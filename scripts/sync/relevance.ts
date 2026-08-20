import type { KeywordConfig } from "../../src/lib/domain/types";
import type { NormalizedCandidate, RelevanceResult } from "./types";

function includes(text: string, term: string): boolean {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

export function scoreRelevance(
  candidate: NormalizedCandidate,
  keywords: KeywordConfig,
): RelevanceResult {
  const title = candidate.title;
  const body = candidate.bodyExcerpt;
  const allText = `${title} ${body} ${candidate.labels.join(" ")}`;
  if (keywords.excludeTerms.some((term) => includes(allText, term))) {
    return { score: 0, disposition: "excluded", matchedTerms: [], scenarios: [] };
  }

  const matchedTerms = keywords.global.filter((term) => includes(allText, term));
  const patternMatch = keywords.includePatterns.some((pattern) => new RegExp(pattern, "iu").test(allText));
  const modelInTitle = keywords.global.some((term) => includes(title, term)) || keywords.includePatterns.some((pattern) => new RegExp(pattern, "iu").test(title));
  const modelInBody = keywords.global.some((term) => includes(body, term)) || patternMatch;
  let score = modelInTitle ? 5 : modelInBody ? 3 : 0;

  const scenarios: RelevanceResult["scenarios"] = [];
  const scenarioGroups = [
    ["TRAINING", keywords.scenarioTerms.training],
    ["INFERENCE", keywords.scenarioTerms.inference],
    ["RL", keywords.scenarioTerms.rl],
  ] as const;
  for (const [scenario, terms] of scenarioGroups) {
    if (terms.some((term) => includes(allText, term))) {
      scenarios.push(scenario);
      score += terms.some((term) => includes(title, term)) ? 2 : 1;
    }
  }
  if (candidate.labels.some((label) => includes(label, "glm"))) score += 1;

  return {
    score,
    disposition: score >= 5 ? "eligible" : score >= 3 ? "review" : "excluded",
    matchedTerms,
    scenarios,
  };
}
