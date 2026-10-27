// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The unique-scope family — what it reads from the metadata, what it proves on
// a real stack, and the controls that keep its green honest:
//
//   • two NEGATIVE controls, one per leg. Within: a field declared unique on a
//     table that already holds a duplicate when the declaration arrives, so the
//     driver cannot create the index (ADR-0120 D4: the constraint is not
//     enforced until the rows are deduplicated) — every second holder is
//     admitted, and must be reported contradicted. Across: a field declared
//     per-organization beside a declared `'global'` index on the same column
//     (the R10 double declaration), so another organization is refused the
//     value — the declared per-organization scope must be reported contradicted;
//   • the ATTRIBUTION control: a refusal that is not this field's unique
//     constraint (an app hook's own dedupe; a constraint on another field the
//     twin also meets) must never read as a proven collision.
//
// The across leg needs two organizations, so it runs on a walled boot. The
// real multi-organization runtime is host-supplied and no framework package
// may declare it, so these suites boot `multiTenant: 'posture-only'`: a walled
// posture with real organizations (`/auth/organization/create`) and real
// per-caller stamping. The family's subject is which rows collide, which the
// index decides from each row's organization; isolation of reads is not under
// test here.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineStack } from '@objectstack/spec';

import { bootStack, type VerifyStack } from './harness.js';
import {
  deriveUniqueScopeCases,
  runUniqueScopeProofs,
  formatUniqueScopeReport,
  type UniqueScopeReport,
} from './unique-scope.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;
const RUN_TIMEOUT = 180_000;

/**
 * One field per scope and per door shape the family probes, and one per shape
 * it names instead. Booted as `defineStack` output, which is what an app's
 * artifact is: the parse is what puts the autonumber's `'organization'` on the
 * field the runtime registers.
 */
const source = {
  manifest: { id: 'com.example.unique-scope', namespace: 'uqs', version: '0.0.1', type: 'app', name: 'Unique Scope Fixture' },
  objects: [
    {
      name: 'uqs_account',
      label: 'Account',
      fields: {
        name: { type: 'text', label: 'Name', required: true, unique: true },
        code: { type: 'text', label: 'Code', unique: 'organization' },
        ext_id: { type: 'text', label: 'External id', unique: 'global' },
        email: { type: 'email', label: 'Email', unique: true },
        // Nothing authored: the spec's parse states `'organization'` for an autonumber.
        number: { type: 'autonumber', label: 'Number' },
        stamped: { type: 'text', label: 'Stamped', readonly: true, unique: 'global' },
        // Not in the population: no unique scope after the parse.
        sequence: { type: 'autonumber', label: 'Sequence', unique: false },
        note: { type: 'text', label: 'Note' },
        active: { type: 'boolean', label: 'Active', unique: true },
      },
    },
    {
      name: 'uqs_badge',
      label: 'Badge',
      fields: {
        title: { type: 'text', label: 'Title' },
        holder: { type: 'lookup', reference: 'uqs_account', label: 'Holder', unique: true },
      },
    },
    {
      name: 'uqs_flat',
      label: 'Flat',
      tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name', unique: true } },
    },
  ],
};

const app = defineStack(source as never) as unknown as typeof source;

const PROBED_WITHIN = [
  ['uqs_account', 'name', ['rest', 'system']],
  ['uqs_account', 'code', ['rest', 'system']],
  ['uqs_account', 'ext_id', ['rest', 'system']],
  ['uqs_account', 'email', ['rest', 'system']],
  ['uqs_account', 'number', ['system']],
  ['uqs_account', 'stamped', ['system']],
  ['uqs_badge', 'holder', ['rest', 'system']],
  ['uqs_flat', 'name', ['rest', 'system']],
] as const;

const resultFor = (report: UniqueScopeReport, object: string, field: string) => {
  const r = report.results.find((x) => x.object === object && x.field === field);
  if (!r) throw new Error(`no result for ${object}.${field}`);
  return r;
};

const shape = (report: UniqueScopeReport, object: string, field: string) =>
  resultFor(report, object, field).probes.map((p) => `${p.leg} ${p.door} ${p.operation} ${p.expected} ${p.outcome}`);

