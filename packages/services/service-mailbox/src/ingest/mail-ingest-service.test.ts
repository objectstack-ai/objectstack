// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ingest seam against the REAL engine: a real {@link ObjectQL} over
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`, the real three mail
 * objects with their real unique indexes, and fixture app objects whose email
 * fields declare `mailAssociation`. A fake engine here would be written by the
 * same hand as the assertions and would decide the very things measured —
 * whether the dedupe key's unique index holds, whether `$icontains` folds case
 * on both sides, whether a system write carrying an organization lands.
 *
 * No resolver is registered anywhere: the app's declaration is the whole seam.
 * Every message is fed as a raw RFC 822 string; no IMAP is involved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
// Engine options are DECLARED, never erased to `any` (`pnpm check:query-options-erasure`).
import type { DataEngineInsertOptions, EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import { SysMailAssociation, SysMailbox, SysMailMessage } from '../objects/index.js';
import { MAILBOX_ADMIN_CAPABILITY } from '../mail-read-visibility.js';
import { MailIngestService, MailboxServiceError, type MailIngestEngine } from './mail-ingest-service.js';
import { parseMatchAddresses } from './match-addresses.js';
import { bounce, forwardAsAttachment, plainMessage, rfc822 } from './messages.fixture.js';

const SYSTEM = { isSystem: true } as const;
const ORG_A = 'org_mail_a';
const ORG_B = 'org_mail_b';

/** An app object whose correspondent field is flagged. */
const Contact = ObjectSchema.create({
  name: 'mailtest_contact',
  label: 'Contact',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.email({ label: 'Email', mailAssociation: true }),
  },
});
/** A second flagged object, flagged on a differently named field. */
const Lead = ObjectSchema.create({
  name: 'mailtest_lead',
  label: 'Lead',
  fields: {
    name: Field.text({ label: 'Name' }),
    work_email: Field.email({ label: 'Work Email', mailAssociation: true }),
  },
});
/** An email field that does NOT declare the flag: never matched. */
const Vendor = ObjectSchema.create({
  name: 'mailtest_vendor',
  label: 'Vendor',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.email({ label: 'Email' }),
  },
});

type Row = Record<string, any>;

describe('the ingest seam on a real engine', () => {
  let engine: ObjectQL;
  let service: MailIngestService;
  const warnings: string[] = [];
  let mailboxSeq = 0;

  const find = (object: string, where: Row): Promise<Row[]> =>
    engine.find(object, { where, limit: 500, context: SYSTEM } satisfies EngineQueryOptions) as Promise<Row[]>;
  const insert = async (object: string, data: Row): Promise<string> =>
    String(((await engine.insert(object, data, { context: SYSTEM } satisfies DataEngineInsertOptions)) as Row).id);

  /** A fresh mailbox per test, so every count below is that test's own. */
  const newMailbox = async (organization = ORG_A, owner = 'usr_owner') =>
    insert('sys_mailbox', {
      organization_id: organization,
      name: `Inbox ${++mailboxSeq}`,
      address: 'Inbox@Corp.test',
      owner_user_id: owner,
    });
  const messagesIn = (mailboxId: string) => find('sys_mail_message', { mailbox_id: mailboxId });
  const linksOf = (messageId: string) => find('sys_mail_association', { mail_message_id: messageId });

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      true,
    );
    await engine.init();
    for (const def of [SysMailbox, SysMailMessage, SysMailAssociation, Contact, Lead, Vendor]) {
      engine.registry.registerObject(def as any, 'mailbox-test', 'mailbox-test');
    }
    await engine.syncSchemas();
    service = new MailIngestService({
      engine: () => engine as unknown as MailIngestEngine,
      logger: { warn: (m: string) => warnings.push(m) },
    });
  });

  afterAll(async () => {
    try {
      await engine?.destroy();
    } catch {
      /* noop */
    }
  });

  it('arms: every flagged object carries the organization column the matcher scopes by', () => {
    for (const name of ['mailtest_contact', 'mailtest_lead', 'mailtest_vendor']) {
      expect(engine.registry.getObject(name)?.fields?.organization_id, name).toBeTruthy();
    }
  });

  describe('a forwarded message lands as ONE row, associated through its forwarded part', () => {
    it('stamps the association the attachment part names, with its source on the stored participant set', async () => {
      const mailbox = await newMailbox();
      const contact = await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'customer@ACME.test' });
      const original = rfc822(
        [
          ['From', 'Customer <Customer@acme.test>'],
          ['To', 'rep@corp.test'],
          ['Message-ID', '<orig-attach@acme.test>'],
        ],
        'What does it cost?',
      );

      const result = await service.ingest({ mailboxId: mailbox, raw: forwardAsAttachment({ original }) }, SYSTEM);

      expect(result.outcome).toBe('stored');
      const rows = await messagesIn(mailbox);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.association_state).toBe('associated');
      expect(row.organization_id).toBe(ORG_A);
      expect(row.from_address).toBe('rep@corp.test');
      expect(row.subject).toBe('Fwd: A question');
      expect(row.message_id).toBe('fwd-1@corp.test');
      expect(row.dedupe_key).toMatch(/^mid:[0-9a-f]{64}$/);
      // The participant set as stored: the forwarder under `outer`, the
      // forwarded message's people under `attachment`, the mailbox itself in
      // neither.
      expect(parseMatchAddresses(row.match_addresses)).toEqual([
        { address: 'rep@corp.test', source: 'outer' },
        { address: 'customer@acme.test', source: 'attachment' },
        { address: 'rep@corp.test', source: 'attachment' },
      ]);
      const links = await linksOf(row.id);
      expect(links.map((l) => [l.object_name, l.record_id, l.matched_field, l.matched_address, l.matched_by])).toEqual([
        ['mailtest_contact', contact, 'email', 'customer@acme.test', 'ingest'],
      ]);
      expect(links[0]!.organization_id).toBe(ORG_A);
    });

    it('control: the same forward with no forwarded part names only the forwarder, and pools', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'customer2@acme.test' });
      const result = await service.ingest(
        { mailboxId: mailbox, raw: plainMessage({ From: 'Rep <rep@corp.test>', 'Message-ID': '<fwd-none@corp.test>' }) },
        SYSTEM,
      );
      expect(result).toMatchObject({ outcome: 'stored', associationState: 'unassociated', associations: [] });
    });
  });

  describe('dedupe', () => {
    it('a second ingest of the same message writes nothing: the row count stays 1', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'dedupe@acme.test' });
      const raw = plainMessage({ From: 'dedupe@acme.test', 'Message-ID': '<dedupe-1@acme.test>' });

      const first = await service.ingest({ mailboxId: mailbox, raw }, SYSTEM);
      const second = await service.ingest({ mailboxId: mailbox, raw }, SYSTEM);

      expect(first.outcome).toBe('stored');
      expect(second).toEqual({ outcome: 'duplicate', messageId: (first as { messageId: string }).messageId });
      const rows = await messagesIn(mailbox);
      expect(rows).toHaveLength(1);
      expect(await linksOf(rows[0]!.id)).toHaveLength(1);
    });

    it('a dedupe read that misses the stored row (a concurrent ingest’s window) is settled by the unique key', async () => {
      const mailbox = await newMailbox();
      const raw = plainMessage({ From: 'race@acme.test', 'Message-ID': '<race-1@acme.test>' });
      const first = await service.ingest({ mailboxId: mailbox, raw }, SYSTEM);
      expect(first.outcome).toBe('stored');

      // The second ingest's dedupe read runs before the first one's insert is
      // visible — modelled by that one read answering nothing. Every other
      // call reaches the real engine unchanged.
      let missed = false;
      const racingEngine = new Proxy(engine, {
        get(target, prop) {
          if (prop === 'find') {
            return async (object: string, options: Row) => {
              if (!missed && object === 'sys_mail_message' && options?.where && 'dedupe_key' in options.where) {
                missed = true;
                return [];
              }
              return target.find(object, options as EngineQueryOptions);
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const racing = new MailIngestService({
        engine: () => racingEngine as unknown as MailIngestEngine,
        logger: { warn: (m: string) => warnings.push(m) },
      });

      const second = await racing.ingest({ mailboxId: mailbox, raw }, SYSTEM);
      expect(missed).toBe(true);
      expect(second).toEqual({ outcome: 'duplicate', messageId: (first as { messageId: string }).messageId });
      expect(await messagesIn(mailbox)).toHaveLength(1);
    });

    it('a message with no Message-ID dedupes on its header block', async () => {
      const mailbox = await newMailbox();
      const raw = plainMessage({ 'Message-ID': null, From: 'no-id@acme.test' });
      expect((await service.ingest({ mailboxId: mailbox, raw }, SYSTEM)).outcome).toBe('stored');
      expect((await service.ingest({ mailboxId: mailbox, raw }, SYSTEM)).outcome).toBe('duplicate');
      const rows = await messagesIn(mailbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.dedupe_key).toMatch(/^hdr:/);
    });

    it('control: a different message is its own row, and the same message in another mailbox is that mailbox’s', async () => {
      const mailbox = await newMailbox();
      const other = await newMailbox();
      const one = plainMessage({ 'Message-ID': '<distinct-1@acme.test>' });
      await service.ingest({ mailboxId: mailbox, raw: one }, SYSTEM);
      await service.ingest({ mailboxId: mailbox, raw: plainMessage({ 'Message-ID': '<distinct-2@acme.test>' }) }, SYSTEM);
      await service.ingest({ mailboxId: other, raw: one }, SYSTEM);
      expect(await messagesIn(mailbox)).toHaveLength(2);
      expect(await messagesIn(other)).toHaveLength(1);
    });
  });

  describe('the pool and the re-match', () => {
    it('an unmatched message lands in the pool, and the re-match associates it once a matching record exists', async () => {
      const mailbox = await newMailbox();
      const raw = plainMessage({ From: 'Prospect <Prospect@new.test>', 'Message-ID': '<pool-1@new.test>' });

      const stored = await service.ingest({ mailboxId: mailbox, raw }, SYSTEM);
      expect(stored).toMatchObject({ outcome: 'stored', associationState: 'unassociated', associations: [] });
      const [pooled] = await messagesIn(mailbox);
      expect(pooled!.association_state).toBe('unassociated');
      expect(await linksOf(pooled!.id)).toHaveLength(0);

      // Nothing to find yet: the re-match changes nothing.
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toEqual({
        scanned: 1, linksAdded: 0, associated: 0, unreadable: [],
      });

      const lead = await insert('mailtest_lead', { organization_id: ORG_A, name: 'P', work_email: 'prospect@NEW.test' });
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toEqual({
        scanned: 1, linksAdded: 1, associated: 1, unreadable: [],
      });
      const [after] = await messagesIn(mailbox);
      expect(after!.association_state).toBe('associated');
      const links = await linksOf(after!.id);
      expect(links.map((l) => [l.object_name, l.record_id, l.matched_field, l.matched_by])).toEqual([
        ['mailtest_lead', lead, 'work_email', 'rematch'],
      ]);

      // Idempotent: a second re-match adds nothing.
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toMatchObject({ linksAdded: 0, associated: 0 });
    });

    it('re-match only adds: a link whose record no longer matches is kept, and a new match is added beside it', async () => {
      const mailbox = await newMailbox();
      const first = await insert('mailtest_contact', { organization_id: ORG_A, name: 'A', email: 'shared@acme.test' });
      await service.ingest(
        { mailboxId: mailbox, raw: plainMessage({ From: 'shared@acme.test', 'Message-ID': '<additive@acme.test>' }) },
        SYSTEM,
      );
      await engine.update('mailtest_contact', { email: 'moved@acme.test' }, {
        where: { id: first },
        context: SYSTEM,
      } satisfies EngineUpdateOptions);
      const second = await insert('mailtest_contact', { organization_id: ORG_A, name: 'B', email: 'shared@acme.test' });

      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toMatchObject({ linksAdded: 1, associated: 0 });
      const [row] = await messagesIn(mailbox);
      const links = (await linksOf(row!.id)).map((l) => [l.record_id, l.matched_by]);
      expect(links).toEqual(expect.arrayContaining([[first, 'ingest'], [second, 'rematch']]));
      expect(links).toHaveLength(2);
    });

    it('a stored participant set that is not the stored shape is reported, never guessed at', async () => {
      const mailbox = await newMailbox();
      const id = await insert('sys_mail_message', {
        organization_id: ORG_A,
        mailbox_id: mailbox,
        received_at: new Date().toISOString(),
        association_state: 'unassociated',
        dedupe_key: 'mid:broken',
        match_addresses: 'customer@acme.test',
      });
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toEqual({
        scanned: 1, linksAdded: 0, associated: 0, unreadable: [id],
      });
    });
  });

  describe('suppression', () => {
    it('an auto-reply writes no row', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'away@acme.test' });
      const result = await service.ingest(
        {
          mailboxId: mailbox,
          raw: plainMessage({ From: 'away@acme.test', 'Auto-Submitted': 'auto-replied', 'Message-ID': '<ooo@acme.test>' }),
        },
        SYSTEM,
      );
      expect(result).toEqual({ outcome: 'suppressed', reason: 'auto_submitted' });
      expect(await messagesIn(mailbox)).toHaveLength(0);
    });

    it('control: the same message without the auto-reply marker is stored and associated', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'present@acme.test' });
      const result = await service.ingest(
        { mailboxId: mailbox, raw: plainMessage({ From: 'present@acme.test', 'Message-ID': '<not-ooo@acme.test>' }) },
        SYSTEM,
      );
      expect(result).toMatchObject({ outcome: 'stored', associationState: 'associated' });
      expect(await messagesIn(mailbox)).toHaveLength(1);
    });

    it('a bounce writes no row', async () => {
      const mailbox = await newMailbox();
      expect(await service.ingest({ mailboxId: mailbox, raw: bounce() }, SYSTEM)).toEqual({
        outcome: 'suppressed',
        reason: 'delivery_report',
      });
      expect(await messagesIn(mailbox)).toHaveLength(0);
    });
  });

  describe('matching reads the declaration, inside the mailbox’s organization', () => {
    it('matches a flagged field only, in the mailbox’s own organization only', async () => {
      const mailbox = await newMailbox(ORG_A);
      const own = await insert('mailtest_contact', { organization_id: ORG_A, name: 'Own', email: 'twin@acme.test' });
      await insert('mailtest_contact', { organization_id: ORG_B, name: 'Other org', email: 'twin@acme.test' });
      await insert('mailtest_vendor', { organization_id: ORG_A, name: 'Unflagged', email: 'twin@acme.test' });
      // A substring of a stored value is not that value.
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'Longer', email: 'eviltwin@acme.test' });

      const result = await service.ingest(
        { mailboxId: mailbox, raw: plainMessage({ From: 'Twin <twin@acme.test>', 'Message-ID': '<scope@acme.test>' }) },
        SYSTEM,
      );
      expect(result).toMatchObject({
        outcome: 'stored',
        associations: [{ object: 'mailtest_contact', recordId: own, matchedField: 'email', matchedAddress: 'twin@acme.test' }],
      });
    });

    it('never matches the mailbox’s own address, whatever its case', async () => {
      const mailbox = await newMailbox(ORG_A);
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'Inbox as contact', email: 'inbox@corp.test' });
      const result = await service.ingest(
        { mailboxId: mailbox, raw: plainMessage({ From: 'stranger@far.test', 'Message-ID': '<own-addr@far.test>' }) },
        SYSTEM,
      );
      expect(result).toMatchObject({ outcome: 'stored', associationState: 'unassociated' });
    });

    it('stores threading ids and display columns', async () => {
      const mailbox = await newMailbox(ORG_A);
      await service.ingest(
        {
          mailboxId: mailbox,
          raw: plainMessage({
            'Message-ID': '<reply-2@acme.test>',
            'In-Reply-To': '<reply-1@acme.test>',
            References: '<root@acme.test> <reply-1@acme.test>',
            Cc: 'a@acme.test, B <b@acme.test>',
          }),
          receivedAt: '2026-10-12T11:00:00.000Z',
        },
        SYSTEM,
      );
      const [row] = await messagesIn(mailbox);
      expect(row).toMatchObject({
        in_reply_to: 'reply-1@acme.test',
        reference_ids: 'root@acme.test reply-1@acme.test',
        to_addresses: 'inbox@corp.test',
        cc_addresses: 'a@acme.test, b@acme.test',
        from_name: 'Customer',
      });
      expect(new Date(row!.received_at).toISOString()).toBe('2026-10-12T11:00:00.000Z');
      expect(new Date(row!.sent_at).toISOString()).toBe('2026-10-12T09:00:00.000Z');
    });
  });

  describe('who may call', () => {
    const refusal = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (err) {
        expect(err).toBeInstanceOf(MailboxServiceError);
        const e = err as MailboxServiceError;
        return { code: e.code, status: e.status };
      }
      throw new Error('expected a refusal');
    };

    it('ingest is refused to anything but the system context, and writes nothing', async () => {
      const mailbox = await newMailbox(ORG_A, 'usr_owner');
      const asOwnerHolder = { userId: 'usr_owner', tenantId: ORG_A, systemPermissions: [MAILBOX_ADMIN_CAPABILITY] };
      expect(await refusal(() => service.ingest({ mailboxId: mailbox, raw: plainMessage() }, asOwnerHolder))).toEqual({
        code: 'PERMISSION_DENIED',
        status: 403,
      });
      expect(await messagesIn(mailbox)).toHaveLength(0);
    });

    it('re-match is served to the mailbox’s owner and to a manage_mailboxes holder of its organization', async () => {
      const mailbox = await newMailbox(ORG_A, 'usr_owner');
      expect(await service.rematch({ mailboxId: mailbox }, { userId: 'usr_owner', tenantId: ORG_A })).toMatchObject({ scanned: 0 });
      expect(
        await service.rematch(
          { mailboxId: mailbox },
          { userId: 'usr_admin', tenantId: ORG_A, systemPermissions: [MAILBOX_ADMIN_CAPABILITY] },
        ),
      ).toMatchObject({ scanned: 0 });
    });

    it('re-match is refused to a member who neither owns the mailbox nor holds the capability', async () => {
      const mailbox = await newMailbox(ORG_A, 'usr_owner');
      expect(
        await refusal(() =>
          service.rematch({ mailboxId: mailbox }, { userId: 'usr_member', tenantId: ORG_A, systemPermissions: ['setup.access'] }),
        ),
      ).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    });

    it('another organization’s mailbox is not found, even by a capability holder; nor is a mailbox that does not exist', async () => {
      const mailbox = await newMailbox(ORG_A, 'usr_owner');
      const holderElsewhere = { userId: 'usr_owner', tenantId: ORG_B, systemPermissions: [MAILBOX_ADMIN_CAPABILITY] };
      expect(await refusal(() => service.rematch({ mailboxId: mailbox }, holderElsewhere))).toEqual({
        code: 'RECORD_NOT_FOUND',
        status: 404,
      });
      expect(await refusal(() => service.rematch({ mailboxId: 'no_such_mailbox' }, SYSTEM))).toEqual({
        code: 'RECORD_NOT_FOUND',
        status: 404,
      });
      expect(await refusal(() => service.ingest({ mailboxId: 'no_such_mailbox', raw: plainMessage() }, SYSTEM))).toEqual({
        code: 'RECORD_NOT_FOUND',
        status: 404,
      });
    });
  });
});
