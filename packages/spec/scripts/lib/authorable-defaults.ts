// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * authorable-defaults.ts — the DEFAULT-VALUE ratchet (#4666).
 *
 * ## The blind spot this closes
 *
 * `authorable-surface/` ratchets the SET of keys an author may write. Nothing
 * ratcheted what those keys *mean when the author omits them*. The same key's
 * `.default()` could move and every channel stayed quiet:
 *
 *   - the authorable-surface comparison sees key NAMES only;
 *   - `retiredKey()` tombstones fire on live → retired, not on a value change;
 *   - `spec-changes.json` / the upgrade guide are projections of the ADR-0087
 *     conversion + migration registries, and a default change does not
 *     necessarily carry a conversion.
 *
 * Measured on #4661's branch: flipping `retryPolicyShape()`'s `maxRetries`
 * default from `0` to `3` — one character — left `check:authorable-surface`
 * fully green. The only thing that caught it was a hand-written runtime pin
 * that an author had remembered to write.
 *
 * Why this is the dangerous half of the surface. A default decides what happens
 * when the author writes NOTHING, and omitting optional keys is the normal mode
 * of AI-authored metadata (ADR-0033), so defaults cover far more deployed
 * behaviour than they did in the hand-written era. Flip `maxRetries`,
 * `enabled`, `required` or an `allow*` and every already-deployed document that
 * omitted the key changes behaviour — with no error, nothing to grep, and
 * nothing in the changelog.
 *
 * ## Direction B: defaults ONLY, constraints deliberately excluded
 *
 * Maintainer ruling on #4666 (2026-08-07). Constraints (`.min()` / `.max()` /
 * `.positive()`) are NOT fingerprinted, and the exclusion is structural rather
 * than a matter of discipline: {@link defaultFingerprintOf} reads exactly one
 * field of the emitted JSON Schema, `default`, so a tightened bound or a
 * reworded `.describe()` cannot move a fingerprint even by accident.
 *
 * The asymmetry that decided it: tightening a constraint REJECTS an existing
 * document — loud, diagnosable, and discovered from CI. Flipping a default
 * rejects nothing; the customer just finds out from an incident. Direction A
 * (defaults + constraints) covers more but makes this ratchet markedly noisier,
 * and #4535 §1 is already complaining that the authorable surface
 * over-collects.
 *
 * ## Why the fingerprint reads the EMITTED schema, not the Zod node
 *
 * The value recorded here is the `default` of the generated JSON Schema — the
 * same document the key set is collected from, and the thing the published
 * contract actually advertises to authors and IDEs. Reading `_zod.def` instead
 * would tie this ratchet to which Zod wrapper produced the value
 * (`.default()` vs `.prefault()` vs `.meta({ default })`), when what an author
 * experiences is only the published result. One source, one truth, and no
 * internals to track across a Zod major.
 */

import { categoryOfDefKey, serializeShard } from './sharded-artifacts.js';

/** `packages/spec/authorable-defaults/<category>.json` — the #4666 default ratchet. */
export const AUTHORABLE_DEFAULTS_DIR_NAME = 'authorable-defaults';

/**
 * How a MISSING default is spelled in an acknowledgement's `from` / `to`.
 *
 * Unambiguous against every real fingerprint, because a fingerprint is always
 * valid JSON and this is not (the JSON string `"(none)"` serializes WITH its
 * quotes). Gaining or losing a default is a behaviour change exactly like
 * moving one, so both endpoints need a spelling.
 */
export const NO_DEFAULT = '(none)';

/** Separator between the key and its fingerprint in a recorded entry. */
const ENTRY_SEP = ' = ';

/**
 * The description carried by EVERY authorable-defaults shard — repeated per
 * file for the same reason the authorable-surface description is: the reader it
 * exists for is the one who just opened a shard to change a number in it.
 *
 * Compared byte-for-byte by the ratchet, so editing it restates the procedure
 * in every shard, deliberately.
 */
