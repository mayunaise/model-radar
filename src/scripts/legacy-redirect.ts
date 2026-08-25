type ClientIndex = {
  items: Record<string, { path: string }>;
  routes: Record<string, string>;
  reports: Record<string, { path: string }>;
};

export async function redirectLegacyRoute(base: string): Promise<void> {
  const basePath = base === "/" ? "" : base.replace(/\/$/, "");
  const path = location.pathname.slice(basePath.length).replace(/^\/+|\/+$/g, "");
  const response = await fetch(`${base}data/client-index.json`);
  if (!response.ok) return;
  const index = await response.json() as ClientIndex;
  const activity = path.match(/^activity\/(.+\/(?:issue|pr)\/\d+)$/);
  if (activity) {
    const id = index.routes[activity[1]];
    const destination = id && index.items[id]?.path;
    if (destination) location.replace(`${base}${destination}`);
    return;
  }
  const report = path.match(/^reports\/(\d{4}-\d{2}-\d{2})$/);
  const destination = report && index.reports[report[1]]?.path;
  if (destination) location.replace(`${base}${destination}`);
}
