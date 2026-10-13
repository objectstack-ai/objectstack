// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two inbound-mail read gates.
 *
 * Both objects are written once, as the system, by the ingest service, and
 * carry no owner column; a message is about records of OTHER objects, and the
 * set of those records is a different set on every row. So neither OWD/sharing
 * nor RLS can say who may read one, and a data middleware does — the
 * parent-record read gate shape (`@objectstack/plugin-audit`,
 * `parent-record-read-gate.ts`), whose one readability answer is
 * {@link resolveReadableParentIds} (`@objectstack/core`): one caller-scoped
 * read per record object, so each record's own OWD/sharing, RLS and
 * object-level CRUD decide.
 *
 *  - `sys_mail_association`: a row is served when the caller can read the
 *    record its (`object_name`, `record_id`) pair names.
 *  - `sys_mail_message`: a row is served when the caller can read a record one
 *    of its association rows names, OR owns the mailbox the message arrived in
 *    (`sys_mailbox.owner_user_id`).
 *
 * A message no record matched — the unassociated POOL — has no association, so
 * only its mailbox's owner (and the exemption below) is served it: the pool is
 * restricted by default, never organization-wide.
 *
 * The one declared exemption on both gates is the capability
 * {@link MAILBOX_ADMIN_CAPABILITY}: its holder is not narrowed by them at all.
 * Only these gates are skipped; the objects' grants, field-level security and
 * every other read seam still apply. Held means the caller's resolved
 * `systemPermissions`, the capability set the request's authorization resolver
 * stamps on the execution context.
 *
 * Mechanism, for one read: pre-scan the rows the query would touch under
 * SYSTEM context (bounded at {@link MAIL_GATE_SCAN_LIMIT}, in the caller's own
 * order), decide which of them the caller may read, and AND an `id`/pair `$in`
 * into the read's WHERE. The middleware covers `count` and `aggregate` too, so
 * a list's `total` excludes what its rows exclude.
 *
 * Fails CLOSED: a row this module cannot authorize is excluded (a malformed or
 * self-referential pair, a record that no longer exists, a record object the
 * caller cannot read or the engine does not know); rows past a scan bound are
 * excluded and said so; a filter-compute failure denies the whole read. System
 * and context-less reads are internal and are not narrowed.
 */

import { resolveReadableParentIds } from '@objectstack/core';

/** The gated message object. */
export const MAIL_MESSAGE_OBJECT = 'sys_mail_message';
/** The gated association object. */
export const MAIL_ASSOCIATION_OBJECT = 'sys_mail_association';
/** The mailbox directory the owner limb reads. */
export const MAILBOX_OBJECT = 'sys_mailbox';

/**
 * The mailbox administrator capability: its holder is exempt from both gates.
 * Declared in `PLATFORM_CAPABILITIES` (`@objectstack/spec/security`) and
 * granted by `ADMIN_FULL_ACCESS_CAPABILITIES` and `organization_admin`; this
 * spelling is pinned against the declaration in this package's tests.
 */
export const MAILBOX_ADMIN_CAPABILITY = 'manage_mailboxes';

/** The engine reads a mail read gate answers for. */
export const MAIL_GATE_READ_OPS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/** Bound on each per-read pre-scan — the parent-record gate's bound. Beyond it
 * the filter fails CLOSED (the un-scanned rows are excluded, never leaked). */
export const MAIL_GATE_SCAN_LIMIT = 2_000;

/** No real message row matches it — the fail-closed answer. */
export const MAIL_MESSAGE_DENY_ALL: Readonly<Record<string, unknown>> = Object.freeze({ id: '__mail_message_denied__' });
/** No real association row matches it — the fail-closed answer. */
export const MAIL_ASSOCIATION_DENY_ALL: Readonly<Record<string, unknown>> = Object.freeze({ id: '__mail_association_denied__' });

const SYSTEM_CTX = { isSystem: true } as const;

/** Object machine-name shape (`ObjectSchema.name` in packages/spec). */
const OBJECT_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** The mail objects themselves: never a record a message is about, and probing
 * one would re-enter these gates. */
const MAIL_OBJECTS: ReadonlySet<string> = new Set([MAIL_MESSAGE_OBJECT, MAIL_ASSOCIATION_OBJECT, MAILBOX_OBJECT]);

/** The read seam's context, as the engine's middleware hands it. */
export interface MailReadMiddlewareCtx {
  object: string;
  operation: string;
  ast?: { where?: unknown; orderBy?: unknown } & Record<string, unknown>;
  context?: { userId?: unknown; isSystem?: boolean; systemPermissions?: unknown } & Record<string, unknown>;
}

