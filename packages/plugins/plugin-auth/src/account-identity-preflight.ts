// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { keysetWalk } from '@objectstack/types';

/**
 * #17440 — the read-only preflight that must refuse BEFORE `sys_account.issuer`
 * is dropped.
 *
 * ## What changes, and why a column drop needs a preflight at all
 *
 * better-auth 1.7.3 removed the issuer-scoped account identity outright
 * (better-auth/better-auth#10909): `AccountKey` is `(providerId, accountId)`
 * again. So account uniqueness moves from `(issuer, account_id)` to
 * `(provider_id, account_id)` — a NARROWER key. Two rows sharing
 * `provider_id` + `account_id` and differing only in `issuer` are legal under
 * the old key and are ONE account under the new one.
 *
 * ⛔ The detection mechanism is never "add the constraint and see what
 * explodes". An operator whose identity table half-migrated at 2am is the worst
 * outcome this change can produce, and on this particular table the explosion
 * would not even happen — see the next section. So the class is measured first,
 * on the rows, and a dirty read REFUSES.
 *
 * ## Why this cannot lean on the declared index, and why the drop is silent
 *
 * `sys_account` has declared `{ fields: ['provider_id', 'account_id'], unique:
 * true }` since the object was created — it long predates `issuer`, which
 * arrived only with the 1.7.0-rc.2 bump. On a deployment where that index is
 * PHYSICALLY present the collision class is refused at write time and this
 * probe reads zero.
 *
 * ⚠️ "Declared" is not "present". `syncDeclaredIndexes` logs a plain UNIQUE
 * whose CREATE fails on existing duplicates onto the durability channel and
 * lets the boot continue (#14902 / #15479) — deliberately, so one dirty table
 * cannot take a deployment down. A database that ever held duplicates therefore
 * carries the declaration and not the constraint, and can still hold the class
 * today.
 *
 * On such a database the column drop does not blow up. It degrades silently:
 * the rows become indistinguishable, `findAccountByKey` resolves whichever one
 * the driver hands back first, and a sign-in can land on the wrong user's
 * account. That is strictly worse than a failed apply, and it is the reason
 * this probe reads ROWS and never the index declaration.
 *
 * ## Refusal discipline
 *
 * Two failures are deliberately NOT reported as "clean", because a preflight
 * that cannot see is not a preflight that found nothing:
 *
 *   1. **A read that throws refuses.** The retired `backfill-account-issuer.ts`
 *      wrapped its reads in `try { … } catch { return [] }` — correct for an
 *      idempotent best-effort stamping pass that runs again next boot, and
 *      exactly wrong here, where the answer authorises an irreversible drop.
 *   2. **A truncated walk refuses.** An unenumerated tail is not zero rows.
 *
 * ## What it deliberately does NOT do
 *
 * It repairs nothing. Which row survives a collision is application knowledge —
 * two humans may be behind those two rows — so this inventories and prescribes,
 * and the operator resolves and re-runs. ⛔ No row is ever merged or deleted
 * here.
 */

/** The object this probe reads. Never written. */
export const SYS_ACCOUNT_OBJECT = 'sys_account';

/** Default rows scanned before the walk gives up and reports truncation. */
export const DEFAULT_ACCOUNT_SCAN_MAX = 200_000;

/** Rows per page. Identity tables are narrow; this keeps one page small. */
const PAGE_SIZE = 500;

const SYSTEM_CTX = { isSystem: true } as const;

