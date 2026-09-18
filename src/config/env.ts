/** Centralized environment access. Keeps `process.env` reads in one place. */
const rawOrigins = process.env.WEB_ORIGIN;
if (!rawOrigins) {
  throw new Error("WEB_ORIGIN is required. Set it in .env with comma-separated frontend origins.");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  allowedFrontendOrigins: rawOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
  /**
   * Shared cookie domain (e.g. "shohojhisab.com").
   * Lets the apex + subdomains share auth cookies so browser JS on the
   * frontend origin can read the CSRF cookie set by the API origin.
   * Leave empty for localhost (host-only cookies).
   */
  cookieDomain: (process.env.COOKIE_DOMAIN ?? "").trim() || undefined,
} as const;
