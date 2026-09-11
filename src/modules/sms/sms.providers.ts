import { decryptSecret, sanitizeProviderText } from "./sms.crypto.js";
import { normalizeBdPhone } from "../../shared/phone.js";

export type SmsProviderId = "GENERIC_HTTP" | "CUSTOM" | "BULKSMSBD" | "SSL_WIRELESS" | "TWILIO";

export type SmsProviderConfig = {
  provider: string;
  senderId: string | null;
  apiKeyEnc: string | null;
  apiSecretEnc: string | null;
  apiBaseUrl: string | null;
  extraConfigEnc: string | null;
};

export type SmsSendResult = {
  ok: boolean;
  providerResponse: string;
  error?: string;
  retryable: boolean;
  balance?: number | null;
};

function providerPhone(raw: string) {
  return normalizeBdPhone(raw).replace(/\D/g, "");
}

function mockMode() {
  return process.env.SMS_DEV_MODE === "1" || process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

function extraConfig(cfg: SmsProviderConfig): Record<string, unknown> {
  const raw = decryptSecret(cfg.extraConfigEnc);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = text;
    }
    return { status: res.status, ok: res.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function postForm(url: string, params: Record<string, string>, headers: Record<string, string> = {}, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(params),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendViaProvider(cfg: SmsProviderConfig, to: string, message: string): Promise<SmsSendResult> {
  if (process.env.SMS_FORCE_FAIL === "1") {
    return { ok: false, providerResponse: "forced_failure", error: "forced_failure", retryable: true };
  }
  const apiKey = decryptSecret(cfg.apiKeyEnc);
  const apiSecret = decryptSecret(cfg.apiSecretEnc);
  const sender = cfg.senderId?.trim() || "";
  const phone = providerPhone(to);
  if (!phone) return { ok: false, providerResponse: "", error: "invalid_phone", retryable: false };

  if (mockMode()) {
    if (!apiKey && process.env.SMS_REQUIRE_CREDS === "1") {
      return { ok: false, providerResponse: "", error: "provider_not_configured", retryable: false };
    }
    return { ok: true, providerResponse: "mock:accepted", retryable: false };
  }

  if (!apiKey) {
    return { ok: false, providerResponse: "", error: "provider_not_configured", retryable: false };
  }

  const kind = (cfg.provider || "GENERIC_HTTP").toUpperCase() as SmsProviderId;
  try {
    if (kind === "BULKSMSBD") {
      const url = cfg.apiBaseUrl || "https://bulksmsbd.net/api/smsapi";
      const res = await postForm(url, {
        api_key: apiKey,
        senderid: sender,
        number: phone,
        message,
      });
      const ok = res.ok && !/error|invalid|failed/i.test(res.text.slice(0, 80));
      return {
        ok,
        providerResponse: sanitizeProviderText(res.text),
        error: ok ? undefined : "provider_rejected",
        retryable: !ok && res.status >= 500,
      };
    }

    if (kind === "SSL_WIRELESS") {
      const url = cfg.apiBaseUrl || "https://smsplus.sslwireless.com/api/v3/send-sms";
      const res = await postJson(url, {
        api_token: apiKey,
        sid: sender,
        msisdn: phone,
        sms: message,
        csms_id: `pos${Date.now()}`,
      }, {});
      const payload = res.json as { status?: string; error?: string };
      const ok = res.ok && String(payload?.status ?? "").toLowerCase() !== "failed";
      return {
        ok,
        providerResponse: sanitizeProviderText(res.json),
        error: ok ? undefined : payload?.error || "provider_rejected",
        retryable: !ok && res.status >= 500,
      };
    }

    if (kind === "TWILIO") {
      const sid = apiKey;
      const token = apiSecret;
      if (!token) return { ok: false, providerResponse: "", error: "provider_not_configured", retryable: false };
      const url = cfg.apiBaseUrl || `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const res = await postForm(
        url,
        { From: sender, To: to.startsWith("+") ? to : `+${phone}`, Body: message },
        { Authorization: `Basic ${auth}` },
      );
      const ok = res.ok;
      return {
        ok,
        providerResponse: sanitizeProviderText(res.text),
        error: ok ? undefined : "provider_rejected",
        retryable: !ok && res.status >= 500,
      };
    }

    const extra = extraConfig(cfg);
    const url = cfg.apiBaseUrl || String(extra.url ?? "");
    if (!url) return { ok: false, providerResponse: "", error: "provider_not_configured", retryable: false };
    const body = {
      api_key: apiKey,
      api_secret: apiSecret,
      senderid: sender,
      sender_id: sender,
      to: phone,
      number: phone,
      message,
    };
    const res = extra.form === true
      ? await postForm(url, Object.fromEntries(Object.entries(body).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])))
      : await postJson(url, body, {});
    const ok = res.status < 400;
    return {
      ok,
      providerResponse: sanitizeProviderText("json" in res ? res.json : res.text),
      error: ok ? undefined : "provider_rejected",
      retryable: !ok && res.status >= 500,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "provider_error";
    return { ok: false, providerResponse: sanitizeProviderText(message), error: "provider_error", retryable: true };
  }
}

export async function fetchProviderBalance(cfg: SmsProviderConfig): Promise<{ balance: number | null; raw: string }> {
  const apiKey = decryptSecret(cfg.apiKeyEnc);
  if (!apiKey) return { balance: null, raw: "not_configured" };
  if (mockMode()) return { balance: null, raw: "mock" };
  const kind = (cfg.provider || "").toUpperCase();
  try {
    if (kind === "BULKSMSBD") {
      const url = `https://bulksmsbd.net/api/getBalanceApi?api_key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      const n = Number(String(text).replace(/[^\d.-]/g, ""));
      return { balance: Number.isFinite(n) ? n : null, raw: sanitizeProviderText(text) };
    }
  } catch (e) {
    return { balance: null, raw: sanitizeProviderText(e instanceof Error ? e.message : "balance_failed") };
  }
  return { balance: null, raw: "unsupported" };
}