describe('deriveUniqueScopeCases — what the family reads from the metadata', () => {
  it("reads each field's scope through the spec's parse, and names what it cannot compare", () => {
    const config = {
      objects: [
        ...source.objects,
        { name: 'uqs_bad', fields: { name: { type: 'text', unique: 'tenant' } } },
        { name: 'uqs_calc', fields: { total: { type: 'formula', expression: '1 + 1', unique: true } } },
      ],
    };
    const byKey = new Map(deriveUniqueScopeCases(config).map((c) => [`${c.object}.${c.field}`, c]));

    // Every field the parse declares unique, and nothing else (`sequence` opted out, `note`/`title` declare none).
    expect([...byKey.keys()].sort()).toEqual([
      'uqs_account.active', 'uqs_account.code', 'uqs_account.email', 'uqs_account.ext_id', 'uqs_account.name',
      'uqs_account.number', 'uqs_account.stamped', 'uqs_bad.name', 'uqs_badge.holder', 'uqs_calc.total', 'uqs_flat.name',
    ]);
    expect(byKey.get('uqs_account.name')).toMatchObject({ declared: true, scope: 'organization', across: 'admitted', doors: ['rest', 'system'] });
    expect(byKey.get('uqs_account.code')).toMatchObject({ declared: 'organization', scope: 'organization', across: 'admitted' });
    expect(byKey.get('uqs_account.ext_id')).toMatchObject({ declared: 'global', scope: 'global', across: 'refused' });
    // The autonumber's scope is the parse's, and the REST door is named, not probed.
    expect(byKey.get('uqs_account.number')).toMatchObject({
      declared: 'organization',
      doors: ['system'],
      restExcluded: expect.stringMatching(/^runtime-issued \(autonumber\)/),
    });
    expect(byKey.get('uqs_account.stamped')).toMatchObject({ declared: 'global', doors: ['system'], restExcluded: expect.stringMatching(/^readonly/) });
    // No organization column: a per-organization spelling is installation-wide.
    expect(byKey.get('uqs_flat.name')).toMatchObject({ declared: true, organizationColumn: false, across: 'refused' });
    // A one-to-one reference is probed within; across, the value is one organization's record.
    expect(byKey.get('uqs_badge.holder')).toMatchObject({ declared: true, acrossExcluded: expect.stringMatching(/^a reference value is a record of one organization/) });
    expect(byKey.get('uqs_badge.holder')!.notDerivable).toBeUndefined();
    // Named instead of probed.
    expect(byKey.get('uqs_account.active')).toMatchObject({ notDerivable: expect.stringMatching(/^a boolean value space/) });
    expect(byKey.get('uqs_calc.total')).toMatchObject({ excluded: expect.stringMatching(/^a formula value is derived on read/) });
    expect(byKey.get('uqs_bad.name')).toMatchObject({ excluded: expect.stringMatching(/^the declaration does not parse under the spec's FieldSchema \(unique: Invalid unique scope 'tenant'/) });
    expect(byKey.get('uqs_bad.name')!.declared).toBeUndefined();
  });
});

describe('runUniqueScopeProofs — a single-posture boot (the untenanted install)', () => {
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    stack = await bootStack(app as never);
    report = await runUniqueScopeProofs(stack, await stack.signIn(), app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('reports the across leg not run, with the reason, rather than skipping it', () => {
    expect(report.boot).toMatchObject({ posture: 'single', walled: false, legs: { within: 'run', across: 'not-run' } });
    expect(report.boot.acrossNotRun).toMatch(/no organization wall, one organization/);
    expect(formatUniqueScopeReport(report)).toContain('across leg NOT RUN');
  });

  it('proves every probed declaration within the one organization, through its doors, by insert and by update', () => {
    for (const [object, field, doors] of PROBED_WITHIN) {
      const r = resultFor(report, object, field);
      expect(r.status, `${object}.${field}: ${JSON.stringify(r.probes)}`).toBe('proven');
      expect(shape(report, object, field)).toEqual(
        doors.flatMap((d) => [`within ${d} insert refused held`, `within ${d} update refused held`]),
      );
    }
  });

  it('reads the refusal it credits: the unique code at each door, the field named only for a bare-column index', () => {
    const at = (object: string, field: string, door: string, operation: string) =>
      resultFor(report, object, field).probes.find((p) => p.door === door && p.operation === operation)!;
    // A per-organization index is an expression index: no field, so the twin attributes it.
    expect(at('uqs_account', 'name', 'rest', 'insert')).toMatchObject({
      answer: { kind: 'refused', code: 'UNIQUE_VIOLATION', status: 409, object: 'uqs_account' },
      twin: 'written',
    });
    expect(at('uqs_account', 'name', 'rest', 'insert').answer!.field).toBeUndefined();
    expect(at('uqs_account', 'name', 'system', 'insert')).toMatchObject({ answer: { kind: 'refused', code: 'DUPLICATE_RECORD', status: 409 }, twin: 'written' });
    // A global index, or no organization column: the column is named, no twin needed.
    expect(at('uqs_account', 'ext_id', 'rest', 'insert')).toMatchObject({ answer: { code: 'UNIQUE_VIOLATION', field: 'ext_id' } });
    expect(at('uqs_account', 'ext_id', 'rest', 'insert').twin).toBeUndefined();
    expect(at('uqs_flat', 'name', 'system', 'insert')).toMatchObject({ answer: { code: 'DUPLICATE_RECORD', field: 'name' } });
    // An update changes only the probed value, so it needs no twin.
    expect(at('uqs_account', 'code', 'rest', 'update')).toMatchObject({ answer: { kind: 'refused', code: 'UNIQUE_VIOLATION' } });
    expect(at('uqs_account', 'code', 'rest', 'update').twin).toBeUndefined();
  });

  it('counts the shapes it names instead of probing, and reports no hard failure', () => {
    expect(resultFor(report, 'uqs_account', 'active')).toMatchObject({ status: 'not-derivable', probes: [] });
    expect(report.summary).toEqual({
      fields: 9,
      probed: { organization: 6, global: 2 },
      proven: 8,
      contradicted: 0,
      failed: 0,
      inconclusive: 0,
      excluded: 0,
      notDerivable: 1,
      probes: 28,
      held: 28,
      contradictions: 0,
      unattributed: 0,
      faults: 0,
      notRun: 0,
      hardFailures: 0,
    });
    expect(formatUniqueScopeReport(report)).toContain('8 proven, 0 CONTRADICTED, 0 FAILED');
  });

  it('names a field whose only door the run does not ask, instead of counting it', async () => {
    const account = source.objects[0]!;
    const systemOnly = { ...source, objects: [{ ...account, fields: { number: account.fields.number, stamped: account.fields.stamped } }] };
    const restOnly = await runUniqueScopeProofs(stack, await stack.signIn(), systemOnly, { doors: ['rest'] });
    for (const field of ['number', 'stamped']) {
      expect(resultFor(restOnly, 'uqs_account', field)).toMatchObject({
        status: 'inconclusive',
        probes: [],
        reason: expect.stringMatching(/^probed through the system door only \(.*\), which this run does not ask$/),
      });
    }
    expect(restOnly.summary).toMatchObject({ proven: 0, inconclusive: 2, probes: 0, hardFailures: 0 });
  });
});

describe('runUniqueScopeProofs — a walled boot (two organizations)', () => {
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    stack = await bootStack(app as never, { multiTenant: 'posture-only' });
    report = await runUniqueScopeProofs(stack, await stack.signIn(), app);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('runs both legs, into two organizations it provisioned', () => {
    expect(report.boot).toMatchObject({ posture: 'isolated', walled: true, legs: { within: 'run', across: 'run' } });
    expect(report.boot.acrossNotRun).toBeUndefined();
  });

  it('admits a per-organization value in another organization, and refuses a global one or one with no organization column', () => {
    expect(shape(report, 'uqs_account', 'name')).toEqual([
      'within rest insert refused held', 'within rest update refused held',
      'within system insert refused held', 'within system update refused held',
      'across rest insert admitted held', 'across system insert admitted held',
    ]);
    expect(shape(report, 'uqs_account', 'ext_id').slice(4)).toEqual(['across rest insert refused held', 'across system insert refused held']);
    expect(shape(report, 'uqs_account', 'number').slice(2)).toEqual(['across system insert admitted held']);
    // No organization column: the system door names no organization, so the across leg is the REST door's.
    expect(shape(report, 'uqs_flat', 'name').slice(4)).toEqual(['across rest insert refused held']);
    // A reference's across leg is named, not run.
    expect(shape(report, 'uqs_badge', 'holder')).toHaveLength(4);
    for (const [object, field] of PROBED_WITHIN) {
      expect(resultFor(report, object, field).status, `${object}.${field}`).toBe('proven');
    }
    expect(report.summary).toMatchObject({ proven: 8, contradicted: 0, failed: 0, inconclusive: 0, probes: 39, held: 39, hardFailures: 0 });
  });
});

describe('runUniqueScopeProofs — NEGATIVE CONTROL, within: a declaration its database cannot enforce', () => {
  const controlApp = (unique: boolean) => ({
    manifest: { id: 'com.example.unique-scope-within', namespace: 'uqw', version: '0.0.1', type: 'app', name: 'Within Control' },
    objects: [{ name: 'uqw_item', label: 'Item', fields: { name: { type: 'text', label: 'Name', ...(unique ? { unique: true } : {}) } } }],
  });
  let dir: string;
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    // The table already holds a duplicate when the declaration arrives: the
    // driver cannot create the index, and says the constraint is not enforced.
    dir = mkdtempSync(join(tmpdir(), 'verify-unique-scope-'));
    const databaseFile = join(dir, 'db.sqlite');
    const before = await bootStack(controlApp(false) as never, { databaseFile });
    await before.seed('uqw_item', [{ name: 'held twice' }, { name: 'held twice' }]);
    await before.stop();
    stack = await bootStack(controlApp(true) as never, { databaseFile });
    report = await runUniqueScopeProofs(stack, await stack.signIn(), controlApp(true));
  }, 2 * BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reports every admitted second holder contradicted, through both doors, by insert and by update', () => {
    const r = resultFor(report, 'uqw_item', 'name');
    expect(r.status, JSON.stringify(r.probes)).toBe('contradicted');
    expect(shape(report, 'uqw_item', 'name')).toEqual([
      'within rest insert refused contradicted', 'within rest update refused contradicted',
      'within system insert refused contradicted', 'within system update refused contradicted',
    ]);
    for (const p of r.probes) expect(p.detail).toMatch(/^declared unique: true, and a second record holding the value in the same organization was admitted/);
    expect(report.summary).toMatchObject({ contradicted: 1, contradictions: 4, hardFailures: 1 });
    expect(formatUniqueScopeReport(report)).toContain('✗ uqw_item.name <text> unique: true  CONTRADICTED on 4 of 4 write(s):');
  });
});

describe('runUniqueScopeProofs — ATTRIBUTION CONTROL, a unique indexes[] entry over the probed column', () => {
  // The field's own index cannot be created (the table already holds a
  // duplicate when the declaration arrives, ADR-0120 D4), while a declared
  // unique composite over the same column can: its other column takes one
  // default on every fixture, so the composite refuses every second holder,
  // naming no field, and admits the twin. A field-less refusal there is
  // possibly that entry's, never proof of the field's own declaration.
  const controlApp = (declared: boolean) => ({
    manifest: { id: 'com.example.unique-scope-composite', namespace: 'uqc', version: '0.0.1', type: 'app', name: 'Composite Control' },
    objects: [
      {
        name: 'uqc_item',
        label: 'Item',
        fields: {
          name: { type: 'text', label: 'Name', ...(declared ? { unique: true } : {}) },
          kind: { type: 'text', label: 'Kind', ...(declared ? { defaultValue: 'standard' } : {}) },
        },
        ...(declared ? { indexes: [{ fields: ['name', 'kind'], unique: 'organization' }] } : {}),
      },
    ],
  });
  let dir: string;
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'verify-unique-scope-composite-'));
    const databaseFile = join(dir, 'db.sqlite');
    const before = await bootStack(defineStack(controlApp(false) as never) as never, { databaseFile });
    await before.seed('uqc_item', [{ name: 'held twice', kind: 'a' }, { name: 'held twice', kind: 'b' }]);
    await before.stop();
    const app = defineStack(controlApp(true) as never) as never;
    stack = await bootStack(app, { databaseFile });
    report = await runUniqueScopeProofs(stack, await stack.signIn(), app);
  }, 2 * BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('never credits a field-less refusal to the field when a unique indexes[] entry covers its column', () => {
    const r = resultFor(report, 'uqc_item', 'name');
    expect(r.status, JSON.stringify(r.probes)).toBe('inconclusive');
    expect(shape(report, 'uqc_item', 'name')).toEqual([
      'within rest insert refused unattributed', 'within rest update refused unattributed',
      'within system insert refused unattributed', 'within system update refused unattributed',
    ]);
    for (const p of r.probes) {
      expect(p.answer).toMatchObject({ kind: 'refused' });
      expect(p.answer!.field).toBeUndefined();
      expect(p.detail).toMatch(/^the unique refusal names no field, and a unique indexes\[\] entry \(name, kind\) covers name/);
    }
    expect(report.summary).toMatchObject({ proven: 0, inconclusive: 1, unattributed: 4, hardFailures: 0 });
  });
});

