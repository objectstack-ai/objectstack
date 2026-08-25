// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The WITHIN-FILE half of an evidence citation check.
//
// WHY THIS EXISTS. Two checks already bound a `live` entry's citation, and both
// of them bound it from the OUTSIDE:
//
//   * does the cited FILE exist            (`checkEvidence`, red since #5623)
//   * is the cited LINE inside that file   (`checkCitationLines`, #11210)
//
// Between them sits a gap neither can see. A consumer that moves WITHIN the file
// it is cited to — or a citation written with no line at all — leaves the file
// present and every named line in range, so both checks pass and the pointer is
// still wrong. Measured, that gap is not theoretical: of 403 (entry, cited local
// file) pairs, 11 cited a file that never mentions the property's own key, and
// SEVEN of those eleven were real rot. Three were the same repos-internal code
// movement that had already rotted `permission.systemPermissions` and
// `permission.tabPermissions`; two were a key whose only consumer has always
// been the renderer repo; one was a citation to a plausible SIBLING file
// (`record-validator.ts` enforces the static `required` contract, while the
// `requiredWhen` CEL predicate is evaluated one file over in
// `rule-validator.ts`); one was a resolver promoted into another package.
//
// WHY IT IS NOT A GREP. The naive form of this check — `\bkey\b` against the
// cited file — is wrong for a class the platform MANDATES. Prime Directive #3:
// TS config keys are `camelCase`, machine names are `snake_case`. So for every
// property persisted as a column, the consumer names the snake_case form and
// never the authoring key: `email_template.bodyHtml` is read as `body_html`,
// `permission.managedBy` as `managed_by`. A matcher blind to that convention
// reports the entire class as rot, which is the failure mode `evidence.mts`'s
// header records from the other direction — the 48-of-227 era, a warning list
// nobody read, with one genuine rot sitting unnoticed inside it.
//
// Hence the anchor set below is the key plus its cross-convention spellings,
// and the ONE residual the fold cannot reach is carried as an explicit,
// measured, shrink-only baseline row rather than as tolerance in the matcher.
// Widening the matcher to cover it would mean accepting some prefix of the key,
// which buys one exemption at the cost of blinding the check to every future
// pointer that lands in a file merely ADJACENT to the reader — the exact shape
// of the `requiredWhen` rot above.

/** An evidence citation whose file never names the property it is evidence for. */
export interface UnanchoredCitation {
  /** Ledger coordinate, `type/prop.path` — the same spelling the gate prints elsewhere. */
  entry: string;
  /** The cited repo-local path, exactly as the evidence writes it. */
  path: string;
}

/** A recorded exemption: this pair is unanchored, and that is understood. */
export interface KeyMentionExemption {
  entry: string;
  path: string;
  why: string;
}

export interface KeyMentionBaseline {
  exemptions: KeyMentionExemption[];
}

/**
 * The spellings a consumer may legitimately use for one authoring key.
 *
 * Exactly two transforms, both of them Prime Directive #3 read in the two
 * directions it can be read — `camelCase` → `snake_case` for a key persisted as
 * a column, and back again for the handful of ledger keys already written in
 * snake_case. Deliberately NOT a fuzzy match: every additional tolerance here is
 * a citation the check can no longer falsify, and the check's whole value is
 * that it falsifies pointers the other two checks cannot.
 */
