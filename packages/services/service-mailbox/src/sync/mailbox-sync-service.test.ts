// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The card's end-to-end acceptance: a shared mailbox's IMAP folder → the
 * ingest seam → `sys_mail_message`, against an in-process IMAP server double
 * (`@objectstack/connector-imap/testing`, a real TCP server that shares no
 * protocol code with the client) and the REAL engine — `ObjectQL` over
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`, the real mail objects
 * with their real unique indexes, and an app object whose email field declares
 * `mailAssociation`. No resolver is registered: the declaration is the seam.
 *
 * Each acceptance clause has its own block; the negative control of each is
 * named in its test and was proven by ablation (the PR body lists them).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { DataEngineInsertOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { staticCredentials } from '@objectstack/connector-imap';
import { ImapServerDouble } from '@objectstack/connector-imap/testing';
import { SysMailAssociation, SysMailbox, SysMailMessage } from '../objects/index.js';
import { MailIngestService, MailboxServiceError, type MailIngestEngine } from '../ingest/mail-ingest-service.js';
import { parseMatchAddresses } from '../ingest/match-addresses.js';
import { bounce, forwardAsAttachment, plainMessage, rfc822 } from '../ingest/messages.fixture.js';
import { MailboxSyncService, type MailboxSyncServiceOptions, type MailSyncEngine } from './mailbox-sync-service.js';

const SYSTEM = { isSystem: true } as const;
const ORG = 'org_sync_a';

const Contact = ObjectSchema.create({
  name: 'synctest_contact',
  label: 'Contact',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.email({ label: 'Email', mailAssociation: true }),
  },
});

type Row = Record<string, any>;

describe('the IMAP sync, end to end, on a real engine', () => {
  let engine: ObjectQL;
  let ingest: MailIngestService;
  let imap: ImapServerDouble;
  let endpoint: { host: string; port: number };
  const errors: string[] = [];
  let seq = 0;

  const find = (object: string, where: Row): Promise<Row[]> =>
    engine.find(object, { where, limit: 500, context: SYSTEM } satisfies EngineQueryOptions) as Promise<Row[]>;
  const insert = async (object: string, data: Row): Promise<string> =>
    String(((await engine.insert(object, data, { context: SYSTEM } satisfies DataEngineInsertOptions)) as Row).id);
  const newMailbox = () =>
    insert('sys_mailbox', { organization_id: ORG, name: `Shared ${++seq}`, address: 'inbox@corp.test', owner_user_id: 'usr_owner' });
  const messagesIn = (mailboxId: string) => find('sys_mail_message', { mailbox_id: mailboxId });
  const mailboxRow = async (mailboxId: string) => (await find('sys_mailbox', { id: mailboxId }))[0]!;

  /** A sync whose resolver answers the double's account for `mailboxId` only. */
  const syncFor = (mailboxId: string, over: Partial<MailboxSyncServiceOptions> = {}, folder?: string) =>
    new MailboxSyncService({
      engine: () => engine as unknown as MailSyncEngine,
      ingest,
      accountFor: (mailbox) =>
        mailbox.id === mailboxId
          ? {
              account: { id: mailbox.id, username: 'user', imap: { ...endpoint, security: 'none' } },
              credentials: staticCredentials({ type: 'password', password: 'secret' }),
              folder,
            }
          : null,
      logger: { warn: () => {}, error: (m: string) => errors.push(m) },
      ...over,
    });

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      true,
    );
    await engine.init();
    for (const def of [SysMailbox, SysMailMessage, SysMailAssociation, Contact]) {
      engine.registry.registerObject(def as any, 'mailbox-sync-test', 'mailbox-sync-test');
    }
    await engine.syncSchemas();
    ingest = new MailIngestService({ engine: () => engine as unknown as MailIngestEngine, logger: { warn: () => {} } });
  });

  afterAll(async () => {
    try {
      await engine?.destroy();
    } catch {
      /* noop */
    }
  });

  beforeEach(async () => {
    imap = new ImapServerDouble();
    endpoint = await imap.listen();
    errors.length = 0;
  });

  afterEach(async () => {
    await imap.close();
  });

  describe('clause 1 — a forwarded message lands as ONE row, associated at ingest', () => {
    it('stores the forward from the shared mailbox once, with the association its forwarded part names', async () => {
      const mailbox = await newMailbox();
      const contact = await insert('synctest_contact', { organization_id: ORG, name: 'C', email: 'customer@acme.test' });
      const original = rfc822(
        [['From', 'Customer <customer@acme.test>'], ['To', 'rep@corp.test'], ['Message-ID', '<sync-orig@acme.test>']],
        'What does it cost?',
      );
      imap.append('INBOX', forwardAsAttachment({ original, messageId: '<sync-fwd-1@corp.test>' }), {
        internalDate: new Date('2026-10-13T09:15:00Z'),
      });
      // Negative control: nothing is stored until the sync hands the message over.
      expect(await messagesIn(mailbox)).toHaveLength(0);

      const result = await syncFor(mailbox).syncMailbox(mailbox, SYSTEM);

      expect(result).toMatchObject({ fetched: 1, stored: 1, duplicates: 0, suppressed: 0, skipped: [], lastUid: 1, reset: false });
      const rows = await messagesIn(mailbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.association_state).toBe('associated');
      expect(rows[0]!.message_id).toBe('sync-fwd-1@corp.test');
      expect(new Date(rows[0]!.received_at).toISOString()).toBe('2026-10-13T09:15:00.000Z');
      expect(parseMatchAddresses(rows[0]!.match_addresses)).toContainEqual({ address: 'customer@acme.test', source: 'attachment' });
      const links = await find('sys_mail_association', { mail_message_id: rows[0]!.id });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ object_name: 'synctest_contact', record_id: contact, matched_by: 'ingest' });
    });

    it('reads the folder read-only: EXAMINE and BODY.PEEK, and no message is left \\Seen', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<ro-1@acme.test>' }));
      await syncFor(mailbox).syncMailbox(mailbox, SYSTEM);
      expect(imap.commands.some((c) => / EXAMINE "INBOX"$/.test(c))).toBe(true);
      expect(imap.commands.some((c) => / SELECT /.test(c))).toBe(false);
      expect(imap.commands.some((c) => /BODY\.PEEK\[\]/.test(c))).toBe(true);
      expect(imap.messages('INBOX').every((m) => !m.flags.has('\\Seen'))).toBe(true);
    });
  });

  describe('clause 2 — a second fetch dedupes, and the row count stays 1', () => {
    it('fetches nothing on a second run: the cursor holds the folder position', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<twice-1@acme.test>' }));
      const sync = syncFor(mailbox);
      await sync.syncMailbox(mailbox, SYSTEM);
      const cursor = await mailboxRow(mailbox);
      expect(cursor).toMatchObject({ imap_folder: 'INBOX', imap_uid_validity: imap.uidValidity('INBOX'), imap_last_uid: 1 });
      expect(cursor.imap_synced_at).toBeTruthy();

      const second = await sync.syncMailbox(mailbox, SYSTEM);

      expect(second).toMatchObject({ fetched: 0, stored: 0, lastUid: 1 });
      expect(await messagesIn(mailbox)).toHaveLength(1);
    });

    it('answers a re-delivered copy (a new UID, the same message) as a duplicate, and stores nothing', async () => {
      const mailbox = await newMailbox();
      const raw = plainMessage({ 'Message-ID': '<redelivered@acme.test>' });
      imap.append('INBOX', raw);
      const sync = syncFor(mailbox);
      await sync.syncMailbox(mailbox, SYSTEM);
      imap.append('INBOX', raw);

      const second = await sync.syncMailbox(mailbox, SYSTEM);

      expect(second).toMatchObject({ fetched: 1, stored: 0, duplicates: 1, lastUid: 2 });
      expect(await messagesIn(mailbox)).toHaveLength(1);
    });

    it('reads the folder from its start when its UIDVALIDITY changes, and every message dedupes', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<uv-1@acme.test>' }));
      imap.append('INBOX', plainMessage({ 'Message-ID': '<uv-2@acme.test>' }));
      const sync = syncFor(mailbox);
      await sync.syncMailbox(mailbox, SYSTEM);
      imap.rebuild('INBOX');

      const after = await sync.syncMailbox(mailbox, SYSTEM);

      expect(after).toMatchObject({ reset: true, fetched: 2, stored: 0, duplicates: 2, uidValidity: imap.uidValidity('INBOX') });
      expect(await messagesIn(mailbox)).toHaveLength(2);
      expect((await mailboxRow(mailbox)).imap_uid_validity).toBe(imap.uidValidity('INBOX'));
    });

    it('starts over when the mailbox is synced from another folder', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<f-1@acme.test>' }));
      imap.append('Shared', plainMessage({ 'Message-ID': '<f-2@acme.test>' }));
      await syncFor(mailbox).syncMailbox(mailbox, SYSTEM);
      const moved = await syncFor(mailbox, {}, 'Shared').syncMailbox(mailbox, SYSTEM);
      expect(moved).toMatchObject({ folder: 'Shared', reset: true, stored: 1 });
      expect((await mailboxRow(mailbox)).imap_folder).toBe('Shared');
    });
  });

  describe('clause 3 — an unmatched message waits in the pool, and re-match associates it once a record exists', () => {
    it('pools a message no record matches, then the re-match links it to the record created later', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ From: 'Prospect <prospect@newco.test>', 'Message-ID': '<pool-1@newco.test>' }));

      await syncFor(mailbox).syncMailbox(mailbox, SYSTEM);
      const [pooled] = await messagesIn(mailbox);
      expect(pooled!.association_state).toBe('unassociated');
      expect(await find('sys_mail_association', { mail_message_id: pooled!.id })).toHaveLength(0);

      const contact = await insert('synctest_contact', { organization_id: ORG, name: 'P', email: 'Prospect@NewCo.test' });
      const rematch = await ingest.rematch({ mailboxId: mailbox }, SYSTEM);

      expect(rematch).toMatchObject({ linksAdded: 1, associated: 1 });
      expect((await messagesIn(mailbox))[0]!.association_state).toBe('associated');
      const links = await find('sys_mail_association', { mail_message_id: pooled!.id });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ record_id: contact, matched_by: 'rematch' });
    });
  });

  describe('clause 4 — an auto-reply is suppressed', () => {
    it('stores no row for an auto-reply or a bounce, and the cursor moves past both', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Auto-Submitted': 'auto-replied', Subject: 'Out of office', 'Message-ID': '<ooo@acme.test>' }));
      imap.append('INBOX', bounce());
      const sync = syncFor(mailbox);

      const result = await sync.syncMailbox(mailbox, SYSTEM);

      expect(result).toMatchObject({ fetched: 2, stored: 0, suppressed: 2, lastUid: 2 });
      expect(await messagesIn(mailbox)).toHaveLength(0);
      expect(await sync.syncMailbox(mailbox, SYSTEM)).toMatchObject({ fetched: 0 });
    });

    it('control: a person’s reply in the same folder is stored', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Auto-Submitted': 'no', 'Message-ID': '<human@acme.test>' }));
      expect(await syncFor(mailbox).syncMailbox(mailbox, SYSTEM)).toMatchObject({ stored: 1, suppressed: 0 });
    });
  });

  describe('the incremental fetch', () => {
    it('fetches only what arrived since the last run, in bounded runs and batches', async () => {
      const mailbox = await newMailbox();
      for (let i = 1; i <= 5; i++) imap.append('INBOX', plainMessage({ 'Message-ID': `<inc-${i}@acme.test>` }));
      const sync = syncFor(mailbox, { batchSize: 2, maxMessagesPerRun: 3 });

      expect(await sync.syncMailbox(mailbox, SYSTEM)).toMatchObject({ fetched: 3, stored: 3, lastUid: 3, more: true });
      expect((await mailboxRow(mailbox)).imap_last_uid).toBe(3);
      expect(await sync.syncMailbox(mailbox, SYSTEM)).toMatchObject({ fetched: 2, stored: 2, lastUid: 5, more: false });
      imap.append('INBOX', plainMessage({ 'Message-ID': '<inc-6@acme.test>' }));
      expect(await sync.syncMailbox(mailbox, SYSTEM)).toMatchObject({ fetched: 1, stored: 1, lastUid: 6 });
      expect(await messagesIn(mailbox)).toHaveLength(6);
      expect(imap.commands.filter((c) => /UID FETCH 1:2 \(UID INTERNALDATE BODY\.PEEK\[\]\)/.test(c))).toHaveLength(1);
    });

    it('skips a message above the size bound, says so at error, and keeps the rest of the mailbox arriving', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<big@acme.test>' }, 'x'.repeat(4096)));
      imap.append('INBOX', plainMessage({ 'Message-ID': '<small@acme.test>' }));

      const result = await syncFor(mailbox, { maxMessageBytes: 1024 }).syncMailbox(mailbox, SYSTEM);

      expect(result).toMatchObject({ fetched: 1, stored: 1, lastUid: 2 });
      expect(result!.skipped).toEqual([{ uid: 1, reason: 'too_large', detail: expect.stringMatching(/above the 1024-byte bound/) }]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/UID 1 .* is NOT mirrored/);
      expect(errors[0]).toMatch(/raise `maxMessageBytes`/);
      expect(imap.commands.some((c) => /UID FETCH 1 \(/.test(c) || /UID FETCH 1:2 \(UID INTERNALDATE/.test(c))).toBe(false);
    });

    it('skips a message the seam refuses as unreadable, and moves on', async () => {
      const mailbox = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<bad@acme.test>' }));
      imap.append('INBOX', plainMessage({ 'Message-ID': '<good@acme.test>' }));
      let calls = 0;
      const refusing = {
        ingest: async (input: Parameters<MailIngestService['ingest']>[0], context: Parameters<MailIngestService['ingest']>[1]) => {
          if (++calls === 1) throw new MailboxServiceError('VALIDATION_ERROR', 'not an RFC 822 message');
          return ingest.ingest(input, context);
        },
      };
      const result = await syncFor(mailbox, { ingest: refusing }).syncMailbox(mailbox, SYSTEM);
      expect(result).toMatchObject({ fetched: 2, stored: 1, lastUid: 2 });
      expect(result!.skipped).toEqual([{ uid: 1, reason: 'unreadable', detail: 'not an RFC 822 message' }]);
    });

    it('stops at a store failure with the cursor below the failed message, and the next run retries it', async () => {
      const mailbox = await newMailbox();
      for (let i = 1; i <= 3; i++) imap.append('INBOX', plainMessage({ 'Message-ID': `<retry-${i}@acme.test>` }));
      let failing = true;
      const flaky = {
        ingest: async (input: Parameters<MailIngestService['ingest']>[0], context: Parameters<MailIngestService['ingest']>[1]) => {
          const id = new TextDecoder().decode(input.raw as Uint8Array);
          if (failing && id.includes('<retry-2@')) throw new Error('database is down');
          return ingest.ingest(input, context);
        },
      };
      const sync = syncFor(mailbox, { ingest: flaky });

      await expect(sync.syncMailbox(mailbox, SYSTEM)).rejects.toThrow('database is down');
      expect((await mailboxRow(mailbox)).imap_last_uid).toBe(1);
      expect(await messagesIn(mailbox)).toHaveLength(1);

      failing = false;
      expect(await sync.syncMailbox(mailbox, SYSTEM)).toMatchObject({ fetched: 2, stored: 2, lastUid: 3 });
      expect(await messagesIn(mailbox)).toHaveLength(3);
    });
  });

  describe('who and what is synced', () => {
    it('answers null and touches nothing for a mailbox no account feeds', async () => {
      const fed = await newMailbox();
      const other = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<nobody@acme.test>' }));
      expect(await syncFor(fed).syncMailbox(other, SYSTEM)).toBeNull();
      expect((await mailboxRow(other)).imap_last_uid ?? null).toBeNull();
      expect(imap.commands).toHaveLength(0);
    });

    it('refuses any caller but the system context', async () => {
      const mailbox = await newMailbox();
      const err = await syncFor(mailbox).syncMailbox(mailbox, { isSystem: false }).catch((e) => e);
      expect(err).toBeInstanceOf(MailboxServiceError);
      expect(err).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    });

    it('syncs every fed mailbox in one pass, and reports one that fails without stopping the others', async () => {
      const good = await newMailbox();
      const broken = await newMailbox();
      imap.append('INBOX', plainMessage({ 'Message-ID': '<all-1@acme.test>' }));
      const sync = new MailboxSyncService({
        engine: () => engine as unknown as MailSyncEngine,
        ingest,
        accountFor: (mailbox) =>
          mailbox.id === good || mailbox.id === broken
            ? {
                account: { id: mailbox.id, username: 'user', imap: { ...endpoint, security: 'none' } },
                credentials: staticCredentials({ type: 'password', password: mailbox.id === good ? 'secret' : 'wrong' }),
              }
            : null,
        logger: { warn: () => {}, error: () => {} },
      });

      const pass = await sync.syncAll(SYSTEM);

      expect(pass.results.map((r) => r.mailboxId)).toEqual([good]);
      expect(pass.failures).toEqual([{ mailboxId: broken, error: expect.stringMatching(/NO/) }]);
      expect(await messagesIn(good)).toHaveLength(1);
      expect((await mailboxRow(broken)).imap_last_uid ?? null).toBeNull();
    });
  });
});
