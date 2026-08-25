import { execFileSync } from "node:child_process";
import { access, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("disabled framework release", () => {
  test("keeps archived data but omits the framework from every public surface", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "glm-disabled-framework-"));
    const configDir = join(temporaryRoot, "config");
    const outputDir = join(temporaryRoot, "dist");
    await cp(resolve(root, "config"), configDir, { recursive: true });
    const repositoriesPath = join(configDir, "repositories.json");
    const repositories = JSON.parse(await readFile(repositoriesPath, "utf8"));
    repositories.repositories = repositories.repositories.map((repository: { slug: string }) => (
      repository.slug === "vllm-project/vllm" ? { ...repository, enabled: false } : repository
    ));
    await writeFile(repositoriesPath, `${JSON.stringify(repositories, null, 2)}\n`);

    execFileSync(process.execPath, [
      resolve(root, "node_modules/astro/bin/astro.mjs"),
      "build",
      "--outDir",
      outputDir,
    ], {
      cwd: root,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", GLM_CONFIG_DIR: configDir },
      stdio: "pipe",
    });

    const activity = await readFile(join(outputDir, "activity/index.html"), "utf8");
    const home = await readFile(join(outputDir, "index.html"), "utf8");

    expect(activity).not.toContain("vllm-project/vllm");
    expect(home).toContain("3 个仓库正在跟踪");
    await expect(access(join(outputDir, "activity/vllm-project-vllm/pr/10004/index.html"))).rejects.toThrow();
    await expect(access(resolve(root, "fixtures/bootstrap-data/items/vllm/2026/08.json"))).resolves.toBeUndefined();
  });
});
