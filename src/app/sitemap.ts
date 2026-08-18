import type { MetadataRoute } from "next";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://www.cobradora.com.br";
const LAST_MODIFIED = "2026-08-17";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${APP_BASE_URL}/`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 1 },
    { url: `${APP_BASE_URL}/termos-de-uso`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${APP_BASE_URL}/politica-de-privacidade`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${APP_BASE_URL}/politica-de-cookies`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
  ];
}
