// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `strictObject` — one call to close an authoring shape against unknown keys.
 *
 * ## Why this exists
 *
 * The #4001 campaign's standard wiring was four moving parts per schema: a
 * hand-transcribed `const X_KEYS = [...] as const` array, a
 * `strictUnknownKeyError({ surface, knownKeys: X_KEYS, history })` call, the
 * `{ error }` argument, and `.strict()`. Plus — because the transcribed array
 * can drift from the shape it describes — an "accepts every declared key" probe
 * test to catch the drift.
 *
 * That was ~34 key arrays and 16 drift-probe test files at the point this
 * helper was written, for a campaign with most of its authorable surface still
 * ahead of it. The cost is not the typing; it is that **the array is a second
 * copy of the truth**, so every schema edit is two edits, and the probe test
 * exists only to catch the case where someone made one of them.
 *
 * The array was never necessary. `knownKeys` feeds one thing — the
 * edit-distance "did you mean" fallback — and the shape object is right there
 * at the call site. Deriving the keys from the shape makes the two copies one,
 * which is also why **no drift probe is needed for a schema built this way**:
 * the key list cannot disagree with the shape it was read from.
 *
 * ## What it does not replace
 *
 * `aliases` and `guidance` stay hand-written, because they are the part that
 * carries judgement rather than transcription:
 *
 * - `aliases` — semantic near-misses edit distance cannot reach. The one that
 *   proves the category is `visibleWhen → visible`: ADR-0089 made `visibleWhen`
 *   the correct spelling on view/page, so an author borrowing it on a different
 *   surface is not making a typo, and only a human-written entry can catch it.
 * - `guidance` — tombstones for retired keys (the rejection must carry the
 *   upgrade) and wrong-layer pointers.
 *
 * Both are optional. A schema with neither still gets a named surface, the
 * offending key echoed back, and a distance-based suggestion — which is the
 * difference between a silent strip and a fixable error. Curation is an
 * upgrade, not a precondition, and treating it as a precondition is part of why
 * the ratchet moved as slowly as it did.
 *
 * @example
 * ```ts
 * export const WidgetSchema = lazySchema(() => strictObject(
 *   {
 *     surface: 'this widget',
 *     history: 'Until #4001 these were dropped silently — the widget still rendered.',
 *     aliases: { visibleWhen: 'visible' },
 *   },
 *   {
 *     name: z.string(),
 *     visible: z.boolean().optional(),
 *   },
 * ));
 * ```
 */

import { z } from 'zod';

import { strictUnknownKeyError } from './suggestions.zod';

/**
 * True when `schema` accepts no value at all — a `z.never()`, however wrapped.
 *
 * The case this exists for is {@link retiredKey}, which declares a removed key
 * as `z.never().optional()` so the removal is audible in both channels an
 * upgrading author hits: `tsc` (the input type is `never`) and the parse (the
 * value raises the upgrade prescription). That declaration is deliberate and
 * strictly stronger than a `guidance` entry — but it also puts the dead key in
 * `Object.keys(shape)`, and the suggester happily offered it.
 *
 * Which produced this, on `skill`, from the campaign's own helper:
 *
 *     Unrecognized key(s) on this skill: `triggerPhrase`. …
 *     Did you mean `triggerPhrase` → `triggerPhrases`?
 *
 * `triggerPhrases` was REMOVED. An author who took the advice landed on the
 * tombstone and got a second rejection telling them to delete what they had
 * just been told to write. Not silent — but it is the shape the ledger's
 * finding 7 already records twice: **this campaign's own fix signposting the
 * way into the failure mode it exists to kill.**
 *
 * The rule is narrower than "skip tombstones" and holds without knowing why a
 * key is unwritable: **never suggest a key the schema cannot accept.** A
 * structural check gets that for free, and keeps working if the tombstone
 * helper is ever reshaped.
 */
function acceptsNothing(schema: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  const def = (schema as { _zod?: { def?: { type?: string; innerType?: unknown } } })._zod?.def;
  if (!def?.type) return false;
  if (def.type === 'never') return true;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      return acceptsNothing(def.innerType, depth + 1);
    default:
      return false;
  }
}

/** Authoring-surface metadata for {@link strictObject}. */
export interface StrictObjectOptions {
  /** Prose name of the surface the key was written on (e.g. `'this widget'`). */
  surface: string;
  /** One sentence: what silently happened before this shape was closed. */
  history: string;
  /**
   * Semantic near-misses edit distance cannot reach — a different *word* for
   * the same intent, usually correct on a neighbouring surface.
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Exact-key prescriptions appended as bullet lines: tombstones for retired
   * keys, wrong-layer pointers. An entry here suppresses the rename suggestion.
   */
  guidance?: Readonly<Record<string, string>>;
  /**
   * Extra candidates for the "did you mean" fallback beyond the shape's own
   * keys. For a base that gets `.extend()`ed elsewhere, naming the extension's
   * keys here keeps the suggestion useful on the extended surface.
   */
  extraKeys?: readonly string[];
}

/**
 * A `.strict()` object whose unknown-key error names the surface, echoes the
 * offending key, and suggests the closest declared key — with the candidate
 * list read from `shape` rather than transcribed alongside it.
 */
export function strictObject<T extends z.ZodRawShape>(options: StrictObjectOptions, shape: T) {
  const { surface, history, aliases, guidance, extraKeys = [] } = options;
  return z
    .object(shape, {
      error: strictUnknownKeyError({
        surface,
        // Declared-but-unwritable keys (tombstones) are excluded — see
        // `acceptsNothing`. They stay in the SHAPE, so writing one still raises
        // its own prescription; they are only kept out of the candidate list a
        // typo gets pointed at.
        knownKeys: [
          ...Object.keys(shape).filter((k) => !acceptsNothing(shape[k])),
          ...extraKeys,
        ],
        history,
        aliases,
        guidance,
      }),
    })
    .strict();
}