/** The engine surface this probe needs — read-only by construction. */
export interface AccountIdentityReadEngine {
  find(
    object: string,
    query: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** One `(provider_id, account_id)` key held by more than one row. */
export interface AccountIdentityCollision {
  providerId: string;
  accountId: string;
  /**
   * The distinct `issuer` values under this key, sorted. `null` is spelled
   * `'(none)'` so an operator reading the report can tell an absent issuer from
   * an empty string.
   */
  issuers: string[];
  /** Row ids, sorted — the identifying detail an operator acts on. */
  rowIds: string[];
  /** Distinct `user_id` values under this key, sorted. */
  userIds: string[];
  /**
   * True when the colliding rows point at MORE THAN ONE user. This is the
   * dangerous shape: after the drop, one of those people signs in and resolves
   * to the other one's account.
   */
  crossUser: boolean;
}

export interface AccountIdentityPreflightReport {
  /** Rows read. */
  scanned: number;
  /** Distinct `(provider_id, account_id)` keys seen. */
  keys: number;
  /** Every key held by more than one row, sorted by provider then account id. */
  collisions: AccountIdentityCollision[];
  /** How many of {@link collisions} span more than one user. */
  crossUser: number;
  /** True when the drop is safe to proceed with on this database. */
  ok: boolean;
}

/**
 * A refusal. Carries an ADR-0112 envelope (`code` + `status`) so a route or a
 * command surfacing it says the same thing either way.
 */
export class AccountIdentityPreflightRefusal extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  readonly report: AccountIdentityPreflightReport | undefined;

  constructor(message: string, report?: AccountIdentityPreflightReport) {
    super(message);
    this.name = 'AccountIdentityPreflightRefusal';
    this.report = report;
  }
}

export interface AccountIdentityPreflightOptions {
  /** Stop after this many rows and refuse rather than report a partial scan. */
  max?: number;
}

const issuerLabel = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '(none)' : String(v);

/**
 * A `find()` answers a bare array — measured across this package's fourteen
 * read sites in #15597, and refused by the engine itself since #15823. ⛔ No
 * `{ records }` limb here: absorbing a shape the contract forbids is how a
 * corrupted read becomes an empty one, and an empty read is the answer that
 * authorises the drop.
 */
function rowsOf(r: unknown, what: string): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  throw new AccountIdentityPreflightRefusal(
    `Reading ${what} answered ${r === null ? 'null' : typeof r}, not an array. ` +
      'Refusing rather than reading an uninterpretable answer as an empty one.',
  );
}

/**
 * Read every `sys_account` row and report the keys that more than one row
 * holds.
 *
 * ⛔ Throws {@link AccountIdentityPreflightRefusal} when the table cannot be
 * enumerated — a read that fails and a table that is empty are different
 * answers, and only one of them authorises a drop.
 */
