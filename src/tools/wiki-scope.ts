/** Every Wiki event is written by the standalone helper; no other scope exists. */
export const WIKI_SCOPE = "standalone";

export function validateWikiScope(scope: unknown): asserts scope is string {
  if (scope !== WIKI_SCOPE) throw new Error(`invalid Wiki scope '${String(scope)}'`);
}
