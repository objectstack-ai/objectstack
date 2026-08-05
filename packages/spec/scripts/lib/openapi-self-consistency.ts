// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Self-consistency assertions for the generated OpenAPI document (#5168).
 *
 * ## The gap this closes
 *
 * `gen:openapi` is one of the two completely ungated generators in the repo
 * (`check:generated`'s own closing line names it: "Generated but ungated (2):
 * gen:openapi, gen:sbom"). Ungated in BOTH senses — nothing verifies the
 * artifact is current, and nothing verified it was even internally coherent.
 *
 * #5168 is what the second gap costs. Every one of the nine contract schemas
 * is wrapped in `lazySchema()`, whose Proxy target is `function lazyZod() {}`,
 * so `typeof schema === 'function'`. The collector's guard led with
 * `typeof schema === 'object'`, short-circuited on all nine, and emitted
 * `components.schemas: {}` — while the hand-written `$ref` literals in `paths`
 * were written out regardless. The published document therefore carried six
 * `$ref`s pointing at nothing, covering the request and response bodies of
 * every CRUD operation, and the failure was visible three ways at once (empty
 * components, dangling refs, a `Components: 0` line printed to the console)
 * without a single thing going red.
 *
 * A "the artifact is coherent" assertion is cheaper than a "the artifact is
 * current" one and catches strictly this class: it needs no baseline, no
 * committed snapshot (`packages/spec/json-schema/` is gitignored and rebuilt
 * on every `pnpm build`), and it covers `$ref`s added in the future for free.
 *
 * ## The two rules
 *
 * 1. **Every local `$ref` resolves.** Any `$ref` beginning with `#/` is a JSON
 *    Pointer into this same document; if it does not resolve, the document is
 *    broken for every consumer that parses it (Scalar's viewer at
 *    `GET /api/v1/docs`, and any client generator pointed at
 *    `GET /api/v1/openapi.json`). Resolution is by pointer rather than by a
 *    `#/components/schemas/` prefix match so that a future `#/$defs/…` ref
 *    is covered without touching this file.
 * 2. **No schema is silently degraded.** See `assertNoDegradedSchemas`.
 *
 * Both are consulted BEFORE the document is written: a self-inconsistent
 * artifact is never emitted at all, rather than emitted and then complained
 * about. The gate is wired into the generator itself (not a separate `check:`
 * script) because the artifact is regenerated on every build — a standalone
 * checker would have to run the generator first to have anything to check.
 */

/** One unresolvable `$ref`, with the document location that carried it. */
export interface DanglingRef {
  /** The `$ref` value verbatim, e.g. `#/components/schemas/ApiError`. */
  ref: string;
  /** Where it appeared, as a readable path: `paths./api/{object}.get.…`. */
  at: string;
}

/**
 * Resolve a JSON Pointer (RFC 6901) against `root`.
 *
 * Returns `undefined` when any segment is missing. `~1` decodes to `/` and
 * `~0` to `~`, in that order — reversing the order corrupts a literal `~1`.
 */
function resolvePointer(root: unknown, pointer: string): unknown {
  // '#' alone addresses the whole document.
  if (pointer === '#' || pointer === '#/') return root;

  const segments = pointer
    .slice(2) // drop the leading '#/'
    .split('/')
    .map((s) => decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~'));

  let node: unknown = root;
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    const container = node as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(container, segment)) return undefined;
    node = container[segment];
  }
  return node;
}

/**
 * Collect every local (`#/…`) `$ref` in `doc` that does not resolve.
 *
 * External refs (`https://…`, `./other.json#/…`) are out of scope — this
 * document has never contained one, and resolving them would mean fetching.
 * They are simply not reported either way.
 */
export function findDanglingRefs(doc: unknown): DanglingRef[] {
  const dangling: DanglingRef[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, at: string): void => {
    if (node === null || typeof node !== 'object') return;
    // Generated documents are trees, but guard against a cycle regardless:
    // an unguarded walk would hang the build instead of failing it.
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const here = at ? `${at}.${key}` : key;
      if (key === '$ref' && typeof value === 'string') {
        if (value.startsWith('#') && resolvePointer(doc, value) === undefined) {
          dangling.push({ ref: value, at });
        }
        continue;
      }
      walk(value, here);
    }
  };

  walk(doc, '');
  return dangling;
}

/**
 * Throw when any `$ref` in `doc` dangles. Message names every offender and the
 * schemas that WERE defined, because "which of the two sides is empty" is the
 * first thing a reader needs (in #5168 the defined side was `[]` entirely).
 */
export function assertRefsResolve(doc: unknown): void {
  const dangling = findDanglingRefs(doc);
  if (dangling.length === 0) return;

  const defined = Object.keys(
    ((doc as Record<string, any>)?.components?.schemas ?? {}) as Record<string, unknown>,
  );

  const lines = dangling.map((d) => `  - ${d.ref}  (referenced at ${d.at || '<root>'})`);
  throw new Error(
    `OpenAPI document is not self-consistent: ${dangling.length} unresolvable $ref(s).\n` +
      `${lines.join('\n')}\n` +
      `  defined components.schemas: [${defined.join(', ') || '<none>'}]\n` +
      `\n` +
      `  A $ref that resolves to nothing breaks every consumer of the published\n` +
      `  document (the Scalar viewer at GET /api/v1/docs renders an empty schema\n` +
      `  panel; client generators fail at parse time). If components.schemas is\n` +
      `  empty, the collector in build-openapi.ts skipped its inputs — note that\n` +
      `  lazySchema() returns a Proxy whose typeof is 'function', not 'object'\n` +
      `  (#5168).`,
  );
}

/**
 * Throw when any contract schema was dropped or degraded during collection.
 *
 * `build-openapi.ts` names its nine contract schemas in a literal table, so a
 * name that fails to convert is never a "this one is optional" — it is an
 * export that moved, was renamed, or stopped being a Zod schema. The original
 * loop expressed that as `if (looks-like-zod) { emit }` with no `else`, which
 * is precisely how nine silent skips published an empty `components.schemas`.
 * Declared here therefore means enforced: every declared name must produce a
 * real converted schema, or the build fails naming the ones that did not.
 */
export function assertNoDegradedSchemas(
  declared: readonly string[],
  emitted: Readonly<Record<string, unknown>>,
  degraded: readonly string[],
): void {
  const missing = declared.filter((name) => !(name in emitted));
  if (missing.length === 0 && degraded.length === 0) return;

  const parts: string[] = ['OpenAPI component schema collection is incomplete.'];
  if (missing.length > 0) {
    parts.push(
      `  not emitted at all (${missing.length}): ${missing.join(', ')}\n` +
        `    The export is missing, renamed, or is not a Zod schema. Note that a\n` +
        `    lazySchema() Proxy has typeof 'function' — a guard demanding\n` +
        `    typeof 'object' rejects every one of them (#5168).`,
    );
  }
  if (degraded.length > 0) {
    parts.push(
      `  converted to a placeholder (${degraded.length}): ${degraded.join(', ')}\n` +
        `    z.toJSONSchema() threw for these. Publishing a bare {type:'object'}\n` +
        `    in their place would ship a contract that describes nothing while\n` +
        `    looking complete — fix the schema instead.`,
    );
  }
  throw new Error(parts.join('\n'));
}