export async function probeAccountIdentityCollisions(
  engine: AccountIdentityReadEngine,
  options: AccountIdentityPreflightOptions = {},
): Promise<AccountIdentityPreflightReport> {
  if (!engine || typeof engine.find !== 'function') {
    throw new AccountIdentityPreflightRefusal(
      `Cannot enumerate ${SYS_ACCOUNT_OBJECT}: no readable ObjectQL engine. ` +
        'Refusing rather than reporting an unread table as clean.',
    );
  }

  const walk = keysetWalk<Record<string, unknown>>(
    async (q) => {
      let page: unknown;
      try {
        page = await engine.find(
          SYS_ACCOUNT_OBJECT,
          {
            where: q.where ?? {},
            orderBy: q.orderBy,
            limit: q.limit,
            fields: ['id', 'provider_id', 'account_id', 'issuer', 'user_id'],
          },
          { context: SYSTEM_CTX },
        );
      } catch (e) {
        // Rule 1 of this file's refusal discipline. A swallowed read here
        // would report an unreadable table as a clean one and authorise the
        // drop on it.
        throw new AccountIdentityPreflightRefusal(
          `Cannot enumerate ${SYS_ACCOUNT_OBJECT}: ${(e as Error)?.message ?? String(e)}. ` +
            'Refusing rather than reporting an unread table as clean.',
        );
      }
      return rowsOf(page, SYS_ACCOUNT_OBJECT);
    },
    { pageSize: PAGE_SIZE, max: options.max ?? DEFAULT_ACCOUNT_SCAN_MAX },
  );

  const groups = new Map<string, Array<Record<string, unknown>>>();
  for await (const page of walk.pages()) {
    for (const row of page) {
      const providerId = String(row.provider_id ?? '');
      const accountId = String(row.account_id ?? '');
      const key = `${providerId} ${accountId}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
  }

  if (walk.truncated) {
    // Rule 2. The tail we did not read may hold the whole class.
    throw new AccountIdentityPreflightRefusal(
      `Scan of ${SYS_ACCOUNT_OBJECT} stopped at ${walk.scanned} row(s) without reaching the end of the ` +
        'table, so the rows it did not read cannot be reported as absent. Re-run with a higher ' +
        'row cap (--max-records). Refusing rather than reporting a partial scan as clean.',
    );
  }

  const collisions: AccountIdentityCollision[] = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    const [providerId, accountId] = key.split(' ');
    const userIds = [...new Set(rows.map((r) => String(r.user_id ?? '')))].sort();
    collisions.push({
      providerId: providerId ?? '',
      accountId: accountId ?? '',
      issuers: [...new Set(rows.map((r) => issuerLabel(r.issuer)))].sort(),
      rowIds: rows.map((r) => String(r.id ?? '')).sort(),
      userIds,
      crossUser: userIds.length > 1,
    });
  }
  collisions.sort(
    (a, b) => a.providerId.localeCompare(b.providerId) || a.accountId.localeCompare(b.accountId),
  );

  return {
    scanned: walk.scanned,
    keys: groups.size,
    collisions,
    crossUser: collisions.filter((c) => c.crossUser).length,
    ok: collisions.length === 0,
  };
}

/**
 * The refusal half. Separated from the probe so a caller can render the report
 * first and refuse after — the operator sees WHAT was found, not only that
 * something was.
 */
export function assertNoAccountIdentityCollisions(
  report: AccountIdentityPreflightReport,
): void {
  if (report.ok) return;
  const crossUser = report.crossUser > 0
    ? ` ${report.crossUser} of them span more than one user, so after the drop one of those people ` +
      'would sign in and resolve to the other one\'s account.'
    : '';
  throw new AccountIdentityPreflightRefusal(
    `${report.collisions.length} (provider_id, account_id) key(s) in ${SYS_ACCOUNT_OBJECT} are held by ` +
      `more than one row.${crossUser} Dropping sys_account.issuer would make those rows ` +
      'indistinguishable. Resolve them — keep the row whose provider account is live and delete the ' +
      'rest so a fresh sign-in re-links — then re-run this preflight. ' +
      '⛔ Nothing is merged or deleted for you: which row survives is application knowledge.',
    report,
  );
}

/** Operator-facing text. One line per collision, capped so a report stays readable. */
export function formatAccountIdentityPreflightReport(
  report: AccountIdentityPreflightReport,
  limit = 50,
): string {
  const lines: string[] = [];
  lines.push(
    `${SYS_ACCOUNT_OBJECT}: ${report.scanned} row(s) scanned, ${report.keys} distinct ` +
      '(provider_id, account_id) key(s).',
  );
  if (report.ok) {
    lines.push('No key is held by more than one row — sys_account.issuer is safe to drop.');
    return lines.join('\n');
  }
  lines.push(
    `${report.collisions.length} colliding key(s), ${report.crossUser} of them spanning more than one user:`,
  );
  for (const c of report.collisions.slice(0, limit)) {
    lines.push(
      `  ${c.providerId} / ${c.accountId} — ${c.rowIds.length} rows ` +
        `[${c.rowIds.join(', ')}], issuers [${c.issuers.join(', ')}], ` +
        `users [${c.userIds.join(', ')}]${c.crossUser ? '  ⚠️ CROSS-USER' : ''}`,
    );
  }
  if (report.collisions.length > limit) {
    lines.push(`  … and ${report.collisions.length - limit} more.`);
  }
  return lines.join('\n');
}

/**
 * The one case where the retired `issuer` still discriminated: a `provider_id`
 * whose registration is RE-POINTED at a different IdP.
 *
 * ## The answer this change commits to
 *
 * **Re-pointing a `provider_id` at a different IdP forces a rebuild of that
 * provider's account bindings. No key separates them, and after the column drop
 * nothing can.**
 *
 * `sys_sso_provider` declares `{ fields: ['provider_id'], unique: true }`, so
 * within one environment `provider_id → issuer` is a function and
 * `(provider_id, account_id)` determines exactly what `(issuer, account_id)`
 * determined — for as long as that function holds. Re-pointing breaks it: rows
 * written under the old IdP and rows written under the new one share one
 * `provider_id`, and the subject namespaces behind them are unrelated. If the
 * new IdP mints a `sub` the old one had already issued to somebody else, the
 * new key resolves that sign-in onto the OTHER person's account row.
 *
 * ⚠️ Under the old key that shape failed LOUDLY: `findAccountByKey` missed the
 * old row, better-auth tried to insert a new one, and the long-standing
 * `(provider_id, account_id)` unique refused it — the user saw
 * `unable_to_link_account`. Under the new key the same shape resolves silently
 * onto the wrong account. The narrowing turns a loud refusal into a quiet
 * cross-user sign-in, which is why this is answered here rather than left to a
 * constraint.
 *
 * ## Why it is enforced at the re-point, not at sign-in
 *
 * After the drop there is no column recording which IdP vouched for a row, so
 * no runtime check can tell an old binding from a new one. The last moment at
 * which the distinction still exists is the write that changes the issuer. So
 * that write is what refuses: {@link refuseIssuerRepointWithLiveBindings} sits
 * on the `sys_sso_provider` update door and declines an issuer change while
 * accounts are still bound to that `provider_id`. The operator deletes the
 * stale bindings — a fresh sign-in re-links each user under the new IdP — and
 * re-points.
 */
export interface RepointGuardEngine extends AccountIdentityReadEngine {}

/** How many bound accounts the guard names before it stops listing. */
const REPOINT_SAMPLE = 5;

/**
 * Refuse an `issuer` change on a `sys_sso_provider` row while `sys_account`
 * rows are still bound to its `provider_id`.
 *
 * A no-op for every other object, for a patch that does not move `issuer`, and
 * for a re-point of a provider nobody has signed in through yet.
 *
 * ⛔ Read failures refuse, for the same reason the probe's do: "I could not
 * check" must never be spelled the same way as "there is nothing to check"
 * when what follows is irreversible.
 */
export async function refuseIssuerRepointWithLiveBindings(
  engine: RepointGuardEngine,
  objectName: string,
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  if (objectName !== 'sys_sso_provider') return;
  if (!existing || !patch || !Object.prototype.hasOwnProperty.call(patch, 'issuer')) return;

  const before = existing.issuer;
  const after = patch.issuer;
  // Only a real change is a re-point. A rewrite of the same value is not.
  if (String(before ?? '') === String(after ?? '')) return;

  const providerId = String(existing.provider_id ?? '');
  if (!providerId) return;

  let bound: Array<Record<string, unknown>>;
  try {
    bound = rowsOf(
      await engine.find(
        SYS_ACCOUNT_OBJECT,
        { where: { provider_id: providerId }, limit: REPOINT_SAMPLE + 1, fields: ['id', 'user_id'] },
        { context: SYSTEM_CTX },
      ),
      `${SYS_ACCOUNT_OBJECT} bindings of "${providerId}"`,
    );
  } catch (e) {
    throw new AccountIdentityPreflightRefusal(
      `Cannot check the account bindings of SSO provider "${providerId}" before re-pointing it: ` +
        `${(e as Error)?.message ?? String(e)}. Refusing the issuer change rather than making it blind.`,
    );
  }

  if (bound.length === 0) return;

  const shown = bound.slice(0, REPOINT_SAMPLE).map((r) => String(r.id ?? ''));
  const more = bound.length > REPOINT_SAMPLE ? ` (and more)` : '';
  throw new AccountIdentityPreflightRefusal(
    `SSO provider "${providerId}" cannot be re-pointed from issuer "${issuerLabel(before)}" to ` +
      `"${issuerLabel(after)}" while ${SYS_ACCOUNT_OBJECT} rows are still bound to it ` +
      `[${shown.join(', ')}]${more}. Account identity is (provider_id, account_id) — no column ` +
      'records which IdP vouched for a row, so a subject the new IdP issues can land on an account ' +
      'the old one created for a different person. Delete this provider\'s account bindings first; ' +
      'each user re-links on their next sign-in.',
  );
}