export const AUTHORABLE_DEFAULTS_DESCRIPTION =
  'Ratchet of the DEFAULT VALUE of every authorable key in one category that has one (#4666) — ' +
  'what a metadata author gets when they omit the key, which for AI-authored metadata is most ' +
  'of the time. Sharded by category like authorable-surface/; the gate reads the whole ' +
  'authorable-defaults/ directory as ONE set. Each line is "<def>:<key> = <canonical JSON>". ' +
  'Additions (a NEW key that ships with a default) are auto-recorded — commit the change. ' +
  'CHANGING, ADDING or REMOVING the default of a key that already existed is NOT auto-recorded: ' +
  'it silently alters the behaviour of already-deployed metadata, so it fails ' +
  'check:authorable-surface until it is declared in DEFAULT_CHANGES_BY_MAJOR ' +
  '(scripts/lib/default-changes.ts). Constraints are deliberately NOT recorded here — a ' +
  'tightened bound REJECTS a document loudly, which is a different and self-announcing class ' +
  '(maintainer ruling on #4666, direction B). See #4666, #4661.';

/** One category's slice of the default-value ratchet. */
export interface AuthorableDefaultsShard {
  description: string;
  category: string;
  defaults: string[];
}

/**
 * Canonical fingerprint of one default value.
 *
 * Normalisation, and why each rule is the way it is:
 *
 *   - **object keys are sorted, recursively.** A JS object literal's key order
 *     is not part of its meaning, so re-spelling `{ mode: 'a', retries: 1 }`
 *     with the keys the other way round must not churn the ratchet. Sorting is
 *     what makes "the fingerprint moved" mean "the VALUE moved".
 *   - **array order is preserved.** An array default's order IS observable to
 *     the author (`schemas: ['urn:…:Group']`), so re-ordering it is a real
 *     change and must be caught.
 *   - **no whitespace.** `JSON.stringify` without an indent, so a
 *     re-formatting pass cannot move a fingerprint.
 *   - **nothing but the value.** No type, no constraints, no description. The
 *     direction-B boundary lives here and nowhere else.
 *
 * A value JSON cannot represent (a function, a `Date`, a `bigint`) has no
 * published default either — `z.toJSONSchema` does not emit one — so this is
 * only ever called on JSON the emitter already produced.
 */
export function defaultFingerprintOf(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? 'null';
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** `"data/Foo:bar"` + `"3"` → `"data/Foo:bar = 3"`. */
export function formatDefaultEntry(key: string, fingerprint: string): string {
  return `${key}${ENTRY_SEP}${fingerprint}`;
}

/**
 * Inverse of {@link formatDefaultEntry}, splitting on the FIRST separator: a
 * def key can never contain ` = `, while a fingerprint routinely can
 * (`{"a":1} = ` is a perfectly ordinary string default). Splitting anywhere
 * else would corrupt exactly the values that are hardest to notice.
 */
export function parseDefaultEntry(entry: string): { key: string; fingerprint: string } {
  const at = entry.indexOf(ENTRY_SEP);
  if (at <= 0) {
    throw new Error(
      `cannot parse authorable-defaults entry ${JSON.stringify(entry)}: every line is ` +
        `"<def>:<key>${ENTRY_SEP}<canonical JSON>" (#4666)`,
    );
  }
  return { key: entry.slice(0, at), fingerprint: entry.slice(at + ENTRY_SEP.length) };
}

/** Parse a whole recorded shard set into `key -> fingerprint`. */
export function parseDefaultEntries(entries: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of entries) {
    const { key, fingerprint } = parseDefaultEntry(entry);
    out.set(key, fingerprint);
  }
  return out;
}

/**
 * Every authorable key of this build that HAS a published default, fingerprinted.
 *
 * Keys with no default are deliberately absent rather than recorded as
 * `(none)`: 1327 of 7943 authorable keys carry a default, so recording only
 * those keeps the artifact at a sixth of the size — and presence is not lost,
 * because gaining a default makes a line APPEAR and losing one makes it
 * VANISH, both of which {@link diffAuthorableDefaults} reads as changes.
 *
 * `retiredKey()` needs no special case: it is `z.never()`, which carries no
 * default and so never produces a line.
 */
export function collectAuthorableDefaults(
  schemasByDefKey: Iterable<[string, unknown]>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [defKey, schema] of schemasByDefKey) {
    const props = (schema as { properties?: Record<string, unknown> }).properties;
    if (!props || typeof props !== 'object') continue;
    for (const [name, prop] of Object.entries(props)) {
      if (!prop || typeof prop !== 'object') continue;
      if (!('default' in (prop as Record<string, unknown>))) continue;
      out.set(`${defKey}:${name}`, defaultFingerprintOf((prop as Record<string, unknown>).default));
    }
  }
  return out;
}

