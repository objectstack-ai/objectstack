// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two exports of one namespace publishing under the SAME def key (#5832).
 *
 * ## The gap this closes
 *
 * `build-schemas.ts` walks each namespace's runtime exports and writes
 * `json-schema/<category>/<Name>.json`, where `<Name>` is
 * `schemaNameFromExportKey(exportKey)` — the export key with a trailing
 * `Schema` stripped. That map is many-to-one by construction: `Foo` and
 * `FooSchema` both resolve to `Foo`. The write was unconditional
 * (`generatedSchemas.set(defKey, …)`), so when two exports resolved to one def
 * key the second silently overwrote the first, and which one survived was
 * decided by export iteration order.
 *
 * `shared/http.zod.ts` had exactly that: `HttpMethod` (seven methods, the enum
 * every `api/*` route is declared with) and `HttpMethodSchema` (five, the view
 * data-source subset). Both published as `shared/HttpMethod`, the five-value
 * one landed last, and so `json-schema/shared/HttpMethod.json`, the bundled
 * `$defs['shared/HttpMethod']` and `references/shared/http#httpmethod` all
 * described the subset — telling every downstream validator, IDE completion and
 * AI metadata author that `HEAD` and `OPTIONS` are illegal on routes that
 * accept them. AGENTS.md: machine-readable surfaces must not lie.
 *
 * Nothing reported it. `check:dual-source-exports` compares EXPORT NAMES
 * (`HttpMethod` and `HttpMethodSchema` are two names, so it sees nothing) and
 * the #4696 docs-index conflict check keys `<category>/<name>` by FILE, so two
 * colliding exports of the same file are one entry to it. The collision only
 * exists after the suffix strip — the same blind spot family as #4592.
 *
 * ## The rule
 *
 * > A def key may be written twice ONLY when both export keys name the very
 * > same schema instance.
 *
 * Identity, not today's byte-equality. The permitted shape is the package's
 * self-alias convention: a second export name bound to the very same schema
 * object, as `src/api/endpoint.zod.ts` does with
 * `export const ApiEndpoint = Object.assign(ApiEndpointSchema, { create })` —
 * `Object.assign` returns its target, so `ApiEndpoint` and `ApiEndpointSchema`
 * are one object and the second write cannot change what is published. A plain
 * re-export (`export const Foo = FooSchema`) is the same shape by the same test.
 *
 * How many of these the package carries, and which def keys they land on, is
 * deliberately NOT restated here: the population moves, and nothing checks a
 * comment. `build-schemas.ts` prints it on every run instead (#12588 — the
 * `N emit(s) collapsed into M existing def key(s) — all self-aliases` line,
 * built from `findSelfAliasedDefKeys` below, which lists each def key and the
 * export keys that reach it). Read that run, not this paragraph. Anything else is
 * two independent declarations under one published name: even if their JSON
 * happens to match today, the next edit to either one makes the artifact
 * depend on export order again, silently. So the guard refuses at the point
 * where the ambiguity is introduced rather than where it becomes visible.
 *
 * The remedy is always at the source, never here: rename the loser to a def
 * name of its own (#4684's `RateLimitConfig` precedent, ADR-0112 D9 — one name
 * means one thing), or delete the duplicate and re-export the survivor.
 *
 * ## The exempt population is enumerable, not implied (#12588)
 *
 * The exemption above is silent by design — a self-alias publishes one artifact,
 * so there is nothing to report as a *problem*. But it is not nothing: those
 * writes are the reason the generator's emit count exceeds the number of
 * definitions it publishes, and for a long time that delta was the only
 * externally visible trace of them. It surfaced as a published artifact
 * describing itself wrongly: `objectstack.json` carried `x-schema-count` taken
 * from the emit counter while its `$defs` held one entry per def key, so the
 * bundle claimed 1596 definitions and shipped 1585.
 *
 * `findSelfAliasedDefKeys` is the other half of `findDefKeyCollisions`: same
 * bucketing, same identity predicate, opposite verdict. Together they partition
 * every multiply-written def key, so "how many emits collapsed, and into what"
 * is answerable rather than inferred from a subtraction.
 */

/** One export as `build-schemas.ts` met it, before anything is written. */
export interface EmittedDef {
  /** Lowercased namespace slug — the `json-schema/<category>/` folder. */
  category: string;
  /** The runtime export key (`HttpMethodSchema`). */
  exportKey: string;
  /** `schemaNameFromExportKey(exportKey)` — the published name. */
  schemaName: string;
  /**
   * The schema object itself. Compared by REFERENCE only; this module never
   * inspects it, so callers may pass the Zod instance as-is.
   */
  schema: unknown;
}

/** A def key claimed by two or more distinct schema instances. */
export interface DefKeyCollision {
  /** `<category>/<SchemaName>` — the file `build-schemas.ts` would write. */
  defKey: string;
  /** Every export key that resolves to it, in encounter order. */
  exportKeys: string[];
}

