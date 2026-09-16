/**
 * Canonical API response helpers.
 *
 * Preserves the existing envelope exactly:
 *   success -> { success: true, data, meta? } / { success: true, data, pagination, meta }
 *   failure -> { success: false, error: { code, message, details? } }
 *
 * `lib/envelope.ts` remains the implementation; import from here in new
 * controller code so the dependency direction stays Route -> Controller -> Service.
 */
export { ok, okList, fail } from "../lib/envelope.js";
