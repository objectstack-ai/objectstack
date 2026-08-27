// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Translation staleness by recorded source hash (#8765, Option B).
 *
 * ## The hole this closes
 *
 * The `apps` / `dashboards` / `pages` half of this package's i18n is
 * HAND-AUTHORED in `<locale>.ts`. Every gate over it judges PRESENCE or
 * OWNERSHIP — `app-nav-translation-parity.test.ts` (a translation exists for
 * every declared id, and none outlives its declaration), `check:i18n-coverage`
 * (ratchets *untranslated* labels), `check:app-nav-i18n` (a label per locale on
 * the merged nav tree). A translated value that has gone STALE satisfies every
 * one of them: it is present, it is owned, it is not untranslated. So when a
 * source string is edited, the three translated bundles keep serving the
 * previous translation under a fully green build — which is how
 * `widget_recent_events` shipped its pre-conversion title in all four locales.
 *
 * Pinning `en` to the source (the default-locale block in
 * `app-nav-translation-parity.test.ts`) does not create that drift, but it does
 * remove the one accidental symptom that used to make it visible: the drift
 * stops being uniform across four bundles and becomes locale-specific,
 * invisible to every reviewer who reads the product in English.
 *
 * ## The ruled shape — Option B
 *
 * Maintainer ruling (delegated adjudication, #8765): *record the source hash at
 * translation time; a hash mismatch marks the translation stale, and stale
 * falls back to the source text.*
 *
 * Two properties of that ruling are load-bearing here, and both are pinned in
 * `source-hash.test.ts`:
 *
 *  1. **A missing hash is LEGACY-TRUSTED, not stale.** Every translation that
 *     predates this mechanism has no recorded hash; reading "no hash" as
 *     "unverified ⇒ stale" would degrade every existing translation on day one.
 *     {@link withSourceFallback} only ever substitutes when a hash IS recorded
 *     and DISAGREES with the current source.
 *  2. **Recovery is per-locale.** The recorded hashes are per-locale tables, so
 *     re-translating one locale (value + its hash) restores that locale alone
 *     and leaves the others falling back. A single shared table could not
 *     express "zh-CN caught up, ja-JP has not".
 *
 * ## Why the fallback SUBSTITUTES the source string rather than deleting the key
 *
 * Both spellings serve identical text — a deleted leaf falls through the
 * resolver's locale chain (`zh-CN` → `en` → the metadata literal), and every
 * link in that chain is the source string. Substitution is chosen because it is
 * the one that changes no key set: every gate listed above, plus
 * `packages/cli/test/platform-page-i18n-parity.test.ts`, makes a KEY-SET claim
 * over these bundles, and deletion would move those key sets as a side effect of
 * a value-level rule — turning translation lag into a red build, which is
 * exactly the Option C cost the ruling rejected.
 *
 * It also introduces no state the product does not already have. A translated
 * locale carrying the source string verbatim is precisely what the extractor
 * writes today for an untranslated key under `--fill=default` (see
 * `extractTranslations` in `packages/cli/src/utils/i18n-extract.ts`), and what
 * every locale-chain fallback has always rendered. That invariance is the
 * acceptance criterion the ruling turns on: B is ruleable over A and C because
 * its failure mode is one the product already has a shape for. A staleness
 * signal that made a visibly THIRD state appear would have drifted from it.
 *
 * ## What counts as "the source string"
 *
 * `en.ts`'s own value at the same key path — no cross-package import needed.
 * That is sound because `en` is a COPY of the source rather than a translation
 * of it, and two assertions already hold it there:
 *
 *  - `apps.*` / `dashboards.*` — the default-locale block of
 *    `app-nav-translation-parity.test.ts` fails the build when `en.ts` stops
 *    matching the declared `SETUP_APP` / `STUDIO_APP` / `ACCOUNT_APP` /
 *    `SystemOverviewDashboard` literals verbatim.
 *  - `pages.*` — `check:app-nav-i18n` compares the `en` copy against the
 *    composed page metadata (those sources live in `@objectstack/cloud-connection`
 *    and `@objectstack/mcp`, which this package does not and must not depend on).
 *
 * So hashing `en` transitively hashes the declared source, and this module needs
 * to import nothing but the bundle sitting next to it.
 *
 * ## Scope: BOTH halves — and the correction that put the generated half here
 *
 * This note used to end with a claim that is FALSE, and #11671 is its
 * counterexample. It read:
 *
 * > `objects` and `metadataForms` are GENERATED (`*.generated.ts`) and are
 * > deliberately out of `HAND_AUTHORED_SECTIONS`. **This hole cannot occur
 * > there**: `os i18n extract` rewrites the `en` bundle from the source on
 * > every run and does not merge the default locale (#8543), so a source edit
 * > either lands in the generated bundle or fails `check:i18n` as drift.
 *
 * Every clause of that is true except the conclusion. Rewriting `en` catches
 * drift **in `en`**. The TRANSLATED locales keep merge semantics
 * (`i18n-extract.ts`: a non-empty existing value in a non-default locale wins),
 * so the ordinary sequence — extract with `--fill=default`, revise the source
 * string, extract again — rewrites `en` and STRANDS the previous source text in
 * every other locale. The bundle is still in sync by key, so `check:i18n`
 * reports OK; the leaf is still present, so `check:i18n-coverage` counts it
 * translated. Measured on #11659 at `bbe0b17`: three locales serving a 602-char
 * superseded draft of a 411-char help string under 31 green checks.
 *
 * A written-down impossibility is what stops the next reader from looking,
 * which is why correcting it was made part of the ruling rather than left as a
 * comment cleanup.
 *
 * Maintainer ruling on #12069 (2026-08-25, Option A): extend THIS module to the
 * generated bundles. So {@link GENERATED_SECTIONS} joins
 * {@link HAND_AUTHORED_SECTIONS} here — one mechanism, one hash function, one
 * recorded table shape.
 *
 * ## The two halves need two PREDICATES, and that is not two mechanisms
 *
 * What a recorded hash MEANS is the same in both halves — "the source revision
 * this leaf was last reconciled against". What the leaf's VALUE is differs, and
 * the predicate has to follow it:
 *
 *  - **hand-authored** — the value is a TRANSLATION, whose bytes say nothing
 *    about the source's. Stale is decided on the record alone:
 *    `recorded !== hash(currentSource)`. {@link findStaleLeaves}, unchanged.
 *  - **generated** — the value got there by being COPIED from the source
 *    (`--fill=default`). So the bytes themselves are evidence, and the record
 *    only certifies WHICH source revision they are a copy of. Stale is
 *    `hash(value) === recorded && hash(currentSource) !== recorded`.
 *    {@link findStaleFills}.
 *
 * The extra conjunct in the generated predicate is not caution, it is what
 * makes the mechanism self-healing where the hand-authored half cannot be. The
 * generated hash tables are themselves generated (`<locale>.source-hashes.
 * generated.ts`), so a translator CANNOT be asked to update a digest by hand
 * the way `<locale>.source-hashes.ts`'s header asks. Without the conjunct,
 * re-translating a filled leaf after its source moved would leave the stale
 * record standing and the gate would report the fresh translation as stale
 * forever — a false positive on precisely the action the mechanism exists to
 * provoke. With it, editing the value clears the flag by itself: the value is
 * no longer a copy of the recorded revision, so no claim is being made about it
 * any more.
 *
 * ## Why the generated tables can be BACKFILLED with no history
 *
 * The generated predicate only ever fires on a leaf whose value is still a byte
 * copy of the recorded revision. So the only records worth writing are for
 * leaves that ARE currently source copies, and those are identifiable from the
 * committed tree alone: `value === currentSource ⇒ record hash(value)`. A leaf
 * that differs from the current source is left with NO record — legacy-trusted,
 * exactly as the ruling's property 1 requires — because nothing in the tree says
 * which revision it was made from.
 *
 * Measured on this tree when the mechanism landed: 9030 translated leaves across
 * the nine bundle sets, 1543 of them byte-equal to `en` (records written) and
 * 7487 differing (legacy-trusted). Day-one stale count is **0 by construction** —
 * every record written equals the hash of the current source, so the second
 * conjunct is false for all of them. This mechanism cannot arrive red.
 */

import type { TranslationData } from '@objectstack/spec/system';

/**
 * The `TranslationData` sections written by hand in `<locale>.ts`, judged by
 * {@link findStaleLeaves}. Their recorded digests live in the hand-maintained
 * `<locale>.source-hashes.ts`.
 */
export const HAND_AUTHORED_SECTIONS = ['apps', 'dashboards', 'pages'] as const;

/**
 * The `TranslationData` sections written by `os i18n extract` into
 * `<locale>.objects.generated.ts` / `<locale>.metadata-forms.generated.ts`,
 * judged by {@link findStaleFills}. Their recorded digests live in the
 * generated `<locale>.source-hashes.generated.ts`.
 *
 * These were excluded from this module until #11671 measured that the hole it
 * closes occurs here too — see the module note for the claim that was wrong and
 * why it was wrong.
 */
export const GENERATED_SECTIONS = ['objects', 'metadataForms'] as const;

/** A recorded map of dotted leaf path → the source hash translated from. */
export type SourceHashes = Readonly<Record<string, string>>;

/**
 * 32-bit FNV-1a over UTF-16 code units, with a configurable basis and prime.
 *
 * Two calls with DIFFERENT constants give two different hash functions, not two
 * views of one — which is what makes concatenating them in {@link hashSource}
 * worth more than either alone.
 */
function fnv1a32(input: string, basis: number, prime: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, prime) >>> 0;
  }
  // Final avalanche (murmur3 finalizer) so single-character edits at the tail
  // move the whole digest rather than its low bits.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The recorded digest of a source string — 64 bits, lower-case hex.
 *
 * Deliberately a small pure function rather than `node:crypto`: this runs at
 * module-evaluation time in a package that ships to any runtime, and the ruling
 * asked for "one recorded hash and one comparison", not a pipeline. Nothing
 * here is a security boundary — a collision's cost is that one stale
 * translation keeps being served, i.e. exactly today's behaviour for that one
 * leaf, so 64 bits over a few hundred short strings is the right trade.
 */
export function hashSource(source: string): string {
  const a = fnv1a32(source, 0x811c9dc5, 0x01000193);
  const b = fnv1a32(source, 0x9e3779b9, 0x85ebca6b);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every string leaf of the hand-authored sections, keyed by dotted path
 * (`apps.setup.navigation.group_overview.label`).
 *
 * A generic deep walk rather than an enumeration of the known shapes: the
 * sections grow keys (`subCaption`, `pages.<n>.components.<id>.<copyKey>`) and
 * an enumeration would silently stop covering the new ones — the same
 * declared-but-unwalked failure this module exists to close.
 */
export function collectSourceLeaves(data: TranslationData | undefined): Map<string, string> {
  return collectLeavesOf(data, HAND_AUTHORED_SECTIONS);
}

/**
 * The same walk over {@link GENERATED_SECTIONS} — every string leaf of the
 * `objects` / `metadataForms` sub-trees, keyed by dotted path
 * (`objects.sys_user.fields.email.help`).
 *
 * A separate entry point rather than a parameter on {@link collectSourceLeaves}
 * because the two populations are judged by two different predicates, and a
 * single call that could return either is one `??` away from applying the wrong
 * one to the wrong half.
 */
export function collectGeneratedLeaves(data: TranslationData | undefined): Map<string, string> {
  return collectLeavesOf(data, GENERATED_SECTIONS);
}

function collectLeavesOf(
  data: TranslationData | undefined,
  sections: readonly string[],
): Map<string, string> {
  const leaves = new Map<string, string>();
  if (!data) return leaves;

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      leaves.set(path, node);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  for (const section of sections) {
    walk((data as Record<string, unknown>)[section], section);
  }
  return leaves;
}

/**
 * The full hash table for a source bundle — what a `<locale>.source-hashes.ts`
 * entry should say once its locale has been re-translated against this source.
 *
 * Exported so refreshing one entry needs no script: a translator who updates
 * `zh-CN.ts` reads the new digest for that path out of this map and records it
 * beside the value they just wrote. It is also the one-time backfill that made
 * the existing tables (every current translation trusted against the current
 * source, per the ruling's legacy-trusted note).
 */
export function collectSourceHashes(source: TranslationData | undefined): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const [path, value] of collectSourceLeaves(source)) {
    hashes[path] = hashSource(value);
  }
  return hashes;
}

