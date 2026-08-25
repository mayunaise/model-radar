import type { ActivityItem, Summary } from "./types";

type ActivityCategory = Summary["category"];
type ClassifiableActivity = Pick<ActivityItem, "type" | "title" | "bodyExcerpt" | "labels">;
type ResolvableActivity = ClassifiableActivity & Pick<ActivityItem, "summary" | "category" | "categorySource">;

const patterns: Array<{ category: Exclude<ActivityCategory, "BUG" | "FIX" | "NEW_SUPPORT" | "OTHER">; pattern: RegExp }> = [
  { category: "DOCS", pattern: /\b(?:doc|docs|documentation|readme|guide|tutorial)\b|文档|说明书|教程/iu },
  { category: "PERFORMANCE", pattern: /\b(?:perf|performance|optim(?:ise|ize|isation|ization)|latency|throughput|benchmark|speedup|fuse|fusion)\b|性能|优化|延迟|吞吐|加速|融合/iu },
  { category: "COMPATIBILITY", pattern: /\b(?:compatibility|compatible|incompatible|adaptation|porting)\b|兼容|适配|移植/iu },
];

const defectPattern = /\b(?:bug|bugfix|fix|broken|crash|error|fail|failed|failure|incorrect|wrong|regression|exception|hang|oom|unable|missing|malformed|recover|repeating)\b|修复|崩溃|错误|出错|失败|异常|问题|无法|不能|卡住|重复/iu;
const supportPattern = /\b(?:support|feature|request|add|enable|implement|integrate|integration|introduce)\b|\bstack\s+tracker\b|支持|新增|添加|启用|实现|接入/iu;

function classifyText(text: string, type: ClassifiableActivity["type"]): ActivityCategory | undefined {
  if (defectPattern.test(text)) return type === "pr" ? "FIX" : "BUG";
  for (const rule of patterns) {
    if (rule.pattern.test(text)) return rule.category;
  }
  if (supportPattern.test(text)) return "NEW_SUPPORT";
  return undefined;
}

export function classifyActivityItem(item: ClassifiableActivity): ActivityCategory {
  const primary = [item.title, ...item.labels].join(" ");
  return classifyText(primary, item.type)
    ?? (item.type === "issue" && defectPattern.test(item.bodyExcerpt) ? "BUG" : undefined)
    ?? "OTHER";
}

export function categoryForItem(item: ResolvableActivity): ActivityCategory {
  return item.summary?.category ?? item.category ?? classifyActivityItem(item);
}

export function withActivityClassification<T extends ResolvableActivity>(item: T): T & {
  category: ActivityCategory;
  categorySource: "rules" | "ai";
} {
  return {
    ...item,
    category: item.summary?.category ?? classifyActivityItem(item),
    categorySource: item.summary ? "ai" : "rules",
  };
}