/** The engine surface the gates use. */
export interface MailGateEngine {
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  registerMiddleware?(
    fn: (ctx: MailReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>,
    options?: { object?: string },
  ): void;
}

/** The logger surface the gates use. */
export interface MailGateLogger {
  warn(message: string): void;
}

/** Whether the caller holds `capability` in its resolved `systemPermissions`. */
function callerHolds(context: MailReadMiddlewareCtx['context'], capability: string): boolean {
  const held = context?.systemPermissions;
  return Array.isArray(held) && held.includes(capability);
}

/** A stored id as the gates compare it, or `null` when the row carries none. */
function idOf(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  return s === '' ? null : s;
}

/** The record an association row names, or `null` when it names none a gate can authorize. */
export function parseAssociatedRecord(
  row: Record<string, unknown> | null | undefined,
): { object: string; recordId: string } | null {
  const object = row?.object_name;
  if (typeof object !== 'string' || !OBJECT_NAME_RE.test(object) || MAIL_OBJECTS.has(object)) return null;
  const recordId = idOf(row?.record_id);
  return recordId === null ? null : { object, recordId };
}

/** AND `filter` into the read's WHERE, never replacing the caller's own. */
function andIntoWhere(ctx: MailReadMiddlewareCtx, filter: unknown): void {
  if (!ctx.ast) return;
  ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, filter] } : filter;
}

/** The rows a read would touch, pre-scanned as the system in the caller's order. */
async function preScan(
  engine: MailGateEngine,
  ctx: MailReadMiddlewareCtx,
  fields: string[],
  logger: MailGateLogger,
  seam: string,
): Promise<Array<Record<string, unknown>>> {
  const orderBy = ctx.ast?.orderBy;
  const rows = await engine.find(ctx.object, {
    where: (ctx.ast?.where as Record<string, unknown>) ?? {},
    fields,
    ...(Array.isArray(orderBy) && orderBy.length > 0 ? { orderBy } : {}),
    limit: MAIL_GATE_SCAN_LIMIT,
    context: { ...SYSTEM_CTX },
  });
  if (rows.length >= MAIL_GATE_SCAN_LIMIT) {
    logger.warn(
      `[mailbox] ${seam}: candidate pre-scan hit the ${MAIL_GATE_SCAN_LIMIT}-row cap; the visibility filter for ` +
        'this broad read is fail-closed and may omit visible rows — scope the query (by mailbox, or by record)',
    );
  }
  return rows;
}

/**
 * Of these association rows, the ones naming a record the caller can read —
 * one caller-scoped read per record object.
 */
async function readableAssociations(
  engine: MailGateEngine,
  callerContext: Record<string, unknown> | undefined,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const idsByObject = new Map<string, Set<string>>();
  for (const row of rows) {
    const parent = parseAssociatedRecord(row);
    if (!parent) continue;
    let ids = idsByObject.get(parent.object);
    if (!ids) idsByObject.set(parent.object, (ids = new Set()));
    ids.add(parent.recordId);
  }
  if (idsByObject.size === 0) return [];
  const readable = await resolveReadableParentIds(engine, callerContext, idsByObject);
  return rows.filter((row) => {
    const parent = parseAssociatedRecord(row);
    return parent !== null && readable.get(parent.object)?.has(parent.recordId) === true;
  });
}

/**
 * The visibility WHERE for one read of `sys_mail_association`: `null` when the
 * caller holds the exemption or the query matches no rows, one `$in` branch per
 * record object holding the readable record ids, or the deny-all sentinel.
 */
export async function computeMailAssociationFilter(
  engine: MailGateEngine,
  ctx: MailReadMiddlewareCtx,
  logger: MailGateLogger,
): Promise<unknown | null> {
  if (callerHolds(ctx.context, MAILBOX_ADMIN_CAPABILITY)) return null;
  const candidates = await preScan(engine, ctx, ['object_name', 'record_id'], logger, 'mail association read visibility');
  if (!candidates.length) return null;
  const kept = await readableAssociations(engine, ctx.context, candidates);
  // record object → the stored record ids kept, so the emitted filter can only
  // match rows the pre-scan saw spelled that way.
  const byObject = new Map<string, unknown[]>();
  for (const row of kept) {
    const object = row.object_name as string;
    let ids = byObject.get(object);
    if (!ids) byObject.set(object, (ids = []));
    if (!ids.includes(row.record_id)) ids.push(row.record_id);
  }
  if (byObject.size === 0) return MAIL_ASSOCIATION_DENY_ALL;
  const branches = [...byObject].map(([object, ids]) => ({ object_name: object, record_id: { $in: ids } }));
  return branches.length === 1 ? branches[0] : { $or: branches };
}

/**
 * The visibility WHERE for one read of `sys_mail_message`: `null` when the
 * caller holds the exemption or the query matches no rows, an `id` `$in` of
 * the messages the caller may read (its own mailboxes' messages and those
 * associated with a record it can read), or the deny-all sentinel.
 */
