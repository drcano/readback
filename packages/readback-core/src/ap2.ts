// AP2 import (SPEC §4.6): read a real AP2 v0.2 payment mandate chain (open mandate ~~ closed
// mandate, SD-JWT) and run Readback-style checks on it. Fails closed, and says "unresolved" (AP2's
// own word) for anything it can't evaluate instead of guessing. Browser-safe, like the rest of core.
//
// What it checks:            what it can't, and says so:
//  - every disclosure digest   - the issuer's signature (AP2 publishes no key for the agent provider)
//  - the agent's signature on  - payment.reference (binds to an AP2 checkout mandate; none on PayPal)
//    the closed mandate        - budget / agent_recurrence (need memory of earlier uses; Readback is
//  - sd_hash binding             stateless; on PayPal rails, invoice uniqueness plays this role)
//  - amount, payee, dates      - instrument / PISP limits
import { base64url, compactVerify, importJWK } from "jose";
import { type PublicJwk, PublicJwkSchema } from "./jws.ts";
import { agentFingerprint } from "./thumbprint.ts";

export type Ap2Status = "pass" | "fail" | "unresolved";
export type Ap2Finding = { item: string; status: Ap2Status; detail: string };
export type Ap2Result = {
  verdict: "allow" | "deny" | "unresolved";
  findings: Ap2Finding[];
  // The same agreement expressed in Readback's terms, where AP2 has an equivalent.
  mapped: { merchant: string | null; capCents: number | null; fingerprint: string | null; notApplicable: string[] };
  purchase: { payeeId: string; amountCents: number; currency: string } | null;
};

type Json = unknown;
const decodeJson = (part: string): Json => JSON.parse(new TextDecoder().decode(base64url.decode(part)));

async function digest(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url.encode(new Uint8Array(d));
}

class Hidden extends Error {}

// SD-JWT: an array element {"...": digest} stands for the disclosure with that digest. Anything we
// can't reveal is treated as hidden, and hidden content is a failure, never a pass.
function reveal(value: Json, disclosures: Map<string, Json>): Json {
  if (Array.isArray(value)) {
    return value.map((el) => {
      if (el && typeof el === "object" && !Array.isArray(el) && Object.keys(el).length === 1 && "..." in el) {
        const d = disclosures.get(String((el as Record<string, Json>)["..."]));
        if (d === undefined) throw new Hidden("an array element is still hidden");
        return reveal(d, disclosures);
      }
      return reveal(el, disclosures);
    });
  }
  if (value && typeof value === "object") {
    if ("_sd" in value) throw new Hidden("object properties are still hidden");
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reveal(v, disclosures)]));
  }
  return value;
}

// "jwt~d1~d2~" → the JWT payload and a digest → value map of its disclosures.
async function parseSdJwt(token: string): Promise<{ jws: string; header: Record<string, Json>; payload: Record<string, Json>; disclosures: Map<string, Json> }> {
  const [jws, ...rest] = token.split("~");
  if (!jws || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) throw new Error("not an SD-JWT");
  const disclosures = new Map<string, Json>();
  for (const d of rest.filter(Boolean)) {
    const arr = decodeJson(d);
    if (!Array.isArray(arr) || (arr.length !== 2 && arr.length !== 3)) throw new Error("malformed disclosure");
    disclosures.set(await digest(d), arr[arr.length - 1]);
  }
  const [h, p] = jws.split(".") as [string, string];
  return { jws, header: decodeJson(h) as Record<string, Json>, payload: decodeJson(p) as Record<string, Json>, disclosures };
}

const obj = (v: Json): Record<string, Json> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {});

