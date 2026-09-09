import type { CookieOptions, Response } from "express";

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
  };
}

export function setAuthCookies(res: Response, access: string, refresh: string, csrf: string) {
  res.cookie(ACCESS_COOKIE, access, { ...baseCookie(), maxAge: 8 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...baseCookie(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  const opts = { ...baseCookie() };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}
