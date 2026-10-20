import "server-only";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STUN: IceServer = { urls: "stun:stun.cloudflare.com:3478" };
const TTL_SECONDS = 4 * 60 * 60; // credentials outlive any normal session; minted per visitor

/** True when Cloudflare TURN is configured (CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN). */
export const turnConfigured = () => !!process.env.CLOUDFLARE_TURN_KEY_ID && !!process.env.CLOUDFLARE_TURN_API_TOKEN;

/** Browsers block port 53, so those TURN URLs only ever time out. */
const usable = (u: string) => !/:53(\?|$)/.test(u);

/**
 * Cloudflare Realtime TURN: asks Cloudflare for short-lived credentials using the API token,
 * which stays on the server. Falls back to STUN only if TURN isn't configured or fails.
 */
export async function iceServers(): Promise<{ iceServers: IceServer[]; ttl: number; turn: boolean }> {
  if (!turnConfigured()) return { iceServers: [STUN], ttl: TTL_SECONDS, turn: false };
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      },
    );
    if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { iceServers?: IceServer | IceServer[] };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    const turn = list
      .filter((s) => s.username && s.credential)
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(usable) }))
      .filter((s) => s.urls.length > 0);
    if (!turn.length) throw new Error("Cloudflare TURN returned no TURN servers");
    return { iceServers: [STUN, ...turn], ttl: TTL_SECONDS, turn: true };
  } catch (e) {
    console.error("[ice] TURN credentials failed, using STUN only:", e);
    return { iceServers: [STUN], ttl: 60, turn: false };
  }
}
