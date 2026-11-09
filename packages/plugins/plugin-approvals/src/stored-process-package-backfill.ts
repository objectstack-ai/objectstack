// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R7, D10] An open approval request names the flow that
 * opened it (`sys_approval_request.process_name`, `flow:NAME`); it gains the
 * package that holds that flow, beside the name (`process_package`) —
 * backfilled at boot.
 *
 * Only OPEN requests are asked: `pending`, and `returned`, whose run waits in
 * the revise window. A decided request (`approved`, `rejected`, `recalled`,
 * `cancelled`) stays as written. Flows are behavioural metadata (ADR-0150 D1
 * bucket 2), identified by `(package, name)`: two facts, two columns
 * (ADR-0126 §4), ⛔ never a re-encoded literal.
 *
 * ## Where the answer comes from
 *
 * The row records WHICH flow it belongs to (D4 identity), so the answer is
 * the flow's one holder in this environment when the backfill runs: the
 * automation engine's `flowHolder(name)`, which asks the one ADR-0150 D3 rule
 * as a caller with no package over the whole registry. An environment
 * override of P's flow is the overlay of P's item, not a second one (D4), so
 * its requests bind to P. ⛔ Not `armedFlowPackage`, a caller's answer. ⛔ No
 * second rule, no first-registered fallback:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own flow, or the platform's → stays null,
 *    which is its spelling;
 *  - refused → the ambiguous set: left null, and every candidate named;
 *  - not-found → nothing holds the name (a flow since removed, or a request
 *    opened with no flow name, whose `process_name` carries the node id):
 *    left null, and named.
 *
 * ## What it does not change
 *
 * No reader or writer moves onto the column (ADR-0150 red line 3): the
 * revise-edge check, the resubmit window, the progress strip and the labels
 * still read the flow by name, and `openNodeRequest` does not stamp it — a
 * request opened after a boot is bound by the next one. Its reader-to-be is
 * the flow's trailing child (B) and S4's upgrade report. No key changes.
 *
 * ## Re-runnable
 *
 * It reads only open rows whose `process_package` is null and writes only
 * that column, so a second run binds nothing and reports the same ambiguous
 * and unheld names.
 */

import { describePackageScopedHolder, type PackageScopedResolution } from '@objectstack/core';
import { keysetWalk } from '@objectstack/types';

/** The table. */
const TABLE = 'sys_approval_request';

/** The open statuses (module doc). */
export const OPEN_REQUEST_STATUSES = Object.freeze(['pending', 'returned'] as const);

/** The `process_name` prefix a flow-driven request carries. */
const FLOW_PREFIX = 'flow:';

/** Infrastructure rows, written and read the way the plugin's other boot passes do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** The automation engine's reader of a flow's identity (`AutomationEngine.flowHolder`). */
export interface FlowHolderSource {
  flowHolder(name: string): PackageScopedResolution | undefined;
}

/** A flow name and how many open requests carry it. */
export interface ProcessName {
  readonly name: string;
  readonly rows: number;
}

/** What one run did, or would do in a dry run. */
export interface ProcessPackageBackfillReport {
  /** Flows whose open requests now carry the one package holder. */
  readonly bound: ReadonlyArray<ProcessName & { readonly packageId: string }>;
  /** Flows two or more holders hold: left null, every candidate named. */
  readonly ambiguous: ReadonlyArray<ProcessName & { readonly candidates: readonly string[] }>;
  /** Flows nothing holds: left null. */
  readonly unheld: readonly ProcessName[];
  /** Flows the environment's own item, or the platform's, answers: left null, its spelling. */
  readonly unpackaged: ReadonlyArray<ProcessName & { readonly holder: 'environment' | 'platform' }>;
}

/** The engine slice the backfill reads and writes through. */
export interface ProcessPackageBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

type Row = Record<string, unknown>;

