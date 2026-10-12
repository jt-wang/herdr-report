// Stands in for a browser's push subscription: holds the private key and
// decrypts what a push service would deliver (RFC 8291 §3.4, the receiving half).
// Written independently of core/push.mjs so the two check each other.
import { createECDH, createHmac, createDecipheriv, randomBytes } from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64url");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

export function fakeSubscription(endpoint) {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    subscription: { endpoint, keys: { p256dh: b64(ua.getPublicKey()), auth: b64(auth) } },
    open(body) {
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const asPublic = body.subarray(21, 21 + idlen);
      const ct = body.subarray(21 + idlen);
      const ikm = hkdf(auth, ua.computeSecret(asPublic), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32);
      const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
      const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
    },
  };
}
