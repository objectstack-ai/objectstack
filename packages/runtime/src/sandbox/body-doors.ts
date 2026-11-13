// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two platform doors a sandboxed script body reaches: `ctx.email.send`
 * (capability `email.send`) hands a message to the mail service, and
 * `ctx.activity.append` (capability `activity.append`) adds one entry to a
 * record's activity timeline. A body asks for each by its token; the sandbox
 * (`quickjs-runner.ts`) refuses a call whose token the body did not declare,
 * and calls the host seam built here for one that it did.
 *
 * What a body says is parsed against the door's spec schema
 * (`BodyMailSendInputSchema`, `BodyActivityAppendInputSchema`,
 * `@objectstack/spec/data`); a key outside it is refused, never dropped. What
 * the platform says is stamped here from the HOST's view of the call, never
 * from the body's copy of `ctx.user` (a JSON copy the body can change):
 *
 *  - the calling user and organization ({@link BodyDoorCaller}), resolved by
 *    the body runner from the engine's context for the hook, the action door's
 *    caller envelope, or a job's declared organization;
 *  - the origin, `<package>/<kind>:<name>` of the body.
 *
 * Every record a body points at (the mail's `related` record, the timeline
 * entry's record and its `source`) is read in the CALLER's scope before the
 * door acts, and one the caller cannot read is answered as one that does not
 * exist.
 *
 * Mail: the bounds both mail doors share (`boundCallerMail`,
 * `@objectstack/core`) stamp the sending user and the organization; the
 * sender is the configured address, with a display name naming the calling
 * user beside the organization; at most `BODY_MAIL_RECIPIENT_LIMIT` recipients
 * per message across `to`, `cc` and `bcc` (each slot by the schema, the sum
 * here), each slot and a `replyTo` within what the mail log's columns hold as
 * recorded; no send while the organization's mail log already records
 * {@link appMailHourlyLimit} messages in the last hour; and no send at all
 * unless the mail log records it (`requireLogRow`). The hourly count is read
 * before the send and is not held across it, so callers racing the last free
 * slot can each pass it: the limit bounds a body's volume, not an exact count.
 *
 * Timeline: the entry is written by the activity feed's owner
 * (`appendAppActivity` on the `audit` service, `@objectstack/plugin-audit`),
 * which holds the ledger's own rules (no platform-only type or metadata key,
 * no excluded or append-only object) and writes the row as the platform.
 */

import {
  BODY_ACTIVITY_METADATA_LIMIT,
  BODY_MAIL_ADDRESS_LIMIT,
  BODY_MAIL_ADDRESS_LIST_LIMIT,
  BODY_MAIL_RECIPIENT_LIMIT,
  BodyActivityAppendInputSchema,
  BodyMailSendInputSchema,
  type BodyActivityAppendInput,
  type BodyMailSendInput,
} from '@objectstack/spec/data';
import type { EmailAddress, IEmailService, SendEmailInput } from '@objectstack/spec/contracts';
import { APP_AUTOMATION_ELEVATION, boundCallerMail, mailAddressOf } from '@objectstack/core';

/** Who is calling, as the host resolved it for one body invocation. */
export interface BodyDoorCaller {
  /** The calling user, or `undefined` for a body with none (a scheduled job). */
  userId: string | undefined;
  /** The caller's active organization, or `undefined` when it has none. */
  organizationId: string | undefined;
  /** The execution context a record the body points at is read in: the caller's own. */
  readContext?: Record<string | symbol, unknown>;
  /**
   * Read one record in the caller's own scope, answering the row or nothing.
   * Where the host holds the caller's scope as an api rather than a context
   * (a hook: `body-runner.ts`), it reads through this, and `readContext` is
   * not read.
   */
  readRecord?: (object: string, id: string) => Promise<unknown>;
}

/** What the body runner hands {@link buildBodyDoors} for one invocation. */
export interface BodyDoorOptions {
  ql: any;
  /** Kernel service lookup, read at call time; `undefined` when the runner was built without one. */
  getService?: (name: string) => unknown;
  /** The package the body belongs to — the first part of the origin. */
  packageId: string;
  origin: { kind: 'hook' | 'action' | 'job'; name: string };
  caller: BodyDoorCaller;
}

