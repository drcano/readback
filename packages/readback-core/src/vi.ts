// Verifiable Intent import: read a Mastercard Verifiable Intent (draft v0.1) autonomous chain as the
// payment network sees it (L1 issuer credential, L2 user mandate with its payment disclosures, L3a
// agent payment mandate) and run Readback-style checks on it, following VI's verifier rules
// (spec README §10.4). VI is evidence only: it defines no dispute procedure. This is the check a
// dispute would run. Fails closed, and says "unresolved" for what it can't evaluate.
//
// What it checks:                      what it can't, and says so:
//  - signatures at all three layers      - the issuer's signature, unless the caller supplies the key
//    (issuer → user → agent, via cnf)    - mandate.payment.reference (needs the merchant's L3b)
//  - both sd_hash bindings               - recurrence / agent_recurrence / budget (need memory of
//  - signing-time validity windows         earlier charges; on PayPal, invoice uniqueness does this)
//  - amount, payee, payment instrument
import { compactVerify, importJWK } from "jose";
import type { Ap2Finding, Ap2Result, Ap2Status } from "./ap2.ts";
import { type PublicJwk, PublicJwkSchema } from "./jws.ts";
import { digest, type Json, obj, parseSdJwt, revealPresented } from "./sd-jwt.ts";
import { agentFingerprint } from "./thumbprint.ts";

export type ViChain = { l1: string; l2: string; l3a: string };
export type ViResult = Ap2Result;

// A plain P-256 public key from a cnf claim: no private part, no fetch-a-key members.
function cnfKey(holder: Json): { jwk: PublicJwk; kid: string | null } {
  const raw = obj(obj(holder)["cnf"])["jwk"];
  const jwk = obj(raw);
  if ("d" in jwk || "jku" in jwk || "x5u" in jwk || "x5c" in jwk) throw new Error("a cnf key is not a plain public key");
  return { jwk: PublicJwkSchema.parse({ kty: jwk["kty"], crv: jwk["crv"], x: jwk["x"], y: jwk["y"] }), kid: typeof jwk["kid"] === "string" ? jwk["kid"] : null };
}

async function verifies(jws: string, jwk: PublicJwk): Promise<boolean> {
  try {
    await compactVerify(jws, await importJWK(jwk, "ES256"), { algorithms: ["ES256"] });
    return true;
  } catch {
    return false;
  }
}

// VI pins a typ per layer (spec README §10.4 item 3).
function header(layer: string, h: Record<string, Json>, typ: string) {
  if (h["alg"] !== "ES256" || h["typ"] !== typ) throw new Error(`${layer} isn't an ES256 ${typ} credential`);
}

