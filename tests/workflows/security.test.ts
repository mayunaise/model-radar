import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "../..");
const workflowDir = resolve(root, ".github/workflows");

async function workflows() {
  const names = (await readdir(workflowDir)).filter((name) => name.endsWith(".yml"));
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(resolve(workflowDir, name), "utf8") })));
}

describe("GitHub workflow security", () => {
  test("pins actions, declares timeouts, and avoids dangerous pull request triggers", async () => {
    const files = await workflows();
    expect(files.length).toBeGreaterThanOrEqual(3);

    for (const file of files) {
      expect(file.text).not.toContain("pull_request_target");
      const actionUses = [...file.text.matchAll(/uses:\s*([^\s]+)/g)].map((match) => match[1]);
      for (const action of actionUses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/);
      const parsed = YAML.parse(file.text) as { jobs?: Record<string, { "timeout-minutes"?: number }> };
      for (const job of Object.values(parsed.jobs ?? {})) expect(job["timeout-minutes"]).toBeGreaterThan(0);
    }
  });

  test("keeps secret-bearing collection separate from Pages deployment", async () => {
    const files = await workflows();
    const daily = files.find((file) => file.name === "daily-sync.yml")?.text ?? "";
    const pages = files.find((file) => file.name === "deploy-pages.yml")?.text ?? "";
    const ci = files.find((file) => file.name === "ci.yml")?.text ?? "";

    expect(daily).toContain("OPENAI_API_KEY");
    expect(daily).not.toContain("deploy-pages");
    expect(pages).toContain("deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e");
    expect(pages).not.toContain("OPENAI_API_KEY");
    expect(ci).not.toMatch(/secrets\./);
  });
});
