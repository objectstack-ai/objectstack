// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The fields of a parent object a READER is served UNMASKED — the one answer
 * both read-time field redactions in this package narrow a parent record's
 * field values by:
 *
 *  - the activity stream's (`activity-field-redaction.ts`, #21081);
 *  - the compliance ledger's (`audit-log-field-redaction.ts`, #21155).
 *
 * Both rows are composed once, as the system, and carry a parent record's
 * field values to every reader of the row. The writer cannot know the reader,
 * so each seam narrows at read time, keyed on the reading caller — and both
 * narrow by THIS answer, so the two can never disagree about which field a
 * reader is served.
 *
 * ⛔ Nothing here derives masking. The served-unmasked set is the security
 * contract's read projection intersected with its query-side answer
 * ({@link resolveServedFields}), whose difference the contract defines as
 * exactly the fields this caller is served masked — the composition the
 * approval payload snapshot serves its snapshot with
 * (`plugin-approvals/src/payload-redaction.ts`, `resolveReadableSnapshotFields`).
 */

import type { ISecurityService } from '@objectstack/spec/contracts';

/** The slice of the security contract a field redaction asks — the REAL interface. */
export type FieldVisibilitySource = Pick<ISecurityService, 'getReadableFields' | 'getQueryableFields'>;

export interface FieldRedactionLogger {
  warn(msg: string, meta?: unknown): void;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The fields of `object` this reader is served UNMASKED, or `undefined` when
 * the seam must not narrow.
 *
 *  - no service, no object, or a read projection that answers `undefined` or
 *    throws → `undefined`: the contract's "no answer", the data plane's own
 *    fallback, and so not a reason to blank the rows;
 *  - otherwise the read projection intersected with `getQueryableFields`.
 *    When THAT answer cannot be had (absent member, `undefined`, a throw) the
 *    contract obliges the consumer not to read its absence as "nothing is
 *    masked": the read projection reports every masked field readable. So the
 *    answer is `[]` — no field is served.
 *
 * `seam` names the redaction in the log line, so an operator can tell which
 * read surface degraded.
 */
export async function resolveServedFields(
  security: Partial<FieldVisibilitySource> | undefined,
  object: string | undefined,
  context: unknown,
  logger?: FieldRedactionLogger,
  seam = 'field redaction',
): Promise<string[] | undefined> {
  if (!security || typeof security.getReadableFields !== 'function') return undefined;
  const name = String(object ?? '').trim();
  if (!name) return undefined;
  let readable: string[] | undefined;
  try {
    readable = await security.getReadableFields(name, context as never);
  } catch (err) {
    logger?.warn(
      `[audit] ${seam}: readable fields of '${name}' could not be resolved — ` +
        `serving the rows about it unnarrowed (${(err as Error)?.message ?? err})`,
    );
    return undefined;
  }
  if (readable === undefined) return undefined;

  let unmasked: string[] | undefined;
  let reason = 'the security service has no masked-for-this-caller answer (getQueryableFields)';
  if (typeof security.getQueryableFields === 'function') {
    try {
      unmasked = await security.getQueryableFields(name, context as never);
      if (unmasked === undefined) reason = 'getQueryableFields answered undefined';
    } catch (err) {
      reason = `getQueryableFields threw: ${(err as Error)?.message ?? err}`;
    }
  }
  if (unmasked === undefined) {
    logger?.warn(
      `[audit] ${seam}: cannot tell which fields of '${name}' are masked for this caller — ` +
        `serving no field value of it (fail closed): ${reason}`,
    );
    return [];
  }
  const keep = new Set(unmasked.map(String));
  return readable.filter((f) => keep.has(String(f)));
}

/**
 * {@link resolveServedFields} for ONE read: one answer per parent object per
 * read, never one per row.
 */
export function servedFieldsPerRead(
  security: Partial<FieldVisibilitySource> | undefined,
  context: unknown,
  logger: FieldRedactionLogger | undefined,
  seam: string,
): (object: string) => Promise<string[] | undefined> {
  const served = new Map<string, Promise<string[] | undefined>>();
  return (object) => {
    let p = served.get(object);
    if (!p) served.set(object, (p = resolveServedFields(security, object, context, logger, seam)));
    return p;
  };
}

/**
 * Drop, key by key, every field of a parent-record snapshot the reader is not
 * served — the approval snapshot's shape. Dropped, not masked: the contract
 * publishes WHICH fields are masked, not the masked value, and dropping
 * discloses strictly less. Mutates `snapshot`; answers whether it changed.
 */
export function dropUnservedKeys(snapshot: Record<string, unknown>, served: ReadonlySet<string>): boolean {
  let changed = false;
  for (const key of Object.keys(snapshot)) {
    if (!served.has(key)) {
      delete snapshot[key];
      changed = true;
    }
  }
  return changed;
}

/**
 * A projection that names a value-bearing column without the columns the
 * redaction judges it by gets those added for the read; the caller removes
 * them from what is served. Returns the columns it added.
 */
export function ensureJudgedColumnsProjected(
  ast: Record<string, unknown> | undefined,
  valueColumns: readonly string[],
  judgedBy: readonly string[],
): string[] {
  const fields = ast?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return [];
  if (!fields.some((f) => valueColumns.includes(String(f)))) return [];
  const added: string[] = [];
  for (const col of judgedBy) {
    if (!fields.includes(col)) {
      fields.push(col);
      added.push(col);
    }
  }
  return added;
}
