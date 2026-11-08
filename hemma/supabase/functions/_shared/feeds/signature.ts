// Push requests are signed like Stripe and Mspecs webhooks: HMAC-SHA256 over
// "<timestamp>.<raw body>" with a key shared with the source system, sent as
//   x-hemma-timestamp: 1794140000
//   x-hemma-signature: sha256=<hex>
// Web Crypto only, so this runs in Deno and Node.

const enc = new TextEncoder();
export const MAX_SKEW_S = 300;

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sign(key: string, timestamp: number, body: string): Promise<string> {
  return `sha256=${await hmacHex(key, `${timestamp}.${body}`)}`;
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verify(key: string, timestampHeader: string | null, signatureHeader: string | null, body: string, nowS = Math.floor(Date.now() / 1000)) {
  const ts = Number(timestampHeader);
  if (!timestampHeader || !Number.isInteger(ts)) return { ok: false, reason: 'missing x-hemma-timestamp' };
  if (Math.abs(nowS - ts) > MAX_SKEW_S) return { ok: false, reason: 'timestamp too old or in the future' };
  if (!signatureHeader) return { ok: false, reason: 'missing x-hemma-signature' };
  const expected = await sign(key, ts, body);
  return sameText(expected, signatureHeader.trim()) ? { ok: true, reason: null } : { ok: false, reason: 'signature does not match' };
}
