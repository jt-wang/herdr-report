// Web Push without dependencies: VAPID (RFC 8292) and aes128gcm payload
// encryption (RFC 8291). From codexbar-pwa (MIT, same author).
//
// The payload is encrypted rather than sent empty-and-fetched-on-wake because the
// phone is often off the tailnet exactly when a notification matters. An empty push
// would arrive as a blank notification with no way to fill it in.

import { createECDH, createHmac, createCipheriv, randomBytes, generateKeyPairSync, createSign, createVerify, createPrivateKey, createPublicKey } from 'node:crypto'

const b64 = (buf) => Buffer.from(buf).toString('base64url')
const unb64 = (s) => Buffer.from(s, 'base64url')

const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/** HKDF with a single-block expand, which is all Web Push ever needs. */
const hkdf = (salt, ikm, info, length) =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length)

export function generateVapidKeys() {
  // generateKeyPairSync already hands back KeyObjects; exporting them to JWK directly
  // avoids round-tripping through createPublicKey/createPrivateKey, which reject a
  // KeyObject argument.
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  return {
    // The uncompressed point the browser expects for applicationServerKey.
    publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(pub.x), unb64(pub.y)])),
    privateJwk: privateKey.export({ format: 'jwk' }),
  }
}

/** VAPID authorisation header for one push endpoint. */
function vapidHeader({ endpoint, publicKey, privateJwk, subject }) {
  const aud = new URL(endpoint).origin
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const body = b64(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }))
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' })
  // JOSE wants the raw r||s pair; Node signs DER unless told otherwise.
  const sig = createSign('SHA256')
    .update(`${header}.${body}`)
    .sign({ key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${body}.${b64(sig)}, k=${publicKey}`
}

/** RFC 8291 aes128gcm body for one subscription. */
function encrypt(subscription, plaintext) {
  const uaPublic = unb64(subscription.keys.p256dh)
  const authSecret = unb64(subscription.keys.auth)

  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(uaPublic)

  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), uaPublic, asPublic,
  ])
  const ikm = hkdf(authSecret, shared, keyInfo, 32)

  const salt = randomBytes(16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02 is the last-record delimiter; there is only ever one record here.
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])])
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()])

  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body])
}

/**
 * Returns { ok } or { gone }. A 404/410 means the subscription is dead and the
 * caller should drop it, which is the only way the file stays clean.
 */
export async function sendPush(subscription, payload, vapid) {
  const body = encrypt(subscription, JSON.stringify(payload))
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      Authorization: vapidHeader({ endpoint: subscription.endpoint, ...vapid }),
    },
    body,
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 404 || res.status === 410) return { gone: true }
  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` }
  return { ok: true }
}
