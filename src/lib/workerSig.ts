// Signed calls from the sync worker (GitHub Actions) to the site, keyed off EA_TOKEN_KEY,
// which both sides already have. Valid for 10 minutes.
import { createHmac, timingSafeEqual } from "node:crypto";

const key = () => createHmac("sha256", process.env.EA_TOKEN_KEY || "").update("cfm-worker-call-v1").digest();
export function signWorkerCall(slug: string, ts = Date.now()) {
  return { ts: String(ts), sig: createHmac("sha256", key()).update(`${slug}.${ts}`).digest("hex") };
}
export function checkWorkerCall(slug: string, ts: string | null, sig: string | null) {
  if (!ts || !sig || !process.env.EA_TOKEN_KEY || Math.abs(Date.now() - Number(ts)) > 10 * 60_000) return false;
  const want = Buffer.from(signWorkerCall(slug, Number(ts)).sig, "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