export async function evaluateViChain(chain: ViChain, issuer?: { jwk: PublicJwk; label: string }): Promise<ViResult> {
  const findings: Ap2Finding[] = [];
  const add = (item: string, status: Ap2Status, detail: string) => findings.push({ item, status, detail });
  const pass = (ok: boolean, item: string, yes: string, no: string) => add(item, ok ? "pass" : "fail", ok ? yes : no);
  const mapped: ViResult["mapped"] = { merchant: null, capCents: null, fingerprint: null, notApplicable: ["SKU", "quantity per order"] };
  const done = (purchase: ViResult["purchase"] = null): ViResult => ({
    verdict: findings.some((f) => f.status === "fail") ? "deny" : findings.some((f) => f.status === "unresolved") ? "unresolved" : "allow",
    findings,
    mapped,
    purchase,
  });

  try {
    const l1 = await parseSdJwt(chain.l1.trim());
    const l2 = await parseSdJwt(chain.l2.trim());
    const l3 = await parseSdJwt(chain.l3a.trim());
    header("L1", l1.header, "sd+jwt");
    header("L2", l2.header, "kb-sd-jwt+kb"); // autonomous mode
    header("L3a", l3.header, "kb-sd-jwt");

    // L1: the issuer vouches for the user's key.
    if (issuer) pass(await verifies(l1.jws, issuer.jwk), "Issuer's signature on the credential (L1)", `Verifies with ${issuer.label}.`, `Doesn't verify with ${issuer.label}.`);
    else add("Issuer's signature on the credential (L1)", "unresolved", `Signed with ${String(l1.header["kid"] ?? "an unnamed key")}; no issuer key was supplied to check it.`);
    const user = cnfKey(l1.payload);

    // L2: the user's mandate, signed by the key L1 names and bound to that exact L1.
    pass(await verifies(l2.jws, user.jwk), "User's signature on her mandate (L2)", "Verifies with the key the credential names (cnf).", "Doesn't verify with the key the credential names.");
    pass(l2.payload["sd_hash"] === (await digest(chain.l1.trim())), "Mandate bound to this credential (sd_hash)", "L2's sd_hash matches L1.", "L2's sd_hash names a different credential.");

    // The payment mandate, among the L2 mandates disclosed to this party.
    const mandate = obj(revealPresented(l2.payload["delegate_payload"], l2.disclosures).map(obj).find((d) => d["vct"] === "mandate.payment.open.1"));
    if (mandate["vct"] === undefined) throw new Error("no payment mandate is disclosed in L2");
    const agent = cnfKey(mandate);
    mapped.fingerprint = await agentFingerprint(agent.jwk);

    // L3a: the agent's payment, signed by the key the mandate delegates to and bound to this L2.
    if (agent.kid !== null && l3.header["kid"] !== agent.kid) throw new Error("L3a's kid doesn't name the delegated agent key");
    if ("cnf" in l3.payload) throw new Error("L3a carries its own cnf key, which VI forbids");
    pass(await verifies(l3.jws, agent.jwk), "Agent's signature on the payment (L3a)", "Verifies with the key the user's mandate delegates to (cnf).", "Doesn't verify with the key the user's mandate delegates to.");
    pass(l3.payload["sd_hash"] === (await digest(chain.l2.trim())), "Payment bound to this mandate (sd_hash)", "L3a's sd_hash matches L2 as presented.", "L3a's sd_hash names a different mandate.");

    // Each layer signed while the one above it was valid. A dispute asks about the moment of
    // payment, so this is checked at signing time, not against today's clock.
    const t = (p: Record<string, Json>, k: string) => Number(p[k]);
    const within = (inner: Record<string, Json>, outer: Record<string, Json>) => t(inner, "iat") >= t(outer, "iat") && t(inner, "iat") <= t(outer, "exp");
    const shortLived = t(l3.payload, "exp") - t(l3.payload, "iat") <= 3600; // VI: L3 lives at most an hour
    pass(within(l2.payload, l1.payload) && within(l3.payload, l2.payload) && shortLived, "Signed while each layer was valid", "L2 within L1's validity, L3a within L2's, L3a lives under an hour. Checked at signing time: a dispute asks whether the chain was valid when the agent paid.", "A layer was signed outside the validity of the one above it, or L3a lives over an hour.");

    const payment = obj(revealPresented(l3.payload["delegate_payload"], l3.disclosures).map(obj).find((d) => d["vct"] === "mandate.payment.1"));
    if (payment["vct"] === undefined) throw new Error("no payment is disclosed in L3a");
    const amount = obj(payment["payment_amount"]);
    const payeeId = String(obj(payment["payee"])["id"] ?? "");
    const amountCents = amount["amount"];
    const currency = String(amount["currency"] ?? "");
    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 0) throw new Error("L3a amount isn't integer minor units");
    const purchase = { payeeId, amountCents, currency };

    const l2Instrument = obj(mandate["payment_instrument"]);
    if (l2Instrument["id"] !== undefined) {
      const l3Instrument = obj(payment["payment_instrument"]);
      pass(l3Instrument["id"] === l2Instrument["id"] && l3Instrument["type"] === l2Instrument["type"], "Payment instrument is the one she authorized", "L3a's instrument matches L2's.", "L3a pays with a different instrument than L2 authorized.");
    }

    const constraints = mandate["constraints"];
    if (!Array.isArray(constraints)) throw new Error("the payment mandate has no constraints");
    for (const raw of constraints) {
      const c = obj(raw);
      switch (c["type"]) {
        case "mandate.payment.amount_range": {
          const int = (v: Json) => v === undefined || (typeof v === "number" && Number.isInteger(v));
          const min = c["min"] === undefined ? 0 : Number(c["min"]);
          const max = c["max"] === undefined ? Infinity : Number(c["max"]);
          const ok = int(c["min"]) && int(c["max"]) && c["currency"] === currency && amountCents >= min && amountCents <= max;
          if (c["currency"] === "USD" && Number.isInteger(max)) mapped.capCents = max;
          add("Amount within range", ok ? "pass" : "fail", `${currency} ${(amountCents / 100).toFixed(2)} vs ${String(c["currency"])} ${(min / 100).toFixed(2)}–${Number.isFinite(max) ? (max / 100).toFixed(2) : "no cap"}.`);
          break;
        }
        case "mandate.payment.allowed_payees": {
          // Only disclosed payees can count; one this party can't see never makes a pass.
          const shown = revealPresented(c["allowed"], l2.disclosures).map(obj);
          const total = Array.isArray(c["allowed"]) ? c["allowed"].length : 0;
          mapped.merchant = shown.length ? shown.map((p) => String(p["name"] ?? p["id"])).join(", ") + (shown.length < total ? ` (${shown.length} of ${total} allowed payees disclosed here)` : "") : null;
          if (shown.length === 0) add("Payee allowed", "unresolved", "None of the allowed payees is disclosed to this party.");
          else pass(shown.some((p) => p["id"] === payeeId), "Payee allowed", `Payee ${payeeId} is allowed (${shown.length} of ${total} allowed payees disclosed here).`, `Payee ${payeeId} isn't among the ${shown.length} of ${total} allowed payees disclosed here.`);
          break;
        }
        case "mandate.payment.reference":
          add("Reference to the checkout mandate", "unresolved", "Binds the payment to the checkout (L3b), which only the merchant receives; the transaction_id ↔ checkout_hash cross-check needs it.");
          break;
        case "mandate.payment.recurrence":
          add("Constraint mandate.payment.recurrence", "unresolved", "Sets up merchant-managed recurring charges, which the network enforces across charges. On PayPal rails, the saved agreement and one invoice per period play this role.");
          break;
        case "mandate.payment.agent_recurrence":
        case "mandate.payment.budget":
          add(`Constraint ${String(c["type"])}`, "unresolved", "Needs memory of earlier charges; Readback is stateless. On PayPal rails, one invoice per period plays this role.");
          break;
        default:
          add(`Constraint ${String(c["type"])}`, "fail", "Unknown constraint type; VI's strict mode, which it says networks should use, fails it.");
      }
    }
    return done(purchase);
  } catch (err) {
    add("Credential chain readable", "fail", err instanceof Error ? err.message : "Unreadable.");
    return done();
  }
}
