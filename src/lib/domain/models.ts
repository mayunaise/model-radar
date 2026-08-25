import type { ActivityItem } from "./types";

export const UNSPECIFIED_GLM_MODEL = "GLM（未指定版本）";

const modelNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareModelNames(left: string, right: string): number {
  if (left === UNSPECIFIED_GLM_MODEL) return 1;
  if (right === UNSPECIFIED_GLM_MODEL) return -1;
  const group = (name: string) => (
    /^GLM-\d/u.test(name) ? 0 : name.startsWith("GLM-") ? 1 : name.startsWith("ChatGLM") ? 2 : 3
  );
  const leftGroup = group(left);
  const rightGroup = group(right);
  return leftGroup - rightGroup || modelNameCollator.compare(right, left);
}

function removeBroaderNames(names: Set<string>): void {
  for (const name of [...names]) {
    const match = /^GLM-(\d+(?:\.\d+)?)$/u.exec(name);
    if (!match) continue;
    const parts = match[1]!.split(".");
    for (let length = 1; length <= parts.length; length += 1) {
      const broader = `GLM-${parts.slice(0, length).join(".")}`;
      if (broader !== name) names.delete(broader);
    }
  }
}

export function modelNamesForItem(
  item: Pick<ActivityItem, "title" | "bodyExcerpt" | "labels" | "summary">,
): string[] {
  const source = [
    item.title,
    item.bodyExcerpt,
    ...item.labels,
    ...(item.summary?.models ?? []),
  ].join(" ");
  let remaining = source;
  const names = new Set<string>();

  const specialModels: Array<[RegExp, string]> = [
    [/(?<![\p{L}\p{N}])glm[-_ ]?asr(?![\p{L}\p{N}])/giu, "GLM-ASR"],
    [/(?<![\p{L}\p{N}])glm[-_ ]?ocr(?![\p{L}\p{N}])/giu, "GLM-OCR"],
    [/(?<![\p{L}\p{N}])glm[-_ ]?4[-_ ]0414(?![\p{L}\p{N}])/giu, "GLM-4"],
    [/(?<![\p{L}\p{N}])glm[-_ ]?4(?:\.[xX])?[-_ ]?v(?![\p{L}\p{N}])/giu, "GLM-4"],
    [/(?<![\p{L}\p{N}])glm[-_ ]?47[-_ ]?flash(?![\p{L}\p{N}])/giu, "GLM-4.7"],
  ];
  for (const [pattern, canonicalName] of specialModels) {
    if (pattern.test(remaining)) names.add(canonicalName);
    remaining = remaining.replace(pattern, " ");
  }

  remaining = remaining.replace(
    /(?<![\p{L}\p{N}])chat[-_ ]?glm[-_ ]?(\d+)(?![\p{L}\p{N}])/giu,
    (_match, version: string) => {
      names.add(`ChatGLM${version}`);
      return " ";
    },
  );
  remaining = remaining.replace(
    /(?<![\p{L}\p{N}])chat[-_ ]?glm(?![\p{L}\p{N}])/giu,
    () => {
      names.add("ChatGLM");
      return " ";
    },
  );
  remaining.replace(
    /(?<![\p{L}\p{N}])glm[-_ ]+(\d+(?:\.\d+)*)(?:[-_ ]?(air|flash|moe|vision|v))?(?![\p{L}\p{N}])(?![_-](?:parser|reasoning|tool))/giu,
    (_match, version: string | undefined) => {
      if (!version || !["4", "5", "10"].includes(version.split(".")[0]!)) return _match;
      const family = version.split(".").slice(0, 2).join(".");
      names.add(`GLM-${family}`);
      return _match;
    },
  );

  removeBroaderNames(names);
  if (names.size === 0 && /(?<![\p{L}\p{N}])glm(?![\p{L}\p{N}])/iu.test(source)) {
    names.add(UNSPECIFIED_GLM_MODEL);
  }
  return [...names].sort(compareModelNames);
}

export function modelOptionsForItems(items: ActivityItem[]): string[] {
  return [...new Set(items.flatMap(modelNamesForItem))].sort(compareModelNames);
}