export async function evaluateAp2Chain(chain: string): Promise<Ap2Result> {
  const findings: Ap2Finding[] = [];
  const add = (item: string, status: Ap2Status, detail: string) => findings.push({ item, status, detail });
  const mapped: Ap2Result["mapped"] = { merchant: null, capCents: null, fingerprint: null, notApplicable: ["SKU", "quantity per order"] };
  const done = (purchase: Ap2Result["purchase"] = null): Ap2Result => ({
    verdict: findings.some((f) => f.status === "fail") ? "deny" : findings.some((f) => f.status === "unresolved") ? "unresolved" : "allow",
    findings,
    mapped,
    purchase,
  });

  try {
    const parts = chain.trim().split("~~");
    if (parts.length !== 2) throw new Error("expected one open mandate and one closed mandate");
    const openToken = `${parts[0]}~`; // the open SD-JWT as presented, trailing "~" included
    const open = await parseSdJwt(openToken);
    const closed = await parseSdJwt(parts[1]!);

    add("Issuer signature on the open mandate", "unresolved", `Signed with ${String(open.header["kid"] ?? "an unnamed key")}; AP2 publishes no public key for it, so it can't be checked here.`);

    // The open mandate (what the user authorized).
    const om = obj((reveal(open.payload["delegate_payload"], open.disclosures) as Json[])[0]);
    if (om["vct"] !== "mandate.payment.open.1") throw new Error("not an AP2 open payment mandate");
    const jwkIn = obj(obj(om["cnf"])["jwk"]);
    if ("d" in jwkIn || "jku" in jwkIn || "x5u" in jwkIn || "x5c" in jwkIn) throw new Error("the agent key in cnf is not a plain public key");
    const jwk: PublicJwk = PublicJwkSchema.parse({ kty: jwkIn["kty"], crv: jwkIn["crv"], x: jwkIn["x"], y: jwkIn["y"] });
    mapped.fingerprint = await agentFingerprint(jwk);

    // The closed mandate (what the agent asked for), signed by that agent key.
    if (closed.header["alg"] !== "ES256" || closed.header["typ"] !== "kb+sd-jwt") throw new Error("closed mandate isn't an ES256 key-binding JWT");
    try {
      await compactVerify(closed.jws, await importJWK(jwk, "ES256"), { algorithms: ["ES256"] });
      add("Agent's signature on the closed mandate", "pass", "Verifies with the key the open mandate names (cnf).");
    } catch {
      add("Agent's signature on the closed mandate", "fail", "Doesn't verify with the key the open mandate names.");
    }
    const sdHash = await digest(openToken);
    add("Closed mandate bound to this open mandate (sd_hash)", closed.payload["sd_hash"] === sdHash ? "pass" : "fail", closed.payload["sd_hash"] === sdHash ? "sd_hash matches." : "sd_hash names a different open mandate.");

    const cm = obj((reveal(closed.payload["delegate_payload"], closed.disclosures) as Json[])[0]);
    if (cm["vct"] !== "mandate.payment.1") throw new Error("not an AP2 closed payment mandate");
    const amount = obj(cm["payment_amount"]);
    const payee = obj(cm["payee"]);
    const amountCents = Number(amount["amount"]);
    const currency = String(amount["currency"] ?? "");
    if (!Number.isInteger(amountCents) || amountCents < 0) throw new Error("closed mandate amount isn't integer minor units");
    const purchase = { payeeId: String(payee["id"] ?? ""), amountCents, currency };
    const iat = Number(closed.payload["iat"]);

    const openIat = Number(om["iat"]);
    const openExp = Number(om["exp"]);
    if (Number.isFinite(openIat) && Number.isFinite(openExp)) {
      const ok = iat >= openIat && iat <= openExp;
      add("Signed while the open mandate was valid", ok ? "pass" : "fail", ok ? "Closed mandate iat is within the open mandate's iat..exp." : "Signed outside the open mandate's validity window.");
    }

    // Constraints. AP2: an unknown constraint MUST fail evaluation (unresolved_constraint).
    const constraints = om["constraints"];
    if (!Array.isArray(constraints)) throw new Error("open mandate has no constraints");
    for (const raw of constraints) {
      const c = obj(raw);
      switch (c["type"]) {
        case "payment.amount_range": {
          const max = Number(c["max"]);
          const min = c["min"] === undefined ? 0 : Number(c["min"]);
          const ok = c["currency"] === currency && Number.isInteger(max) && amountCents <= max && amountCents >= min;
          if (c["currency"] === "USD" && Number.isInteger(max)) mapped.capCents = max;
          add("Amount within range", ok ? "pass" : "fail", `${currency} ${(amountCents / 100).toFixed(2)} vs ${String(c["currency"])} ${(min / 100).toFixed(2)}–${(max / 100).toFixed(2)}.`);
          break;
        }
        case "payment.allowed_payees": {
          const allowed = (Array.isArray(c["allowed"]) ? c["allowed"] : []).map(obj);
          const ok = allowed.some((p) => p["id"] === purchase.payeeId);
          if (allowed.length === 1) mapped.merchant = String(allowed[0]!["name"] ?? allowed[0]!["id"]);
          add("Payee allowed", ok ? "pass" : "fail", ok ? `Payee ${purchase.payeeId} is allowed.` : `Payee ${purchase.payeeId} isn't in the allowed list.`);
          break;
        }
        case "payment.execution_date": {
          const nb = c["not_before"] === undefined ? -Infinity : Date.parse(String(c["not_before"])) / 1000;
          const na = c["not_after"] === undefined ? Infinity : Date.parse(String(c["not_after"])) / 1000;
          const ok = !Number.isNaN(nb) && !Number.isNaN(na) && iat >= nb && iat <= na;
          add("Within the execution dates", ok ? "pass" : "fail", ok ? "Signed within not_before..not_after." : "Signed outside (or unreadable) execution dates.");
          break;
        }
        case "payment.reference":
          add("Reference to a checkout mandate", "unresolved", "Binds to an AP2 checkout mandate; there is none on PayPal rails to compare.");
          break;
        case "payment.agent_recurrence":
        case "payment.budget":
          add(`Constraint ${String(c["type"])}`, "unresolved", "Needs memory of earlier uses; Readback is stateless. On PayPal rails, one invoice per period plays this role.");
          break;
        case "payment.allowed_payment_instruments":
        case "payment.allowed_pisps":
          add(`Constraint ${String(c["type"])}`, "unresolved", "Instrument limits aren't evaluated here.");
          break;
        default:
          add(`Constraint ${String(c["type"])}`, "fail", "Unknown constraint type; AP2 requires unknown constraints to fail (unresolved_constraint).");
      }
    }
    return done(purchase);
  } catch (err) {
    add("Mandate chain readable", "fail", err instanceof Hidden ? `Hidden content can't be checked: ${err.message}.` : err instanceof Error ? err.message : "Unreadable.");
    return done();
  }
}
