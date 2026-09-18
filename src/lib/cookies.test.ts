import { describe, expect, it } from "vitest";
import { cookieDomainFor, setAuthCookies } from "./cookies.js";

describe("cookieDomainFor", () => {
  it("derives the shared domain from the API subdomain", () => {
    expect(cookieDomainFor("server.shohojhisab.com")).toBe("shohojhisab.com");
  });

  it("keeps apex domains as-is", () => {
    expect(cookieDomainFor("shohojhisab.com")).toBe("shohojhisab.com");
  });

  it("stays host-only for localhost and IPs", () => {
    expect(cookieDomainFor("localhost")).toBeUndefined();
    expect(cookieDomainFor("127.0.0.1")).toBeUndefined();
    expect(cookieDomainFor(undefined)).toBeUndefined();
  });
});

describe("setAuthCookies", () => {
  it("sets Domain on all cookies for the production API host", () => {
    const calls: [string, Record<string, unknown>][] = [];
    const res = {
      cookie: (n: string, _v: string, o: Record<string, unknown>) => calls.push([n, o]),
      clearCookie: () => {},
    };
    setAuthCookies(res as never, "a", "r", "c", "server.shohojhisab.com");
    expect(calls).toHaveLength(3);
    for (const [, opts] of calls) {
      expect(opts.domain).toBe("shohojhisab.com");
    }
    const csrf = calls.find(([n]) => n === "pos_csrf")!;
    expect(csrf[1].httpOnly).toBe(false);
  });

  it("stays host-only for localhost (dev unchanged)", () => {
    const calls: [string, Record<string, unknown>][] = [];
    const res = {
      cookie: (n: string, _v: string, o: Record<string, unknown>) => calls.push([n, o]),
      clearCookie: () => {},
    };
    setAuthCookies(res as never, "a", "r", "c", "localhost");
    expect(calls).toHaveLength(3);
    for (const [, opts] of calls) {
      expect("domain" in opts).toBe(false);
    }
  });
});