/** The host seams installed on the body's `ctx`. */
export interface BodyDoors {
  email: { send(input: unknown): Promise<{ id: string; status: string }> };
  activity: { append(input: unknown): Promise<{ id: string }> };
}

/** Default for {@link appMailHourlyLimit}. */
export const DEFAULT_APP_MAIL_HOURLY_LIMIT = 200;

/**
 * The most messages an organization's mail log may record in one hour before
 * `ctx.email.send` refuses another: `OS_EMAIL_APP_SEND_HOURLY_LIMIT`, else
 * {@link DEFAULT_APP_MAIL_HOURLY_LIMIT}. Counted on the mail log, so every
 * node of a cluster sees the same count.
 */
export function appMailHourlyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OS_EMAIL_APP_SEND_HOURLY_LIMIT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_APP_MAIL_HOURLY_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `OS_EMAIL_APP_SEND_HOURLY_LIMIT must be a whole number of messages, 0 or more; it is '${raw}'.`,
    );
  }
  return n;
}

type DoorCode = 'VALIDATION_ERROR' | 'RECORD_NOT_FOUND' | 'RATE_LIMIT_EXCEEDED' | 'NOT_IMPLEMENTED' | 'PERMISSION_DENIED';
const STATUS: Record<DoorCode, number> = {
  VALIDATION_ERROR: 400,
  PERMISSION_DENIED: 403,
  RECORD_NOT_FOUND: 404,
  RATE_LIMIT_EXCEEDED: 429,
  NOT_IMPLEMENTED: 501,
};

function doorError(code: DoorCode, message: string): Error {
  return Object.assign(new Error(message), { code, status: STATUS[code], statusCode: STATUS[code] });
}

/** Parse a body's input, or throw the door's `VALIDATION_ERROR` naming each problem. */
function parseInput<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } },
  input: unknown,
  door: string,
): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.map(String).join('.') + ': ' : ''}${i.message}`);
  throw doorError('VALIDATION_ERROR', `${door} was called with input it does not take: ${lines.join('; ')}`);
}

/** The number of addresses one recipient slot names. */
function recipientCount(value: unknown): number {
  if (value === undefined) return 0;
  return Array.isArray(value) ? value.length : 1;
}

/**
 * The characters one address takes as the mail log records it: the bare
 * address, or `"Name" <address>` with each `"` in the name escaped. Read the
 * way {@link BodyMailSendInputSchema}'s description states the limits, with
 * every display name counted as quoted.
 */