/**
 * The record `os i18n extract` writes for one translated locale's generated
 * sections — the pure rule behind `<locale>.source-hashes.generated.ts`.
 *
 * One entry per leaf that IS currently a byte copy of some source revision, and
 * nothing else:
 *
 *  - `value === currentSource` — the leaf is a copy of the CURRENT source
 *    (a fresh `--fill=default`, or a term deliberately left in English). Record
 *    `hash(value)`, which is also `hash(currentSource)`, so it is not stale.
 *  - `previous[path] === hash(value)` — the leaf is still the copy the last run
 *    recorded, whatever the source has done since. Carry the record forward;
 *    that is the whole memory this mechanism has, and dropping it is how the
 *    drift becomes undetectable again.
 *  - otherwise — record NOTHING. Either the leaf was translated (its bytes are
 *    not a copy of anything we recorded) or it predates the mechanism. Both are
 *    legacy-trusted, per the ruling's property 1.
 *
 * Note the third bullet is also the self-healing step: a translator who edits a
 * stale filled leaf makes `hash(value)` stop matching the record, so the record
 * is dropped on the next extract and the leaf goes back to legacy-trusted
 * instead of being reported stale forever.
 *
 * Pure and total: same inputs, same table. That is what lets `os i18n extract
 * --check` compare the committed companion byte-for-byte.
 */
