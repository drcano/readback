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
import { compactVerify, importJWK } from "jose";
import { type PublicJwk, PublicJwkSchema } from "./jws.ts";
import { digest, Hidden, type Json, obj, parseSdJwt, reveal } from "./sd-jwt.ts";
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
    const amountCents = amount["amount"];
    const currency = String(amount["currency"] ?? "");
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 0) throw new Error("closed mandate amount isn't integer minor units");
    const purchase = { payeeId: String(payee["id"] ?? ""), amountCents, currency };
    const iat = Number(closed.payload["iat"]);

    const openIat = Number(om["iat"]);
    const openExp = Number(om["exp"]);
    if (Number.isFinite(openIat) && Number.isFinite(openExp)) {
      const ok = iat >= openIat && iat <= openExp;
      add("Signed while the open mandate was valid", ok ? "pass" : "fail", ok ? "Closed mandate iat is within the open mandate's iat..exp." : "Signed outside the open mandate's validity window.");
    } else add("Signed while the open mandate was valid", "unresolved", "The open mandate carries no validity window (iat, exp) to check.");

    // Constraints. AP2: an unknown constraint MUST fail evaluation (unresolved_constraint).
    const constraints = om["constraints"];
    if (!Array.isArray(constraints)) throw new Error("open mandate has no constraints");
    for (const raw of constraints) {
      const c = obj(raw);
      switch (c["type"]) {
        case "payment.amount_range": {
          const int = (v: Json): v is number => typeof v === "number" && Number.isInteger(v);
          const max = int(c["max"]) ? c["max"] : NaN;
          const min = c["min"] === undefined ? 0 : int(c["min"]) ? c["min"] : NaN;
          const ok = c["currency"] === currency && Number.isInteger(max) && Number.isInteger(min) && amountCents <= max && amountCents >= min;
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
