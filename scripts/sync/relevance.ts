import type { KeywordConfig } from "../../src/lib/domain/types";
import type { NormalizedCandidate, RelevanceResult } from "./types";

function includesTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}`, "iu").test(text);
}

// Mentions such as `glm4_moe.py` often appear only as comparison examples in
// issues about another model. A source filename or repository path is not
// evidence that GLM is affected, supported, fixed, or requested.
function withoutIncidentalGlmCodeReferences(text: string): string {
  return text.replace(
    /\b(?:chat[-_ ]?)?glm[\w.-]*\.(?:py|pyi|cpp|cc|cxx|cu|cuh|h|hpp|json|ya?ml|toml|md)\b/giu,
    " ",
  );
}

export function scoreRelevance(
  candidate: NormalizedCandidate,
  keywords: KeywordConfig,
): RelevanceResult {
  const title = candidate.title;
  const body = candidate.bodyExcerpt;
  const semanticBody = withoutIncidentalGlmCodeReferences(body);
  const allText = `${title} ${semanticBody} ${candidate.labels.join(" ")}`;
  if (keywords.excludeTerms.some((term) => includesTerm(allText, term))) {
    return { score: 0, disposition: "excluded", matchedTerms: [], scenarios: [] };
  }

  const matchesModel = (text: string) => (
    keywords.global.some((term) => includesTerm(text, term))
    || keywords.includePatterns.some((pattern) => new RegExp(pattern, "iu").test(text))
  );
  const semanticText = `${title} ${semanticBody}`;
  const matchedTerms = keywords.global.filter((term) => includesTerm(semanticText, term));
  const modelInTitle = matchesModel(title);
  const modelInBody = matchesModel(semanticBody);
  // Repository automation can briefly attach incorrect or overly broad labels,
  // and previously collected data can retain such metadata. A GLM-like label
  // is therefore only corroborating evidence: admission always requires a
  // direct model anchor in the title or substantive body text.
  if (!modelInTitle && !modelInBody) {
    return { score: 0, disposition: "excluded", matchedTerms: [], scenarios: [] };
  }
  const negativeBodyOnlyMention = /\b(?:chat[-_ ]?glm|glm)[\s\S]{0,100}\b(?:unaffected|not affected|no (?:shared )?gate)\b|(?:不受影响|未受影响)[\s\S]{0,100}(?:chat[-_ ]?glm|glm)/iu.test(semanticBody);
  if (!modelInTitle && negativeBodyOnlyMention) {
    return { score: 0, disposition: "excluded", matchedTerms, scenarios: [] };
  }
  let score = modelInTitle ? 5 : 3;

  const scenarios: RelevanceResult["scenarios"] = [];
  const scenarioGroups = [
    ["TRAINING", keywords.scenarioTerms.training],
    ["INFERENCE", keywords.scenarioTerms.inference],
    ["RL", keywords.scenarioTerms.rl],
  ] as const;
  for (const [scenario, terms] of scenarioGroups) {
    if (terms.some((term) => includesTerm(allText, term))) {
      scenarios.push(scenario);
      score += terms.some((term) => includesTerm(title, term)) ? 2 : 1;
    }
  }
  if (candidate.labels.some((label) => includesTerm(label, "glm"))) score += 1;

  return {
    score,
    disposition: score >= 5 ? "eligible" : score >= 3 ? "review" : "excluded",
    matchedTerms,
    scenarios,
  };
}
