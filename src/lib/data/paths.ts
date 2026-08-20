import { isAbsolute, relative, resolve } from "node:path";

export function assertInsideRoot(root: string, candidate: string): string {
  const relation = relative(root, candidate);
  if (relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relation)) {
    throw new Error(`Resolved path is outside the data root: ${candidate}`);
  }
  return candidate;
}

export function dataPath(root: string, path: string): string {
  return assertInsideRoot(root, resolve(root, path));
}
