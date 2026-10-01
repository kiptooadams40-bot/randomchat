import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pages: [string, number][] = [
    ["", 1],
    ["/chat", 0.9],
    ["/pricing", 0.8],
    ["/faq", 0.6],
    ["/privacy", 0.3],
    ["/terms", 0.3],
  ];
  return pages.map(([path, priority]) => ({ url: `${base}${path}`, lastModified: new Date(), priority }));
}