/** Split fingerprints into `<category> -> canonical shard bytes`. */
export function authorableDefaultsShardTexts(defaults: ReadonlyMap<string, string>): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const [key, fingerprint] of defaults) {
    const category = categoryOfDefKey(key);
    const bucket = grouped.get(category);
    const line = formatDefaultEntry(key, fingerprint);
    if (bucket) bucket.push(line);
    else grouped.set(category, [line]);
  }
  const out = new Map<string, string>();
  for (const category of [...grouped.keys()].sort()) {
    out.set(
      category,
      serializeShard({
        description: AUTHORABLE_DEFAULTS_DESCRIPTION,
        category,
        defaults: grouped.get(category)!.sort(),
      } satisfies AuthorableDefaultsShard),
    );
  }
  return out;
}

// ─── Comparison ───────────────────────────────────────────────────────

/** How a key's default moved between the baseline and this build. */
export type DefaultChangeKind = 'changed' | 'added' | 'removed';

export interface ObservedDefaultChange {
  key: string;
  kind: DefaultChangeKind;
  /** Baseline fingerprint, or {@link NO_DEFAULT}. */
  from: string;
  /** This build's fingerprint, or {@link NO_DEFAULT}. */
  to: string;
}

export interface DefaultDiffInput {
  /** `key -> fingerprint` recorded at the baseline. */
  baseline: ReadonlyMap<string, string>;
  /** `key -> fingerprint` this build emits. */
  current: ReadonlyMap<string, string>;
  /** Authorable keys at the baseline — `key -> isRetired`. */
  baselineKeys: ReadonlyMap<string, boolean>;
  /** Authorable keys this build emits — `key -> isRetired`. */
  currentKeys: ReadonlyMap<string, boolean>;
}

/**
 * The default changes that are this gate's business.
 *
 * Three exclusions, each because ANOTHER gate already owns the fact and would
 * otherwise report it twice under a worse name:
 *
 *   1. a key that is NEW to the authorable surface. Its default cannot have
 *      changed the behaviour of deployed metadata, because no deployed document
 *      could omit a key that did not exist. Adding the key is what the
 *      authorable-surface ratchet records, and it records it already.
 *   2. a key that has LEFT the surface (absent from this build). Its default
 *      going with it is the removal, not a separate event — checks (a)/(c) of
 *      the surface gate adjudicate that, with the tombstone prescription.
 *   3. a key that is now RETIRED. `retiredKey()` is `z.never()` and carries no
 *      default by construction, so reading the loss as a "removed default"
 *      would demand a second declaration for one retirement — check (b)
 *      already demands the real one.
 */
export function diffAuthorableDefaults(input: DefaultDiffInput): ObservedDefaultChange[] {
  const { baseline, current, baselineKeys, currentKeys } = input;
  const changes: ObservedDefaultChange[] = [];
  const keys = new Set<string>([...baseline.keys(), ...current.keys()]);
  for (const key of [...keys].sort()) {
    // (2)/(3): gone, or tombstoned — someone else's verdict.
    if (!currentKeys.has(key) || currentKeys.get(key) === true) continue;
    const from = baseline.get(key);
    const to = current.get(key);
    if (from === to) continue;
    if (from === undefined) {
      // (1): a key the baseline never had is not a default CHANGE.
      if (!baselineKeys.has(key)) continue;
      changes.push({ key, kind: 'added', from: NO_DEFAULT, to: to! });
    } else if (to === undefined) {
      changes.push({ key, kind: 'removed', from, to: NO_DEFAULT });
    } else {
      changes.push({ key, kind: 'changed', from, to });
    }
  }
  return changes;
}

// ─── Authorisation ────────────────────────────────────────────────────

/** One declared hop of a key's default, as written in `DEFAULT_CHANGES_BY_MAJOR`. */
export interface DeclaredDefaultChange {
  /** Exact `${defKey}:${name}` — never a leaf name (#4659's lesson). */
  key: string;
  /** Fingerprint before the change, or {@link NO_DEFAULT}. */
  from: string;
  /** Fingerprint after it, or {@link NO_DEFAULT}. */
  to: string;
  /** Why the flip is correct, and what a consumer relying on the old value must do. */
  reason: string;
}

