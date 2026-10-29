// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The parent-derived write reach family — what it reads from the metadata,
// what it proves on a real stack, and the controls that keep its green honest:
//
//   • the NEGATIVE control: an app hook on a detail that refuses with the
//     platform's own `403 PERMISSION_DENIED` where the master is editable, so
//     the detail's answer disagrees with its master's — found without any
//     engine change, and reported contradicted;
//   • the ATTRIBUTION control: a refusal that is not the platform's
//     authorization refusal (an app's own code) never reads as a held refusal;
//   • a run on a stack booted without `parentWriteReachSecurity` reports the
//     verifier personas not run, with the reason, and counts them.
//
// The door is the engine's write as each persona (the calls the REST data
// ingress makes, with the caller's context), so a refusal keeps its own
// `details`: attribution reads the object and the operation it names.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';

import { bootStack, type VerifyStack } from './harness.js';
import { warmUpBoot } from './boot-warm-up.testkit.js';
import {
  deriveParentWriteReachCases,
  runParentWriteReachProofs,
  formatParentWriteReachReport,
  parentWriteReachSecurity,
  type ParentWriteReachReport,
} from './parent-write-reach.js';

// The boot's first load, paid during collection rather than in the first
// case's clock (see `boot-warm-up.testkit.ts`). The boots below differ only in
// their app and its security source, which the warm-up does not share.
await warmUpBoot();

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;
const RUN_TIMEOUT = 180_000;

const manager = {
  name: 'pwr_manager',
  label: 'Manager',
  objects: {
    // Every account by the all-records grant, owning none of them.
    pwr_account: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
    // Edit and create a contract, never delete one.
    pwr_contract: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
    pwr_quote: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
    pwr_quote_line: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
  },
};
const rep = {
  name: 'pwr_rep',
  label: 'Rep',
  objects: {
    // Its own accounts only, and a contract it reads but never edits.
    pwr_account: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'own' },
    pwr_contract: { allowRead: true },
    pwr_quote: { allowCreate: true, allowRead: true, allowEdit: true },
    pwr_quote_line: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true },
  },
};

