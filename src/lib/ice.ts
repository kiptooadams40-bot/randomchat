const DEFAULT_STUN = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478";

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const split = (s: string | undefined) =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** Public STUN by default (free). TURN is added only when configured. */
export function iceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: split(process.env.ICE_STUN_URLS || DEFAULT_STUN) }];
  const turn = split(process.env.TURN_URLS);
  if (turn.length) {
    servers.push({
      urls: turn,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}
