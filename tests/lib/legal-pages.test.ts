import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { metadata as privacyMetadata } from "@/app/politica-de-privacidade/page";
import { metadata as termsMetadata } from "@/app/termos-de-uso/page";

describe("legal pages indexing", () => {
  it("keeps incomplete legal pages out of the sitemap", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);

    expect(paths).not.toContain("/termos-de-uso");
    expect(paths).not.toContain("/politica-de-privacidade");
    expect(paths).toContain("/politica-de-cookies");
  });

  it.each([
    ["terms", termsMetadata],
    ["privacy", privacyMetadata],
  ])("marks %s as noindex while allowing link discovery", (_label, metadata) => {
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });
});
