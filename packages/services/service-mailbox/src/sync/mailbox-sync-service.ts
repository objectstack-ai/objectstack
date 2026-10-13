// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mailbox sync: an IMAP folder → the ingest seam, incrementally.
 *
 * For one mailbox it opens a read-only session on the mailbox's IMAP account
 * (`@objectstack/connector-imap`), reads the folder's UIDVALIDITY, fetches the
 * messages whose UID is above the stored cursor and hands each one, in UID
 * order, to {@link MailIngestService.ingest} under the system context. Dedupe,
 * threading, association, the pool and automatic-mail suppression all happen
 * there; this module adds only what an IMAP folder needs:
 *
 *  - **The cursor** (`sys_mailbox.imap_folder`, `imap_uid_validity`,
 *    `imap_last_uid`, `imap_synced_at`). A UID names the same message only
 *    while the folder's UIDVALIDITY holds (RFC 3501 §2.3.1.1), so a cursor
 *    taken under another UIDVALIDITY — or in another folder — is discarded and
 *    the folder is read from its first UID again. Nothing is duplicated by
 *    that: every message the seam already holds answers `duplicate`.
 *  - **Advance only past what was handed over.** The cursor moves after each
 *    batch to the highest UID whose message was stored, found already stored,
 *    suppressed, or deliberately skipped. A failure of the store stops the run
 *    with the cursor below the message that failed, so the next run retries it.
 *  - **Skip, loudly, what can never be stored**, so one message cannot stall a
 *    mailbox forever: a message larger than `maxMessageBytes`, and a message
 *    the seam refuses as unreadable (`VALIDATION_ERROR`). Each is logged at
 *    `error`, once, naming its UID; it stays in the IMAP folder.
 *
 * Which account feeds which mailbox, and with what credential, is the host's
 * answer ({@link MailboxAccountResolver}), asked each run: the sync keeps no
 * credential, and a mailbox the resolver does not answer for is not synced.
 *
 * Runs are bounded (`maxMessagesPerRun`) and one mailbox is never synced twice
 * at once in this process. Two processes syncing the same mailbox at once
 * waste a fetch and store nothing twice: the seam's dedupe key is unique.
 */

import {
  openImapSession,
  type ImapSession,
  type ImapSessionOptions,
  type MailAccount,
  type MailCredentialProvider,
} from '@objectstack/connector-imap';
import { keysetWalk } from '@objectstack/types';
import { MAILBOX_OBJECT } from '../mail-read-visibility.js';
import { MailboxServiceError, type MailIngestService } from '../ingest/mail-ingest-service.js';

/** The account a mailbox is synced from. */
export interface MailboxImapAccount {
  account: MailAccount;
  /** Resolves the account's credential when a session opens. */
  credentials: MailCredentialProvider;
  /** The folder to mirror. Default `INBOX`. */
  folder?: string;
}

/** The mailbox a resolver is asked about. */
export interface MailboxSyncTarget {
  id: string;
  name: string | null;
  address: string | null;
  organizationId: string;
}

/**
 * Which IMAP account feeds a mailbox. Answer `null` (or nothing) for a mailbox
 * this host does not sync. Asked once per mailbox per run.
 */
export type MailboxAccountResolver = (
  mailbox: MailboxSyncTarget,
) => MailboxImapAccount | null | undefined | Promise<MailboxImapAccount | null | undefined>;

/** Why a message was not stored, and the cursor moved past it anyway. */
export type MailboxSyncSkipReason = 'too_large' | 'unreadable';

/** What one sync of one mailbox did. */
export interface MailboxSyncResult {
  mailboxId: string;
  folder: string;
  uidValidity: number;
  /** A stored cursor no longer applied (UIDVALIDITY or folder changed), so the folder was read from its start. */
  reset: boolean;
  /** Messages handed to ingest. */
  fetched: number;
  stored: number;
  duplicates: number;
  suppressed: number;
  /** Messages the cursor moved past without storing them, each logged at `error`. */
  skipped: Array<{ uid: number; reason: MailboxSyncSkipReason; detail: string }>;
  /** The cursor after this run. */
  lastUid: number;
  /** Messages above the cursor remain: this run reached `maxMessagesPerRun`. */
  more: boolean;
}

/** What one pass over every mailbox did. */
export interface MailboxSyncAllResult {
  /** One per mailbox that has an account. */
  results: MailboxSyncResult[];
  /** Mailboxes whose sync failed; their cursors stayed where they were. */
  failures: Array<{ mailboxId: string; error: string }>;
}