export interface StaleDeclaration {
  key: string;
  /** What the chain's last hop claims the default now is. */
  claims: string;
  /** What this build actually emits. */
  emits: string;
  why: 'chain-tip-mismatch' | 'chain-not-contiguous';
}

export interface DefaultAuthorisation {
  /** Changes covered by a declared chain — printed, never silent. */
  authorised: Array<{ change: ObservedDefaultChange; declared: DeclaredDefaultChange[] }>;
  /** Changes with no declaration that covers them. Fatal. */
  unauthorised: ObservedDefaultChange[];
  /** Declarations at the current major that no longer describe reality. Fatal. */
  stale: StaleDeclaration[];
}

/**
 * Adjudicate observed changes against the declared ones.
 *
 * ## What makes a declaration honest rather than an allowlist
 *
 * The failure mode named in the dispatch — and in #4690 — is an exemption list
 * nobody re-checks, which quietly blesses whatever comes later. Four properties
 * stop that here, and all four are re-derived on EVERY run from sources the
 * declaration cannot edit:
 *
 *   1. **Both endpoints are pinned.** A declaration covers the transition
 *      `from → to` and nothing else. `from` is compared against the BASELINE,
 *      which is read out of git at the merge base (or, before this ratchet
 *      exists upstream, the committed artifact); `to` is compared against what
 *      THIS BUILD emits. Neither is a field the declaration's author can set.
 *   2. **The chain tip must still be true.** For every key declared at the
 *      current major, the last hop's `to` must equal the live fingerprint. Move
 *      the default again — or revert it — and the declaration goes RED instead
 *      of silently covering the new value. This is the property that makes a
 *      declaration die when it stops being true, and it is the exact mirror of
 *      the surface gate's check (b2).
 *   3. **The chain must be contiguous.** Two hops of one key must meet
 *      (`hop[i].to === hop[i+1].from`), so a chain cannot skip a value that was
 *      really shipped in between.
 *   4. **Only the CURRENT major authorises.** Past majors' entries are the
 *      historical record and cover nothing, so an authorisation cannot outlive
 *      the major it was written for. By the time a major rolls, the baseline
 *      already carries the new value, so nothing is left needing cover.
 *
 * A declaration naming a key this build does not emit at all is NOT an error:
 * that is the expected end state once the key is retired, and the surface gate
 * owns that verdict (same disposition as check (b2)).
 */
export function authoriseDefaultChanges(
  changes: readonly ObservedDefaultChange[],
  declaredByMajor: Readonly<Record<number, readonly DeclaredDefaultChange[]>>,
  currentMajor: number,
  current: ReadonlyMap<string, string>,
  currentKeys: ReadonlyMap<string, boolean>,
): DefaultAuthorisation {
  const chains = new Map<string, DeclaredDefaultChange[]>();
  for (const declared of declaredByMajor[currentMajor] ?? []) {
    const chain = chains.get(declared.key);
    if (chain) chain.push(declared);
    else chains.set(declared.key, [declared]);
  }

  const stale: StaleDeclaration[] = [];
  for (const [key, chain] of chains) {
    // A declaration about a key this build no longer emits is history, not a claim.
    if (!currentKeys.has(key)) continue;
    for (let i = 1; i < chain.length; i++) {
      if (chain[i - 1].to !== chain[i].from) {
        stale.push({
          key,
          claims: `${chain[i - 1].to} → ${chain[i].from}`,
          emits: current.get(key) ?? NO_DEFAULT,
          why: 'chain-not-contiguous',
        });
      }
    }
    const tip = chain[chain.length - 1].to;
    const live = current.get(key) ?? NO_DEFAULT;
    if (tip !== live) {
      stale.push({ key, claims: tip, emits: live, why: 'chain-tip-mismatch' });
    }
  }

  const authorised: DefaultAuthorisation['authorised'] = [];
  const unauthorised: ObservedDefaultChange[] = [];
  for (const change of changes) {
    const chain = chains.get(change.key);
    // The chain must START where the baseline sits, and END where this build
    // does. A branch that forked mid-chain matches at a later hop.
    const at = chain?.findIndex((hop) => hop.from === change.from) ?? -1;
    const covers =
      chain !== undefined && at >= 0 && chain[chain.length - 1].to === change.to;
    if (covers) authorised.push({ change, declared: chain!.slice(at) });
    else unauthorised.push(change);
  }
  return { authorised, unauthorised, stale };
}