const tally = <T extends ProcessName>(into: Map<string, T>, name: string, make: () => T): void => {
  const at = into.get(name);
  into.set(name, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/**
 * Bind every open request whose `process_package` is null to the one package
 * that holds its flow (module doc). Reads by keyset page; writes only
 * `process_package`, one row at a time, by id.
 */
export async function backfillProcessPackages(
  engine: ProcessPackageBackfillEngine,
  flows: FlowHolderSource,
  options?: { readonly dryRun?: boolean },
): Promise<ProcessPackageBackfillReport> {
  const bound = new Map<string, ProcessName & { packageId: string }>();
  const ambiguous = new Map<string, ProcessName & { candidates: readonly string[] }>();
  const unheld = new Map<string, ProcessName>();
  const unpackaged = new Map<string, ProcessName & { holder: 'environment' | 'platform' }>();
  const answers = new Map<string, PackageScopedResolution | undefined>();

  const walk = keysetWalk<Row>(
    async (query) => {
      const page = await engine.find(TABLE, { ...query, fields: ['id', 'process_name', 'process_package', 'status'], context: SYSTEM_CTX });
      return Array.isArray(page) ? (page as Row[]) : [];
    },
    { where: { $and: [{ process_package: null }, { status: { $in: [...OPEN_REQUEST_STATUSES] } }] }, pageSize: PAGE_SIZE },
  );
  for await (const page of walk.pages()) {
    for (const row of page) {
      // The filter is the driver's; this re-check keeps a driver that reads it
      // loosely from moving a bound row or binding a decided one.
      if (row.process_package !== null && row.process_package !== undefined) continue;
      if (!(OPEN_REQUEST_STATUSES as readonly unknown[]).includes(row.status)) continue;
      const id = row.id;
      const processName = row.process_name;
      if (id === null || id === undefined || typeof processName !== 'string' || !processName.startsWith(FLOW_PREFIX)) continue;
      const name = processName.slice(FLOW_PREFIX.length);
      if (name === '') continue;
      if (!answers.has(name)) answers.set(name, flows.flowHolder(name));
      const answer = answers.get(name);
      if (answer?.status === 'resolved') {
        if (answer.holder.kind === 'package') {
          const packageId = answer.holder.packageId;
          if (!options?.dryRun) {
            await engine.update(TABLE, { id, process_package: packageId }, { context: SYSTEM_CTX });
          }
          tally(bound, name, () => ({ name, rows: 0, packageId }));
        } else {
          const holder = answer.holder.kind;
          tally(unpackaged, name, () => ({ name, rows: 0, holder }));
        }
      } else if (answer?.status === 'refused') {
        const candidates = answer.candidates.map(describePackageScopedHolder);
        tally(ambiguous, name, () => ({ name, rows: 0, candidates }));
      } else {
        // `not-found`, or no registry to ask: nothing is bound on an answer nobody gave.
        tally(unheld, name, () => ({ name, rows: 0 }));
      }
    }
  }
  return { bound: [...bound.values()], ambiguous: [...ambiguous.values()], unheld: [...unheld.values()], unpackaged: [...unpackaged.values()] };
}

/** The logger slice a run writes to. */
export interface ProcessPackageBackfillLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const rowsOf = (n: number): string => `${n} request${n === 1 ? '' : 's'}`;

/** What a run says: bound and unheld at `info`, the ambiguous set at `warn`. */
export function logProcessPackageBackfill(report: ProcessPackageBackfillReport, logger: ProcessPackageBackfillLogger): void {
  const at = `${TABLE}.process_package`;
  if (report.bound.length > 0) {
    logger.info(
      `[approvals] ${at}: open requests now name the package that holds their flow (ADR-0150 D8) — ` +
        report.bound.map((b) => `'${b.name}' → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[approvals] ${at}: more than one holder holds these flows, so none is picked and each open request is left naming ` +
        'no package. Every reader still reads the flow by name as before — ' +
        report.ambiguous.map((a) => `'${a.name}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
      { ambiguous: report.ambiguous },
    );
  }
  if (report.unheld.length > 0) {
    logger.info(
      `[approvals] ${at}: nothing holds these flows, so their open requests name no package — ` +
        report.unheld.map((u) => `'${u.name}' (${rowsOf(u.rows)})`).join(', ') + '.',
      { unheld: report.unheld },
    );
  }
}