export function namingVariants(key: string): string[] {
  const out = new Set<string>([key]);
  out.add(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  out.add(key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()));
  return [...out];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The key a CONSUMER would name, from the ledger coordinate that addresses it.
 *
 * `objects.children.allowExport` is read as `allowExport`: `children` is the
 * ledger's own nesting spelling and appears in no consumer, and the container
 * segments name the shape the key sits in rather than the key. Dropping the
 * `children` markers before taking the last segment matters — without it a
 * drilled entry would be matched against the literal word `children`, which
 * some consumer files do contain, and the check would silently pass on the
 * entire drilled population.
 */
export function leafKeyOf(ledgerPath: string): string {
  const segments = ledgerPath.split('.').filter((s) => s !== 'children');
  return segments[segments.length - 1] ?? ledgerPath;
}

/**
 * Does `content` name this key, in any of its convention spellings, as a WORD?
 *
 * Word-bounded on purpose: an unbounded substring match would let `required`
 * satisfy `requiredWhen`, which is precisely the false negative that kept the
 * `field.requiredWhen` citation looking healthy — its cited file mentions
 * `required` on twenty lines and `requiredWhen` on none.
 */
export function isKeyMentioned(content: string, key: string): boolean {
  return namingVariants(key).some((v) => new RegExp(`\\b${escapeRe(v)}\\b`).test(content));
}

/**
 * Every resolvable local citation of one entry whose file does not name the key.
 *
 * `readFile` returns `null` for a path it cannot read, and those are SKIPPED
 * rather than reported — a citation into a missing file is already the
 * existence check's finding, and reporting one rot under two headings teaches a
 * reader to discount both lists (the same reasoning `checkCitationLines` states
 * for its own `null` case).
 */
export function findUnanchoredCitations(
  entry: string,
  key: string,
  localPaths: readonly string[],
  readFile: (path: string) => string | null,
): UnanchoredCitation[] {
  const out: UnanchoredCitation[] = [];
  for (const path of localPaths) {
    const content = readFile(path);
    if (content === null) continue;
    if (!isKeyMentioned(content, key)) out.push({ entry, path });
  }
  return out;
}

export function parseKeyMentionBaseline(json: unknown): KeyMentionBaseline {
  const doc = json as { exemptions?: unknown } | null;
  const rows = doc?.exemptions;
  if (
    !Array.isArray(rows) ||
    rows.some(
      (r) =>
        !r ||
        typeof (r as KeyMentionExemption).entry !== 'string' ||
        typeof (r as KeyMentionExemption).path !== 'string' ||
        typeof (r as KeyMentionExemption).why !== 'string',
    )
  ) {
    throw new Error(
      'key-mention.baseline.json must have an `exemptions` array of { entry, path, why } objects',
    );
  }
  return { exemptions: rows as KeyMentionExemption[] };
}

export interface KeyMentionReconciliation {
  /** Unanchored pairs the baseline does not record — the gate FAILS on these. */
  unanchored: UnanchoredCitation[];
  /** Baseline rows whose pair now anchors (or no longer exists) — also a FAILURE. */
  stale: string[];
  /** Recorded exemptions still in force, for the run's summary line. */
  exempt: number;
}

/**
 * Reconcile what the walk observed against the recorded baseline.
 *
 * Stale rows FAIL, symmetrically with new ones, for the reason
 * `undrilled-containers.baseline.json` states about its own: a debt file that
 * only ever fails in the growing direction can be overstated for free, and an
 * exemption nobody can lose is an exemption nobody re-reads. A row leaves this
 * file by the pair becoming anchored — a repointed citation, or a consumer that
 * starts naming the key — never by being deleted for convenience.
 */
export function reconcileKeyMentions(input: {
  observed: readonly UnanchoredCitation[];
  baseline: readonly KeyMentionExemption[];
}): KeyMentionReconciliation {
  const key = (c: { entry: string; path: string }): string => `${c.entry} → ${c.path}`;
  const observedKeys = new Set(input.observed.map(key));
  const baselineKeys = new Set(input.baseline.map(key));

  return {
    unanchored: input.observed.filter((c) => !baselineKeys.has(key(c))),
    stale: input.baseline
      .filter((e) => !observedKeys.has(key(e)))
      .map((e) => `${key(e)} — the cited file now names the key (or the citation is gone); delete this exemption`),
    exempt: input.baseline.filter((e) => observedKeys.has(key(e))).length,
  };
}

/** Prescription printed under newly-unanchored citations. */
export const KEY_MENTION_GUIDANCE = [
  'A `live` entry cites a file that never names the property — in any of its',
  'camelCase/snake_case spellings. The file exists and every cited line is in',
  'range, so neither the existence check nor the line bound can see this; the',
  'citation is nonetheless unfalsifiable as written.',
  '',
  'Measured, 7 of the first 11 of these were real rot, so start by assuming it is:',
  '',
  '  1. REPOINT it — the usual cause is a consumer that moved. A domain',
  '     extraction (`http-dispatcher.ts` → `domains/actions.ts`), a helper',
  '     promoted into another package (#10101), or a citation that named a',
  '     plausible SIBLING file all leave the old path resolving perfectly.',
  '     Find the file that names the key and cite that one, with a line.',
  '  2. RE-CLASSIFY it — if no file in this repo names the key, the consumer may',
  '     be in another realm (prefix it `objectui:` and pin the commit, per the',
  '     ledger README) or may not exist at all, in which case the honest verdict',
  '     is `dead` under ADR-0049 rather than a repoint to a plausible survivor.',
  '  3. EXEMPT it — only when the consumer genuinely reads the key under a name',
  '     no naming-convention fold reaches (a compound child-key remap such as',
  '     `fromOverride.address` → `from_address`). Add a row to',
  '     `scripts/liveness/key-mention.baseline.json` saying WHICH name the file',
  '     uses. That file is shrink-only: a row whose pair later anchors FAILS.',
].join('\n');
