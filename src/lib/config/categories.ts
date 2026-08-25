import type { ActivityItem, CategoryConfig, SearchDocument, Summary } from "../domain/types";

export function categoryDefinitionsForType(
  config: CategoryConfig,
  type: SearchDocument["type"],
) {
  return config.categories
    .filter((category) => category.appliesTo.includes(type))
    .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code));
}

export function isCategoryAllowedForType(
  config: CategoryConfig,
  type: SearchDocument["type"],
  category: Summary["category"],
): boolean {
  return categoryDefinitionsForType(config, type).some((definition) => definition.code === category);
}

export function categoryLabel(
  config: CategoryConfig,
  type: SearchDocument["type"],
  category: Summary["category"],
): string {
  return categoryDefinitionsForType(config, type)
    .find((definition) => definition.code === category)?.labels[type]
    ?? category;
}

export function assertActivityCategories(
  items: ActivityItem[],
  config: CategoryConfig,
): void {
  for (const item of items) {
    const category = item.summary?.category ?? item.category;
    if (category && !isCategoryAllowedForType(config, item.type, category)) {
      throw new Error(`Category ${category} is not allowed for ${item.type}`);
    }
  }
}
