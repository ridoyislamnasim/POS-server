import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { signAccess, signRefresh } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { authRepository } from "./auth.repository.js";
import type { LoginInput, RequestMeta } from "./auth.types.js";

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_WINDOW_MS = 15 * 60_000;

/**
 * Business logic for authentication.
 * No Express `req`/`res` here — callers pass plain inputs + request metadata.
 */
export const authService = {
  async login(input: LoginInput, meta: RequestMeta) {
    const email = String(input.email ?? "").trim();
    const password = String(input.password ?? "");
    if (!email || !password) {
      throw new AppError("VALIDATION", "Email and password required", 400);
    }

    const user = await authRepository.findUserByEmail(email);
    const recent = await authRepository.countRecentFailedLogins(
      email,
      new Date(Date.now() - LOCK_WINDOW_MS),
    );
    if (recent >= MAX_FAILED_ATTEMPTS) {
      throw new AppError("FORBIDDEN", "Account locked. Try later.", 429);
    }

    const good = user ? await bcrypt.compare(password, user.passwordHash) : false;
    await authRepository.recordLoginAttempt(email, Boolean(good), meta.ip);
    if (!user || !good || user.status !== "ACTIVE") {
      throw new AppError("UNAUTHORIZED", "Invalid email or password", 401);
    }

    const isPlatformUser = user.roles.some((r) => r.role.key === "PLATFORM_SUPER_ADMIN");

    let membership: (typeof user.tenants)[number] | null;
    if (isPlatformUser) {
      membership = input.tenantId
        ? (user.tenants.find((t) => t.tenantId === input.tenantId) ?? null)
        : null;
      if (input.tenantId && !membership) {
        throw new AppError("FORBIDDEN", "No tenant access", 403);
      }
    } else {
      if (!input.tenantId) {
        throw new AppError("FORBIDDEN", "Tenant ID required", 403);
      }
      membership = user.tenants.find((t) => t.tenantId === input.tenantId) ?? null;
      if (!membership) throw new AppError("FORBIDDEN", "No tenant access", 403);
    }

    const tenantId = membership?.tenantId ?? null;

    const session = await authRepository.createPendingSession(user.id, meta.userAgent, meta.ip);
    const access = signAccess({ sub: user.id, tenantId, sid: session.id });
    const refresh = signRefresh({ sub: user.id, sid: session.id });
    await authRepository.storeRefreshHash(
      session.id,
      createHash("sha256").update(refresh).digest("hex"),
    );
    const csrf = randomBytes(24).toString("hex");

    await writeAudit({
      tenantId,
      userId: user.id,
      actorUserId: user.id,
      action: "login",
      entityType: "Session",
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      access,
      refresh,
      csrf,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        locale: user.locale,
        roles: user.roles.map((r) => r.role.key),
        tenant: membership?.tenant ?? null,
        branches: user.branches.map((b) => b.branch),
        allBranches: membership?.allBranches ?? false,
        isPlatform: isPlatformUser,
      },
    };
  },

  async logout(ctx: RequestContext, meta: RequestMeta) {
    if (ctx.sessionId) {
      await authRepository.revokeSession(ctx.sessionId, ctx.userId);
    } else {
      await authRepository.revokeAllSessions(ctx.userId);
    }
    await writeAudit({
      ctx,
      action: "logout",
      entityType: "Session",
      entityId: ctx.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { signedOut: true };
  },

  async me(ctx: RequestContext) {
    const user = await authRepository.findUserForMe(ctx.userId);
    if (!user) throw new AppError("UNAUTHORIZED", "Not found", 401);

    const branches =
      ctx.allBranches || ctx.isPlatform
        ? ctx.tenantId
          ? await authRepository.listBranchesForTenant(ctx.tenantId)
          : []
        : user.branches.map((b) => b.branch);

    const tenant = ctx.tenantId ? await authRepository.findTenantApiAccess(ctx.tenantId) : null;
    const apiAccessEnabled = ctx.isPlatform ? true : tenant?.apiAccessEnabled !== false;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      permissions: ctx.permissions,
      roles: ctx.roles,
      tenantId: ctx.tenantId,
      tenants: user.tenants.map((t) => t.tenant),
      branches,
      allBranches: ctx.allBranches,
      isPlatform: ctx.isPlatform,
      apiAccessEnabled,
      lockMessage: apiAccessEnabled
        ? null
        : tenant?.apiAccessDisabledReason ||
          "Please pay your previous month's bill to continue using the platform.",
    };
  },
};
