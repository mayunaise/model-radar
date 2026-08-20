import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "../..");

let built = false;

export function buildSite(): void {
  if (built) return;
  execFileSync(
    process.execPath,
    [resolve(projectRoot, "node_modules/astro/bin/astro.mjs"), "build"],
    {
      cwd: projectRoot,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    },
  );
  built = true;
}

export async function readBuilt(path: string): Promise<string> {
  buildSite();
  return readFile(resolve(projectRoot, "dist", path), "utf8");
}