describe('runUniqueScopeProofs — NEGATIVE CONTROL, across: a per-organization field a global index overrides', () => {
  const controlApp = {
    manifest: { id: 'com.example.unique-scope-across', namespace: 'uqx', version: '0.0.1', type: 'app', name: 'Across Control' },
    objects: [
      {
        name: 'uqx_item',
        label: 'Item',
        fields: { name: { type: 'text', label: 'Name', unique: true } },
        indexes: [{ fields: ['name'], unique: 'global' }],
      },
    ],
  };
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    stack = await bootStack(controlApp as never, { multiTenant: 'posture-only' });
    report = await runUniqueScopeProofs(stack, await stack.signIn(), controlApp);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it('reports the declared per-organization scope contradicted across, and held within', () => {
    const r = resultFor(report, 'uqx_item', 'name');
    expect(r.status, JSON.stringify(r.probes)).toBe('contradicted');
    expect(shape(report, 'uqx_item', 'name')).toEqual([
      'within rest insert refused held', 'within rest update refused held',
      'within system insert refused held', 'within system update refused held',
      'across rest insert admitted contradicted', 'across system insert admitted contradicted',
    ]);
    for (const p of r.probes.filter((x) => x.leg === 'across')) {
      expect(p.answer).toMatchObject({ kind: 'refused', field: 'name' });
      expect(p.detail).toMatch(/^declared unique: true, and a record in another organization was refused the value/);
    }
    expect(report.summary).toMatchObject({ contradicted: 1, contradictions: 2, hardFailures: 1 });
  });
});

