// Spike step 9 (Node half), SPEC §8 + §4.3: jose 6.x does ES256 compact JWS with an embedded
// jwk, RFC 7638 thumbprints, and pinned-algorithm verification the way Readback needs.
// No PayPal calls, no .env. Run: pnpm spike:crypto
// Key finding this checks: jose verifies signatures but does NOT police header members or typ.
// Those SPEC §4.3 hygiene rules are Readback's job (the `hygiene` function below).
import { calculateJwkThumbprint, CompactSign, compactVerify, EmbeddedJWK, exportJWK, generateKeyPair } from "jose";
import { check } from "./common.ts";

const enc = new TextEncoder();
const b64url = (s: string) => Buffer.from(s).toString("base64url");

// ---------- RFC 7638 §3.1 test vector: proves the thumbprint is the standard one ----------
const rfcJwk = {
  kty: "RSA",
  n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
  e: "AQAB",
};
check("RFC 7638 §3.1 thumbprint vector", (await calculateJwkThumbprint(rfcJwk, "sha256")) === "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs");

// ---------- SPEC §4.3 hygiene: the rules jose doesn't enforce ----------
// Returns a reason string if the header is bad, or null if it's acceptable.
function hygiene(jws: string): string | null {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) return "not compact base64url";
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(jws.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return "header is not JSON";
  }
  const keys = Object.keys(header).sort().join(",");
  if (keys !== "alg,jwk,typ") return `header members must be exactly alg,jwk,typ (got ${keys})`;
  if (header.alg !== "ES256") return "alg must be ES256";
  if (header.typ !== "rb-mandate+jwt") return "typ must be rb-mandate+jwt";
  const jwk = header.jwk as Record<string, unknown>;
  if (Object.keys(jwk).sort().join(",") !== "crv,kty,x,y") return "jwk members must be exactly kty,crv,x,y";
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return "jwk must be EC P-256";
  return null;
}

// Verify = Readback's order: hygiene first, then jose with the algorithm pinned to ES256.
// Returns "ok" or why it was rejected, so each case below can say which layer caught it.
async function verify(jws: string): Promise<string> {
  const bad = hygiene(jws);
  if (bad) return `hygiene: ${bad}`;
  return joseOnly(jws);
}
async function joseOnly(jws: string): Promise<string> {
  try {
    await compactVerify(jws, EmbeddedJWK, { algorithms: ["ES256"] });
    return "ok";
  } catch (e) {
    return `jose: ${(e as Error).message}`;
  }
}

// ---------- happy path ----------
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const { kty, crv, x, y } = await exportJWK(publicKey);
const jwk = { kty, crv, x, y }; // exactly these four members (SPEC §4.3)
const thumbprint = await calculateJwkThumbprint(jwk, "sha256");
const fingerprint = thumbprint.slice(0, 16);
const iat = Math.floor(Date.now() / 1000);
const payload = { v: 1, agr: "SPIKE09TOKEN", th: "0123456789abcdef", sku: "GBP-SR24", qty: 1, unit: "64.99", amt: "64.99", cur: "USD", p: 1, iat, exp: iat + 300, jti: crypto.randomUUID() };

async function sign(header: Record<string, unknown>, body: unknown, key = privateKey): Promise<string> {
  // `as` here because we deliberately build bad headers; jose's type expects a valid one.
  return new CompactSign(enc.encode(JSON.stringify(body))).setProtectedHeader(header as { alg: string }).sign(key);
}

const good = await sign({ alg: "ES256", typ: "rb-mandate+jwt", jwk }, payload);
console.log(`JWS ${good.length} chars (SPEC §4.3 expects ~570), fingerprint ${fingerprint.match(/.{4}/g)!.join("-")}`);
check("valid mandate verifies (hygiene + jose pinned to ES256)", (await verify(good)) === "ok");
const verified = await compactVerify(good, EmbeddedJWK, { algorithms: ["ES256"] });
check("payload round-trips exactly", new TextDecoder().decode(verified.payload) === JSON.stringify(payload));
const headerJwk = verified.protectedHeader.jwk;
check("embedded jwk thumbprint === signer's thumbprint", headerJwk !== undefined && (await calculateJwkThumbprint(headerJwk, "sha256")) === thumbprint);
check("fingerprint is 16 base64url chars (96 bits)", /^[A-Za-z0-9_-]{16}$/.test(fingerprint));

// ---------- negative cases: each must be rejected, and we print which layer caught it ----------
async function mustReject(label: string, jws: string): Promise<void> {
  const why = await verify(jws);
  check(`rejects ${label} -> ${why}`, why !== "ok");
}

const [h, , s] = good.split(".") as [string, string, string];
await mustReject("tampered payload", `${h}.${b64url(JSON.stringify({ ...payload, amt: "6499.00" }))}.${s}`);

const es384 = await generateKeyPair("ES384", { extractable: true });
const jwk384 = await exportJWK(es384.publicKey);
const wrongAlg = await sign({ alg: "ES384", typ: "rb-mandate+jwt", jwk: { kty: jwk384.kty, crv: jwk384.crv, x: jwk384.x, y: jwk384.y } }, payload, es384.privateKey);
await mustReject("alg ES384 (wrong alg header)", wrongAlg);
check("  ...and jose alone also rejects it (algorithm pin works)", (await joseOnly(wrongAlg)) !== "ok");

const algNone = `${b64url(JSON.stringify({ alg: "none", typ: "rb-mandate+jwt", jwk }))}.${good.split(".")[1]}.`;
await mustReject("alg none", algNone);
check("  ...and jose alone also rejects it", (await joseOnly(algNone)) !== "ok");

const withKid = await sign({ alg: "ES256", typ: "rb-mandate+jwt", jwk, kid: "attacker" }, payload);
await mustReject("extra header member (kid)", withKid);
check("  ...jose alone ACCEPTS it, so hygiene is required (expected)", (await joseOnly(withKid)) === "ok");

const wrongTyp = await sign({ alg: "ES256", typ: "JWT", jwk }, payload);
await mustReject("typ JWT", wrongTyp);
check("  ...jose alone ACCEPTS it, so hygiene is required (expected)", (await joseOnly(wrongTyp)) === "ok");

const { d } = await exportJWK(privateKey);
const withD = await sign({ alg: "ES256", typ: "rb-mandate+jwt", jwk: { ...jwk, d } }, payload);
await mustReject("private key (d) inside the embedded jwk", withD);
check("  ...jose alone also rejects it", (await joseOnly(withD)) !== "ok");

const other = await generateKeyPair("ES256", { extractable: true });
const otherJwk = await exportJWK(other.publicKey);
await mustReject("key substitution (header jwk is not the signing key)", await sign({ alg: "ES256", typ: "rb-mandate+jwt", jwk: { kty: otherJwk.kty, crv: otherJwk.crv, x: otherJwk.x, y: otherJwk.y } }, payload));

console.log(process.exitCode ? "\nSome checks FAILED." : "\nAll crypto checks passed.");
