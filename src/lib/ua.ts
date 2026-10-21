/** User-agent parsing for display and in-app browser detection. Never used to identify people. */

const IN_APP: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/musical_ly|TikTok|BytedanceWebview|trill/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Twitter|TwitterAndroid/i, "X"],
  [/LinkedInApp/i, "LinkedIn"],
  [/\bLine\//i, "LINE"],
  [/MicroMessenger/i, "WeChat"],
  [/WhatsApp/i, "WhatsApp"],
  [/Telegram/i, "Telegram"],
  [/Pinterest/i, "Pinterest"],
];

/** Name of the app whose built-in browser this is, or null for a normal browser. */
export function inAppBrowser(ua: string): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return "an app"; // generic Android WebView
  return null;
}

export const isAndroid = (ua: string) => /Android/i.test(ua);
export const isIOS = (ua: string) => /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));

/** "Phone · Chrome" style label for the device list. */
export function describeDevice(ua: string | null): { device: string; browser: string } {
  const s = ua ?? "";
  const device = /iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))
    ? "Tablet"
    : /Mobi|iPhone|Android/i.test(s)
      ? "Phone"
      : s
        ? "Computer"
        : "Unknown device";
  const app = inAppBrowser(s);
  const browser = app
    ? `${app} in-app browser`
    : /EdgA?\//.test(s)
      ? "Edge"
      : /SamsungBrowser/.test(s)
        ? "Samsung Internet"
        : /OPR\/|Opera/.test(s)
          ? "Opera"
          : /Firefox|FxiOS/.test(s)
            ? "Firefox"
            : /CriOS|Chrome\//.test(s)
              ? "Chrome"
              : /Safari\//.test(s)
                ? "Safari"
                : "Browser";
  return { device, browser };
}
