import { categoryDefinitionsForType } from "../lib/config/categories";
import type { CategoryConfig, SearchDocument } from "../lib/domain/types";

export const ACTIVITY_PAGE_SIZE = 50;

export function categoryOptionsForType(
  config: CategoryConfig,
  type: SearchDocument["type"],
): Array<{ value: SearchDocument["category"]; label: string }> {
  return categoryDefinitionsForType(config, type).map((category) => ({
    value: category.code,
    label: category.labels[type]!,
  }));
}

export type ActivityFilters = {
  query?: string;
  repository?: string;
  type?: SearchDocument["type"];
  state?: SearchDocument["state"];
  category?: SearchDocument["category"];
  model?: string;
  page?: number;
};

function normalizedPage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function parseActivityFilters(params: URLSearchParams): ActivityFilters {
  const value = (name: string) => params.get(name)?.trim() || undefined;
  return {
    query: value("q"),
    repository: value("repository"),
    type: value("type") as ActivityFilters["type"],
    state: value("state") as ActivityFilters["state"],
    category: value("category") as ActivityFilters["category"],
    model: value("model"),
    page: normalizedPage(value("page")),
  };
}

export function paginateSearchDocuments(
  documents: SearchDocument[],
  requestedPage: number,
  pageSize = ACTIVITY_PAGE_SIZE,
): {
  documents: SearchDocument[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
} {
  const totalItems = documents.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    documents: documents.slice(start, start + pageSize),
    currentPage,
    totalPages,
    totalItems,
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
    if (filters.model && !document.models.includes(filters.model)) return false;
    if (query) {
      const text = [document.title, document.summary, document.repository, ...document.models]
        .join(" ")
        .toLocaleLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
}

export function findActivityFilterTargets(root: ParentNode = document): {
  form: HTMLFormElement | null;
  count: HTMLElement | null;
  cards: HTMLElement[];
} | null {
  const explorer = root.querySelector<HTMLElement>("[data-activity-explorer]");
  if (!explorer) return null;
  return {
    form: explorer.querySelector<HTMLFormElement>("[data-activity-filters]"),
    count: explorer.querySelector<HTMLElement>("[data-result-count]"),
    cards: [...explorer.querySelectorAll<HTMLElement>("[data-activity-item]")],
  };
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

function updateCategorySelect(
  select: HTMLSelectElement,
  config: CategoryConfig,
  type: ActivityFilters["type"],
  preferredValue?: string,
): void {
  const placeholder = new Option(type ? "全部分类" : "请先选择类型", "");
  const options = type
    ? categoryOptionsForType(config, type).map(({ value, label }) => new Option(label, value))
    : [];
  select.replaceChildren(placeholder, ...options);
  select.disabled = !type;
  if (preferredValue && options.some((option) => option.value === preferredValue)) {
    select.value = preferredValue;
  }
}

export function enhanceActivityFilters(): void {
  const targets = findActivityFilterTargets();
  if (!targets) return;
  const { form, count, cards } = targets;
  if (!form || !count) return;
  const explorer = form.closest<HTMLElement>("[data-activity-explorer]");
  const pagination = explorer?.querySelector<HTMLElement>("[data-activity-pagination]");
  const previousButton = pagination?.querySelector<HTMLButtonElement>("[data-page-previous]");
  const nextButton = pagination?.querySelector<HTMLButtonElement>("[data-page-next]");
  const pagePicker = pagination?.querySelector<HTMLDetailsElement>("[data-page-picker]");
  const pageSelect = pagination?.querySelector<HTMLElement>("[data-page-select]");
  const pageOptions = pagination?.querySelector<HTMLElement>("[data-page-options]");
  const pageSummary = pagination?.querySelector<HTMLElement>("[data-page-summary]");
  const typeSelect = form.elements.namedItem("type");
  const categorySelect = form.elements.namedItem("category");
  if (!(typeSelect instanceof HTMLSelectElement) || !(categorySelect instanceof HTMLSelectElement)) return;
  const categoryConfig = JSON.parse(form.dataset.categoryOptions ?? "{}") as CategoryConfig;
  const initial = parseActivityFilters(new URLSearchParams(location.search));
  let currentPage = initial.page ?? 1;

  const apply = (resetPage = false) => {
    if (resetPage) currentPage = 1;
    const filters = formFilters(form);
    const matchingCards: HTMLElement[] = [];
    for (const card of cards) {
      const text = card.textContent?.toLocaleLowerCase() ?? "";
      const models = (card.dataset.models ?? "").split("|").filter(Boolean);
      const matches =
        (!filters.repository || card.dataset.repository === filters.repository) &&
        (!filters.type || card.dataset.type === filters.type) &&
        (!filters.state || card.dataset.state === filters.state) &&
        (!filters.category || card.dataset.category === filters.category) &&
        (!filters.model || models.includes(filters.model)) &&
        (!filters.query || `${text} ${models.join(" ").toLocaleLowerCase()}`.includes(filters.query.toLocaleLowerCase()));
      if (matches) matchingCards.push(card);
    }
    const totalPages = Math.max(1, Math.ceil(matchingCards.length / ACTIVITY_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const pageStart = (currentPage - 1) * ACTIVITY_PAGE_SIZE;
    const visibleCards = new Set(matchingCards.slice(pageStart, pageStart + ACTIVITY_PAGE_SIZE));
    for (const card of cards) card.hidden = !visibleCards.has(card);
    count.textContent = `共 ${matchingCards.length} 条 · 第 ${currentPage}/${totalPages} 页`;

    if (pagePicker && pageSelect && pageOptions && previousButton && nextButton && pageSummary) {
      pageOptions.replaceChildren(...Array.from({ length: totalPages }, (_, index) => {
        const page = index + 1;
        const option = document.createElement("button");
        option.type = "button";
        option.dataset.pageValue = String(page);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", page === currentPage ? "true" : "false");
        option.textContent = `第 ${page} 页`;
        return option;
      }));
      pageSelect.textContent = `第 ${currentPage} 页`;
      pageSelect.setAttribute("aria-disabled", totalPages <= 1 ? "true" : "false");
      pagePicker.dataset.disabled = totalPages <= 1 ? "true" : "false";
      if (totalPages <= 1) pagePicker.removeAttribute("open");
      previousButton.disabled = currentPage <= 1;
      nextButton.disabled = currentPage >= totalPages;
      pageSummary.textContent = `第 ${currentPage} / ${totalPages} 页`;
    }

    const params = new URLSearchParams();
    const names: Array<[string, string | undefined]> = [
      ["q", filters.query],
      ["repository", filters.repository],
      ["type", filters.type],
      ["state", filters.state],
      ["category", filters.category],
      ["model", filters.model],
      ["page", currentPage > 1 ? String(currentPage) : undefined],
    ];
    for (const [name, value] of names) if (value) params.set(name, value);
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };

  for (const [name, value] of Object.entries({ q: initial.query, repository: initial.repository, type: initial.type, state: initial.state, model: initial.model })) {
    const control = form.elements.namedItem(name);
    if (value && control instanceof HTMLInputElement) control.value = value;
    if (value && control instanceof HTMLSelectElement) control.value = value;
  }
  updateCategorySelect(categorySelect, categoryConfig, initial.type, initial.category);
  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) apply(true);
  });
  form.addEventListener("change", (event) => {
    if (event.target === typeSelect) {
      updateCategorySelect(categorySelect, categoryConfig, typeSelect.value as ActivityFilters["type"], categorySelect.value);
    }
    apply(true);
  });
  form.addEventListener("reset", () => requestAnimationFrame(() => {
    updateCategorySelect(categorySelect, categoryConfig, undefined);
    apply(true);
  }));
  previousButton?.addEventListener("click", () => {
    currentPage -= 1;
    apply();
  });
  nextButton?.addEventListener("click", () => {
    currentPage += 1;
    apply();
  });
  pageSelect?.addEventListener("click", (event) => {
    if (pagePicker?.dataset.disabled === "true") event.preventDefault();
  });
  pagePicker?.addEventListener("toggle", () => {
    if (!pagePicker.open) return;
    requestAnimationFrame(() => pageOptions?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
  });
  pageOptions?.addEventListener("click", (event) => {
    const option = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-page-value]") : null;
    if (!option) return;
    currentPage = normalizedPage(option.dataset.pageValue);
    pagePicker?.removeAttribute("open");
    apply();
  });
  apply();
}