export function collectFilledFromHashes(
  translated: TranslationData | undefined,
  source: TranslationData | undefined,
  previous: SourceHashes | undefined,
): Record<string, string> {
  const sourceLeaves = collectGeneratedLeaves(source);
  const hashes: Record<string, string> = {};
  for (const [path, value] of collectGeneratedLeaves(translated)) {
    const digest = hashSource(value);
    const isCurrentCopy = sourceLeaves.get(path) === value;
    const wasRecordedCopy = previous?.[path] === digest;
    if (isCurrentCopy || wasRecordedCopy) hashes[path] = digest;
  }
  return hashes;
}

/** A leaf whose recorded hash disagrees with the current source. */
export interface StaleLeaf {
  /** Dotted leaf path, e.g. `dashboards.system_overview.widgets.w1.title`. */
  path: string;
  /** The hash recorded when the translation was made. */
  recorded: string;
  /** The hash of the source string as it reads now. */
  current: string;
}

/**
 * The stale leaves of one translated bundle, in walk order.
 *
 * Separate from {@link withSourceFallback} because "which entries need
 * re-translating" is a question worth asking without rewriting anything — it is
 * what a maintainer wants after editing a source string, and what the tests
 * assert against.
 *
 * A path with no recorded hash is NOT reported: missing is legacy-trusted, per
 * the ruling. A path whose source string no longer exists at all is not
 * reported either — that is a REMOVED key, which the parity tests' reverse
 * direction already owns, and re-reporting it here would put two owners on one
 * fact.
 */