export async function computeMailMessageFilter(
  engine: MailGateEngine,
  ctx: MailReadMiddlewareCtx,
  logger: MailGateLogger,
): Promise<unknown | null> {
  if (callerHolds(ctx.context, MAILBOX_ADMIN_CAPABILITY)) return null;
  const candidates = await preScan(engine, ctx, ['id', 'mailbox_id'], logger, 'mail message read visibility');
  if (!candidates.length) return null;

  /** message id as compared → the id as STORED, for every candidate. */
  const stored = new Map<string, unknown>();
  for (const row of candidates) {
    const id = idOf(row.id);
    if (id !== null && !stored.has(id)) stored.set(id, row.id);
  }
  const visible = new Set<string>();

  // 1. The owner limb: the caller's own mailboxes, read as the system (the
  //    directory is served only to administrators).
  const userId = idOf(ctx.context?.userId);
  if (userId !== null) {
    const mailboxIds = [...new Set(candidates.map((r) => idOf(r.mailbox_id)).filter((v): v is string => v !== null))];
    if (mailboxIds.length) {
      const owned = await engine.find(MAILBOX_OBJECT, {
        where: { id: { $in: mailboxIds }, owner_user_id: userId },
        fields: ['id'],
        limit: mailboxIds.length,
        context: { ...SYSTEM_CTX },
      });
      const ownedIds = new Set(owned.map((r) => idOf(r.id)).filter((v): v is string => v !== null));
      for (const row of candidates) {
        const id = idOf(row.id);
        const mailbox = idOf(row.mailbox_id);
        if (id !== null && mailbox !== null && ownedIds.has(mailbox)) visible.add(id);
      }
    }
  }

  // 2. The association limb, for the rest: a message is readable when one of
  //    its associations names a record the caller can read. A pool message has
  //    no association, so nothing here can serve it.
  const pending = [...stored.keys()].filter((id) => !visible.has(id));
  if (pending.length) {
    const associations = await engine.find(MAIL_ASSOCIATION_OBJECT, {
      where: { mail_message_id: { $in: pending } },
      fields: ['mail_message_id', 'object_name', 'record_id'],
      limit: MAIL_GATE_SCAN_LIMIT,
      context: { ...SYSTEM_CTX },
    });
    if (associations.length >= MAIL_GATE_SCAN_LIMIT) {
      logger.warn(
        `[mailbox] mail message read visibility: association pre-scan hit the ${MAIL_GATE_SCAN_LIMIT}-row cap; ` +
          'the visibility filter for this broad read is fail-closed and may omit visible messages — scope the query',
      );
    }
    for (const row of await readableAssociations(engine, ctx.context, associations)) {
      const id = idOf(row.mail_message_id);
      if (id !== null && stored.has(id)) visible.add(id);
    }
  }

  if (visible.size === 0) return MAIL_MESSAGE_DENY_ALL;
  return { id: { $in: [...visible].map((id) => stored.get(id)) } };
}

/** One gate's middleware: reads only, callers only, fail closed. */
function gateMiddleware(
  engine: MailGateEngine,
  logger: MailGateLogger,
  seam: string,
  compute: typeof computeMailMessageFilter,
  denyAll: Readonly<Record<string, unknown>>,
) {
  return async (ctx: MailReadMiddlewareCtx, next: () => Promise<void>): Promise<void> => {
    // Only reads carry an `ast` to constrain; both objects are engine-owned and
    // `apiMethods: ['get', 'list']`. System / context-less reads are internal.
    if (!MAIL_GATE_READ_OPS.has(ctx.operation) || !ctx.ast || !ctx.context || ctx.context.isSystem) {
      return next();
    }
    try {
      const filter = await compute(engine, ctx, logger);
      if (filter) andIntoWhere(ctx, filter);
    } catch (err) {
      // A filter-compute failure must never fall open into a leak.
      logger.warn(`[mailbox] ${seam}: filter failed, denying all (${(err as Error)?.message ?? err})`);
      andIntoWhere(ctx, denyAll);
    }
    return next();
  };
}

/**
 * Install both read gates. Returns `false` (and installs nothing) on an engine
 * without the middleware seam, so the caller can say so out loud.
 */
export function installMailReadVisibility(engine: MailGateEngine, logger: MailGateLogger): boolean {
  if (typeof engine.registerMiddleware !== 'function') return false;
  engine.registerMiddleware(
    gateMiddleware(engine, logger, 'mail message read visibility', computeMailMessageFilter, MAIL_MESSAGE_DENY_ALL),
    { object: MAIL_MESSAGE_OBJECT },
  );
  engine.registerMiddleware(
    gateMiddleware(engine, logger, 'mail association read visibility', computeMailAssociationFilter, MAIL_ASSOCIATION_DENY_ALL),
    { object: MAIL_ASSOCIATION_OBJECT },
  );
  return true;
}