const source = {
  manifest: { id: 'com.example.parent-write-reach', namespace: 'pwr', version: '0.0.1', type: 'app', name: 'Parent Write Reach Fixture' },
  objects: [
    { name: 'pwr_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
    { name: 'pwr_person', label: 'Person', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
    {
      name: 'pwr_contract',
      label: 'Contract',
      sharingModel: 'controlled_by_parent',
      fields: {
        account: { type: 'master_detail', required: true, label: 'Account', reference: 'pwr_account' },
        // A second required reference, to an object the personas hold no grant on.
        signer: { type: 'lookup', label: 'Signer', reference: 'pwr_person', required: true },
        title: { type: 'text', label: 'Title' },
      },
    },
    {
      name: 'pwr_quote',
      label: 'Quote',
      sharingModel: 'controlled_by_parent',
      fields: { account: { type: 'master_detail', required: true, label: 'Account', reference: 'pwr_account' }, title: { type: 'text', label: 'Title' } },
    },
    {
      // Two levels: a line's master is a quote, whose own master is an account.
      name: 'pwr_quote_line',
      label: 'Quote line',
      sharingModel: 'controlled_by_parent',
      fields: { quote: { type: 'master_detail', required: true, label: 'Quote', reference: 'pwr_quote' }, title: { type: 'text', label: 'Title' } },
    },
  ],
  permissions: [manager, rep],
  // [ADR-0131 D3/D4; #24757] Each position names its set: a set that only
  // shares a position's name is granted by nothing.
  positions: [
    { name: 'pwr_manager', label: 'Manager', permissionSets: ['pwr_manager'] },
    { name: 'pwr_rep', label: 'Rep', permissionSets: ['pwr_rep'] },
  ],
};

const VERIFIERS = ['master-all-records', 'detail-only', 'master-all-records-no-delete'] as const;

const resultFor = (report: ParentWriteReachReport, object: string) => {
  const r = report.results.find((x) => x.object === object);
  if (!r) throw new Error(`no result for ${object}`);
  return r;
};

const reachOf = (report: ParentWriteReachReport, object: string, persona: string, masters: 'other' | 'own') => {
  const r = resultFor(report, object).reaches.find((x) => x.persona === persona && x.masters === masters);
  if (!r) throw new Error(`no reach for ${object} ${persona} ${masters}`);
  return r;
};

/** `verb[/detail owner] expected outcome`, per probe of one reach. */
const shape = (report: ParentWriteReachReport, object: string, persona: string, masters: 'other' | 'own') =>
  reachOf(report, object, persona, masters).probes.map((p) => `${p.verb}${p.detailOwner ? `/${p.detailOwner}` : ''} ${p.expected} ${p.outcome}`);

const ALL_ALLOWED = [
  'edit/other allowed held', 'delete/other allowed held', 'edit/own allowed held', 'delete/own allowed held', 'create allowed held',
];
const ALL_REFUSED = [
  'edit/other refused held', 'delete/other refused held', 'edit/own refused held', 'delete/own refused held', 'create refused held',
];
const NO_DELETE = [
  'edit/other allowed held', 'delete/other refused held', 'edit/own allowed held', 'delete/own refused held', 'create allowed held',
];

describe('deriveParentWriteReachCases — what the family reads from the metadata', () => {
  it("reads controlled_by_parent and the master through the spec's parse, walks the chain, and names what it cannot compare", () => {
    // Ten controlled_by_parent objects in a row above an account: eight
    // controlled_by_parent masters above `pwr_deep_0` and `pwr_deep_1` reach
    // the write gate's depth bound; `pwr_deep_2` has seven.
    const deep = Array.from({ length: 10 }, (_, i) => ({
      name: `pwr_deep_${i}`,
      sharingModel: 'controlled_by_parent',
      fields: { up: { type: 'master_detail', required: true, reference: i === 9 ? 'pwr_account' : `pwr_deep_${i + 1}` } },
    }));
    const config = {
      objects: [
        ...source.objects,
        { name: 'pwr_public', sharingModel: 'public_read_write', fields: { account: { type: 'master_detail', reference: 'pwr_account' } } },
        {
          name: 'pwr_two_masters',
          sharingModel: 'controlled_by_parent',
          fields: {
            account: { type: 'master_detail', required: true, reference: 'pwr_account' },
            person: { type: 'master_detail', required: true, reference: 'pwr_person' },
          },
        },
        { name: 'pwr_no_master', sharingModel: 'controlled_by_parent', fields: { account: { type: 'lookup', reference: 'pwr_account', required: true } } },
        { name: 'pwr_outside', sharingModel: 'controlled_by_parent', fields: { owner: { type: 'master_detail', required: true, reference: 'crm_elsewhere' } } },
        { name: 'pwr_loop_a', sharingModel: 'controlled_by_parent', fields: { b: { type: 'master_detail', required: true, reference: 'pwr_loop_b' } } },
        { name: 'pwr_loop_b', sharingModel: 'controlled_by_parent', fields: { a: { type: 'master_detail', required: true, reference: 'pwr_loop_a' } } },
        { name: 'pwr_badge', label: 'Badge', fields: { photo: { type: 'image', required: true } } },
        { name: 'pwr_badge_line', sharingModel: 'controlled_by_parent', fields: { badge: { type: 'master_detail', required: true, reference: 'pwr_badge' } } },
        { name: 'pwr_bad', sharingModel: 'controlled_by_parent', fields: { account: { type: 'master_detail', required: true, reference: 'pwr_account', bogus: true } } },
        ...deep,
      ],
    };
    const byObject = new Map(deriveParentWriteReachCases(config).map((c) => [c.object, c]));

    // Every object the parse declares controlled_by_parent, and nothing else.
    expect([...byObject.keys()].sort()).toEqual([
      'pwr_bad', 'pwr_badge_line', 'pwr_contract',
      ...deep.map((d) => d.name).sort(),
      'pwr_loop_a', 'pwr_loop_b', 'pwr_no_master', 'pwr_outside', 'pwr_quote', 'pwr_quote_line', 'pwr_two_masters',
    ].sort());
    expect(byObject.get('pwr_contract')).toEqual({ object: 'pwr_contract', hops: [{ object: 'pwr_contract', field: 'account', master: 'pwr_account' }] });
    expect(byObject.get('pwr_quote_line')).toEqual({
      object: 'pwr_quote_line',
      hops: [
        { object: 'pwr_quote_line', field: 'quote', master: 'pwr_quote' },
        { object: 'pwr_quote', field: 'account', master: 'pwr_account' },
      ],
    });
    // Named instead of probed.
    // [#23100] ADR-0055 §1 is the parse's rule now: two required masters and a
    // master derived through a required lookup are refused by `ObjectSchema`
    // itself, so the family names the parse's refusal rather than its own.
    expect(byObject.get('pwr_two_masters')!.excluded).toMatch(
      /^the object does not parse under the spec's ObjectSchema \(fields: Object 'pwr_two_masters' declares sharingModel 'controlled_by_parent' with 2 required `master_detail` fields/,
    );
    expect(byObject.get('pwr_no_master')!.excluded).toMatch(
      /^the object does not parse under the spec's ObjectSchema \(sharingModel: Object 'pwr_no_master' declares sharingModel 'controlled_by_parent' but no required `master_detail` field/,
    );
    expect(byObject.get('pwr_outside')!.excluded).toMatch(/^the master crm_elsewhere is not an object this app declares/);
    expect(byObject.get('pwr_loop_a')!.excluded).toMatch(/^the master chain re-enters pwr_loop_a \(a cycle\)/);
    expect(byObject.get('pwr_deep_0')!.excluded).toMatch(/^the master chain reaches 8 controlled_by_parent masters, the write gate's depth bound/);
    expect(byObject.get('pwr_deep_1')!.excluded).toMatch(/^the master chain reaches 8 controlled_by_parent masters/);
    expect(byObject.get('pwr_deep_2')!.excluded).toBeUndefined();
    expect(byObject.get('pwr_deep_2')!.hops).toHaveLength(8);
    expect(byObject.get('pwr_deep_2')!.hops.at(-1)).toEqual({ object: 'pwr_deep_9', field: 'up', master: 'pwr_account' });
    // [#23100] With its master_detail now `required: true` (the one shape ADR-0055 §1
    // admits), the detail itself needs a synthesized master, so the family names the
    // detail's own block — the same unsynthesizable master, reached one hop earlier.
    expect(byObject.get('pwr_badge_line')!.notDerivable).toMatch(
      /^the detail cannot be synthesized: required relational target "pwr_badge" is not synthesizable/,
    );
    expect(byObject.get('pwr_bad')!.excluded).toMatch(/^the object does not parse under the spec's ObjectSchema/);
  });
});

describe('runParentWriteReachProofs — the fixture app, booted with parentWriteReachSecurity', () => {
  let stack: VerifyStack;
  let report: ParentWriteReachReport;
  const app = defineStack(source as never) as unknown as typeof source;

  beforeAll(async () => {
    stack = await bootStack(app as never, { security: parentWriteReachSecurity(app) });
    report = await runParentWriteReachProofs(stack, app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('runs every persona: the three verifier personas and one per declared position', () => {
    expect(report.door).toBe('user');
    expect(report.personas.map((p) => `${p.name} ${p.status}`)).toEqual([
      ...VERIFIERS.map((v) => `${v} run`), 'position:pwr_manager run', 'position:pwr_rep run',
    ]);
    // The server's own resolution of the sets each holds.
    expect(report.personas.find((p) => p.name === 'position:pwr_manager')!.permissionSets).toContain('pwr_manager');
    expect(report.personas.find((p) => p.name === 'master-all-records')!.permissionSets).toContain('verify_parent_write_master_all');
  });

  it('proves every single-level detail, for every persona, under a master chain another principal owns and one it owns', () => {
    for (const object of ['pwr_contract', 'pwr_quote']) {
      expect(resultFor(report, object).status, formatParentWriteReachReport(report)).toBe('proven');
      for (const masters of ['other', 'own'] as const) {
        expect(shape(report, object, 'master-all-records', masters)).toEqual(ALL_ALLOWED);
        // The detail's own verbs, and the master readable but not editable: refused by the master.
        expect(shape(report, object, 'detail-only', masters)).toEqual(ALL_REFUSED);
        expect(reachOf(report, object, 'detail-only', masters).masterEdit).toBe('not-editable');
        // The master's all-records grant widens which rows, never which verbs.
        expect(shape(report, object, 'master-all-records-no-delete', masters)).toEqual(NO_DELETE);
      }
    }
  });

  it("reads hotcrm's contract shape: the manager writes another's contract through the account, never deletes it; the rep's object gate stands", () => {
    // The account is another principal's; the manager edits it by the all-records grant alone.
    const other = reachOf(report, 'pwr_contract', 'position:pwr_manager', 'other');
    expect(other).toMatchObject({ masterRead: 'readable', masterEdit: 'editable', grants: { edit: true, delete: false, create: true } });
    expect(shape(report, 'pwr_contract', 'position:pwr_manager', 'other')).toEqual(NO_DELETE);
    // A refusal is the platform's authorization refusal for the detail.
    expect(other.probes.find((p) => p.verb === 'delete')!.answer).toMatchObject({
      kind: 'refused', status: 403, code: 'PERMISSION_DENIED', object: 'pwr_contract', operation: 'delete',
    });
    // The rep cannot read another's account, so that chain is outside its reach, and named.
    expect(reachOf(report, 'pwr_contract', 'position:pwr_rep', 'other')).toMatchObject({ masterRead: 'unreadable', probes: [] });
    // On its own account the rep edits the master and is still refused the contract: the object gate.
    expect(reachOf(report, 'pwr_contract', 'position:pwr_rep', 'own')).toMatchObject({ masterEdit: 'editable', grants: { edit: false, delete: false, create: false } });
    expect(shape(report, 'pwr_contract', 'position:pwr_rep', 'own')).toEqual(ALL_REFUSED);
    expect(shape(report, 'pwr_quote', 'position:pwr_rep', 'own')).toEqual(NO_DELETE);
  });

  it('proves a two-level detail whose master the persona edits, for every persona, as the quote\'s own write answers', () => {
    // ADR-0055's amendment: the write gate walks the chain hop by hop, and a
    // detail whose whole chain is reachable stays writable. Since the
    // maintainer's ruling A on #23093 the hop judges the quote by the
    // composition its own write is judged by, so a quote line agrees with the
    // same persona's update of the quote, its own chain included.
    const r = resultFor(report, 'pwr_quote_line');
    expect(r.status, formatParentWriteReachReport(report)).toBe('proven');
    for (const masters of ['other', 'own'] as const) {
      const reach = reachOf(report, 'pwr_quote_line', 'master-all-records', masters);
      expect(reach.masterEdit).toBe('editable');
      // Admitted, and the record shows each write landed (the family's own read-back).
      expect(shape(report, 'pwr_quote_line', 'master-all-records', masters)).toEqual(ALL_ALLOWED);
      for (const p of reach.probes) expect(p.answer).toMatchObject({ kind: 'written' });
      // Where the conjunction refuses, the refusal still holds.
      expect(shape(report, 'pwr_quote_line', 'detail-only', masters)).toEqual(ALL_REFUSED);
    }
    expect(formatParentWriteReachReport(report)).toContain('✓ pwr_quote_line (pwr_quote_line.quote → pwr_quote, pwr_quote.account → pwr_account)  held on');
  });

  it('counts every reach and write, and every object is proven', () => {
    expect(report.summary).toEqual({
      objects: 3,
      probed: 3,
      proven: 3,
      contradicted: 0,
      failed: 0,
      inconclusive: 0,
      excluded: 0,
      notDerivable: 0,
      personas: { run: 5, notRun: 0 },
      // 3 objects × 5 personas × 2 master chains, the rep's three chains another principal owns outside its reach.
      reaches: { probed: 27, unreadable: 3, unmeasured: 0 },
      probes: { edit: 54, delete: 54, create: 27 },
      held: 135,
      contradictions: 0,
      unattributed: 0,
      faults: 0,
      notRun: 0,
      hardFailures: 0,
    });
  });
});

/**
 * The negative and attribution controls. `pwc_signed`'s hooks refuse every
 * edit and delete with the platform's own envelope (`403 PERMISSION_DENIED`,
 * `details` naming the write), whoever writes and whatever the master says;
 * `pwc_frozen`'s hook refuses every edit of the MASTER that way, so its edit
 * reads refused while nothing stops a write of its details; `pwc_locked`'s
 * refuse an edit with that envelope naming ANOTHER object, and a delete with
 * the app's own code.
 */
const deny = (code: string, status: number, details?: { operation: string; object: string }) => async () => {
  throw Object.assign(new Error(`refused by the app (${code})`), { code, status, ...(details ? { details } : {}) });
};
const controlSource = {
  manifest: { id: 'com.example.parent-write-reach-controls', namespace: 'pwc', version: '0.0.1', type: 'app', name: 'Parent Write Reach Controls' },
  objects: [
    { name: 'pwc_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
    {
      name: 'pwc_signed',
      label: 'Signed',
      sharingModel: 'controlled_by_parent',
      fields: { account: { type: 'master_detail', required: true, label: 'Account', reference: 'pwc_account' }, title: { type: 'text', label: 'Title' } },
    },
    {
      name: 'pwc_locked',
      label: 'Locked',
      sharingModel: 'controlled_by_parent',
      fields: { account: { type: 'master_detail', required: true, label: 'Account', reference: 'pwc_account' }, title: { type: 'text', label: 'Title' } },
    },
    { name: 'pwc_frozen', label: 'Frozen', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
    {
      name: 'pwc_frozen_line',
      label: 'Frozen line',
      sharingModel: 'controlled_by_parent',
      fields: { frozen: { type: 'master_detail', required: true, label: 'Frozen', reference: 'pwc_frozen' }, title: { type: 'text', label: 'Title' } },
    },
  ],
  hooks: [
    // Update and delete only: the fixtures are seeded through a door that
    // runs hooks, so an insert refusal would refuse the fixtures too.
    {
      name: 'pwc_signed_refuses_an_edit',
      object: 'pwc_signed',
      events: ['beforeUpdate'],
      handler: deny('PERMISSION_DENIED', 403, { operation: 'update', object: 'pwc_signed' }),
    },
    {
      name: 'pwc_signed_refuses_a_delete',
      object: 'pwc_signed',
      events: ['beforeDelete'],
      handler: deny('PERMISSION_DENIED', 403, { operation: 'delete', object: 'pwc_signed' }),
    },
    {
      name: 'pwc_locked_refuses_an_edit_naming_the_account',
      object: 'pwc_locked',
      events: ['beforeUpdate'],
      handler: deny('PERMISSION_DENIED', 403, { operation: 'update', object: 'pwc_account' }),
    },
    {
      name: 'pwc_frozen_refuses_every_edit',
      object: 'pwc_frozen',
      events: ['beforeUpdate'],
      handler: deny('PERMISSION_DENIED', 403, { operation: 'update', object: 'pwc_frozen' }),
    },
    {
      name: 'pwc_locked_refuses_a_delete_with_its_own_code',
      object: 'pwc_locked',
      events: ['beforeDelete'],
      handler: deny('RECORD_LOCKED', 409),
    },
  ],
};

describe('runParentWriteReachProofs — NEGATIVE and ATTRIBUTION controls', () => {
  let stack: VerifyStack;
  let report: ParentWriteReachReport;
  const app = defineStack(controlSource as never) as unknown as typeof controlSource;

  beforeAll(async () => {
    stack = await bootStack(app as never, { security: parentWriteReachSecurity(app) });
    report = await runParentWriteReachProofs(stack, app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('NEGATIVE CONTROL: a detail refusing with the platform code where its master is editable is reported contradicted', () => {
    const r = resultFor(report, 'pwc_signed');
    expect(r.status, formatParentWriteReachReport(report)).toBe('contradicted');
    for (const masters of ['other', 'own'] as const) {
      expect(shape(report, 'pwc_signed', 'master-all-records', masters)).toEqual([
        'edit/other allowed contradicted', 'delete/other allowed contradicted',
        'edit/own allowed contradicted', 'delete/own allowed contradicted',
        'create allowed held',
      ]);
      // Where the conjunction refuses too, the same refusal holds.
      expect(shape(report, 'pwc_signed', 'detail-only', masters)).toEqual(ALL_REFUSED);
    }
  });

  it('NEGATIVE CONTROL: details admitted under a master whose own edit is refused are reported contradicted', () => {
    const r = resultFor(report, 'pwc_frozen_line');
    expect(r.status, formatParentWriteReachReport(report)).toBe('contradicted');
    for (const masters of ['other', 'own'] as const) {
      const reach = reachOf(report, 'pwc_frozen_line', 'master-all-records', masters);
      expect(reach).toMatchObject({ masterEdit: 'not-editable', masterAnswer: { code: 'PERMISSION_DENIED', object: 'pwc_frozen', operation: 'update' } });
      expect(shape(report, 'pwc_frozen_line', 'master-all-records', masters)).toEqual([
        'edit/other refused contradicted', 'delete/other refused contradicted',
        'edit/own refused contradicted', 'delete/own refused contradicted',
        'create refused contradicted',
      ]);
      for (const p of reach.probes) expect(p.detail).toMatch(/was refused an edit of its master pwc_frozen, and the (edit|delete|create) was admitted$/);
    }
    // The two negative controls, and nothing else, are the run's hard failures.
    expect(report.summary).toMatchObject({ contradicted: 2, failed: 0, hardFailures: 2 });
  });

  it("ATTRIBUTION CONTROL: an app's own refusal is never read as the platform's, held or contradicted", () => {
    const r = resultFor(report, 'pwc_locked');
    expect(r.status, formatParentWriteReachReport(report)).toBe('inconclusive');
    for (const masters of ['other', 'own'] as const) {
      // Expected allowed, and refused — naming another object, or with the app's own code: unattributed.
      expect(shape(report, 'pwc_locked', 'master-all-records', masters)).toEqual([
        'edit/other allowed unattributed', 'delete/other allowed unattributed',
        'edit/own allowed unattributed', 'delete/own allowed unattributed',
        'create allowed held',
      ]);
      const probes = reachOf(report, 'pwc_locked', 'master-all-records', masters).probes;
      for (const p of probes.filter((x) => x.verb === 'edit')) {
        expect(p.answer).toMatchObject({ kind: 'refused', status: 403, code: 'PERMISSION_DENIED', object: 'pwc_account', operation: 'update' });
        expect(p.detail).toMatch(/^refused for another reason: PERMISSION_DENIED \(403\) naming update on pwc_account/);
      }
      for (const p of probes.filter((x) => x.verb === 'delete')) {
        expect(p.answer).toMatchObject({ kind: 'refused', status: 409, code: 'RECORD_LOCKED' });
        expect(p.detail).toMatch(/^refused for another reason: RECORD_LOCKED \(409\)/);
      }
    }
    expect(r.reaches.flatMap((x) => x.probes).some((p) => p.outcome === 'contradicted')).toBe(false);
  });
});

describe('runParentWriteReachProofs — a stack booted without parentWriteReachSecurity', () => {
  let stack: VerifyStack;
  let report: ParentWriteReachReport;
  // The single-level objects only, so every probe this stack answers is one the engine agrees with.
  const singleLevel = {
    ...source,
    objects: source.objects.filter((o) => o.name !== 'pwr_quote_line'),
    permissions: source.permissions.map((set) => ({
      ...set,
      objects: Object.fromEntries(Object.entries(set.objects).filter(([name]) => name !== 'pwr_quote_line')),
    })),
  };
  const app = defineStack(singleLevel as never) as unknown as typeof source;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    report = await runParentWriteReachProofs(stack, app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('reports the verifier personas not run, with the reason, and counts them; the position personas still run', () => {
    expect(report.personas.map((p) => `${p.name} ${p.status}`)).toEqual([
      'position:pwr_manager run', 'position:pwr_rep run', ...VERIFIERS.map((v) => `${v} not-run`),
    ]);
    for (const p of report.personas.filter((x) => x.kind === 'verifier')) {
      expect(p.reason).toMatch(/the server does not resolve it for the persona: boot the stack with `parentWriteReachSecurity\(config\)`/);
    }
    expect(report.summary).toMatchObject({ proven: 2, contradicted: 0, personas: { run: 2, notRun: 3 }, hardFailures: 3 });
    expect(formatParentWriteReachReport(report)).toContain('⛔ persona master-all-records NOT RUN');
  });
});
