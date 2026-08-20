import { defineConfig } from "astro/config";

const configuredBase = process.env.SITE_BASE ?? "/";
const base = configuredBase === "/" ? "/" : `/${configuredBase.replace(/^\/+|\/+$/g, "")}`;

export default defineConfig({
  output: "static",
  base,
  trailingSlash: "always",
});
