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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, Field } from '@objectstack/spec/data';
// Engine options are DECLARED, never erased to `any` (`pnpm check:query-options-erasure`).
import type { DataEngineInsertOptions, EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import type { AttachFileInput, IFileAttachmentService } from '@objectstack/spec/contracts';
import { SysMember, SysUser } from '@objectstack/platform-objects/identity';
import { SysMailAssociation, SysMailbox, SysMailMessage } from '../objects/index.js';
import { MAILBOX_ADMIN_CAPABILITY } from '../mail-read-visibility.js';
import { MailIngestService, MailboxServiceError, type MailIngestEngine } from './mail-ingest-service.js';
import { parseMatchAddresses } from './match-addresses.js';
import {
  appleMailForwardBlock,
  binaryBytes,
  bounce,
  forwardAsAttachment,
  forwardInline,
  gmailForwardBlock,
  messageWithParts,
  outlookForwardBlock,
  plainMessage,
  rfc822,
  type InlineOriginal,
} from './messages.fixture.js';

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
  const errors: string[] = [];
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
    // The identity objects the inline-forward door reads, as the auth plugin registers them.
    for (const def of [SysMailbox, SysMailMessage, SysMailAssociation, SysUser, SysMember, Contact, Lead, Vendor]) {
      engine.registry.registerObject(def as any, 'mailbox-test', 'mailbox-test');
    }
    await engine.syncSchemas();
    service = new MailIngestService({
      engine: () => engine as unknown as MailIngestEngine,
      logger: { warn: (m: string) => warnings.push(m), error: (m: string) => errors.push(m) },
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
        logger: { warn: (m: string) => warnings.push(m), error: (m: string) => errors.push(m) },
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

  describe('a forward quoted INLINE, read only for a user of the mailbox’s organization', () => {
    // The forwarder, `rep@corp.test`, is a user who is a member of ORG_A (its
    // stored email in another case: the door folds ASCII case as the matcher
    // does). `elsewhere@corp.test` is a user, but a member of ORG_B only.
    // `stranger@far.test` is no user at all.
    beforeAll(async () => {
      const rep = await insert('sys_user', { name: 'Rep', email: 'Rep@Corp.test' });
      await insert('sys_member', { organization_id: ORG_A, user_id: rep, role: 'member' });
      const elsewhere = await insert('sys_user', { name: 'Elsewhere', email: 'elsewhere@corp.test' });
      await insert('sys_member', { organization_id: ORG_B, user_id: elsewhere, role: 'member' });
    });

    const FORMATS: ReadonlyArray<readonly [string, (original?: InlineOriginal) => string]> = [
      ['gmail', gmailForwardBlock],
      ['outlook', outlookForwardBlock],
      ['apple-mail', appleMailForwardBlock],
    ];

    for (const [format, block] of FORMATS) {
      it(`${format}: the forward associates through the original sender’s flagged field, and the stored set carries \`inline\`; control: the same message without the block pools`, async () => {
        const mailbox = await newMailbox();
        const customer = `customer-${format}@acme.test`;
        const contact = await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: customer });

        const control = await service.ingest(
          { mailboxId: mailbox, raw: forwardInline({ messageId: `<inline-${format}-none@corp.test>`, block: null }) },
          SYSTEM,
        );
        expect(control).toMatchObject({ outcome: 'stored', associationState: 'unassociated', associations: [] });

        const result = await service.ingest(
          {
            mailboxId: mailbox,
            raw: forwardInline({
              messageId: `<inline-${format}@corp.test>`,
              block: block({ from: `Customer <${customer.toUpperCase()}>`, cc: null }),
            }),
          },
          SYSTEM,
        );
        expect(result).toMatchObject({
          outcome: 'stored',
          associationState: 'associated',
          associations: [{ object: 'mailtest_contact', recordId: contact, matchedField: 'email', matchedAddress: customer }],
        });

        const rows = await messagesIn(mailbox);
        const stored = rows.find((r) => r.message_id === `inline-${format}@corp.test`)!;
        expect(parseMatchAddresses(stored.match_addresses)).toEqual([
          { address: 'rep@corp.test', source: 'outer' },
          { address: customer, source: 'inline' },
          { address: 'rep@corp.test', source: 'inline' },
        ]);
        const pooled = rows.find((r) => r.message_id === `inline-${format}-none@corp.test`)!;
        expect(parseMatchAddresses(pooled.match_addresses)).toEqual([{ address: 'rep@corp.test', source: 'outer' }]);
        expect((await linksOf(stored.id)).map((l) => [l.record_id, l.matched_address, l.matched_by])).toEqual([
          [contact, customer, 'ingest'],
        ]);
      });
    }

    it('a block the parser does not recognise is not guessed at: the message pools, with no `inline` entry', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'customer-localized@acme.test' });
      // Gmail in German labels the original's sender `Von:`.
      const localized = gmailForwardBlock({ from: 'Customer <customer-localized@acme.test>', cc: null }).replace('From: ', 'Von: ');
      const result = await service.ingest(
        { mailboxId: mailbox, raw: forwardInline({ messageId: '<inline-localized@corp.test>', block: localized }) },
        SYSTEM,
      );
      expect(result).toMatchObject({ outcome: 'stored', associationState: 'unassociated', associations: [] });
      const [row] = await messagesIn(mailbox);
      expect(parseMatchAddresses(row!.match_addresses)).toEqual([{ address: 'rep@corp.test', source: 'outer' }]);
    });

    it('a forward not sent by a user of the mailbox’s organization is not read: no user, a member elsewhere, two From addresses', async () => {
      const mailbox = await newMailbox();
      const contact = await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'customer-door@acme.test' });
      const block = gmailForwardBlock({ from: 'Customer <customer-door@acme.test>', cc: null });
      const forwarders: Array<[string, string]> = [
        ['stranger', 'Stranger <stranger@far.test>'],
        ['elsewhere', 'Elsewhere <elsewhere@corp.test>'],
        ['two-from', 'rep@corp.test, stranger@far.test'],
      ];
      for (const [name, forwarder] of forwarders) {
        const result = await service.ingest(
          { mailboxId: mailbox, raw: forwardInline({ forwarder, messageId: `<door-${name}@corp.test>`, block }) },
          SYSTEM,
        );
        expect(result, name).toMatchObject({ outcome: 'stored', associationState: 'unassociated', associations: [] });
      }
      for (const row of await messagesIn(mailbox)) {
        expect(parseMatchAddresses(row.match_addresses)!.map((a) => a.source), String(row.message_id)).not.toContain('inline');
      }

      // Control: the same block, forwarded by the organization's user, is read.
      const opened = await service.ingest(
        { mailboxId: mailbox, raw: forwardInline({ messageId: '<door-rep@corp.test>', block }) },
        SYSTEM,
      );
      expect(opened).toMatchObject({ associationState: 'associated', associations: [{ recordId: contact }] });
    });

    it('with no identity objects registered, no sender is an organization user: the forward is not read, and that is said once', async () => {
      const mailbox = await newMailbox();
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'customer-noauth@acme.test' });
      const withoutIdentity = new Proxy(engine, {
        get(target, prop) {
          if (prop === 'registry') {
            return {
              getAllObjects: () =>
                target.registry.getAllObjects().filter((o: { name?: string }) => o.name !== 'sys_user' && o.name !== 'sys_member'),
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const said: string[] = [];
      const noAuth = new MailIngestService({
        engine: () => withoutIdentity as unknown as MailIngestEngine,
        logger: { warn: (m: string) => said.push(m), error: (m: string) => said.push(m) },
      });
      for (const id of ['<noauth-1@corp.test>', '<noauth-2@corp.test>']) {
        const block = gmailForwardBlock({ from: 'customer-noauth@acme.test', cc: null });
        const result = await noAuth.ingest({ mailboxId: mailbox, raw: forwardInline({ messageId: id, block }) }, SYSTEM);
        expect(result).toMatchObject({ outcome: 'stored', associationState: 'unassociated' });
      }
      expect(said.filter((m) => m.includes('identity objects'))).toHaveLength(1);
      expect(said[0]).toContain("'sys_user' and 'sys_member' are not registered");
    });

    it('re-match replays the stored `inline` entries, and never re-reads the body', async () => {
      const mailbox = await newMailbox();
      await service.ingest(
        {
          mailboxId: mailbox,
          raw: forwardInline({
            messageId: '<inline-later@corp.test>',
            block: outlookForwardBlock({ from: 'Later <later@acme.test>', cc: null }),
          }),
        },
        SYSTEM,
      );
      // A row whose body quotes a forward its stored set does not carry: the
      // re-match reads `match_addresses`, so the body's addresses never match.
      await insert('sys_mail_message', {
        organization_id: ORG_A,
        mailbox_id: mailbox,
        received_at: new Date().toISOString(),
        association_state: 'unassociated',
        dedupe_key: 'mid:inline-body-only',
        body_text: gmailForwardBlock({ from: 'Body Only <body-only@acme.test>', cc: null }),
        match_addresses: JSON.stringify([{ address: 'rep@corp.test', source: 'outer' }]),
      });
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toEqual({
        scanned: 2, linksAdded: 0, associated: 0, unreadable: [],
      });

      const later = await insert('mailtest_contact', { organization_id: ORG_A, name: 'L', email: 'later@acme.test' });
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'B', email: 'body-only@acme.test' });
      expect(await service.rematch({ mailboxId: mailbox }, SYSTEM)).toEqual({
        scanned: 2, linksAdded: 1, associated: 1, unreadable: [],
      });
      const rows = await messagesIn(mailbox);
      const replayed = rows.find((r) => r.message_id === 'inline-later@corp.test')!;
      expect(replayed.association_state).toBe('associated');
      expect((await linksOf(replayed.id)).map((l) => [l.record_id, l.matched_address, l.matched_by])).toEqual([
        [later, 'later@acme.test', 'rematch'],
      ]);
      const bodyOnly = rows.find((r) => r.dedupe_key === 'mid:inline-body-only')!;
      expect(bodyOnly.association_state).toBe('unassociated');
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

  describe('attachments: each part is handed to the attach verb as a file of the row', () => {
    /**
     * The verb as the producer sees it: it records each call, with the state
     * of the parent row AT the call (the row must exist first), and refuses
     * the file names it is told to. The verb's own behaviour is pinned on the
     * real one in `mailbox-attachments-kernel.test.ts`; here what is measured
     * is what the seam hands it, and when.
     */
    type Call = AttachFileInput & { parentAtCall: Row | undefined };
    let calls: Call[];
    let refuse: Map<string, Error>;
    let attaching: MailIngestService;
    const said: { warn: string[]; error: string[] } = { warn: [], error: [] };
    const verb: IFileAttachmentService = {
      async attachFile(input) {
        const [parent] = await find(input.parentObject, { id: input.parentId });
        calls.push({ ...input, parentAtCall: parent });
        const refusal = refuse.get(input.filename);
        if (refusal) throw refusal;
        return { fileId: `file_${calls.length}`, attachmentId: `att_${calls.length}`, size: input.data.byteLength };
      },
    };
    const refusalOf = (code: string, status: number, message: string) =>
      Object.assign(new Error(message), { code, status });

    const ORIGINAL = rfc822(
      [
        ['From', 'Customer <customer@acme.test>'],
        ['To', 'rep@corp.test'],
        ['Subject', 'What does it cost?'],
        ['Message-ID', '<attach-orig@acme.test>'],
      ],
      'What does it cost?',
    );
    const PDF = binaryBytes(40);
    /** The card's message: one forwarded message and one file. */
    const forwardWithFile = (messageId: string) =>
      messageWithParts({
        messageId,
        parts: [
          { contentType: 'application/pdf; name="quote.pdf"', disposition: 'attachment; filename="quote.pdf"', bytes: PDF },
          { contentType: 'message/rfc822', disposition: 'attachment; filename="question.eml"', message: ORIGINAL },
        ],
      });

    beforeAll(() => {
      attaching = new MailIngestService({
        engine: () => engine as unknown as MailIngestEngine,
        logger: { warn: (m: string) => said.warn.push(m), error: (m: string) => said.error.push(m) },
        attachments: () => verb,
      });
    });
    beforeEach(() => {
      calls = [];
      refuse = new Map();
      said.warn.length = 0;
      said.error.length = 0;
    });

    it('stores the file and the forwarded message (.eml), in message order, on the row, in the mailbox’s organization', async () => {
      const mailbox = await newMailbox(ORG_A);
      const result = await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-1@corp.test>') }, SYSTEM);

      expect(result.outcome).toBe('stored');
      const messageId = (result as { messageId: string }).messageId;
      const rows = await messagesIn(mailbox);
      expect(rows.map((r) => r.id)).toEqual([messageId]);
      expect(calls.map((c) => [c.parentObject, c.parentId, c.organizationId, c.filename, c.mimeType])).toEqual([
        ['sys_mail_message', messageId, ORG_A, 'quote.pdf', 'application/pdf'],
        ['sys_mail_message', messageId, ORG_A, 'question.eml', 'message/rfc822'],
      ]);
      // The bytes as the message carries them: the file's, and the forwarded
      // message exactly as it travels in its part.
      expect(Buffer.isBuffer(calls[0]!.data)).toBe(true);
      expect(new Uint8Array(calls[0]!.data)).toEqual(PDF);
      expect(calls[1]!.data.toString('utf8')).toBe(ORIGINAL);
      // The parent exists, in the mailbox's organization, before each call.
      for (const call of calls) expect(call.parentAtCall).toMatchObject({ id: messageId, organization_id: ORG_A });
      expect([...said.warn, ...said.error]).toEqual([]);
    });

    it('control: a message without parts hands the verb nothing', async () => {
      const mailbox = await newMailbox(ORG_A);
      const result = await attaching.ingest({ mailboxId: mailbox, raw: plainMessage({ 'Message-ID': '<attach-none@acme.test>' }) }, SYSTEM);
      expect(result.outcome).toBe('stored');
      expect(calls).toEqual([]);
    });

    it('acts in the mailbox’s organization, never null: a mailbox in ORG_B stores its parts in ORG_B', async () => {
      const mailbox = await newMailbox(ORG_B);
      const result = await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-org-b@corp.test>') }, SYSTEM);
      expect(calls.map((c) => [c.parentId, c.organizationId])).toEqual([
        [(result as { messageId: string }).messageId, ORG_B],
        [(result as { messageId: string }).messageId, ORG_B],
      ]);
    });

    it('a re-delivered copy stops at the dedupe: no part is handed over again', async () => {
      const mailbox = await newMailbox(ORG_A);
      const raw = forwardWithFile('<attach-again@corp.test>');
      expect((await attaching.ingest({ mailboxId: mailbox, raw }, SYSTEM)).outcome).toBe('stored');
      expect(calls).toHaveLength(2);

      expect((await attaching.ingest({ mailboxId: mailbox, raw }, SYSTEM)).outcome).toBe('duplicate');
      expect(calls).toHaveLength(2);
      expect(await messagesIn(mailbox)).toHaveLength(1);
    });

    it('control: the same parts under another Message-ID are another message, and are handed over again', async () => {
      const mailbox = await newMailbox(ORG_A);
      await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-twin-1@corp.test>') }, SYSTEM);
      await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-twin-2@corp.test>') }, SYSTEM);
      expect(calls).toHaveLength(4);
      expect(new Set(calls.map((c) => c.parentId)).size).toBe(2);
    });

    it('a re-match never re-attaches, and a suppressed message attaches nothing', async () => {
      const mailbox = await newMailbox(ORG_A);
      await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-rematch@corp.test>') }, SYSTEM);
      await insert('mailtest_contact', { organization_id: ORG_A, name: 'C', email: 'rep@corp.test' });
      expect(await attaching.rematch({ mailboxId: mailbox }, SYSTEM)).toMatchObject({ scanned: 1 });
      expect(calls).toHaveLength(2);

      const suppressed = messageWithParts({
        messageId: '<attach-ooo@corp.test>',
        headers: [['Auto-Submitted', 'auto-replied']],
        parts: [{ contentType: 'application/pdf', disposition: 'attachment; filename="ooo.pdf"', bytes: PDF }],
      });
      expect(await attaching.ingest({ mailboxId: mailbox, raw: suppressed }, SYSTEM)).toEqual({
        outcome: 'suppressed',
        reason: 'auto_submitted',
      });
      expect(calls).toHaveLength(2);
    });

    it('counts every part the parser lists — an inline image, an inline file, a nameless part — and names each', async () => {
      const mailbox = await newMailbox(ORG_A);
      const long = `${'q'.repeat(300)}.pdf`;
      const raw = messageWithParts({
        messageId: '<attach-kinds@corp.test>',
        parts: [
          // An image the HTML body shows by `cid:` reference.
          { contentType: 'image/png', disposition: 'inline; filename="logo.png"', contentId: '<logo@corp.test>', bytes: binaryBytes() },
          // Apple Mail marks the files it attaches `inline`.
          { contentType: 'application/pdf; name="apple.pdf"', disposition: 'inline; filename="apple.pdf"', bytes: PDF },
          { contentType: 'application/octet-stream', bytes: binaryBytes(1) },
          { contentType: 'application/pdf', disposition: `attachment; filename="${long}"`, bytes: PDF },
          { contentType: 'application/pdf', disposition: 'attachment; filename="../evil/path.pdf"', bytes: PDF },
          // Forwarded with no file name: named by its own Subject.
          { contentType: 'message/rfc822', message: ORIGINAL },
          // A forwarded message whose Subject cannot name it.
          { contentType: 'message/global', message: ORIGINAL.replace('Subject: What does it cost?\r\n', '') },
        ],
      });
      expect((await attaching.ingest({ mailboxId: mailbox, raw }, SYSTEM)).outcome).toBe('stored');
      const names = calls.map((c) => c.filename);
      expect(names).toEqual([
        'logo.png',
        'apple.pdf',
        'attachment-3',
        `${'q'.repeat(251)}.pdf`,
        '.._evil_path.pdf',
        'What does it cost?.eml',
        'forwarded.eml',
      ]);
      expect(calls.map((c) => c.mimeType)).toEqual([
        'image/png', 'application/pdf', 'application/octet-stream', 'application/pdf', 'application/pdf',
        'message/rfc822', 'message/global',
      ]);
      expect(names[3]).toHaveLength(255);
    });

    it('a refused part loses neither the message nor the other parts, and is said at error, by name', async () => {
      const mailbox = await newMailbox(ORG_A);
      refuse.set('quote.pdf', refusalOf('FILES_DISABLED', 403, 'Attachments are not enabled on sys_mail_message.'));

      const result = await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-refused@corp.test>') }, SYSTEM);

      expect(result.outcome).toBe('stored');
      expect(await messagesIn(mailbox)).toHaveLength(1);
      expect(calls.map((c) => c.filename)).toEqual(['quote.pdf', 'question.eml']);
      expect(said.error).toHaveLength(1);
      expect(said.error[0]).toContain("'quote.pdf'");
      expect(said.error[0]).toContain('FILES_DISABLED (403)');
      expect(said.error[0]).toContain('is NOT stored');
      expect(said.warn).toEqual([]);
    });

    it('control: the same message with no refusal says nothing', async () => {
      const mailbox = await newMailbox(ORG_A);
      await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-not-refused@corp.test>') }, SYSTEM);
      expect(said.error).toEqual([]);
    });

    it('a part the verb throws on without an envelope is said too, and the message is still stored', async () => {
      const mailbox = await newMailbox(ORG_A);
      refuse.set('question.eml', new Error('storage backend unreachable'));
      const result = await attaching.ingest({ mailboxId: mailbox, raw: forwardWithFile('<attach-thrown@corp.test>') }, SYSTEM);
      expect(result.outcome).toBe('stored');
      expect(said.error).toHaveLength(1);
      expect(said.error[0]).toContain("'question.eml'");
      expect(said.error[0]).toContain('storage backend unreachable');
    });

    it('with no attach verb composed, the message is stored without its parts, and that is said once', async () => {
      for (const attachments of [() => undefined, undefined]) {
        const quiet: string[] = [];
        const loud: string[] = [];
        const withoutStorage = new MailIngestService({
          engine: () => engine as unknown as MailIngestEngine,
          logger: { warn: (m: string) => quiet.push(m), error: (m: string) => loud.push(m) },
          ...(attachments ? { attachments } : {}),
        });
        const mailbox = await newMailbox(ORG_A);
        for (const id of ['<nostore-1@corp.test>', '<nostore-2@corp.test>']) {
          expect((await withoutStorage.ingest({ mailboxId: mailbox, raw: forwardWithFile(id) }, SYSTEM)).outcome).toBe('stored');
        }
        expect(await messagesIn(mailbox)).toHaveLength(2);
        expect(quiet.filter((m) => m.includes("'file-attachments' service is composed"))).toHaveLength(1);
        expect(loud).toEqual([]);
      }
      expect(calls).toEqual([]);
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
