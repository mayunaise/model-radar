import type { Repository, SourceProvider } from "./types";

export type SourceDescriptor = { provider: SourceProvider; slug: string };

export function repositorySource(repository: Repository): SourceDescriptor {
  return repository.source ?? {
    provider: "github",
    slug: repository.canonicalSlug ?? repository.slug,
  };
}

export function splitSourceSlug(slug: string): [string, string] {
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository source slug: ${slug}`);
  return [owner, repo];
}
