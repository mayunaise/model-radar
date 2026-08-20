export function repositoryRouteKey(repository: string): string {
  return repository.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function itemPath(repository: string, number: number): string {
  return `/activity/${repositoryRouteKey(repository)}/${number}/`;
}
