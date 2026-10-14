// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ingest seam: one raw RFC 822 message into one mailbox becomes one
 * `sys_mail_message` row and its `sys_mail_association` links — and the
 * explicit re-match that adds the links a later record makes possible.
 *
 * Decisions this module carries out (design record on #8998, ruling 6116489638
 * on #22870):
 *
 *  - **Mirror, not adopt** (decision 1). The row holds what the message says:
 *    participants, threading ids, subject, the text and HTML bodies as sent.
 *  - **Associated at ingest, re-matched explicitly** (decision 2). The matcher
 *    ({@link MailRecordMatcher}) runs once, at ingest, over the participant set,
 *    and the set is stored on the row (`match_addresses`, with each address's
 *    source), so {@link MailIngestService.rematch} replays exactly that input.
 *    Re-match only ADDS links (Q5 A): a link is a recorded fact, never
 *    silently withdrawn.
 *  - **Unmatched mail waits in the pool** (decision 3): a message no record
 *    matches is stored `association_state: 'unassociated'`, never dropped. The
 *    read gates keep the pool to the mailbox's owner and `manage_mailboxes`
 *    holders (`mail-read-visibility.ts`).
 *  - **Forward as attachment is read** (Q3 C, phase 1): the headers of a
 *    `message/rfc822` or `message/global` part are participants too, under
 *    source `attachment`.
 *  - **Forward quoted inline is read, for an organization user's forward
 *    only** (Q3 C, the staged half): the "Forwarded message" block Gmail,
 *    Outlook or Apple Mail writes into the text/plain body
 *    (`inline-forward.ts`) names participants under source `inline` — when
 *    the message's From is a user who is a member of the mailbox's
 *    organization (D5: forwarding is consent). A block the parser does not
 *    recognise is not guessed at, and a forward from anyone else is not read:
 *    the message is matched on its other participants, which may pool it.
 *
 * ## Writes, in order
 *
 * 1. the message row, `unassociated`;
 * 2. one link per matched record (`matched_by: 'ingest'`);
 * 3. `association_state: 'associated'`, once its links exist.
 *
 * A failure between them leaves the message in the pool with the links that
 * landed — visible to the mailbox's owner and administrators — and a re-match
 * completes it. The failure itself reaches the caller.
 *
 * Every write is a system write that carries the mailbox's organization
 * (ADR-0131 D9), and every match is read inside it — the organization-user
 * door too: a membership in another organization does not open it.
 *
 * ## Who may call
 *
 *  - `ingest`: system context only. A message enters a mailbox from its mail
 *    source; a user who could hand the seam a message could put words in a
 *    correspondent's mouth on every record that correspondent matches.
 *  - `rematch`: system context, or a caller in the mailbox's organization who
 *    holds `manage_mailboxes` or owns the mailbox — the same people the pool's
 *    read gate serves (Q4 A). A mailbox in another organization is not found.
 */

import { keysetWalk } from '@objectstack/types';
import {
  MAILBOX_ADMIN_CAPABILITY,
  MAILBOX_OBJECT,
  MAIL_ASSOCIATION_OBJECT,
  MAIL_MESSAGE_OBJECT,
} from '../mail-read-visibility.js';
import { dedupeKeyOf } from './dedupe-key.js';
import { parseInlineForward } from './inline-forward.js';
import {
  collectMatchAddresses,
  normalizeMailAddress,
  parseMatchAddresses,
  serializeMatchAddresses,
  type MailMatchAddress,
} from './match-addresses.js';
import {
  MailRecordMatcher,
  linksFor,
  type MailAssociationMatch,
  type MailMatchEngine,
} from './match-records.js';
import {
  parseInboundMessage,
  participantAddresses,
  type MailParticipantHeaders,
  type ParsedInboundMessage,
  type RawMailMessage,
} from './parse-message.js';
import { suppressionReasonOf, type MailSuppressionReason } from './suppression.js';

/** The kernel service name the mailbox plugin registers {@link MailIngestService} under. */
export const MAILBOX_SERVICE = 'mailbox';

/** The engine surface the seam reads and writes through. */
export interface MailIngestEngine extends MailMatchEngine {
  insert(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/** The logger surface the seam reports through. */
export interface MailIngestLogger {
  warn(message: string): void;
}

/**
 * The caller of an entry point, as the request's execution context carries
 * it: `isSystem`, the user, the active organization (`tenantId`) and the
 * resolved capability set (`systemPermissions`).
 */
export interface MailboxCallerContext {
  isSystem?: boolean;
  userId?: unknown;
  tenantId?: unknown;
  systemPermissions?: unknown;
}

/** One message handed to the seam. */
export interface MailIngestInput {
  /** The `sys_mailbox` the message arrived in. */
  mailboxId: string;
  /** The message as received (RFC 822 / RFC 5322). */
  raw: RawMailMessage;
  /**
   * When the mailbox received it (the IMAP INTERNALDATE, RFC 3501), as an ISO
   * timestamp or a `Date`. Absent: the time of the ingest.
   */
  receivedAt?: string | Date;
}

/** What one ingest did. */
export type MailIngestResult =
  | {
      outcome: 'stored';
      /** The new `sys_mail_message` row. */
      messageId: string;
      associationState: 'associated' | 'unassociated';
      /** One per `sys_mail_association` row written; empty for a pool message. */
      associations: MailAssociationMatch[];
    }
  | {
      /** The mailbox already holds this message (same dedupe key); nothing was written. */
      outcome: 'duplicate';
      messageId: string;
    }
  | {
      /** An auto-reply or a bounce: nothing was written. */
      outcome: 'suppressed';
      reason: MailSuppressionReason;
    };

/** What to re-match. */
export interface MailRematchInput {
  mailboxId: string;
  /** Only these messages of the mailbox. Absent: every message of the mailbox. */
  messageIds?: string[];
}

/** What one re-match did. */
export interface MailRematchResult {
  /** Messages read. */
  scanned: number;
  /** Links added (`matched_by: 'rematch'`). */
  linksAdded: number;
  /** Messages that left the pool (`unassociated` → `associated`). */
  associated: number;
  /** Messages whose stored `match_addresses` is not the stored shape: not matched, never guessed. */
  unreadable: string[];
}

/** The refusal codes the entry points answer with (ADR-0112 standard members). */
export type MailboxServiceErrorCode = 'PERMISSION_DENIED' | 'RECORD_NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR';

const STATUS_OF: Record<MailboxServiceErrorCode, number> = {
  PERMISSION_DENIED: 403,
  RECORD_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
};

/** A refusal of an entry point, carrying its ADR-0112 `code` and HTTP `status`. */
export class MailboxServiceError extends Error {
  readonly status: number;
  readonly statusCode: number;
  constructor(readonly code: MailboxServiceErrorCode, message: string) {
    super(message);
    this.name = 'MailboxServiceError';
    this.status = STATUS_OF[code];
    this.statusCode = this.status;
  }
}

/** Messages read per re-match page. */
export const REMATCH_PAGE_SIZE = 200;
/** Existing links read per re-match page. */
export const REMATCH_LINK_SCAN_LIMIT = 5_000;
/**
 * `sys_user` rows read to recognise one inline forward's sender: those whose
 * email contains the sender's address. Beyond it the read may miss the user,
 * and is said so.
 */
export const SENDER_USER_SCAN_LIMIT = 100;

/** The identity objects the organization-user door reads (registered by the auth plugin). */
const USER_OBJECT = 'sys_user';
const MEMBER_OBJECT = 'sys_member';

const SYSTEM_CTX = { isSystem: true } as const;
const DUPLICATE_RECORD = 'DUPLICATE_RECORD';

/** Display-column bounds (`sys_mail_message`'s declared `maxLength`s). */
const BOUND = {
  message_id: 998,
  subject: 998,
  from_address: 320,
  from_name: 255,
  sender_address: 320,
  reply_to: 4000,
  to_addresses: 4000,
  cc_addresses: 4000,
} as const;

interface MailboxRow {
  id: string;
  address: string | null;
  ownerUserId: string | null;
  organizationId: string | null;
}

const idOf = (value: unknown): string | null =>
  (typeof value === 'string' && value !== '') || typeof value === 'number' ? String(value) : null;

/** U+0000 never reaches a text column (a SQL text type refuses it). */
const storable = (value: string): string => value.replace(/\u0000/g, '');

/** `value` cut to `max` UTF-16 units, never inside a surrogate pair. */
function fit(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const clean = storable(value);
  if (clean.length <= max) return clean;
  let end = max;
  const last = clean.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return clean.slice(0, end);
}

/** Addresses joined with `, `, whole addresses only, within `max`. */
function joinAddresses(addresses: ReadonlyArray<string>, max: number): string | null {
  let out = '';
  for (const raw of addresses) {
    const address = storable(raw);
    const next = out ? `${out}, ${address}` : address;
    if (next.length > max) break;
    out = next;
  }
  return out === '' ? null : out;
}

function isoOrNull(value: string | Date | undefined): string | null {
  if (value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function isDuplicateRecord(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DUPLICATE_RECORD;
}

function distinctAddresses(addresses: ReadonlyArray<MailMatchAddress>): string[] {
  return [...new Set(addresses.map((a) => a.address))];
}

/**
 * The ingest seam and the re-match action. The engine is resolved on each
 * call, never cached at construction, so a plugin may build this before the
 * engine's own registration completes.
 */
export class MailIngestService {
  private readonly matcher: MailRecordMatcher;
  /** Whether the absence of the identity objects the door reads has been said. */
  private reportedNoIdentityObjects = false;

  constructor(
    private readonly options: {
      /** The data engine (`objectql`), resolved per call. */
      engine: () => MailIngestEngine;
      logger: MailIngestLogger;
      /** The ingest clock, for a message with no `receivedAt`. */
      now?: () => Date;
    },
  ) {
    this.matcher = new MailRecordMatcher(options.engine, options.logger);
  }

  /**
   * Ingest one raw message into one mailbox: suppress it, find it already
   * stored, or store it with its associations. System context only.
   */
  async ingest(input: MailIngestInput, context: MailboxCallerContext): Promise<MailIngestResult> {
    if (context?.isSystem !== true) {
      throw new MailboxServiceError(
        'PERMISSION_DENIED',
        'Ingesting mail requires the system context: a message enters a mailbox from its mail source, never ' +
          "from a user, because an ingested message is shown on every record its correspondents' addresses match.",
      );
    }
    if (typeof input?.mailboxId !== 'string' || input.mailboxId === '') {
      throw new MailboxServiceError('VALIDATION_ERROR', 'Ingesting mail requires the id of the mailbox it arrived in.');
    }
    const receivedAt = input.receivedAt === undefined ? (this.options.now?.() ?? new Date()).toISOString() : isoOrNull(input.receivedAt);
    if (receivedAt === null) {
      throw new MailboxServiceError('VALIDATION_ERROR', '`receivedAt` must be a valid timestamp or Date when it is given.');
    }

    const engine: MailIngestEngine = this.options.engine();
    const mailbox = await this.mailbox(engine, input.mailboxId);
    const organizationId = this.organizationOf(mailbox);

    let parsed;
    try {
      parsed = await parseInboundMessage(input.raw);
    } catch (err) {
      throw new MailboxServiceError(
        'VALIDATION_ERROR',
        `The message for mailbox '${mailbox.id}' could not be read as an RFC 822 message: ${(err as Error)?.message ?? err}`,
      );
    }
    if (parsed.unreadForwardedParts > 0) {
      this.options.logger.warn(
        `[mailbox] a message for mailbox '${mailbox.id}' carries ${parsed.unreadForwardedParts} forwarded part(s) that ` +
          'could not be read; their addresses take no part in matching, and the message is stored without them.',
      );
    }

    const reason = suppressionReasonOf(parsed);
    if (reason !== null) return { outcome: 'suppressed', reason };

    const dedupeKey = await dedupeKeyOf(parsed);
    const existing = await this.storedId(engine, mailbox.id, dedupeKey);
    if (existing !== null) return { outcome: 'duplicate', messageId: existing };

    const inline = await this.inlineForwardOf(engine, organizationId, mailbox.id, parsed);
    const matchAddresses = collectMatchAddresses(
      [
        { source: 'outer', addresses: participantAddresses(parsed.outer) },
        ...parsed.forwarded.map((part) => ({ source: 'attachment' as const, addresses: participantAddresses(part) })),
        ...(inline === null ? [] : [{ source: 'inline' as const, addresses: participantAddresses(inline) }]),
      ],
      mailbox.address ? [mailbox.address] : [],
    );
    const addresses = distinctAddresses(matchAddresses);
    const links = linksFor(addresses, await this.matcher.match(organizationId, addresses));

    const outer = parsed.outer;
    const row: Record<string, unknown> = {
      organization_id: organizationId,
      mailbox_id: mailbox.id,
      message_id: fit(parsed.messageId, BOUND.message_id),
      in_reply_to: parsed.inReplyTo.length ? storable(parsed.inReplyTo.join(' ')) : null,
      reference_ids: parsed.references.length ? storable(parsed.references.join(' ')) : null,
      subject: fit(parsed.subject, BOUND.subject),
      from_address: fit(outer.from[0], BOUND.from_address),
      from_name: fit(parsed.fromName, BOUND.from_name),
      sender_address: fit(outer.sender[0], BOUND.sender_address),
      reply_to: joinAddresses(outer.replyTo, BOUND.reply_to),
      to_addresses: joinAddresses(outer.to, BOUND.to_addresses),
      cc_addresses: joinAddresses(outer.cc, BOUND.cc_addresses),
      sent_at: parsed.sentAt,
      received_at: receivedAt,
      body_text: parsed.text === null ? null : storable(parsed.text),
      body_html: parsed.html === null ? null : storable(parsed.html),
      match_addresses: serializeMatchAddresses(matchAddresses),
      association_state: 'unassociated',
      dedupe_key: dedupeKey,
    };

    let messageId: string | null;
    try {
      messageId = idOf(((await engine.insert(MAIL_MESSAGE_OBJECT, row, { context: { ...SYSTEM_CTX } })) as { id?: unknown })?.id);
    } catch (err) {
      // A concurrent ingest of the same message won the unique key: the
      // message is stored once, which is the outcome this call wanted.
      if (isDuplicateRecord(err)) {
        const winner = await this.storedId(engine, mailbox.id, dedupeKey);
        if (winner !== null) return { outcome: 'duplicate', messageId: winner };
      }
      throw err;
    }
    if (messageId === null) {
      throw new MailboxServiceError('INTERNAL_ERROR', `The engine stored a message for mailbox '${mailbox.id}' but returned no id.`);
    }
    if (links.length === 0) return { outcome: 'stored', messageId, associationState: 'unassociated', associations: [] };

    for (const link of links) await this.link(engine, organizationId, messageId, link, 'ingest');
    await this.markAssociated(engine, messageId);
    return { outcome: 'stored', messageId, associationState: 'associated', associations: links };
  }

  /**
   * Re-match a mailbox's messages: replay each one's stored `match_addresses`
   * against the records that exist now and add the links that are missing.
   * Additive only. System context, or a `manage_mailboxes` holder or the
   * mailbox's owner in its organization.
   */
  async rematch(input: MailRematchInput, context: MailboxCallerContext): Promise<MailRematchResult> {
    if (typeof input?.mailboxId !== 'string' || input.mailboxId === '') {
      throw new MailboxServiceError('VALIDATION_ERROR', 'A re-match requires the id of the mailbox to re-match.');
    }
    const only = input.messageIds;
    if (only !== undefined && (!Array.isArray(only) || only.some((id) => typeof id !== 'string' || id === ''))) {
      throw new MailboxServiceError('VALIDATION_ERROR', '`messageIds` must be a list of message ids when it is given.');
    }

    const engine: MailIngestEngine = this.options.engine();
    const mailbox = await this.mailbox(engine, input.mailboxId);
    this.authorizeRematch(context, mailbox);
    const organizationId = this.organizationOf(mailbox);

    const result: MailRematchResult = { scanned: 0, linksAdded: 0, associated: 0, unreadable: [] };
    if (only !== undefined && only.length === 0) return result;

    // Seek by `id`: this walk writes the rows it reads (their state), so an
    // offset would count into a set its own writes are changing.
    const walk = keysetWalk<Record<string, unknown>>(
      (query) =>
        engine.find(MAIL_MESSAGE_OBJECT, {
          ...query,
          fields: ['id', 'match_addresses', 'association_state'],
          context: { ...SYSTEM_CTX },
        }),
      {
        where: only === undefined ? { mailbox_id: mailbox.id } : { mailbox_id: mailbox.id, id: { $in: [...new Set(only)] } },
        pageSize: REMATCH_PAGE_SIZE,
      },
    );
    for await (const page of walk.pages()) await this.rematchPage(engine, organizationId, page, result);
    return result;
  }

  private async rematchPage(
    engine: MailIngestEngine,
    organizationId: string,
    page: ReadonlyArray<Record<string, unknown>>,
    result: MailRematchResult,
  ): Promise<void> {
    const messages: Array<{ id: string; addresses: string[]; state: unknown }> = [];
    for (const row of page) {
      const id = idOf(row.id);
      if (id === null) continue;
      result.scanned++;
      const stored = parseMatchAddresses(row.match_addresses);
      if (stored === null) {
        result.unreadable.push(id);
        continue;
      }
      messages.push({ id, addresses: distinctAddresses(stored), state: row.association_state });
    }
    if (messages.length === 0) return;

    const matches = await this.matcher.match(organizationId, messages.flatMap((m) => m.addresses));
    const existing = new Map<string, Set<string>>();
    const present = await engine.find(MAIL_ASSOCIATION_OBJECT, {
      where: { mail_message_id: { $in: messages.map((m) => m.id) } },
      fields: ['mail_message_id', 'object_name', 'record_id'],
      limit: REMATCH_LINK_SCAN_LIMIT,
      context: { ...SYSTEM_CTX },
    });
    if (present.length >= REMATCH_LINK_SCAN_LIMIT) {
      // Still additive and still once per record (the unique key refuses a
      // second link), but a message whose links were not read may stay
      // `unassociated` until a narrower re-match (`messageIds`) reads them.
      this.options.logger.warn(
        `[mailbox] re-match read the ${REMATCH_LINK_SCAN_LIMIT}-row bound of existing links for one page of messages; ` +
          're-match fewer messages at a time (messageIds) to read them all.',
      );
    }
    for (const link of present) {
      const messageId = idOf(link.mail_message_id);
      if (messageId === null) continue;
      let keys = existing.get(messageId);
      if (!keys) existing.set(messageId, (keys = new Set()));
      keys.add(`${String(link.object_name)} ${String(link.record_id)}`);
    }

    for (const message of messages) {
      const have = existing.get(message.id) ?? new Set<string>();
      let added = 0;
      for (const link of linksFor(message.addresses, matches)) {
        if (have.has(`${link.object} ${link.recordId}`)) continue;
        if (await this.link(engine, organizationId, message.id, link, 'rematch')) added++;
        have.add(`${link.object} ${link.recordId}`);
      }
      result.linksAdded += added;
      if (message.state !== 'associated' && have.size > 0) {
        await this.markAssociated(engine, message.id);
        result.associated++;
      }
    }
  }

  /** Write one link; `false` when the unique key says it already exists. */
  private async link(
    engine: MailIngestEngine,
    organizationId: string,
    messageId: string,
    link: MailAssociationMatch,
    matchedBy: 'ingest' | 'rematch',
  ): Promise<boolean> {
    try {
      await engine.insert(
        MAIL_ASSOCIATION_OBJECT,
        {
          organization_id: organizationId,
          mail_message_id: messageId,
          object_name: link.object,
          record_id: link.recordId,
          matched_address: link.matchedAddress,
          matched_field: link.matchedField,
          matched_by: matchedBy,
        },
        { context: { ...SYSTEM_CTX } },
      );
      return true;
    } catch (err) {
      if (isDuplicateRecord(err)) return false;
      throw err;
    }
  }

  /**
   * The participants of the forward the body quotes inline, or `null`: when
   * the body carries no block the parser recognises, or when the message was
   * not sent by a user of the mailbox's organization. The parser is pure, so
   * the door is read only for a message that carries a recognised block.
   */
  private async inlineForwardOf(
    engine: MailIngestEngine,
    organizationId: string,
    mailboxId: string,
    parsed: ParsedInboundMessage,
  ): Promise<MailParticipantHeaders | null> {
    const forward = parseInlineForward(parsed.text);
    if (forward === null) return null;
    const door = await this.sentByOrganizationUser(engine, organizationId, mailboxId, parsed.outer.from);
    return door ? forward.participants : null;
  }

  /**
   * The organization-user door of the `inline` source (ruling 6116489638 on
   * #22870, Q3 C; D5: forwarding is consent). Open when the message's From
   * names exactly one address, a `sys_user` holds that address as its email
   * (ASCII case-insensitive, decided here on the value read back, as the
   * record matcher decides it), and that user is a member (`sys_member`) of
   * the mailbox's organization. Both reads are the system's, and the
   * membership read is scoped to that one organization: a member of another
   * organization is not a user of this one.
   *
   * Closed when the identity objects are not registered (no auth plugin is
   * composed, so no sender can be recognised) — said once per instance.
   */
  private async sentByOrganizationUser(
    engine: MailIngestEngine,
    organizationId: string,
    mailboxId: string,
    from: ReadonlyArray<string>,
  ): Promise<boolean> {
    if (from.length !== 1) return false;
    const address = normalizeMailAddress(from[0]);
    if (address === null) return false;
    if (!this.identityObjectsRegistered(engine, mailboxId)) return false;

    const users = await engine.find(USER_OBJECT, {
      where: { email: { $icontains: address } },
      fields: ['id', 'email'],
      limit: SENDER_USER_SCAN_LIMIT,
      context: { ...SYSTEM_CTX },
    });
    const userIds = [
      ...new Set(
        users.filter((user) => normalizeMailAddress(user.email) === address).flatMap((user) => idOf(user.id) ?? []),
      ),
    ];
    if (userIds.length === 0) {
      if (users.length >= SENDER_USER_SCAN_LIMIT) {
        this.options.logger.warn(
          `[mailbox] recognising the sender of an inline forward in mailbox '${mailboxId}' read the ` +
            `${SENDER_USER_SCAN_LIMIT}-row bound of users whose email contains the sender's address without finding ` +
            'it, so the forward is not read and the message is matched on its other participants.',
        );
      }
      return false;
    }
    const members = await engine.find(MEMBER_OBJECT, {
      where: { $and: [{ organization_id: organizationId }, { user_id: { $in: userIds } }] },
      fields: ['id'],
      limit: 1,
      context: { ...SYSTEM_CTX },
    });
    return members.length > 0;
  }

  private identityObjectsRegistered(engine: MailIngestEngine, mailboxId: string): boolean {
    const names = new Set<string>();
    for (const schema of engine.registry?.getAllObjects?.() ?? []) {
      const name = (schema as { name?: unknown } | null)?.name;
      if (typeof name === 'string') names.add(name);
    }
    if (names.has(USER_OBJECT) && names.has(MEMBER_OBJECT)) return true;
    if (!this.reportedNoIdentityObjects) {
      this.reportedNoIdentityObjects = true;
      this.options.logger.warn(
        `[mailbox] a message for mailbox '${mailboxId}' quotes a forward inline, but the identity objects ` +
          `'${USER_OBJECT}' and '${MEMBER_OBJECT}' are not registered, so no sender can be recognised as a user of ` +
          "the mailbox's organization and no inline forward is read; such messages are matched on their other " +
          'participants. Compose the auth plugin, which registers both, to read inline forwards.',
      );
    }
    return false;
  }

  private async markAssociated(engine: MailIngestEngine, messageId: string): Promise<void> {
    await engine.update(
      MAIL_MESSAGE_OBJECT,
      { association_state: 'associated' },
      { where: { id: messageId }, context: { ...SYSTEM_CTX } },
    );
  }

  private async storedId(engine: MailIngestEngine, mailboxId: string, dedupeKey: string): Promise<string | null> {
    const [row] = await engine.find(MAIL_MESSAGE_OBJECT, {
      where: { mailbox_id: mailboxId, dedupe_key: dedupeKey },
      fields: ['id'],
      limit: 1,
      context: { ...SYSTEM_CTX },
    });
    return idOf(row?.id);
  }

  private async mailbox(engine: MailIngestEngine, mailboxId: string): Promise<MailboxRow> {
    const [row] = await engine.find(MAILBOX_OBJECT, {
      where: { id: mailboxId },
      fields: ['id', 'address', 'owner_user_id', 'organization_id'],
      limit: 1,
      context: { ...SYSTEM_CTX },
    });
    const id = idOf(row?.id);
    if (!row || id === null) throw new MailboxServiceError('RECORD_NOT_FOUND', `Mailbox '${mailboxId}' was not found.`);
    return {
      id,
      address: typeof row.address === 'string' ? row.address : null,
      ownerUserId: idOf(row.owner_user_id),
      organizationId: idOf(row.organization_id),
    };
  }

  private organizationOf(mailbox: MailboxRow): string {
    if (mailbox.organizationId === null) {
      throw new MailboxServiceError(
        'INTERNAL_ERROR',
        `Mailbox '${mailbox.id}' carries no organization, so its mail cannot be matched or stored inside one. ` +
          'Every mailbox row is written with the organization that owns it.',
      );
    }
    return mailbox.organizationId;
  }

  private authorizeRematch(context: MailboxCallerContext, mailbox: MailboxRow): void {
    if (context?.isSystem === true) return;
    const organization = idOf(context?.tenantId);
    if (organization === null || organization !== mailbox.organizationId) {
      // Another organization's mailbox does not exist for this caller.
      throw new MailboxServiceError('RECORD_NOT_FOUND', `Mailbox '${mailbox.id}' was not found.`);
    }
    const held = context?.systemPermissions;
    if (Array.isArray(held) && held.includes(MAILBOX_ADMIN_CAPABILITY)) return;
    const userId = idOf(context?.userId);
    if (userId !== null && userId === mailbox.ownerUserId) return;
    throw new MailboxServiceError(
      'PERMISSION_DENIED',
      `Re-matching mailbox '${mailbox.id}' requires the \`${MAILBOX_ADMIN_CAPABILITY}\` capability or ownership of the mailbox.`,
    );
  }
}
