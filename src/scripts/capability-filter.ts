import type { CapabilityEntry } from "../lib/domain/types";

export type CapabilityFilters = {
  hardware?: CapabilityEntry["hardware"];
  scenario?: CapabilityEntry["scenario"];
  framework?: string;
  status?: CapabilityEntry["status"];
};

export function parseCapabilityFilters(params: URLSearchParams): CapabilityFilters {
  const value = (name: string) => params.get(name)?.trim() || undefined;
  return {
    hardware: value("hardware") as CapabilityFilters["hardware"],
    scenario: value("scenario") as CapabilityFilters["scenario"],
    framework: value("framework"),
    status: value("status") as CapabilityFilters["status"],
  };
}

export function filterCapabilities(
  entries: CapabilityEntry[],
  filters: CapabilityFilters,
): CapabilityEntry[] {
  return entries.filter(
    (entry) =>
      (!filters.hardware || entry.hardware === filters.hardware) &&
      (!filters.scenario || entry.scenario === filters.scenario) &&
      (!filters.framework || entry.framework === filters.framework) &&
      (!filters.status || entry.status === filters.status),
  );
}

export function enhanceCapabilityFilters(): void {
  const form = document.querySelector<HTMLFormElement>("[data-capability-filters]");
  const rows = [...document.querySelectorAll<HTMLElement>("[data-capability-row]")];
  const count = document.querySelector<HTMLElement>("[data-capability-count]");
  if (!form || !count) return;

  const setInitial = parseCapabilityFilters(new URLSearchParams(location.search));
  for (const [name, value] of Object.entries(setInitial)) {
    const control = form.elements.namedItem(name);
    if (value && control instanceof HTMLSelectElement) control.value = value;
  }

  const apply = () => {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, raw] of data.entries()) {
      const value = String(raw).trim();
      if (value) params.set(key, value);
    }
    const filters = parseCapabilityFilters(params);
    let visible = 0;
    for (const row of rows) {
      const matches =
        (!filters.hardware || row.dataset.hardware === filters.hardware) &&
        (!filters.scenario || row.dataset.scenario === filters.scenario) &&
        (!filters.framework || row.dataset.framework === filters.framework) &&
        (!filters.status || row.dataset.status === filters.status);
      row.hidden = !matches;
      if (matches) visible += 1;
    }
    count.textContent = `${visible} 条能力记录`;
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };

  form.addEventListener("change", apply);
  form.addEventListener("reset", () => requestAnimationFrame(apply));
  apply();
}