export function findStaleLeaves(
  translated: TranslationData | undefined,
  source: TranslationData | undefined,
  recorded: SourceHashes | undefined,
): StaleLeaf[] {
  if (!translated || !recorded) return [];
  const sourceLeaves = collectSourceLeaves(source);
  const stale: StaleLeaf[] = [];

  for (const path of collectSourceLeaves(translated).keys()) {
    const recordedHash = recorded[path];
    if (recordedHash === undefined) continue; // legacy-trusted
    const sourceValue = sourceLeaves.get(path);
    if (sourceValue === undefined) continue; // removed key — not this rule's
    const currentHash = hashSource(sourceValue);
    if (currentHash !== recordedHash) {
      stale.push({ path, recorded: recordedHash, current: currentHash });
    }
  }
  return stale;
}

/** A generated leaf still holding a byte copy of a source revision that has moved on. */
export interface StaleFill {
  /** Dotted leaf path, e.g. `objects.sys_user.fields.email.help`. */
  path: string;
  /** The digest of the source revision this leaf is a copy of. */
  recorded: string;
  /** The digest of the source string as it reads now. */
  current: string;
}

/**
 * The stale FILLS of one translated bundle's generated sections, in walk order.
 *
 * Three conjuncts, and each one is load-bearing:
 *
 *  1. a digest is recorded for the path — no record is legacy-trusted, never
 *     stale (the ruling's property 1);
 *  2. `hash(value) === recorded` — the leaf is STILL the copy that was
 *     recorded. A leaf someone has since re-translated fails here and is not
 *     reported, which is what keeps a real translation from being called stale
 *     merely because it once started life as a fill;
 *  3. `hash(currentSource) !== recorded` — the source has actually moved. A
 *     leaf equal to the CURRENT source is not drift: an untranslated key, a
 *     proper noun, a symbol or a term left in English on purpose all live here,
 *     and reporting them would be restating the gap `check:i18n-coverage`
 *     already owns.
 *
 * A path whose source string no longer exists is not reported — that is a
 * REMOVED key, which `check:i18n`'s key-set comparison owns.
 */
