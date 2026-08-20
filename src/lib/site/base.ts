const configured = process.env.SITE_BASE ?? "/";
const normalized = configured === "/" ? "" : `/${configured.replace(/^\/+|\/+$/g, "")}`;

export const siteBase = `${normalized}/`;

export function sitePath(path: string): string {
  return `${siteBase}${path.replace(/^\//, "")}`;
}
