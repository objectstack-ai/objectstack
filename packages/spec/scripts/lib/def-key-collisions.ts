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
 * self-alias convention — `export const ThemeMode = ThemeModeSchema`, and
 * fourteen more across `api`, `system` and `ui` — where the second write is the
 * same object and therefore cannot change what is published. Anything else is
 * two independent declarations under one published name: even if their JSON
 * happens to match today, the next edit to either one makes the artifact
 * depend on export order again, silently. So the guard refuses at the point
 * where the ambiguity is introduced rather than where it becomes visible.
 *
 * The remedy is always at the source, never here: rename the loser to a def
 * name of its own (#4684's `RateLimitConfig` precedent, ADR-0112 D9 — one name
 * means one thing), or delete the duplicate and re-export the survivor.
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

/**
 * Def keys written more than once by DIFFERENT schema instances.
 *
 * Self-aliases (every entry for a key is the identical object) are not
 * collisions and are not reported. Result order follows first encounter, so a
 * build's report is stable across runs.
 */
export function findDefKeyCollisions(entries: Iterable<EmittedDef>): DefKeyCollision[] {
  const byDefKey = new Map<string, EmittedDef[]>();
  for (const entry of entries) {
    const defKey = `${entry.category}/${entry.schemaName}`;
    const bucket = byDefKey.get(defKey);
    if (bucket) bucket.push(entry);
    else byDefKey.set(defKey, [entry]);
  }

  const collisions: DefKeyCollision[] = [];
  for (const [defKey, bucket] of byDefKey) {
    if (bucket.length < 2) continue;
    // One object reached by two names publishes one artifact — no ambiguity.
    if (bucket.every((e) => e.schema === bucket[0].schema)) continue;
    collisions.push({ defKey, exportKeys: bucket.map((e) => e.exportKey) });
  }
  return collisions;
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
    `    names resolve to a single object (\`export const ThemeMode = ThemeModeSchema\` — that\n` +
    `    shape is allowed here precisely because it cannot change what is published).\n`
  );
}