/** A def key written more than once, every write the SAME schema instance. */
export interface SelfAliasedDefKey {
  /** `<category>/<SchemaName>` — the one file all of these writes produce. */
  defKey: string;
  /** Every export key that resolves to it, in encounter order. */
  exportKeys: string[];
}

/**
 * Group entries by the def key they publish to, preserving encounter order both
 * between buckets and inside them, so every report built from this is stable
 * across runs. Shared by both verdicts below: they must never disagree about
 * which entries belong to one key.
 */
function bucketByDefKey(entries: Iterable<EmittedDef>): Map<string, EmittedDef[]> {
  const byDefKey = new Map<string, EmittedDef[]>();
  for (const entry of entries) {
    const defKey = `${entry.category}/${entry.schemaName}`;
    const bucket = byDefKey.get(defKey);
    if (bucket) bucket.push(entry);
    else byDefKey.set(defKey, [entry]);
  }
  return byDefKey;
}

/** Every write in the bucket names the identical object — the exempt shape. */
function isSelfAlias(bucket: readonly EmittedDef[]): boolean {
  return bucket.every((e) => e.schema === bucket[0].schema);
}

/**
 * Def keys written more than once by DIFFERENT schema instances.
 *
 * Self-aliases (every entry for a key is the identical object) are not
 * collisions and are not reported — `findSelfAliasedDefKeys` returns exactly
 * those. Result order follows first encounter, so a build's report is stable
 * across runs.
 */
export function findDefKeyCollisions(entries: Iterable<EmittedDef>): DefKeyCollision[] {
  const collisions: DefKeyCollision[] = [];
  for (const [defKey, bucket] of bucketByDefKey(entries)) {
    if (bucket.length < 2) continue;
    // One object reached by two names publishes one artifact — no ambiguity.
    if (isSelfAlias(bucket)) continue;
    collisions.push({ defKey, exportKeys: bucket.map((e) => e.exportKey) });
  }
  return collisions;
}

/**
 * Def keys written more than once where every write is the SAME instance — the
 * population `findDefKeyCollisions` exempts, and the reason a build's emit
 * count exceeds the number of definitions it publishes (#12588).
 *
 * This is a report, never a verdict: each of these publishes one artifact and
 * nothing about it depends on export order. Callers use it to *account for* the
 * difference between emits and definitions, not to fail a build.
 */
export function findSelfAliasedDefKeys(entries: Iterable<EmittedDef>): SelfAliasedDefKey[] {
  const aliases: SelfAliasedDefKey[] = [];
  for (const [defKey, bucket] of bucketByDefKey(entries)) {
    if (bucket.length < 2) continue;
    if (!isSelfAlias(bucket)) continue;
    aliases.push({ defKey, exportKeys: bucket.map((e) => e.exportKey) });
  }
  return aliases;
}

/**
 * How many emits these self-aliased keys absorb — the count by which a build's
 * emit total exceeds its published definition count. A key written N times
 * contributes N-1: the first write is the definition, the rest collapse onto it.
 */
export function collapsedEmitCount(aliases: readonly SelfAliasedDefKey[]): number {
  return aliases.reduce((total, alias) => total + alias.exportKeys.length - 1, 0);
}

/** The build-stopping message for `findDefKeyCollisions()`. */
export function formatDefKeyCollisions(collisions: readonly DefKeyCollision[]): string {
  const lines = collisions.map(
    (c) => `    json-schema/${c.defKey}.json  <-  ${c.exportKeys.join(', ')}`,
  );
  return (
    `${collisions.length} JSON Schema def key(s) are claimed by two or more different schemas:\n\n` +
    `${lines.join('\n')}\n\n` +
    `A def key is \`<category>/<Name>\` with \`<Name>\` = the export key minus a trailing\n` +
    `\`Schema\` (scripts/lib/schema-name.ts), so \`Foo\` and \`FooSchema\` publish to ONE file.\n` +
    `Writing it twice means the published artifact — json-schema/, the bundled objectstack.json\n` +
    `\`$defs\`, and the reference page built from them — describes whichever export the namespace\n` +
    `happened to enumerate last, and the other one is not published at all (#5832).\n\n` +
    `Fix it at the source, not here:\n` +
    `  - two DIFFERENT schemas: rename one to a def name of its own — that is what #4684 did for\n` +
    `    \`RateLimitConfig\` and #5832 for \`HttpMethodSubsetSchema\`, and what ADR-0112 D9 means by\n` +
    `    one name meaning one thing. Record the rename in scripts/lib/renamed-defs.ts when the OLD\n` +
    `    def key stops being emitted;\n` +
    `  - a duplicate DECLARATION of one schema: delete it and re-export the survivor, so both\n` +
    `    names resolve to a single object — \`export const Foo = FooSchema\`, or the\n` +
    `    \`Object.assign(FooSchema, { … })\` form src/api/endpoint.zod.ts uses for \`ApiEndpoint\`.\n` +
    `    Either shape is allowed here precisely because it cannot change what is published;\n` +
    `    a build's own summary lists the self-aliases it already carries.\n`
  );
}
