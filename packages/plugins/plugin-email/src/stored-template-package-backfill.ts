// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R20, D10] A legacy `sys_email_template` row names an email
 * template by its bare name; it gains the package that holds that template,
 * beside the name (`package_id`) — backfilled at boot.
 *
 * No mail is sent from this table any more (ADR-0131 D6/D10): its rows are
 * the overlays earlier releases wrote, and the v18 promotion ceremony is the
 * reader-to-be of the column. Email templates are behavioural metadata
 * (ADR-0150 D1 bucket 2), identified by `(package, name)`: two facts, two
 * columns (ADR-0126 §4), ⛔ never a re-encoded literal.
 *
 * ## Where the answer comes from
 *
 * The template's one holder in this environment when the backfill runs:
 * objectql's {@link resolvePackageScopedName} (the one ADR-0150 D3 rule),
 * asked as a caller with no package over the whole registry. A name only this
 * service's built-in templates hold resolves to them as the overridable
 * baseline (D3 (b), `via: 'baseline'`), a package holder like any other, so
 * the row binds to this service's package. ⛔ No second rule, no
 * first-registered fallback:
 *
 *  - resolved to a package → the row takes that package;
 *  - resolved to the environment's own template, or the platform's → stays
 *    null, which is its spelling;
 *  - refused → the ambiguous set: left null, and every candidate named;
 *  - not-found → nothing declares the name any more: left null, and named.
 *
 * Nothing reads the column yet and nothing else writes it; no key changes.
 * It reads only rows whose `package_id` is null and writes only that column,
 * so a second run binds nothing and reports the same names.
 */

import { describePackageScopedHolder, resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';

/** The table. */
const TABLE = 'sys_email_template';

/** Infrastructure rows, written and read the way the plugin's other system writes are. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Rows per page of the walk. */
const PAGE_SIZE = 500;

/** A template name and how many rows carry it. */
export interface TemplateName {
  readonly name: string;
  readonly rows: number;
}

/** What one run did, or would do in a dry run. */
export interface TemplatePackageBackfillReport {
  readonly bound: ReadonlyArray<TemplateName & { readonly packageId: string }>;
  readonly ambiguous: ReadonlyArray<TemplateName & { readonly candidates: readonly string[] }>;
  readonly unheld: readonly TemplateName[];
  readonly unpackaged: ReadonlyArray<TemplateName & { readonly holder: 'environment' | 'platform' }>;
}

/** The engine slice the backfill reads and writes through. */
export interface TemplatePackageBackfillEngine {
  find(object: string, options?: unknown): Promise<unknown>;
  update(object: string, data: unknown, options?: unknown): Promise<unknown>;
}

type Row = Record<string, unknown>;

const tally = <T extends TemplateName>(into: Map<string, T>, name: string, make: () => T): void => {
  const at = into.get(name);
  into.set(name, { ...(at ?? make()), rows: (at?.rows ?? 0) + 1 });
};

/**
 * Bind every row whose `package_id` is null to the one package that holds its
 * template (module doc). Reads by id-ordered page; writes only `package_id`,
 * one row at a time, by id.
 */
export async function backfillTemplatePackages(
  engine: TemplatePackageBackfillEngine,
  registry: PackageScopedRegistry,
  options?: { readonly dryRun?: boolean },
): Promise<TemplatePackageBackfillReport> {
  const bound = new Map<string, TemplateName & { packageId: string }>();
  const ambiguous = new Map<string, TemplateName & { candidates: readonly string[] }>();
  const unheld = new Map<string, TemplateName>();
  const unpackaged = new Map<string, TemplateName & { holder: 'environment' | 'platform' }>();
  const answers = new Map<string, ReturnType<typeof resolvePackageScopedName>>();

  let cursor: unknown = undefined;
  for (;;) {
    const where = cursor === undefined ? { package_id: null } : { $and: [{ package_id: null }, { id: { $gt: cursor } }] };
    const found = await engine.find(TABLE, {
      where,
      orderBy: [{ field: 'id', order: 'asc' }],
      limit: PAGE_SIZE,
      fields: ['id', 'name', 'package_id'],
      context: SYSTEM_CTX,
    });
    const page = Array.isArray(found) ? (found as Row[]) : [];
    if (page.length === 0) break;
    for (const row of page) {
      // The filter is the driver's; this re-check keeps a driver that reads it
      // loosely from moving a bound row.
      if (row.package_id !== null && row.package_id !== undefined) continue;
      const id = row.id;
      const name = row.name;
      if (id === null || id === undefined || typeof name !== 'string' || name === '') continue;
      // [#32183] A binding never moves with a reversible disable: every holder.
      if (!answers.has(name)) {
        answers.set(name, resolvePackageScopedName(registry, {
          type: 'email_template', name, callerPackageId: null, includeDisabledPackages: true,
        }));
      }
      const answer = answers.get(name)!;
      if (answer.status === 'resolved') {
        if (answer.holder.kind === 'package') {
          const packageId = answer.holder.packageId;
          if (!options?.dryRun) await engine.update(TABLE, { id, package_id: packageId }, { context: SYSTEM_CTX });
          tally(bound, name, () => ({ name, rows: 0, packageId }));
        } else {
          const holder = answer.holder.kind;
          tally(unpackaged, name, () => ({ name, rows: 0, holder }));
        }
      } else if (answer.status === 'refused') {
        const candidates = answer.candidates.map(describePackageScopedHolder);
        tally(ambiguous, name, () => ({ name, rows: 0, candidates }));
      } else {
        tally(unheld, name, () => ({ name, rows: 0 }));
      }
    }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1]?.id;
    if (last === undefined || last === cursor) break;
    cursor = last;
  }
  return { bound: [...bound.values()], ambiguous: [...ambiguous.values()], unheld: [...unheld.values()], unpackaged: [...unpackaged.values()] };
}

/** The logger slice a run writes to. */
export interface TemplatePackageBackfillLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const rowsOf = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;

/** What a run says: bound and unheld at `info`, the ambiguous set at `warn`. */
export function logTemplatePackageBackfill(report: TemplatePackageBackfillReport, logger: TemplatePackageBackfillLogger): void {
  const at = `${TABLE}.package_id`;
  if (report.bound.length > 0) {
    logger.info(
      `[email] ${at}: rows now name the package that holds their template (ADR-0150 D8) — ` +
        report.bound.map((b) => `'${b.name}' → ${b.packageId} (${rowsOf(b.rows)})`).join(', ') + '.',
    );
  }
  if (report.ambiguous.length > 0) {
    logger.warn(
      `[email] ${at}: more than one holder holds these templates, so none is picked and each row is left naming no ` +
        'package — ' +
        report.ambiguous.map((a) => `'${a.name}' (${rowsOf(a.rows)}; held by ${a.candidates.join('; ')})`).join(', ') + '.',
      { ambiguous: report.ambiguous },
    );
  }
  if (report.unheld.length > 0) {
    logger.info(
      `[email] ${at}: nothing declares these templates, so their rows name no package — ` +
        report.unheld.map((u) => `'${u.name}' (${rowsOf(u.rows)})`).join(', ') + '.',
      { unheld: report.unheld },
    );
  }
}
