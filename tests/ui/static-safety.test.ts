import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("published shell", () => {
  test("provides keyboard navigation and visible focus treatment", async () => {
    const html = await readBuilt("index.html");
    const stylesheet = html.match(/href="\/(?:[^\"]+\.css)"/)?.[0].slice(7, -1);

    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('aria-label="主导航"');
    expect(stylesheet).toBeDefined();
    expect(await readBuilt(stylesheet!)).toContain(":focus-visible");
  });

  test("does not publish credential names or unsafe HTML directives", async () => {
    const html = await readBuilt("index.html");

    expect(html).not.toMatch(/OPENAI_API_KEY|GITHUB_TOKEN|set:html|innerHTML/);
  });
});
