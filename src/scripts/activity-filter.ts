import type { SearchDocument } from "../lib/domain/types";

export type ActivityFilters = {
  query?: string;
  repository?: string;
  type?: SearchDocument["type"];
  state?: SearchDocument["state"];
  category?: SearchDocument["category"];
};

export function parseActivityFilters(params: URLSearchParams): ActivityFilters {
  const value = (name: string) => params.get(name)?.trim() || undefined;
  return {
    query: value("q"),
    repository: value("repository"),
    type: value("type") as ActivityFilters["type"],
    state: value("state") as ActivityFilters["state"],
    category: value("category") as ActivityFilters["category"],
  };
}

export function filterSearchDocuments(
  documents: SearchDocument[],
  filters: ActivityFilters,
): SearchDocument[] {
  const query = filters.query?.toLocaleLowerCase();
  return documents.filter((document) => {
    if (filters.repository && document.repository !== filters.repository) return false;
    if (filters.type && document.type !== filters.type) return false;
    if (filters.state && document.state !== filters.state) return false;
    if (filters.category && document.category !== filters.category) return false;
    if (query) {
      const text = [document.title, document.summary, document.repository, ...document.models]
        .join(" ")
        .toLocaleLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
}

function formFilters(form: HTMLFormElement): ActivityFilters {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, raw] of data.entries()) {
    const value = String(raw).trim();
    if (value) params.set(key, value);
  }
  return parseActivityFilters(params);
}

export function enhanceActivityFilters(): void {
  const form = document.querySelector<HTMLFormElement>("[data-activity-filters]");
  const count = document.querySelector<HTMLElement>("[data-result-count]");
  const cards = [...document.querySelectorAll<HTMLElement>("[data-activity-item]")];
  if (!form || !count) return;

  const apply = () => {
    const filters = formFilters(form);
    let visible = 0;
    for (const card of cards) {
      const text = card.textContent?.toLocaleLowerCase() ?? "";
      const matches =
        (!filters.repository || card.dataset.repository === filters.repository) &&
        (!filters.type || card.dataset.type === filters.type) &&
        (!filters.state || card.dataset.state === filters.state) &&
        (!filters.category || card.dataset.category === filters.category) &&
        (!filters.query || text.includes(filters.query.toLocaleLowerCase()));
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    count.textContent = `${visible} 条结果`;

    const params = new URLSearchParams();
    const names: Array<[string, string | undefined]> = [
      ["q", filters.query],
      ["repository", filters.repository],
      ["type", filters.type],
      ["state", filters.state],
      ["category", filters.category],
    ];
    for (const [name, value] of names) if (value) params.set(name, value);
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };

  const initial = parseActivityFilters(new URLSearchParams(location.search));
  for (const [name, value] of Object.entries({ q: initial.query, repository: initial.repository, type: initial.type, state: initial.state, category: initial.category })) {
    const control = form.elements.namedItem(name);
    if (value && control instanceof HTMLInputElement) control.value = value;
    if (value && control instanceof HTMLSelectElement) control.value = value;
  }
  form.addEventListener("input", apply);
  form.addEventListener("change", apply);
  form.addEventListener("reset", () => requestAnimationFrame(apply));
  apply();
}
