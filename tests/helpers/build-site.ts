import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "../..");

let built = false;
let outputRoot: string | undefined;

export function buildSite(): void {
  if (built) return;
  outputRoot = mkdtempSync(join(tmpdir(), "glm-radar-pages-test-"));
  execFileSync(
    process.execPath,
    [resolve(projectRoot, "node_modules/astro/bin/astro.mjs"), "build", "--outDir", outputRoot],
    {
      cwd: projectRoot,
      env: { ...process.env, GLM_DATA_DIR: resolve(projectRoot, "fixtures/bootstrap-data"), ASTRO_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    },
  );
  built = true;
}

export async function readBuilt(path: string): Promise<string> {
  buildSite();
  return readFile(resolve(outputRoot!, path), "utf8");
}

process.once("exit", () => {
  if (outputRoot) rmSync(outputRoot, { recursive: true, force: true });
});
