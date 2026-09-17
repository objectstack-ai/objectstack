// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolve a **nested** `RETIRED_KEYS_BY_MAJOR` row against the JSON Schema this
 * build emits — the set membership test check (b2) had no way to perform
 * (#17969).
 *
 * ## The defect this closes
 *
 * `build-schemas.ts` builds `currentKeys` from `schema.properties`, **one level
 * deep**. Every check that reads that map therefore sees top-level keys only,
 * and check (b2) — the guard that refuses an entry naming a key this build
 * still emits as LIVE — is the one where the blindness costs something: a
 * nested row such as `system/SchemaLevelIsolationStrategy:performance.schemaCacheTTL`
 * matches nothing in the map, so it is silently IGNORED rather than judged.
 * Measured by ablation before this module existed: a fabricated nested row
 * (`…:performance.zzNotARealKey9999`) passed `check:authorable-surface` at exit
 * 0 with zero ❌, against a lit control — a live TOP-LEVEL key — refused at
 * exit 1. A typo'd def, a typo'd path or a stale key name registered silently
 * and stayed registered, and the retirement ledger is the input to the ADR-0087
 * conversions downstream, so the error would be inherited as fact.
 *
 * ## Why this is not simply "recurse `currentKeys`"
 *
 * Three lines below its construction, that same map is also the **emitted**
 * authorable-surface baseline (`currentEntries`). Measured on this tree:
 * recursing the walk in place adds **14,376 lines** to `authorable-surface/**`
 * across all 14 shards — it publishes the whole nested key space as a
 * ratcheted, author-facing contract. That is a separate decision from giving a
 * checker the discrimination it lacks, so the nested view lives here instead,
 * is computed for the REGISTERED ROWS ONLY, and is reachable from nothing that
 * emits. Deliberately no map of every nested key is built: the hazard this
 * module exists beside is precisely a nested key space lying around for a later
 * author to pipe into `currentEntries`, so there is nothing to pipe.
 *
 * ## The three states, and why "absent" means something here and not up there
 *
 * For a TOP-LEVEL row, an entry naming a key the build no longer emits is the
 * expected steady state, not an error: the key was tombstoned, its
 * `authorable-surface/` line carried `[RETIRED]`, it aged out, and check (c)
 * let that line go — a gated, reviewable route with evidence at every step.
 *
 * A nested key has none of that. It never reaches `authorable-surface/` (0
 * dotted entries on the shipped baseline), so checks (a), (a0), (b) and (c) are
 * all structurally blind to it and no gated route can ever produce "registered
 * nested row whose path this build does not emit". That state has exactly one
 * origin — the row is wrong — which is why {@link NestedAuthorableKeyState}
 * separates it from the def-level steady state below.
 *
 * `def-not-emitted` IS still a steady state and is deliberately left unjudged:
 * a whole-def removal is registered in `RETIRED_DEFS_BY_MAJOR` and adjudicated
 * by the `json-schema.manifest/` ratchet, and its key entries are subsumed by
 * it. Three of the shipped nested rows are in that state (the change-management
 * family, retired whole), and reading them as unresolvable would be this
 * module's own false red.
 *
 * ## Resolution is deliberately generous; only the REFUSAL is strict
 *
 * A path that fails to resolve is about to be refused, so every unwrapping step
 * below exists to keep a legitimate row resolving: `$ref` into the document's
 * own `$defs`, the `anyOf`/`oneOf`/`allOf` branches of a union, and `items` —
 * the registry spells an array member's key `steps.estimatedMinutes`, eliding
 * the `[]` its own prose writes (`RollbackPlan.steps[].estimatedMinutes`), so
 * an array is traversed WITHOUT consuming a segment. Measured over the 48
 * nested rows this tree declares: `properties` alone resolves 43, and `items`
 * carries the other 2 (`kernel/Manifest:contributes.kinds.globs`,
 * `system/ServiceLevelObjective:errorBudget.burnRateWindows.window`); `$ref`
 * and the combinators are not load-bearing on today's rows and are here because
 * the first row that lands under one must not read as a typo.
 *
 * `additionalProperties` is the one traversal deliberately NOT made: descending
 * into a record's value shape would match `foo.bar` against a path an author
 * writes as `foo.<someKey>.bar`, skipping a segment — a false GREEN, and the
 * only direction this module must not err in.
 *
 * ## A dot is not the same question as a path — the CALLER routes
 *
 * {@link isNestedAuthorableKey} is deliberately lexical, and is not on its own a
 * verdict that a row names a path: four keys on the shipped baseline are
 * TOP-LEVEL property names that carry a dot — `api/ODataResponse:@odata.context`
 * and its two siblings, and `identity/SCIMUser`'s SCIM extension URN. Routing
 * therefore asks the emitted schema FIRST (`currentKeys.has(key)` in
 * `build-schemas.ts`) and reads a row as a path only when this build emits no
 * top-level property of that exact name, so a live dotted top-level key is
 * judged by check (b2) on the map it has always been in.
 *
 * ## What it cannot see, stated where the next author will need it
 *
 * The guidance route (check (c) proof 4, #18301) retires a key by REMOVING it
 * from a `strictObject` shape rather than tombstoning it in place, so a key
 * retired that way is legitimately absent from the emitted schema. That proof
 * is computed per DEF for a top-level leaf (`computeGuidanceRoutes()` in
 * `build-schemas.ts`) and has no nested form, so a nested row taking that route
 * would be read here as `unresolvable`. Measured on this tree: 0 of the 48
 * nested rows take it — all 45 whose def is emitted resolve to a tombstone. The
 * refusal text names this, because the remedy is to teach this check the route,
 * ⛔ never to delete the row that is telling the truth.
 *
 * @see build-schemas.ts — checks (b2)/(b3), the only consumers
 */

/** How a registered nested row stands against the schema this build emits. */
export type NestedAuthorableKeyState =
  /** The path resolves, and at least one declaration of the leaf is writable. */
  | 'live'
  /** The path resolves and every declaration of the leaf is a tombstone. */
  | 'retired'
  /** The def is emitted; the path is not in it. Nothing legitimate lands here. */
  | 'unresolvable'
  /** This build emits no such def — the whole-def removal steady state. */
  | 'def-not-emitted';

/** How deep a chain of unwrappings may go without consuming a path segment. */
const MAX_UNWRAP_DEPTH = 12;

/** `retiredKey()` is `z.never()`, which Zod renders as `{ "not": {} }`. */
export function isRetiredJsonSchemaNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const not = (node as Record<string, unknown>).not;
  return !!not && typeof not === 'object' && Object.keys(not).length === 0;
}

/** Whether a `${defKey}:${name}` row names a path INSIDE a def rather than a key of it. */
export function isNestedAuthorableKey(key: string): boolean {
  const sep = key.indexOf(':');
  return sep >= 0 && key.slice(sep + 1).includes('.');
}

/**
 * Follow `$ref` chains that point inside this document. Returns `null` for an
 * external ref or a cycle — an unresolvable node, never a wrong one.
 *
 * The bare root pointer `#` is a third of the shipped spellings (36 emitted
 * occurrences against 1,032 `#/$defs/…` ones): it is how a RECURSIVE schema
 * refers back to its own document, and reading it as external would make every
 * path under a recursive node read as a typo.
 */
function dereference(node: unknown, doc: Record<string, unknown>): unknown {
  const seen = new Set<string>();
  let current = node;
  while (current && typeof current === 'object' && typeof (current as Record<string, unknown>).$ref === 'string') {
    const ref = (current as Record<string, unknown>).$ref as string;
    if (!ref.startsWith('#') || seen.has(ref)) return null;
    seen.add(ref);
    const pointer = ref.slice(1);
    if (pointer !== '' && !pointer.startsWith('/')) return null;
    let target: unknown = doc;
    for (const rawToken of pointer === '' ? [] : pointer.slice(1).split('/')) {
      const token = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object') return null;
      target = (target as Record<string, unknown>)[token];
    }
    current = target;
  }
  return current;
}

/**
 * Every object node reachable from `node` without consuming a path segment —
 * itself, its union branches and its array members, each dereferenced.
 */
function unwrapObjectNodes(
  node: unknown,
  doc: Record<string, unknown>,
  into: Record<string, unknown>[],
  seen: Set<unknown>,
  depth: number,
): void {
  if (depth > MAX_UNWRAP_DEPTH) return;
  const resolved = dereference(node, doc);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return;
  if (seen.has(resolved)) return;
  seen.add(resolved);
  into.push(resolved as Record<string, unknown>);
  for (const combinator of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = (resolved as Record<string, unknown>)[combinator];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) unwrapObjectNodes(branch, doc, into, seen, depth + 1);
  }
  // An array is traversed without consuming a segment: the registry spells an
  // array member's key `steps.estimatedMinutes`, not `steps[].estimatedMinutes`.
  const items = (resolved as Record<string, unknown>).items;
  if (items !== undefined) unwrapObjectNodes(items, doc, into, seen, depth + 1);
}

