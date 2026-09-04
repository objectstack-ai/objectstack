// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Advisory-hit aggregation for machine load paths (#13889).
 *
 * ## The defect this closes
 *
 * A `severity: 'warning'` (or `'info'`) validation rule is ADVISORY: it never
 * blocks a write, and its message is written for a HUMAN IN A FORM ("At least
 * one related record should be selected"). The evaluator's only report channel
 * for one is `logger.warn`, one line per (row × violated rule).
 *
 * On an interactive write that is exactly right. On the seed / bootstrap load
 * path it is not: a clean-database first boot writes every seeded row through
 * the same evaluator, so an app whose seed legitimately contains N rows that
 * trip one advisory rule gets N `WARN` lines in the STARTUP LOG — a form hint
 * re-cast as a boot diagnostic, which reads like the boot failed. Measured
 * downstream (hotcrm#1203): the only ways an app could reach "zero warnings"
 * were to bend its data (attach a parent record it does not have) or delete the
 * rule (weaken a real guard). Both are worse than the noise.
 *
 * Maintainer ruling (2026-09-01, verbatim 「同意」 on option B):
 * 「⛔ 不改规则语义,只改日志形状」 — do not change rule semantics, change
 * only the shape of the log. So this module changes NOTHING about what a rule
 * evaluates to, who it applies to, or whether it blocks. It changes where the
 * REPORT goes while a machine load path is running, and nothing else.
 *
 * ## Why an ambient scope rather than a parameter
 *
 * The producer (`evaluateValidationRules`, `@objectstack/objectql`) and the
 * scope owner (`SeedLoaderService.load`, `@objectstack/metadata-protocol`) are
 * separated by the whole engine write path: the loader calls
 * `IDataEngine.insert/update`, and the evaluator is reached several layers
 * below through a contract that carries no reporting channel. Threading a sink
 * through would mean widening `IDataEngine`'s options — a published contract —
 * for a diagnostic concern. An ambient scope keeps the change inside the two
 * ends that care.
 *
 * `AsyncLocalStorage` rather than a module-level flag, deliberately: seed loads
 * are NOT boot-only. A per-org replay (`sys_organization` insert) runs a full
 * seed load on a LIVE server, concurrently with ordinary interactive traffic. A
 * plain global would capture those interactive writes' advisories into the
 * replay's summary — silently swallowing a report meant for someone else. ALS
 * scopes the capture to the load's own async context, which is the difference
 * between aggregating and losing.
 *
 * ## Folded on arrival, never accumulated per row
 *
 * A hit is folded into its `(object, rule)` group as it arrives, so a load of
 * 100 000 rows that all trip one rule holds ONE group, not 100 000 records.
 * The group keeps what a reader needs to act — the rule, the object, the
 * severity, the message, the row count, and up to {@link ADVISORY_SAMPLE_ROWS}
 * example rows — which is the 「详见…」 half of the ruling's summary shape.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Example row references a group carries, so the summary can point at real rows. */
export const ADVISORY_SAMPLE_ROWS = 5;

/** One advisory rule hit, as the evaluator reports it. */
export interface AdvisoryHit {
  /** Object the row belongs to. */
  object: string;
  /** The declared rule's `name`. */
  rule: string;
  /** The rule's declared severity — `'warning'` or `'info'`; never `'error'`. */
  severity: string;
  /** The rule's author-written message, in the caller's locale. */
  message: string;
  /**
   * A reference to the row, when the write carries one.
   *
   * NOT necessarily an id: on the path this exists for — a seed INSERT — the
   * driver has not issued an id yet at validation time, so an id-only reference
   * would be empty for exactly the case the aggregation was built for. The
   * producer sends the best stable handle it has (`id`, else `name=<value>`,
   * the same way the seed loader names a row in its own errors).
   */
  recordRef?: string;
}

/** Every hit for one `(object, rule)` pair, folded. */
export interface AdvisoryGroup {
  object: string;
  rule: string;
  severity: string;
  /** The first message seen for this group (they differ only by interpolation). */
  message: string;
  /** How many ROWS tripped this rule during the scope. */
  rows: number;
  /** Up to {@link ADVISORY_SAMPLE_ROWS} example row references. */
  sampleRows: string[];
}

interface AdvisoryCollector {
  groups: Map<string, AdvisoryGroup>;
}

const storage = new AsyncLocalStorage<AdvisoryCollector>();

/**
 * Group key.
 *
 * `JSON.stringify` of the pair rather than a delimiter-joined string: any
 * single-character delimiter is a claim about what an object or rule name
 * cannot contain, and a wrong claim collides two groups into one silently.
 * Encoding the pair makes the key injective with nothing to be wrong about.
 */
function keyOf(object: string, rule: string): string {
  return JSON.stringify([object, rule]);
}

/**
 * Offer one advisory hit to the active aggregation scope.
 *
 * @returns `true` when a scope captured it — the caller must then NOT log its
 * own per-row line, because the scope owner reports the whole group. `false`
 * when no scope is active, which is the ordinary interactive case: the caller
 * logs exactly as it always did. A caller that ignores the return value
 * degrades to today's behaviour rather than losing the report.
 */
export function recordAdvisoryHit(hit: AdvisoryHit): boolean {
  const collector = storage.getStore();
  if (!collector) return false;
  const key = keyOf(hit.object, hit.rule);
  const existing = collector.groups.get(key);
  if (existing) {
    existing.rows += 1;
    if (hit.recordRef != null && existing.sampleRows.length < ADVISORY_SAMPLE_ROWS) {
      existing.sampleRows.push(hit.recordRef);
    }
    return true;
  }
  collector.groups.set(key, {
    object: hit.object,
    rule: hit.rule,
    severity: hit.severity,
    message: hit.message,
    rows: 1,
    sampleRows: hit.recordRef != null ? [hit.recordRef] : [],
  });
  return true;
}

/**
 * Whether an advisory aggregation scope is active on this async context.
 *
 * Exported for tests and for a caller that wants to skip building a message it
 * is about to discard; {@link recordAdvisoryHit}'s return value is the one that
 * decides.
 */
export function isAggregatingAdvisories(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Run `fn` with advisory hits aggregated, then hand the folded groups to
 * `report`.
 *
 * `report` runs in a `finally`, so a load that throws still reports what it
 * tripped before failing — the diagnostics of a half-finished seed are the ones
 * most worth having. It is called only when there is something to report, and
 * its own failure is never allowed to replace the caller's outcome: a reporting
 * bug must not turn a successful seed load into a failed one.
 */
export async function runWithAdvisoryAggregation<T>(
  fn: () => Promise<T>,
  report: (groups: AdvisoryGroup[]) => void,
): Promise<T> {
  const collector: AdvisoryCollector = { groups: new Map() };
  try {
    return await storage.run(collector, fn);
  } finally {
    if (collector.groups.size > 0) {
      try {
        report([...collector.groups.values()]);
      } catch {
        // Reporting is a diagnostic, never an outcome.
      }
    }
  }
}
