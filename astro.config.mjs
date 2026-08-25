import { defineConfig } from "astro/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { exportHybridData } from "./scripts/build/hybrid-data.mjs";

const configuredBase = process.env.SITE_BASE ?? "/";
const base = configuredBase === "/" ? "/" : `/${configuredBase.replace(/^\/+|\/+$/g, "")}`;
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const dataRoot = resolve(projectRoot, process.env.GLM_DATA_DIR ?? "fixtures/bootstrap-data");
const configRoot = resolve(projectRoot, "config");
const devDataRoot = resolve(projectRoot, ".astro/hybrid-data");

function hybridData() {
  return {
    name: "glm-hybrid-data",
    hooks: {
      "astro:server:setup": async ({ server }) => {
        const rebuild = () => exportHybridData({ dataRoot, outputRoot: devDataRoot, configRoot });
        let ready = rebuild();
        server.watcher.add([dataRoot, configRoot]);
        server.watcher.on("change", (path) => {
          if (path.startsWith(dataRoot) || path.startsWith(configRoot)) ready = rebuild();
        });
        server.middlewares.use(async (request, response, next) => {
          const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
          const prefix = `${base === "/" ? "" : base}/data/`;
          if (!pathname.startsWith(prefix)) return next();
          await ready;
          const relative = pathname.slice(prefix.length);
          const target = resolve(devDataRoot, relative);
          if (!target.startsWith(`${devDataRoot}/`)) return next();
          try {
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(await readFile(target));
          } catch {
            next();
          }
        });
      },
      "astro:build:done": async ({ dir }) => {
        await exportHybridData({
          dataRoot,
          outputRoot: resolve(fileURLToPath(dir), "data"),
          configRoot,
        });
      },
    },
  };
}

export default defineConfig({
  output: "static",
  base,
  trailingSlash: "always",
  integrations: [hybridData()],
});