/** Every declaration of `segment` reachable from `node`, across branches and array members. */
function propertyNodes(segment: string, node: unknown, doc: Record<string, unknown>): unknown[] {
  const objects: Record<string, unknown>[] = [];
  unwrapObjectNodes(node, doc, objects, new Set(), 0);
  const found: unknown[] = [];
  for (const object of objects) {
    const properties = object.properties;
    if (!properties || typeof properties !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(properties, segment)) continue;
    found.push((properties as Record<string, unknown>)[segment]);
  }
  return found;
}

/**
 * Judge one registered `${defKey}:${a.b.c}` row against the schemas this build
 * emitted.
 *
 * A leaf declared on more than one union branch reads `live` unless EVERY
 * declaration of it is a tombstone: if an author can still write the key
 * through any branch, the registration is the premature one check (b2) exists
 * to refuse.
 */
export function nestedAuthorableKeyState(
  key: string,
  schemasByDefKey: ReadonlyMap<string, Record<string, unknown>>,
): NestedAuthorableKeyState {
  const separator = key.indexOf(':');
  if (separator < 0) return 'unresolvable';
  const defKey = key.slice(0, separator);
  const path = key.slice(separator + 1);
  const doc = schemasByDefKey.get(defKey);
  if (!doc) return 'def-not-emitted';

  let nodes: unknown[] = [doc];
  for (const segment of path.split('.')) {
    if (segment.length === 0) return 'unresolvable';
    const next: unknown[] = [];
    for (const node of nodes) next.push(...propertyNodes(segment, node, doc));
    if (next.length === 0) return 'unresolvable';
    nodes = next;
  }
  const everyDeclarationTombstoned = nodes.every((node) =>
    isRetiredJsonSchemaNode(dereference(node, doc)),
  );
  return everyDeclarationTombstoned ? 'retired' : 'live';
}