function recordedAddressLength(value: unknown): number {
  if (typeof value === 'string') return value.trim().length;
  const { name, address } = value as { name?: string; address: string };
  const shown = name?.trim() ?? '';
  const bare = address.trim().length;
  return shown.length === 0 ? bare : shown.length + (shown.match(/"/g)?.length ?? 0) + 5 + bare;
}

/** The characters one recipient slot takes as recorded: its addresses joined by `", "`. */
function recordedSlotLength(value: unknown): number {
  if (value === undefined) return 0;
  const list = Array.isArray(value) ? value : [value];
  return list.reduce((sum: number, a) => sum + recordedAddressLength(a), 0) + 2 * Math.max(0, list.length - 1);
}

/** Refuse a message whose slots, as recorded, exceed what the mail log's columns hold. */
function refuseOverRecordedLimits(message: BodyMailSendInput): void {
  const recipients = recipientCount(message.to) + recipientCount(message.cc) + recipientCount(message.bcc);
  if (recipients > BODY_MAIL_RECIPIENT_LIMIT) {
    throw doorError(
      'VALIDATION_ERROR',
      `ctx.email.send: a message may name at most ${BODY_MAIL_RECIPIENT_LIMIT} recipients across \`to\`, \`cc\` and \`bcc\`; this one names ${recipients}. Send it in smaller messages.`,
    );
  }
  for (const slot of ['to', 'cc', 'bcc'] as const) {
    const length = recordedSlotLength(message[slot]);
    if (length > BODY_MAIL_ADDRESS_LIST_LIMIT) {
      throw doorError(
        'VALIDATION_ERROR',
        `ctx.email.send: \`${slot}\` takes ${length} characters as the mail log records it ("Name" <address>, joined by ", "), ` +
          `over the ${BODY_MAIL_ADDRESS_LIST_LIMIT} it holds. Send it in smaller messages.`,
      );
    }
  }
  if (message.replyTo !== undefined) {
    const length = recordedAddressLength(message.replyTo);
    if (length > BODY_MAIL_ADDRESS_LIMIT) {
      throw doorError(
        'VALIDATION_ERROR',
        `ctx.email.send: \`replyTo\` takes ${length} characters as the mail log records it ("Name" <address>), over the ${BODY_MAIL_ADDRESS_LIMIT} it holds.`,
      );
    }
  }
}

/**
 * The caller's read scope: the context with the body's elevation taken off.
 * An action body's engine context is the caller's envelope elevated
 * (`buildActionExecutionContext`); this hands back the envelope. No context is
 * a scope with no principal.
 */
export function callerScopeOf(context: Record<string | symbol, unknown> | undefined): Record<string | symbol, unknown> {
  if (!context || typeof context !== 'object') return {};
  const out: Record<string | symbol, unknown> = { ...context };
  if (out[APP_AUTOMATION_ELEVATION] !== undefined) {
    delete out[APP_AUTOMATION_ELEVATION];
    delete out.isSystem;
  }
  return out;
}

/** Answer whether `object`/`id` is a record the caller can read. Never throws. */
async function readableByCaller(ql: any, object: string, id: string, caller: BodyDoorCaller): Promise<boolean> {
  try {
    let row: any;
    if (caller.readRecord) row = await caller.readRecord(object, id);
    else if (caller.readContext && ql && typeof ql.findOne === 'function') {
      row = await ql.findOne(object, { where: { id }, fields: ['id'] }, { context: caller.readContext });
    } else return false;
    return row != null && String(row.id) === id;
  } catch {
    return false;
  }
}

async function requireReadable(ql: any, ref: { object: string; id: string }, caller: BodyDoorCaller, door: string): Promise<void> {
  if (await readableByCaller(ql, ref.object, ref.id, caller)) return;
  throw doorError(
    'RECORD_NOT_FOUND',
    `${door}: no '${ref.object}' record '${ref.id}' that this caller can read. The door acts only on a record the caller can read.`,
  );
}

function service<T>(getService: BodyDoorOptions['getService'], name: string): T | undefined {
  if (!getService) return undefined;
  try {
    return (getService(name) as T) ?? undefined;
  } catch {
    return undefined;
  }
}

/** A display-name fragment safe for a header: one line, no quotes or angle brackets. */
function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 120) : undefined;
}

async function nameOf(ql: any, object: string, id: string | undefined): Promise<string | undefined> {
  if (!id || !ql || typeof ql.findOne !== 'function') return undefined;
  try {
    const row = await ql.findOne(object, { where: { id }, fields: ['id', 'name'] }, { context: { isSystem: true } });
    return displayText(row?.name);
  } catch {
    return undefined;
  }
}

/**
 * The sender of a body's message: the configured address, with a display name
 * naming the calling user beside the organization (「Ann Lee via Acme」).
 * `undefined` when the deployment reports no configured sender, which the
 * mail service then answers as it answers any send without one.
 */
async function senderFor(ql: any, email: IEmailService, caller: BodyDoorCaller): Promise<EmailAddress | undefined> {
  const configured = typeof email.getDefaultFrom === 'function' ? email.getDefaultFrom() : undefined;
  const address = mailAddressOf(configured);
  if (!address) return undefined;
  const configuredName = typeof configured === 'object' && configured ? displayText(configured.name) : undefined;
  const [userName, orgName] = await Promise.all([
    nameOf(ql, 'sys_user', caller.userId),
    nameOf(ql, 'sys_organization', caller.organizationId),
  ]);
  const base = orgName ?? configuredName;
  const name = fitSenderName(userName ? (base ? `${userName} via ${base}` : userName) : configuredName, address);
  return name ? { name, address } : { address };
}

/**
 * A sender display name cut so `"Name" <address>` fits the mail log's sender
 * column ({@link BODY_MAIL_ADDRESS_LIMIT}); none when the address leaves no room.
 */
function fitSenderName(name: string | undefined, address: string): string | undefined {
  if (!name) return undefined;
  const room = BODY_MAIL_ADDRESS_LIMIT - address.length - 5;
  if (room < 1) return undefined;
  const cut = name.slice(0, room).trim();
  return cut.length > 0 ? cut : undefined;
}