/**
 * The attribution control. `uqa_contact`'s hooks refuse a repeated email with
 * the app's own code before the engine writes (an app's dedupe, the shape
 * hotcrm's contact hook has); `uqa_tagged`'s hook stamps one `code` on every
 * record, so every record after the first meets `code`'s constraint, and so
 * does the twin of any probe of `label`.
 */
const attributionApp = {
  manifest: { id: 'com.example.unique-scope-attribution', namespace: 'uqa', version: '0.0.1', type: 'app', name: 'Attribution Control' },
  objects: [
    { name: 'uqa_contact', label: 'Contact', fields: { email: { type: 'email', label: 'Email', unique: true } } },
    {
      name: 'uqa_tagged',
      label: 'Tagged',
      fields: { label: { type: 'text', label: 'Label', unique: true }, code: { type: 'text', label: 'Code', unique: true } },
    },
  ],
  hooks: [
    {
      name: 'uqa_contact_dedupes_email',
      object: 'uqa_contact',
      events: ['beforeInsert', 'beforeUpdate'],
      handler: async (ctx: { input: { email?: unknown; id?: unknown }; api: any }) => {
        const email = ctx.input.email;
        if (typeof email !== 'string') return;
        const existing = await ctx.api.object('uqa_contact').find({ where: { email } });
        if (existing.some((row: { id?: unknown }) => row.id !== ctx.input.id)) {
          throw Object.assign(new Error('Another contact already has this email'), { code: 'DUPLICATE_VALUE', status: 409 });
        }
      },
    },
    {
      name: 'uqa_tagged_stamps_one_code',
      object: 'uqa_tagged',
      events: ['beforeInsert'],
      handler: async (ctx: { input: { code?: unknown } }) => {
        ctx.input.code = 'one code for every record';
      },
    },
  ],
};

