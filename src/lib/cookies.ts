import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

const isProd = process.env.NODE_ENV === "production";

export const ACCESS_COOKIE = "pos_access";
export const REFRESH_COOKIE = "pos_refresh";
export const CSRF_COOKIE = "pos_csrf";

function baseCookie(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    // Shared domain (e.g. shohojhisab.com) so the frontend origin
    // (apex / mobile subdomain) can read the CSRF cookie set by the
    // API subdomain and send it back as X-CSRF-Token. Without this,
    // every unsafe request fails with 403 "CSRF token mismatch".
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
  };
}

/** Expire legacy host-only cookies left over from before COOKIE_DOMAIN existed. */
function clearHostOnlyAuthCookies(res: Response) {
  const opts: CookieOptions = { httpOnly: true, secure: isProd, sameSite: "lax", path: "/" };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

export function setAuthCookies(res: Response, access: string, refresh: string, csrf: string) {
  if (env.cookieDomain) clearHostOnlyAuthCookies(res);
  res.cookie(ACCESS_COOKIE, access, { ...baseCookie(), maxAge: 8 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...baseCookie(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie(CSRF_COOKIE, csrf, {
    ...baseCookie(),
    httpOnly: false,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  const opts = { ...baseCookie() };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
  if (env.cookieDomain) clearHostOnlyAuthCookies(res);
}
