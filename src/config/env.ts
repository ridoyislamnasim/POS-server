/** Centralized environment access. Keeps `process.env` reads in one place. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3020")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
} as const;
