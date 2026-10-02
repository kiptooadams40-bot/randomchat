"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Calls `onChange` (debounced) whenever the signed-in visitor's own `profiles` row is updated,
 * e.g. when a PesaPal payment is fulfilled and plan_expires_at / vip_until are set by the
 * server. The server remains the source of truth: `onChange` should simply re-read /api/session.
 * Silently does nothing if Realtime isn't available (the caller has polling fallbacks).
 */
export function useProfileRealtime(enabled: boolean, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const sb = supabaseBrowser();
    if (!sb) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof sb.channel> | undefined;

    (async () => {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (cancelled || !session) return;
      sb.realtime.setAuth(session.access_token); // so RLS applies to this visitor
      channel = sb
        .channel(`profile:${session.user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
          () => {
            clearTimeout(timer);
            timer = setTimeout(() => cb.current(), 250);
          },
        )
        .subscribe();
    })().catch(() => {
      /* realtime unavailable: polling fallbacks cover it */
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void sb.removeChannel(channel);
    };
  }, [enabled]);
}
