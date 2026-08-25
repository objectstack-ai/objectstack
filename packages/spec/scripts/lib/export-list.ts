// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `Exports: …` line a skill-reference row falls back to when its module has
 * no doc block of its own — and which exports may appear on it.
 *
 * Extracted from `build-skill-references.ts` (#12201) for the same reason
 * `file-description.ts` (#5059), `format-type.ts` (#4912) and `escape-mdx.ts`
 * (#5452) were: the generator is a top-level script that runs `main()` on
 * import, so the only way to assert on this list used to be to run the whole
 * thing and read the emitted `_index.md`.
 *
 * ## Why the list is filtered
 *
 * The line is TRUE either way — an accurate list of what the module exports,
 * which is why #12094 kept the fallback instead of refusing (an honest export
 * list beats a confidently wrong prose sentence). What is wrong is the
 * RANKING. Two properties combined badly:
 *
 * 1. Rank was SOURCE ORDER — `slice(0, 5)` kept whichever five happened to be
 *    declared first, which is a fact about file layout, not about importance.
 * 2. The extraction has no notion of authorable surface — any `export const`
 *    qualified, including constants whose own names say they are not for
 *    authoring.
 *
 * So a `.zod.ts` that declares its machine constants near the top headlined
 * them. Measured on the post-#12094 catalog, three of the eleven modules that
 * reach this fallback did exactly that:
 *
 * - `automation/approval.zod.ts` — `DEPRECATED_APPROVER_TYPES`,
 *   `NON_AUTHORABLE_APPROVER_TYPES`
 * - `kernel/plugin.zod.ts` — `CORE_PLUGIN_TYPES`, `CONSUMER_INSTALLABLE_TYPES`
 * - `system/translation.zod.ts` — `LEGACY_OBJECT_FIRST_KEYS`
 *
 * `skills/**` is loaded WHOLE into a customer agent's context window, and its
 * job is to teach that agent what it may author. A row headlining
 * `DEPRECATED_APPROVER_TYPES` and `NON_AUTHORABLE_APPROVER_TYPES` points an
 * authoring agent at precisely the vocabulary it must not use, with nothing on
 * the line marking them as such. Nothing is broken and no gate is wrong — this
 * is the "make AI-written metadata hard to get wrong" axis, and it is why the
 * repair belongs on this surface rather than in a lint rule about naming.
 *
 * ## Why filtering, and NOT `*Schema`-first sorting
 *
 * Machine constants are dropped and source order is kept for everything that
 * survives. Sorting `*Schema` exports ahead of the rest was considered and
 * deliberately NOT taken: on the very row that motivated this card it demotes
 * `ApproverType` — the approver-type enum an author actually writes — below
 * four schema objects, which is worse by this surface's own standard. The
 * hazard that was measured is machine vocabulary appearing AT ALL, not schemas
 * appearing late.
 *
 * The loud-refusal alternative (require a module doc block on every `.zod.ts`
 * reachable from `SKILL_MAP`, and drop this fallback) is also not taken —
 * #12094 declined it for this same population and that reasoning stands.
 * Authoring the missing module doc blocks remains a separate editorial
 * question; it would remove the symptom without any generator change, and this
 * filter does not stand in its way.
 */

/**
 * A machine constant by naming convention: all caps, with at least one
 * underscore.
 *
 * The underscore is REQUIRED rather than incidental. `SCREAMING_SNAKE` is a
 * convention about multi-word constants, and the separator is what makes the
 * reading unambiguous — a lone all-caps token (`URL`, `ID`, `MCP`) is as
 * plausibly an acronym inside a name as it is a constant. Measured across the
 * eleven modules that reach this fallback, the two readings are
 * indistinguishable: every all-caps export in the corpus has an underscore, and
 * no export is a lone all-caps token. Where the corpus cannot choose, the
 * narrower rule wins, and `export-list.test.ts` pins that boundary — so
 * widening it later is a decision someone makes on evidence, not a regex
 * someone quietly loosens.
 */
const MACHINE_CONSTANT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * Every `export const` name, in source order.
 *
 * Carried over from the generator verbatim, alternation included. The
 * `\w+Schema|\w+` branch is redundant — the second alternative subsumes the
 * first for every input, since both are anchored by the same trailing
 * `\s*[:=]` — but this change is about RANKING, and rewriting the extraction
 * at the same time would widen what the diff has to be trusted about.
 */
const EXPORT_CONST = /export\s+const\s+(\w+Schema|\w+)\s*(?:[:=])/g;

/** How many names a pointer row lists before it becomes noise. */
const MAX_NAMES = 5;

/**
 * The `Exports: …` description for a module with no doc block of its own, or
 * `null` when there is nothing authorable to name.
 *
 * `null` is the "fall through" answer, and it is distinct from an empty list on
 * purpose: the caller prints no description at all rather than a bare
 * `Exports:` with nothing after it. A module whose entire public surface is
 * machine constants has nothing to say to an authoring agent, and 宁可缺,
 * 不要错 — a row with no description is a gap the reader can see.
 *
 * The cap is applied AFTER filtering, not before. Slicing first would let a
 * module's constants consume the row's five slots and then be deleted from it,
 * so the fix would merely SHORTEN the hazardous rows instead of promoting the
 * authorable names waiting behind them — `system/translation.zod.ts` would
 * publish four names where five were available.
 */
export function exportListDescription(source: string): string | null {
  const names: string[] = [];
  for (const match of source.matchAll(EXPORT_CONST)) {
    if (!MACHINE_CONSTANT.test(match[1])) names.push(match[1]);
  }
  if (names.length === 0) return null;
  return `Exports: ${names.slice(0, MAX_NAMES).join(', ')}`;
}
