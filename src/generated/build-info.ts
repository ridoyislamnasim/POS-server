/**
 * Build fingerprint. CI overwrites this file before `pnpm build`
 * (see .github/workflows/deploy.yml "Bake build info") so the
 * deployed app can report exactly which commit is live via
 * GET /api/version. Local default stays "dev".
 */
export const BUILD_SHA = "dev";
export const BUILD_TIME = "dev";
