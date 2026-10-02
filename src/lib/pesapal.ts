import "server-only";
import { pesapalBase, pesapalConfigured } from "./env";
import { getSetting, setSetting } from "./repo";

/**
 * PesaPal API v3 client (https://pay.pesapal.com/v3 live).
 * Flow: RequestToken -> RegisterIPN (once per callback URL) -> SubmitOrderRequest
 * (returns redirect_url) -> [customer pays on PesaPal's hosted page] ->
 * IPN / callback -> GetTransactionStatus (the only thing we trust).
 */

export class PesapalError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

async function call<T>(path: string, init: { method?: "GET" | "POST"; token?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${pesapalBase()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new PesapalError(`PesaPal unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body handled below */
  }
  // PesaPal reports many failures as HTTP 200 with a populated `error` object. BUT successful
  // responses carry an `error` object too, with every field null (e.g. GetTransactionStatus
  // returns {"error":{"error_type":null,"code":null,"message":null,...},"status":"200"}),
  // so only treat it as a failure when it actually contains something.
  const err = json?.error;
  const errorDetail =
    err && typeof err === "object"
      ? (err.message ?? err.code ?? err.error_type ?? null)
      : typeof err === "string" && err
        ? err
        : null;
  if (!res.ok || errorDetail) {
    const detail = errorDetail ?? json?.message ?? (text.slice(0, 200) || res.statusText);
    throw new PesapalError(`PesaPal ${path} failed (${res.status}): ${detail}`);
  }
  return json as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Bearer token (valid ~5 min). Cached per server instance until shortly before it expires. */
export async function getToken(): Promise<string> {
  if (!pesapalConfigured()) throw new PesapalError("PesaPal is not configured (PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET).", 503);
  if (cachedToken && cachedToken.expiresAt - Date.now() > 30_000) return cachedToken.token;
  const r = await call<{ token?: string; expiryDate?: string }>("/api/Auth/RequestToken", {
    method: "POST",
    body: { consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET },
  });
  if (!r.token) throw new PesapalError("PesaPal returned no token (check the consumer key/secret and PESAPAL_ENV).");
  const expiry = r.expiryDate ? new Date(r.expiryDate).getTime() : NaN;
  cachedToken = { token: r.token, expiresAt: Number.isFinite(expiry) ? expiry : Date.now() + 4 * 60_000 };
  return r.token;
}

export function resetTokenCache() {
  cachedToken = null;
}

// ── IPN registration ────────────────────────────────────────────────────────

const ipnMemo = new Map<string, string>();

/**
 * The notification_id for our IPN URL. Resolution order: PESAPAL_IPN_ID env override,
 * this instance's memory, the database (so every instance shares it), then register
 * with PesaPal and persist.
 */
export async function ensureIpnId(ipnUrl: string): Promise<string> {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;
  const key = `pesapal_ipn:${pesapalBase()}:${ipnUrl}`;
  const memo = ipnMemo.get(key);
  if (memo) return memo;
  const stored = await getSetting(key);
  if (stored) {
    ipnMemo.set(key, stored);
    return stored;
  }
  const token = await getToken();
  const r = await call<{ ipn_id?: string }>("/api/URLSetup/RegisterIPN", {
    method: "POST",
    token,
    body: { url: ipnUrl, ipn_notification_type: "GET" },
  });
  if (!r.ipn_id) throw new PesapalError("PesaPal did not return an ipn_id.");
  await setSetting(key, r.ipn_id);
  ipnMemo.set(key, r.ipn_id);
  return r.ipn_id;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export type SubmitOrder = {
  merchantReference: string;
  currency: "USD" | "KES";
  amount: number;
  description: string;
  callbackUrl: string;
  cancellationUrl: string;
  notificationId: string;
  billing: { email: string; phone?: string };
};

export async function submitOrder(o: SubmitOrder): Promise<{ orderTrackingId: string; redirectUrl: string }> {
  const token = await getToken();
  const r = await call<{ order_tracking_id?: string; redirect_url?: string; merchant_reference?: string }>(
    "/api/Transactions/SubmitOrderRequest",
    {
      method: "POST",
      token,
      body: {
        id: o.merchantReference,
        currency: o.currency,
        amount: o.amount,
        description: o.description.slice(0, 100),
        callback_url: o.callbackUrl,
        cancellation_url: o.cancellationUrl,
        redirect_mode: "TOP_WINDOW",
        notification_id: o.notificationId,
        billing_address: {
          email_address: o.billing.email,
          ...(o.billing.phone ? { phone_number: o.billing.phone } : {}),
          first_name: "RandomChat",
          last_name: "Customer",
        },
      },
    },
  );
  if (!r.order_tracking_id || !r.redirect_url) throw new PesapalError("PesaPal did not return a redirect_url.");
  return { orderTrackingId: r.order_tracking_id, redirectUrl: r.redirect_url };
}

export type TransactionStatus = {
  /** 0 = invalid/not paid yet, 1 = completed, 2 = failed, 3 = reversed */
  statusCode: 0 | 1 | 2 | 3;
  description: string;
  amount: number;
  currency: string;
  merchantReference: string;
  confirmationCode: string | null;
  paymentMethod: string | null;
};

export async function getTransactionStatus(orderTrackingId: string): Promise<TransactionStatus> {
  const token = await getToken();
  const r = await call<any>(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, { token });
  const code = Number(r.status_code ?? r.payment_status_code);
  return {
    statusCode: ([0, 1, 2, 3].includes(code) ? code : 0) as 0 | 1 | 2 | 3,
    description: String(r.payment_status_description ?? ""),
    amount: Number(r.amount),
    currency: String(r.currency ?? ""),
    merchantReference: String(r.merchant_reference ?? ""),
    confirmationCode: r.confirmation_code ?? null,
    paymentMethod: r.payment_method ?? null,
  };
}