describe('runUniqueScopeProofs — ATTRIBUTION CONTROL', () => {
  let stack: VerifyStack;
  let report: UniqueScopeReport;

  beforeAll(async () => {
    stack = await bootStack(attributionApp as never);
    report = await runUniqueScopeProofs(stack, await stack.signIn(), attributionApp);
  }, BOOT_TIMEOUT + RUN_TIMEOUT);

  afterAll(async () => {
    await stack?.stop();
  });

  it("never credits an app's own dedupe refusal to the declared constraint", () => {
    const r = resultFor(report, 'uqa_contact', 'email');
    expect(r.status, JSON.stringify(r.probes)).toBe('inconclusive');
    expect(r.probes.map((p) => p.outcome)).toEqual(['unattributed', 'unattributed', 'unattributed', 'unattributed']);
    for (const p of r.probes) expect(p.detail).toMatch(/^refused for another reason: /);
    // In process the app's own code arrives verbatim.
    for (const p of r.probes.filter((x) => x.door === 'system')) expect(p.answer).toMatchObject({ kind: 'refused', code: 'DUPLICATE_VALUE' });
  });

  it('never credits a field-less unique refusal the twin meets too', () => {
    const r = resultFor(report, 'uqa_tagged', 'label');
    expect(r.status, JSON.stringify(r.probes)).toBe('inconclusive');
    const first = r.probes[0]!;
    expect(first).toMatchObject({ leg: 'within', door: 'rest', operation: 'insert', outcome: 'unattributed', twin: 'refused' });
    expect(first.detail).toMatch(/^the unique refusal names no field, and the same record with only label changed was refused too/);
    expect(r.probes.some((p) => p.outcome === 'held')).toBe(false);
    expect(report.summary).toMatchObject({ proven: 0, contradicted: 0, hardFailures: 0 });
  });
});