/**
 * Refuse a send while the mail log already records the hourly limit: the
 * caller's organization's messages, or, for a caller with no organization,
 * the whole log's. Read before the send, not held across it (see the module
 * docblock).
 */
async function refuseOverHourlyLimit(ql: any, caller: BodyDoorCaller): Promise<void> {
  const limit = appMailHourlyLimit();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const where: Record<string, unknown> = {
    created_at: { $gte: since },
    ...(caller.organizationId ? { organization_id: caller.organizationId } : {}),
  };
  if (!ql || typeof ql.count !== 'function') {
    throw doorError('NOT_IMPLEMENTED', 'ctx.email.send: the mail log cannot be counted here, so the hourly limit cannot be held.');
  }
  const sent = await ql.count('sys_email', { where }, { context: { isSystem: true } });
  if (typeof sent === 'number' && sent >= limit) {
    const counted = caller.organizationId
      ? "this organization's mail log records"
      : 'with no organization to count by, the whole mail log records';
    throw doorError(
      'RATE_LIMIT_EXCEEDED',
      `ctx.email.send: ${counted} ${sent} messages in the last hour, at the limit of ${limit}. ` +
        'Try again later; an operator raises the limit with OS_EMAIL_APP_SEND_HOURLY_LIMIT.',
    );
  }
}

/** Build the two door seams for one body invocation. */
export function buildBodyDoors(opts: BodyDoorOptions): BodyDoors {
  const { ql, getService, caller } = opts;
  const origin = `${opts.packageId}/${opts.origin.kind}:${opts.origin.name}`;

  return {
    email: {
      async send(input: unknown) {
        const message = parseInput<BodyMailSendInput>(BodyMailSendInputSchema as any, input, 'ctx.email.send');
        refuseOverRecordedLimits(message);
        const email = service<IEmailService>(getService, 'email');
        if (!email || typeof email.send !== 'function') {
          throw doorError('NOT_IMPLEMENTED', 'ctx.email.send: this deployment has no mail service.');
        }
        if (message.related) await requireReadable(ql, message.related, caller, 'ctx.email.send');
        await refuseOverHourlyLimit(ql, caller);

        const { related, ...rest } = message;
        const bounded = boundCallerMail(rest as Record<string, unknown>, caller, email);
        if (!bounded.ok) throw doorError('PERMISSION_DENIED', `ctx.email.send: ${bounded.reason}`);
        const from = await senderFor(ql, email, caller);
        const sendInput = {
          ...bounded.input,
          ...(related ? { relatedObject: related.object, relatedId: related.id } : {}),
          ...(from ? { from } : {}),
          requireLogRow: true,
        } as SendEmailInput;
        const result = await email.send(sendInput);
        return { id: String(result?.id ?? ''), status: String(result?.status ?? '') };
      },
    },
    activity: {
      async append(input: unknown) {
        const entry = parseInput<BodyActivityAppendInput>(
          BodyActivityAppendInputSchema as any,
          input,
          'ctx.activity.append',
        );
        if (entry.metadata !== undefined) {
          const size = JSON.stringify(entry.metadata)?.length ?? 0;
          if (size > BODY_ACTIVITY_METADATA_LIMIT) {
            throw doorError(
              'VALIDATION_ERROR',
              `ctx.activity.append: \`metadata\` takes ${size} characters as JSON, over the ${BODY_ACTIVITY_METADATA_LIMIT} an entry holds.`,
            );
          }
        }
        const audit = service<{ appendAppActivity?: (e: unknown, s: unknown) => Promise<{ id: string }> }>(getService, 'audit');
        if (!audit || typeof audit.appendAppActivity !== 'function') {
          throw doorError('NOT_IMPLEMENTED', 'ctx.activity.append: this deployment has no activity feed.');
        }
        await requireReadable(ql, { object: entry.object, id: entry.recordId }, caller, 'ctx.activity.append');
        if (entry.source) await requireReadable(ql, entry.source, caller, 'ctx.activity.append');
        return audit.appendAppActivity(entry, {
          actorId: caller.userId,
          organizationId: caller.organizationId,
          origin,
        });
      },
    },
  };
}
