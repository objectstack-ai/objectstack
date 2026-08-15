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
 * ## Scope: the hand-authored sections only
 *
 * `objects` and `metadataForms` are GENERATED (`*.generated.ts`) and are
 * deliberately out of {@link HAND_AUTHORED_SECTIONS}. This hole cannot occur
 * there: `os i18n extract` rewrites the `en` bundle from the source on every
 * run and does not merge the default locale (#8543), so a source edit either
 * lands in the generated bundle or fails `check:i18n` as drift.
 */

import type { TranslationData } from '@objectstack/spec/system';

/**
 * The `TranslationData` sections whose leaves carry staleness checking — the
 * hand-authored half. See the module note for why the generated sections
 * (`objects`, `metadataForms`) are excluded rather than merely unlisted.
 */
export const HAND_AUTHORED_SECTIONS = ['apps', 'dashboards', 'pages'] as const;

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

  for (const section of HAND_AUTHORED_SECTIONS) {
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
 * The input is never mutated. Returns the same reference when nothing is stale,
 * so the common case allocates nothing.
 */
export function withSourceFallback(
  translated: TranslationData,
  source: TranslationData | undefined,
  recorded: SourceHashes | undefined,
): TranslationData {
  const stale = findStaleLeaves(translated, source, recorded);
  if (stale.length === 0) return translated;

  const sourceLeaves = collectSourceLeaves(source);
  const next: Record<string, unknown> = { ...translated };
  for (const { path } of stale) {
    const sourceValue = sourceLeaves.get(path);
    if (sourceValue !== undefined) setDeep(next, path, sourceValue);
  }
  return next as TranslationData;
}