export function findStaleFills(
  translated: TranslationData | undefined,
  source: TranslationData | undefined,
  recorded: SourceHashes | undefined,
): StaleFill[] {
  if (!translated || !recorded) return [];
  const sourceLeaves = collectGeneratedLeaves(source);
  const stale: StaleFill[] = [];

  for (const [path, value] of collectGeneratedLeaves(translated)) {
    const recordedHash = recorded[path];
    if (recordedHash === undefined) continue; // legacy-trusted
    if (hashSource(value) !== recordedHash) continue; // re-translated since — not our claim
    const sourceValue = sourceLeaves.get(path);
    if (sourceValue === undefined) continue; // removed key — not this rule's
    const currentHash = hashSource(sourceValue);
    if (currentHash !== recordedHash) {
      stale.push({ path, recorded: recordedHash, current: currentHash });
    }
  }
  return stale;
}

function setDeep(target: Record<string, unknown>, path: string, value: string): void {
  const segments = path.split('.');
  let node = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] as string;
    const next = node[segment];
    // Copy-on-write: never mutate the authored bundle, which the parity tests
    // read directly and which callers may hold a reference to.
    const copy: Record<string, unknown> = isPlainObject(next) ? { ...next } : {};
    node[segment] = copy;
    node = copy;
  }
  node[segments[segments.length - 1] as string] = value;
}

/**
 * The served copy of a translated bundle: every leaf whose recorded source hash
 * disagrees with the current source is replaced by the SOURCE string; every
 * other leaf — including every leaf with no recorded hash — is carried through
 * untouched.
 *
 * `recorded` judges the hand-authored sections ({@link findStaleLeaves}); the
 * optional `filledFrom` judges the generated ones ({@link findStaleFills}).
 * Omitting `filledFrom` leaves the generated sections entirely legacy-trusted,
 * which is what every caller did before #11671 and is still the honest default
 * for a bundle with no committed `<locale>.source-hashes.generated.ts`.
 *
 * The input is never mutated. Returns the same reference when nothing is stale,
 * so the common case allocates nothing.
 */
export function withSourceFallback(
  translated: TranslationData,
  source: TranslationData | undefined,
  recorded: SourceHashes | undefined,
  filledFrom?: SourceHashes,
): TranslationData {
  const stale = findStaleLeaves(translated, source, recorded);
  const staleFills = findStaleFills(translated, source, filledFrom);
  if (stale.length === 0 && staleFills.length === 0) return translated;

  const handAuthored = collectSourceLeaves(source);
  const generated = collectGeneratedLeaves(source);
  const next: Record<string, unknown> = { ...translated };
  for (const { path } of stale) {
    const sourceValue = handAuthored.get(path);
    if (sourceValue !== undefined) setDeep(next, path, sourceValue);
  }
  for (const { path } of staleFills) {
    const sourceValue = generated.get(path);
    if (sourceValue !== undefined) setDeep(next, path, sourceValue);
  }
  return next as TranslationData;
}
