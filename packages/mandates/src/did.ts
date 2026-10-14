// did:key for Ed25519: "did:key:z" + base58btc(0xed 0x01 ++ 32-byte public key).
// The DID *is* the public key, so verifying needs no registry or network call.
// Browser-safe on purpose (no Node-only APIs): the shopper's key is generated in the browser.
import { base64url, type CryptoKey, exportJWK, generateKeyPair, importJWK } from "jose";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PREFIX = [0xed, 0x01];

function base58Encode(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out; // each leading zero byte is a leading "1"
  }
  return out;
}

function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(digit);
  }
  const body: number[] = [];
  for (; n > 0n; n /= 256n) body.unshift(Number(n % 256n));
  const zeros = text.length - text.replace(/^1+/, "").length;
  return new Uint8Array([...new Uint8Array(zeros), ...body]);
}

export type KeyPair = { did: string; privateKey: CryptoKey };

export async function generateDidKey(): Promise<KeyPair> {
  const { publicKey, privateKey } = await generateKeyPair("Ed25519", { extractable: true });
  const { x } = await exportJWK(publicKey);
  if (!x) throw new Error("expected OKP public key");
  const raw = base64url.decode(x);
  return { did: "did:key:z" + base58Encode(new Uint8Array([...ED25519_PREFIX, ...raw])), privateKey };
}

// Throws on anything that isn't an Ed25519 did:key; callers treat a throw as deny.
export async function publicKeyFromDid(did: string): Promise<CryptoKey> {
  if (!did.startsWith("did:key:z")) throw new Error("not a did:key");
  const bytes = base58Decode(did.slice("did:key:z".length));
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error("not an Ed25519 did:key");
  const x = base64url.encode(bytes.slice(2));
  const key = await importJWK({ kty: "OKP", crv: "Ed25519", x }, "Ed25519");
  if (key instanceof Uint8Array) throw new Error("unexpected symmetric key");
  return key;
}
