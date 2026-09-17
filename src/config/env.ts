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
} as const;