/** The engine surface the sync reads and writes through. */
export interface MailSyncEngine {
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/** The logger surface the sync reports through. */
export interface MailSyncLogger {
  info?(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MailboxSyncServiceOptions {
  /** The data engine (`objectql`), resolved per call. */
  engine: () => MailSyncEngine;
  /** The ingest seam the messages are handed to. */
  ingest: Pick<MailIngestService, 'ingest'>;
  accountFor: MailboxAccountResolver;
  logger: MailSyncLogger;
  /** Messages fetched per IMAP command. Default {@link DEFAULT_SYNC_BATCH_SIZE}. */
  batchSize?: number;
  /** Messages handed to ingest per mailbox per run. Default {@link DEFAULT_SYNC_MAX_MESSAGES_PER_RUN}. */
  maxMessagesPerRun?: number;
  /** Larger messages are skipped (and logged). Default {@link DEFAULT_SYNC_MAX_MESSAGE_BYTES}. */
  maxMessageBytes?: number;
  /** Opens a session; the connector's own by default. */
  openSession?: (options: ImapSessionOptions) => Promise<ImapSession>;
  /** The sync clock. */
  now?: () => Date;
}

export const DEFAULT_SYNC_FOLDER = 'INBOX';
export const DEFAULT_SYNC_BATCH_SIZE = 25;
export const DEFAULT_SYNC_MAX_MESSAGES_PER_RUN = 500;
/** 32 MiB: above the 25 MB attachment limit of the large hosted providers, once transfer-encoded. */
export const DEFAULT_SYNC_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

const SYSTEM_CTX = { isSystem: true } as const;
const MAILBOX_PAGE_SIZE = 200;

interface Cursor {
  folder: string | null;
  uidValidity: number | null;
  lastUid: number | null;
}

const idOf = (value: unknown): string | null =>
  (typeof value === 'string' && value !== '') || typeof value === 'number' ? String(value) : null;

const numberOf = (value: unknown): number | null => {
  const n = typeof value === 'string' && value !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The IMAP sync of every mailbox an account resolver answers for. */
export class MailboxSyncService {
  private readonly running = new Map<string, Promise<MailboxSyncResult | null>>();
  private readonly open = new Set<ImapSession>();
  private closed = false;

  constructor(private readonly options: MailboxSyncServiceOptions) {}

  /**
   * Sync one mailbox. Answers `null` when no account feeds it. System context
   * only: the sync writes the mailbox's cursor and stores its mail.
   */
  async syncMailbox(mailboxId: string, context: { isSystem?: boolean }): Promise<MailboxSyncResult | null> {
    if (context?.isSystem !== true) {
      throw new MailboxServiceError('PERMISSION_DENIED', 'Syncing a mailbox requires the system context.');
    }
    if (typeof mailboxId !== 'string' || mailboxId === '') {
      throw new MailboxServiceError('VALIDATION_ERROR', 'Syncing a mailbox requires its id.');
    }
    const inFlight = this.running.get(mailboxId);
    if (inFlight) return inFlight;
    const run = this.runMailbox(mailboxId).finally(() => this.running.delete(mailboxId));
    this.running.set(mailboxId, run);
    return run;
  }

  /** Sync every mailbox that has an account; one mailbox's failure does not stop the others. */
  async syncAll(context: { isSystem?: boolean }): Promise<MailboxSyncAllResult> {
    if (context?.isSystem !== true) {
      throw new MailboxServiceError('PERMISSION_DENIED', 'Syncing mailboxes requires the system context.');
    }
    const engine = this.options.engine();
    const out: MailboxSyncAllResult = { results: [], failures: [] };
    const walk = keysetWalk<Record<string, unknown>>(
      (query) => engine.find(MAILBOX_OBJECT, { ...query, fields: ['id'], context: { ...SYSTEM_CTX } }),
      { where: {}, pageSize: MAILBOX_PAGE_SIZE },
    );
    for await (const page of walk.pages()) {
      for (const row of page) {
        const id = idOf(row.id);
        if (id === null || this.closed) continue;
        try {
          const result = await this.syncMailbox(id, SYSTEM_CTX);
          if (result) out.results.push(result);
        } catch (err) {
          out.failures.push({ mailboxId: id, error: messageOf(err) });
        }
      }
    }
    return out;
  }

  /** Close every open session; later runs do nothing. For the plugin's teardown. */
  close(): void {
    this.closed = true;
    for (const session of this.open) session.close();
    this.open.clear();
  }

  private async runMailbox(mailboxId: string): Promise<MailboxSyncResult | null> {
    if (this.closed) return null;
    const engine = this.options.engine();
    const [row] = await engine.find(MAILBOX_OBJECT, {
      where: { id: mailboxId },
      fields: ['id', 'name', 'address', 'organization_id', 'imap_folder', 'imap_uid_validity', 'imap_last_uid'],
      limit: 1,
      context: { ...SYSTEM_CTX },
    });
    const id = idOf(row?.id);
    if (!row || id === null) throw new MailboxServiceError('RECORD_NOT_FOUND', `Mailbox '${mailboxId}' was not found.`);
    const organizationId = idOf(row.organization_id);
    if (organizationId === null) {
      throw new MailboxServiceError(
        'INTERNAL_ERROR',
        `Mailbox '${id}' carries no organization, so its mail cannot be stored inside one. Every mailbox row is written with the organization that owns it.`,
      );
    }
    const binding = await this.options.accountFor({
      id,
      name: typeof row.name === 'string' ? row.name : null,
      address: typeof row.address === 'string' ? row.address : null,
      organizationId,
    });
    if (!binding) return null;

    const folder = binding.folder ?? DEFAULT_SYNC_FOLDER;
    const stored: Cursor = {
      folder: typeof row.imap_folder === 'string' ? row.imap_folder : null,
      uidValidity: numberOf(row.imap_uid_validity),
      lastUid: numberOf(row.imap_last_uid),
    };
    const open = this.options.openSession ?? openImapSession;
    const session = await open({ account: binding.account, credentials: binding.credentials });
    this.open.add(session);
    try {
      return await this.syncFolder(engine, session, id, folder, stored);
    } finally {
      this.open.delete(session);
      await session.logout();
    }
  }

  private async syncFolder(
    engine: MailSyncEngine,
    session: ImapSession,
    mailboxId: string,
    folder: string,
    stored: Cursor,
  ): Promise<MailboxSyncResult> {
    const status = await session.examine(folder);
    const applies = stored.folder === folder && stored.uidValidity === status.uidValidity;
    const hadCursor = stored.folder !== null || stored.uidValidity !== null || stored.lastUid !== null;
    const result: MailboxSyncResult = {
      mailboxId,
      folder,
      uidValidity: status.uidValidity,
      reset: hadCursor && !applies,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      suppressed: 0,
      skipped: [],
      lastUid: applies ? (stored.lastUid ?? 0) : 0,
      more: false,
    };

    const maxPerRun = this.options.maxMessagesPerRun ?? DEFAULT_SYNC_MAX_MESSAGES_PER_RUN;
    const candidates = (await session.listMessages(result.lastUid + 1)).filter((m) => m.uid > result.lastUid);
    const taken = candidates.slice(0, maxPerRun);
    result.more = candidates.length > taken.length;

    const batchSize = Math.max(1, this.options.batchSize ?? DEFAULT_SYNC_BATCH_SIZE);
    const maxBytes = this.options.maxMessageBytes ?? DEFAULT_SYNC_MAX_MESSAGE_BYTES;
    for (let at = 0; at < taken.length && !this.closed; at += batchSize) {
      const batch = taken.slice(at, at + batchSize);
      const fits = batch.filter((m) => m.size === null || m.size <= maxBytes).map((m) => m.uid);
      const fetched = new Map((await session.fetchMessages(fits)).map((m) => [m.uid, m]));
      try {
        for (const entry of batch) {
          if (entry.size !== null && entry.size > maxBytes) {
            this.skip(result, mailboxId, folder, entry.uid, 'too_large', `${entry.size} bytes, above the ${maxBytes}-byte bound`);
            continue;
          }
          const message = fetched.get(entry.uid);
          if (message) {
            result.fetched++;
            try {
              const outcome = await this.options.ingest.ingest(
                { mailboxId, raw: message.raw, receivedAt: message.internalDate ?? undefined },
                { ...SYSTEM_CTX },
              );
              if (outcome.outcome === 'stored') result.stored++;
              else if (outcome.outcome === 'duplicate') result.duplicates++;
              else result.suppressed++;
            } catch (err) {
              if (!(err instanceof MailboxServiceError) || err.code !== 'VALIDATION_ERROR') throw err;
              this.skip(result, mailboxId, folder, entry.uid, 'unreadable', err.message);
            }
          }
          // Absent from the fetch: expunged since it was listed; nothing to mirror.
          result.lastUid = entry.uid;
        }
      } finally {
        await this.saveCursor(engine, mailboxId, folder, status.uidValidity, result.lastUid);
      }
    }
    if (taken.length === 0) await this.saveCursor(engine, mailboxId, folder, status.uidValidity, result.lastUid);
    return result;
  }

  private skip(
    result: MailboxSyncResult,
    mailboxId: string,
    folder: string,
    uid: number,
    reason: MailboxSyncSkipReason,
    detail: string,
  ): void {
    result.skipped.push({ uid, reason, detail });
    this.options.logger.error(
      `[mailbox] message UID ${uid} of folder '${folder}' in mailbox '${mailboxId}' is NOT mirrored (${detail}). ` +
        'The sync moves past it so the rest of the mailbox keeps arriving, and nothing else will report it: ' +
        'the message stays in the IMAP folder, and only a copy re-delivered under a new UID will be read. ' +
        (reason === 'too_large'
          ? 'To mirror messages this large, raise `maxMessageBytes` in the mailbox IMAP sync options.'
          : 'It is not a readable RFC 822 message.'),
    );
  }

  private async saveCursor(
    engine: MailSyncEngine,
    mailboxId: string,
    folder: string,
    uidValidity: number,
    lastUid: number,
  ): Promise<void> {
    await engine.update(
      MAILBOX_OBJECT,
      {
        imap_folder: folder,
        imap_uid_validity: uidValidity,
        imap_last_uid: lastUid,
        imap_synced_at: (this.options.now?.() ?? new Date()).toISOString(),
      },
      { where: { id: mailboxId }, context: { ...SYSTEM_CTX } },
    );
  }
}
