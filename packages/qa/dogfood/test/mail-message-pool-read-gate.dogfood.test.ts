// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22870] The inbound-mail objects on a showcase boot, through the data API:
// `sys_mail_message` is registered and served, and its unassociated pool is
// RESTRICTED by default — mailbox owners and mailbox administrators only, never
// every member who holds the object's read grant.
//
// ## The composition
//
// The showcase as `objectstack serve` composes it (`bootShowcase`), whose
// `requires` names `mailbox`, so `MailboxServicePlugin` registers the three
// objects and installs both read gates. A fixture security plugin adds three
// permission sets: object read on the mail objects (and on the showcase
// contact the fixture associates mail with), and the explicit grant of the
// mailbox administrator capability. Principals:
//
//   - READER: holds the mail read set and owns one contact (its own record);
//   - OWNER: holds the mail read set and owns the fixture mailbox;
//   - HOLDER: holds the mail read set and the capability;
//   - OUTSIDER: holds no grant on the mail objects (the 403 control);
//   - the seeded platform administrator (a default holder of the capability).
//
// The rows, written as the system as the ingest service writes them:
//   - one mailbox, owned by OWNER;
//   - message ASSOCIATED: linked to the reader's own contact;
//   - message FOREIGN: linked to a contact the reader cannot read;
//   - message POOL: no association at all (the unassociated pool).
//
// `@objectstack/service-mailbox` resolves through its BUILT output here (it is
// reached through `@objectstack/verify`'s provider table), so a verdict on a
// change to the gates is a verdict on their last build. Fixtures are synthetic.
// ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';
import { PermissionSetSchema, PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { bootShowcase } from './showcase-boot.js';
import { assertArmed, armedWhen } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

/** The capability under test, as `PLATFORM_CAPABILITIES` declares it. */
const CAP = 'manage_mailboxes';
const MESSAGE = 'sys_mail_message';
const ASSOCIATION = 'sys_mail_association';
const MAILBOX = 'sys_mailbox';
const CONTACT = 'showcase_contact';
const SYS = { isSystem: true } as const;
const DOMAIN = 'mail-pool-22870.verify.test';
const PASSWORD = 'Mail-Pool-Pass-22870';

const read = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
/**
 * Object read on the three mail objects and the contact the fixture associates
 * mail with. The mailbox directory's grant is here too, so a refusal of it
 * below comes from the directory's capability requirement, not from a missing
 * grant.
 */
const mailReadSet = PermissionSetSchema.parse({
  name: 'mail_pool_22870_read',
  label: 'Mail read (fixture)',
  objects: { [MESSAGE]: read, [ASSOCIATION]: read, [MAILBOX]: read, [CONTACT]: read },
});
/** The explicit grant of the mailbox administrator capability. */
const mailAdminSet = PermissionSetSchema.parse({
  name: 'mail_pool_22870_admin',
  label: 'Mailbox administrator (fixture)',
  objects: {},
  systemPermissions: [CAP],
});

type Who = 'admin' | 'reader' | 'owner' | 'holder' | 'outsider';
type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));

