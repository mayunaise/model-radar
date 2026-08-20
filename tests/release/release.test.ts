import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "dist");

async function textFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return /\.(?:html|css|js|json|svg)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

describe("release artifact", () => {
  test("publishes all required routes under the repository base without credentials", async () => {
    execFileSync(process.execPath, [resolve(root, "node_modules/astro/bin/astro.mjs"), "build"], {
      cwd: root,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", SITE_BASE: "/glm-model-info-site" },
      stdio: "pipe",
    });

    const required = [
      "index.html",
      "reports/index.html",
      "reports/2026-08-20/index.html",
      "activity/index.html",
      "activity/vllm-project-vllm/10004/index.html",
      "capabilities/index.html",
      "404.html",
      "favicon.svg",
    ];
    await Promise.all(required.map((path) => expect(access(resolve(dist, path))).resolves.toBeUndefined()));

    const home = await readFile(resolve(dist, "index.html"), "utf8");
    expect(home).toContain('href="/glm-model-info-site/reports/"');
    expect(home).toContain("所有条目均为样例");

    for (const path of await textFiles(dist)) {
      expect(await readFile(path, "utf8")).not.toMatch(/sk-[A-Za-z0-9_-]{16,}|OPENAI_API_KEY=|GITHUB_TOKEN=/);
    }
  });
});
