import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("project contract", () => {
  test("exposes the commands required by development and automation", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(Object.keys(packageJson.scripts ?? {}).sort()).toEqual([
      "audit:data",
      "build",
      "build:local",
      "build:search",
      "check",
      "dev",
      "dev:local",
      "sync",
      "sync:local",
      "test",
      "test:watch",
      "validate:data",
    ]);
  });

  test("has an Astro configuration for a static site", async () => {
    await expect(access(resolve(root, "astro.config.mjs"))).resolves.toBeUndefined();
    const config = await import(`${resolve(root, "astro.config.mjs")}?test`);

    expect(config.default.output).toBe("static");
  });
});