describe('[#22870] the inbound-mail pool is restricted to mailbox owners and administrators, through the data API on a showcase boot', () => {
  let stack: VerifyStack;
  let ql: any;
  const token = {} as Record<Who, string>;
  const uid = {} as Record<Who, string>;
  const id = { mailbox: '', ownContact: '', foreignContact: '', associated: '', foreign: '', pool: '' };

  const atRest = async (object: string, where: Record<string, unknown>): Promise<Row[]> =>
    (await ql.find(object, { where, limit: 50, context: { ...SYS } })) ?? [];
  const byId = async (who: Who, object: string, rowId: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${object}/${rowId}`);
    const body: any = await res.json().catch(() => ({}));
    return { status: res.status, code: body?.code ?? body?.error?.code, body };
  };
  const list = async (who: Who, object: string, where: Record<string, unknown>) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${object}?$filter=${filterOf(where)}&limit=50`);
    expect(res.status, `${who} lists ${object}`).toBe(200);
    const body: any = await res.json();
    return { ids: rowsOf(body).map((r) => String(r.id)).sort(), total: Number(body.total) };
  };
  const inMailbox = () => ({ mailbox_id: id.mailbox });

  beforeAll(async () => {
    stack = await bootShowcase({
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, mailReadSet, mailAdminSet],
      }),
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token.admin = await stack.signIn(); // the seeded platform administrator
    const userIdOf = async (email: string) => String((await atRest('sys_user', { email }))[0]?.id ?? '');
    uid.admin = await userIdOf('admin@objectos.ai');
    const grant = async (who: Who, setName: string) => {
      // [ADR-0131 D3] A set is served by name from the security catalog; no
      // boot writes a `sys_permission_set` row for it.
      const set = await catalogPermissionSet(ql, setName);
      expect(set, `fixture permission set ${setName} served by the security catalog`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: uid[who], permission_set: set.name }, { context: { ...SYS } });
    };
    for (const who of ['reader', 'owner', 'holder', 'outsider'] as const) {
      const email = `${who}@${DOMAIN}`;
      token[who] = await stack.signUp(email, PASSWORD, `Mail Pool ${who}`);
      uid[who] = await userIdOf(email);
    }
    for (const who of ['reader', 'owner', 'holder'] as const) await grant(who, mailReadSet.name);
    await grant('holder', mailAdminSet.name);

    // The organization every fixture row is stamped with: the reader's own,
    // as the ingest service stamps a message with its mailbox's organization.
    const [membership] = await atRest('sys_member', { user_id: uid.reader });
    const organization = membership?.organization_id ? { organization_id: membership.organization_id } : {};
    const insert = async (object: string, data: Record<string, unknown>) =>
      String((await ql.insert(object, { ...organization, ...data }, { context: { ...SYS } })).id);

    id.ownContact = await insert(CONTACT, { name: 'Mail Pool Own', email: `own@${DOMAIN}`, owner_id: uid.reader });
    id.foreignContact = await insert(CONTACT, { name: 'Mail Pool Foreign', email: `foreign@${DOMAIN}`, owner_id: uid.admin });
    id.mailbox = await insert(MAILBOX, { name: 'Mail Pool Inbox', address: `inbox@${DOMAIN}`, owner_user_id: uid.owner });
    const message = (key: string, state: 'associated' | 'unassociated') =>
      insert(MESSAGE, {
        mailbox_id: id.mailbox,
        subject: `Mail pool ${key}`,
        from_address: `${key}@${DOMAIN}`,
        received_at: new Date().toISOString(),
        association_state: state,
        dedupe_key: `mail-pool-22870-${key}`,
      });
    id.associated = await message('associated', 'associated');
    id.foreign = await message('foreign', 'associated');
    id.pool = await message('pool', 'unassociated');
    const link = (messageId: string, recordId: string, address: string) =>
      insert(ASSOCIATION, {
        mail_message_id: messageId,
        object_name: CONTACT,
        record_id: recordId,
        matched_address: address,
        matched_field: 'email',
        matched_by: 'ingest',
      });
    await link(id.associated, id.ownContact, `own@${DOMAIN}`);
    await link(id.foreign, id.foreignContact, `foreign@${DOMAIN}`);

    await assertArmed([
      armedWhen({
        control: 'the declaration: the capability is a curated organization capability, and the platform administrator grant carries it',
        disarmedBy: 'a capability nobody declares or grants would make the exemption cases a statement about a string',
        observe: async () => ({
          declared: PLATFORM_CAPABILITIES.find((c) => c.name === CAP)?.scope ?? 'undeclared',
          adminGrant: (ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []).includes(CAP),
        }),
        armed: (o) => o.declared === 'org' && o.adminGrant,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'at rest: three messages in the fixture mailbox, two associations, and the pool message has none',
        disarmedBy: 'a fixture write that never landed would let every refusal below pass on a row that does not exist',
        observe: async () => ({
          messages: (await atRest(MESSAGE, inMailbox())).length,
          associations: (await atRest(ASSOCIATION, { object_name: CONTACT, record_id: { $in: [id.ownContact, id.foreignContact] } })).length,
          poolLinks: (await atRest(ASSOCIATION, { mail_message_id: id.pool })).length,
        }),
        armed: (o) => o.messages === 3 && o.associations === 2 && o.poolLinks === 0,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the reader reads its own contact and not the foreign one (the record half of the gate has something to decide)',
        disarmedBy: 'a reader who could read both contacts, or neither, would make the associated and foreign cases indistinguishable',
        observe: async () => ({
          own: (await byId('reader', CONTACT, id.ownContact)).status,
          foreign: (await byId('reader', CONTACT, id.foreignContact)).status,
        }),
        armed: (o) => o.own === 200 && o.foreign === 404,
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the object is registered and served: the reader reads a message associated with its own record (positive control)', async () => {
    const a = await byId('reader', MESSAGE, id.associated);
    expect(a.status).toBe(200);
    expect(String((a.body?.record ?? a.body?.data ?? a.body)?.id)).toBe(id.associated);
  });

  it('the pin: an ordinary member reading an unassociated message is refused as not found', async () => {
    const a = await byId('reader', MESSAGE, id.pool);
    expect(a.status).toBe(404);
    expect(a.code).toBe('RECORD_NOT_FOUND');
  });

  it('a message associated only with a record the reader cannot read is refused as not found', async () => {
    const a = await byId('reader', MESSAGE, id.foreign);
    expect(a.status).toBe(404);
    expect(a.code).toBe('RECORD_NOT_FOUND');
  });

  it('list: the reader is served only the associated message, and the total agrees with the rows', async () => {
    expect(await list('reader', MESSAGE, inMailbox())).toEqual({ ids: [id.associated], total: 1 });
  });

  it('list: the reader is served only the association naming its own record', async () => {
    const served = await list('reader', ASSOCIATION, { mail_message_id: { $in: [id.associated, id.foreign] } });
    expect(served.total).toBe(1);
    const [row] = await atRest(ASSOCIATION, { mail_message_id: id.associated });
    expect(served.ids).toEqual([String(row.id)]);
  });

  it('the mailbox owner is served every message of its mailbox, the pool included', async () => {
    expect((await byId('owner', MESSAGE, id.pool)).status).toBe(200);
    expect(await list('owner', MESSAGE, inMailbox())).toEqual({
      ids: [id.associated, id.foreign, id.pool].sort(),
      total: 3,
    });
  });

  it('a holder of the mailbox administrator capability is served the pool (the exemption control)', async () => {
    expect((await byId('holder', MESSAGE, id.pool)).status).toBe(200);
    expect((await list('holder', MESSAGE, inMailbox())).total).toBe(3);
    expect((await byId('admin', MESSAGE, id.pool)).status).toBe(200);
  });

  it('a member with no grant on the object is refused at the object, not at the gate (the 403 control)', async () => {
    const a = await byId('outsider', MESSAGE, id.pool);
    expect(a.status).toBe(403);
    expect(a.code).toBe('PERMISSION_DENIED');
  });

  it('the mailbox directory is served only to a holder of the capability, its owner included in the refusal', async () => {
    expect((await byId('holder', MAILBOX, id.mailbox)).status).toBe(200);
    const a = await byId('owner', MAILBOX, id.mailbox);
    expect(a.status).toBe(403);
    expect(a.code).toBe('PERMISSION_DENIED');
  });
});
