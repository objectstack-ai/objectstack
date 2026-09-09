// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The never-published ratchet (#16431) — an exported `z.ZodType` that produces
 * NO JSON Schema, held to a declared population instead of a `console.warn`.
 *
 * ## The blind spot this closes, stated exactly
 *
 * `build-schemas.ts` already runs a disappearance ratchet (#2978 / #4725): a
 * def key recorded in `json-schema.manifest/` that this build does not emit
 * fails the build. That ratchet's domain is **"was published, stopped being
 * published"**. It is structurally blind to **"never was published"** — a
 * schema absent from the manifest was never in its baseline, so there is
 * nothing for it to miss.
 *
 * The skip that produces such an export is a `console.warn` in a build that
 * exits 0. So on every instrument this repo owned, two very different states
 * were the same colour:
 *
 *   - an export whose contract genuinely does not belong on a published
 *     JSON-Schema surface (a React props contract, a driver interface made of
 *     `z.function()` members), and
 *   - an export whose prose, constraints and `.describe()` text an author is
 *     expected to read on `content/docs/references/**` and which silently
 *     reaches no page at all.
 *
 * #16431 measured the population for the first time: **23 exports**, across
 * `Automation` / `Cloud` / `Data` / `Kernel` / `System` / `UI`, in one build.
 * The card that found it saw four of them. Nobody was tracking the other 19,
 * and nothing would have reported the 24th.
 *
 * ## What this module is, and what it deliberately is NOT
 *
 * It is a **visibility ratchet**: it reports what is already true and refuses
 * GROWTH of the population. It changes no schema, changes nothing about the
 * generator's projection ability, and makes nothing start or stop publishing —
 * the baseline is anchored to the tree as it stands, so it is green the moment
 * it lands.
 *
 * It is **not** a criterion about `z.date()`, or about any one unrepresentable
 * type. The population has at least four distinct causes today (`function`,
 * `date`, `custom`, `undefined`), and a criterion written against one of them
 * would have been blind to the other three the same way the disappearance
 * ratchet is blind to this whole class.
 *
 * ## Shrink-only in BOTH directions
 *
 * Same discipline as `entry-nameability.baseline.json` and
 * `dual-source-exports.baseline.json`, and for the same reason:
 *
 *   - an export that is not emitted and NOT recorded fails the build — growth
 *     has to be a reviewed line in a diff, never a silent warn;
 *   - an entry that no longer describes the tree ALSO fails, with an
 *     instruction to delete it. A ledger that keeps entries after the export
 *     starts emitting (or stops existing) has stopped describing the tree and
 *     started covering for it — and a stale line is exactly the room the 24th
 *     member needs to arrive looking like the 23rd.
 *
 * The recorded `cause` is re-checked against what the build observes for the
 * same reason `DEFAULT_CHANGES_BY_MAJOR` re-checks both endpoints of a declared
 * default change (#4666): a reason written about a `z.date()` that is now a
 * `z.function()` describes a repair that never happened, and it would keep
 * reading as current forever.
 *
 * ## Why the ledger is HAND-EDITED and has no `gen:` script
 *
 * Identical to the reasoning recorded in `entry-nameability.baseline.json`: a
 * generator for this file would let a new un-emitted export be admitted by
 * running a command instead of by a decision — which is the whole failure mode
 * being closed. Every entry carries a `reason` in prose, and the gate requires
 * it to be non-empty, because a baseline that records only a COUNT lets the
 * 24th member slip in behind a repaired 23rd with nobody able to see which one
 * was replaced.
 */
import fs from 'fs';
import path from 'path';

/** File name of the committed ledger, resolved against the package root. */
export const UNEMITTED_BASELINE_FILE = 'unemitted-schemas.baseline.json';

/**
 * The unrepresentable-type families Zod's `toJSONSchema()` throws for, keyed by
 * the family name this ledger records.
 *
 * Derived from `zod/v4/core/json-schema-processors` (zod 4.4.3), which is the
 * only producer of the `… cannot be represented in JSON Schema` messages
 * `build-schemas.ts` classifies as a known skip. Matched on the distinctive
 * word rather than the whole sentence, so a re-worded message keeps its family.
 * Order matters: `BigInt literals` must reach `bigint` before any later
 * pattern, and ``Literal `undefined` `` must reach `undefined`.
 */
const CAUSE_PATTERNS: ReadonlyArray<readonly [RegExp, UnemittedCause]> = [
  [/\bbigint\b/i, 'bigint'],
  [/\bsymbols?\b/i, 'symbol'],
  [/\bundefined\b/i, 'undefined'],
  [/\bvoid\b/i, 'void'],
  [/\bdate\b/i, 'date'],
  [/\bnan\b/i, 'nan'],
  [/\bcustom\b/i, 'custom'],
  [/\bfunctions?\b/i, 'function'],
  [/\btransforms?\b/i, 'transform'],
  [/\bmap\b/i, 'map'],
  [/\bset\b/i, 'set'],
];

/** The families above, plus `other` for a message none of them classifies. */
export type UnemittedCause =
  | 'bigint'
  | 'custom'
  | 'date'
  | 'function'
  | 'map'
  | 'nan'
  | 'other'
  | 'set'
  | 'symbol'
  | 'transform'
  | 'undefined'
  | 'void';

/** One export this build could not project, as observed by the generator. */
export interface UnemittedSkip {
  /** The protocol namespace, e.g. `Data`. */
  readonly namespace: string;
  /** The export name inside it, e.g. `ComparisonOperatorSchema`. */
  readonly exportKey: string;
  /** The message `z.toJSONSchema()` threw, verbatim. */
  readonly message: string;
}

/** One recorded member of the accepted population. */
export interface UnemittedEntry {
  /** The unrepresentable family, re-checked against this build. */
  readonly cause: UnemittedCause;
  /** Why this export has no published JSON Schema. Required, never empty. */
  readonly reason: string;
}

/** The committed ledger's shape. */
export interface UnemittedBaseline {
  readonly entries: Readonly<Record<string, UnemittedEntry>>;
}

/** `Namespace.ExportKey` — the unit this ledger is keyed by. */
export function ledgerKey(skip: Pick<UnemittedSkip, 'namespace' | 'exportKey'>): string {
  return `${skip.namespace}.${skip.exportKey}`;
}

/**
 * Classify a skip message into its unrepresentable family.
 *
 * An unclassified message is `other` rather than a throw: a Zod upgrade that
 * re-words a message must fail as a LEDGER mismatch naming the raw text, not as
 * a crash inside the classifier.
 */
export function causeOf(message: string): UnemittedCause {
  for (const [pattern, cause] of CAUSE_PATTERNS) {
    if (pattern.test(message)) return cause;
  }
  return 'other';
}

/** Everything the gate found wrong with the ledger, in one pass. */
export interface UnemittedProblems {
  /** Not emitted, not recorded — the growth this ratchet refuses. */
  readonly undeclared: readonly UnemittedSkip[];
  /** Recorded, but the export emits a JSON Schema now. Delete the line. */
  readonly repaired: readonly string[];
  /** Recorded, but no such export exists any more. Delete the line. */
  readonly vanished: readonly string[];
  /** Recorded with a `cause` this build does not observe. */
  readonly miscaused: ReadonlyArray<{ key: string; recorded: UnemittedCause; observed: UnemittedCause; message: string }>;
  /** Recorded with an empty `reason` — a count pretending to be a ledger. */
  readonly unreasoned: readonly string[];
}

/** True when nothing above needs saying. */
export function hasUnemittedProblems(p: UnemittedProblems): boolean {
  return (
    p.undeclared.length > 0 ||
    p.repaired.length > 0 ||
    p.vanished.length > 0 ||
    p.miscaused.length > 0 ||
    p.unreasoned.length > 0
  );
}

/**
 * Adjudicate one build's observed population against the committed ledger.
 *
 * `exportedZodKeys` is every `Namespace.ExportKey` this build saw as a
 * `z.ZodType`, emitted or not — it is what separates "this entry was repaired"
 * from "this export no longer exists", two states whose remedy is the same line
 * deletion but whose PR description is not.
 */
export function checkUnemittedSchemas(args: {
  readonly skips: readonly UnemittedSkip[];
  readonly exportedZodKeys: ReadonlySet<string>;
  readonly baseline: UnemittedBaseline;
}): UnemittedProblems {
  const { skips, exportedZodKeys, baseline } = args;
  const observed = new Map(skips.map((s) => [ledgerKey(s), s]));

  const undeclared = skips.filter((s) => !(ledgerKey(s) in baseline.entries));
  const repaired: string[] = [];
  const vanished: string[] = [];
  const miscaused: Array<{ key: string; recorded: UnemittedCause; observed: UnemittedCause; message: string }> = [];
  const unreasoned: string[] = [];

  for (const [key, entry] of Object.entries(baseline.entries)) {
    if (entry.reason.trim() === '') unreasoned.push(key);
    const skip = observed.get(key);
    if (skip) {
      const seen = causeOf(skip.message);
      if (seen !== entry.cause) {
        miscaused.push({ key, recorded: entry.cause, observed: seen, message: skip.message });
      }
      continue;
    }
    if (exportedZodKeys.has(key)) repaired.push(key);
    else vanished.push(key);
  }

  return { undeclared, repaired, vanished, miscaused, unreasoned };
}

/** Read the committed ledger, or `null` when the file is absent. */
export function readUnemittedBaseline(pkgDir: string): UnemittedBaseline | null {
  const file = path.join(pkgDir, UNEMITTED_BASELINE_FILE);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
  const entries = parsed.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    throw new Error(`${UNEMITTED_BASELINE_FILE}: "entries" must be an object of key -> { cause, reason }`);
  }
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const entry = value as Partial<UnemittedEntry>;
    if (typeof entry?.cause !== 'string' || typeof entry?.reason !== 'string') {
      throw new Error(`${UNEMITTED_BASELINE_FILE}: entry "${key}" needs a string \`cause\` and a string \`reason\``);
    }
  }
  return { entries: entries as Readonly<Record<string, UnemittedEntry>> };
}

/** Group a population by cause, for the accepted-population report. */
export function countByCause(skips: readonly UnemittedSkip[]): Map<UnemittedCause, number> {
  const counts = new Map<UnemittedCause, number>();
  for (const skip of skips) {
    const cause = causeOf(skip.message);
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  return new Map([...counts].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])));
}
