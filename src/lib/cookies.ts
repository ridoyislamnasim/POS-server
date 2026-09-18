import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

const isProd = process.env.NODE_ENV === "production";

export const ACCESS_COOKIE = "pos_access";
export const REFRESH_COOKIE = "pos_refresh";
export const CSRF_COOKIE = "pos_csrf";

/**
 * Normalize a cookie domain: strip protocol/path/port, lowercase.
 * Returns undefined for localhost / IPs / single-label hosts where a
 * Domain attribute would be rejected (fall back to host-only cookies).
 */
function normalizeDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let v = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = (v.split("/")[0] ?? "").split(":")[0] ?? "";
  v = v.replace(/^\.+|\.+$/g, "");
  if (!v || v === "localhost" || !v.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(v) || v.includes(":")) {
    return undefined;
  }
  return v;
}

/**
 * Shared cookie domain so the frontend origin (apex / mobile subdomain)
 * can read the CSRF cookie set by the API subdomain and send it back as
 * X-CSRF-Token. Without this, every unsafe request fails with
 * 403 "CSRF token mismatch".
 *
 * Explicit COOKIE_DOMAIN wins; otherwise auto-derive the last two labels
 * of the API host (server.shohojhisab.com -> shohojhisab.com).
 * Localhost/IPs stay host-only (undefined).
 */
export function cookieDomainFor(hostname?: string): string | undefined {
  const configured = normalizeDomain(env.cookieDomain);
  if (configured) return configured;
  if (!hostname) return undefined;
  const host = (hostname.trim().toLowerCase().split(":")[0] ?? "").replace(/\.$/, "");
  if (!host || host === "localhost" || !host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return undefined;
  }
  return host.split(".").slice(-2).join(".");
}

function baseCookie(domain?: string): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

/** Expire legacy host-only cookies left over from before domain sharing. */
function clearHostOnlyAuthCookies(res: Response) {
  const opts: CookieOptions = { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

export function setAuthCookies(
  res: Response,
  access: string,
  refresh: string,
  csrf: string,
  hostname?: string,
) {
  const domain = cookieDomainFor(hostname);
  if (domain) clearHostOnlyAuthCookies(res);
  res.cookie(ACCESS_COOKIE, access, { ...baseCookie(domain), maxAge: 8 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...baseCookie(domain), maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie(CSRF_COOKIE, csrf, {
    ...baseCookie(domain),
    httpOnly: false,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response, hostname?: string) {
  const domain = cookieDomainFor(hostname);
  const opts = { ...baseCookie(domain) };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
  if (domain) clearHostOnlyAuthCookies(res);
}
