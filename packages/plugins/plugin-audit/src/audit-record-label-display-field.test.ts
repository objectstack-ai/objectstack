// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21878] The activity row's record label is the record's TITLE as ADR-0079
 * resolves it, with the record id as the floor.
 *
 * The CRUD mirror (`audit-writers.ts`) names the record in every activity row
 * it writes: in `record_label`, and inside the created / deleted / generic
 * updated summary. Which field that name is read from is ADR-0079's
 * `resolveDisplayField` over the registered definition — the answer every
 * renderer titles the record by — so an object titled by a field no fixed key
 * list anticipated (`company_name`) is named by its title rather than its id.
 *
 * What is pinned:
 *  - an object titled only by `company_name` is labelled by it, on the create,
 *    update and delete rows, and the row declares `company_name` as the
 *    label's source (the declaration #21081's read side redacts by);
 *  - objects titled by `name` / `title` / `subject` are labelled by that field;
 *  - an explicit `nameField` decides the label over a `name` field;
 *  - an empty title value floors to the id, never to another populated field;
 *  - a title field that is a credential floors to the id;
 *  - #21081's masking still holds: a reader not served the resolved title
 *    field is served neither the label nor the summary that carries it, while
 *    a reader served it keeps both.
 *
 * Real kernel, real engine, real driver, the real `AuditPlugin`. The one
 * stand-in is the security service, answering the two contract members the
 * read side asks (`activity-field-redaction.test.ts` has the same double and
 * says why).
 *
 * ⚠️ No test title states a value.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { EngineQueryOptions } from '@objectstack/spec/data';

import { AuditPlugin } from './audit-plugin.js';

const ACTIVITY = 'sys_activity';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.record-label-display-field';
const SYS = { isSystem: true } as const;
/** Not served the company object's title field. */
const UNSERVED_READER = { userId: 'u_unserved', tenantId: 'org_1', positions: ['org_member'] };
/** Served every field: the control. */
const CONTROL = { userId: 'u_control', tenantId: 'org_1', positions: ['org_member'] };

const OBJ = {
  company: 'ard_company',
  named: 'ard_named',
  titled: 'ard_titled',
  subjected: 'ard_subjected',
  pointer: 'ard_pointer',
  credential: 'ard_credential',
} as const;

/** Synthetic values. */
const V = {
  company: 'ARDCOMPANYONE41',
  companyRenamed: 'ARDCOMPANYTWO42',
  phone: '+1-555-0100',
  name: 'ARDNAME43',
  nameTitle: 'ARDNAMETITLE44',
  title: 'ARDTITLE45',
  subject: 'ARDSUBJECT46',
  code: 'ARDCODE47',
  pointerName: 'ARDPOINTERNAME48',
  emptyNameTitle: 'ARDEMPTYNAMETITLE49',
  secret: 'ARDSECRET50',
  credentialName: 'ARDCREDNAME51',
};

const text = (name: string) => ({ name, label: name, type: 'text' as const });

const objects = [
  {
    // The measured case: no `name` field and no `nameField`.
    name: OBJ.company,
    label: 'Label Company',
    fields: {
      company_name: text('company_name'),
      phone: { name: 'phone', label: 'Phone', type: 'phone' as const },
      status: {
        name: 'status', label: 'Status', type: 'select' as const,
        options: [{ label: 'Active', value: 'active' }, { label: 'Lost', value: 'lost' }],
      },
    },
  },
  { name: OBJ.named, label: 'Label Named', fields: { name: text('name'), title: text('title') } },
  { name: OBJ.titled, label: 'Label Titled', fields: { title: text('title'), notes: { name: 'notes', label: 'Notes', type: 'textarea' as const } } },
  { name: OBJ.subjected, label: 'Label Subjected', fields: { subject: text('subject'), body: { name: 'body', label: 'Body', type: 'textarea' as const } } },
  { name: OBJ.pointer, label: 'Label Pointer', nameField: 'code', fields: { name: text('name'), code: text('code') } },
  {
    name: OBJ.credential,
    label: 'Label Credential',
    nameField: 'pass_code',
    fields: { name: text('name'), pass_code: { name: 'pass_code', label: 'Pass Code', type: 'password' as const } },
  },
];

type Row = Record<string, any>;

describe('[#21878] the activity record label is the ADR-0079 title, with the id as the floor', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const ids: Record<string, string> = {};

  /** All fields of `object`, as the engine registry holds them. */
  const allFields = (object: string): string[] =>
    Object.keys(((engine as any).getSchema(object)?.fields ?? {}) as Record<string, unknown>);

  /** The double: the two contract members the read side asks, per reader. */
  const security = {
    async getReadableFields(object: string, context?: any): Promise<string[] | undefined> {
      const all = allFields(object);
      if (context?.userId === UNSERVED_READER.userId && object === OBJ.company) {
        return all.filter((f) => f !== 'company_name');
      }
      return all;
    },
    async getQueryableFields(object: string, context?: any): Promise<string[] | undefined> {
      return security.getReadableFields(object, context);
    },
  };

  /** The mirror rows about one record, oldest first. */
  const rowsAbout = (object: string, id: string, context: EngineQueryOptions['context'] = SYS) =>
    engine.find(ACTIVITY, {
      where: { object_name: object, record_id: id },
      orderBy: [{ field: 'timestamp', order: 'asc' }],
      context,
    }) as Promise<Row[]>;

  const rowOfType = async (object: string, id: string, type: string): Promise<Row> => {
    const row = (await rowsAbout(object, id)).find((r) => r.type === type);
    expect(row, `a ${type} row about ${object}`).toBeTruthy();
    return row!;
  };

  /** The fields the writer declared the label was composed from. */
  const labelSources = (row: Row): unknown =>
    (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata)?.text_sources?.record_label;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use({
      name: 'test.security-double',
      version: '0.0.0',
      init: async (ctx: any) => ctx.registerService('security', security),
      start: async () => {},
    } as any);
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    for (const o of objects) engine.registry.registerObject(o as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    const insert = async (object: string, data: Row) => String((await engine.insert(object, data, { context: SYS })).id);

    // The company record lives through all three verbs.
    ids.company = await insert(OBJ.company, { company_name: V.company, phone: V.phone, status: 'active' });
    await engine.update(OBJ.company, { company_name: V.companyRenamed }, { where: { id: ids.company }, context: SYS });
    await engine.delete(OBJ.company, { where: { id: ids.company }, context: SYS });
    // A company record kept alive for the read-side cases.
    ids.companyKept = await insert(OBJ.company, { company_name: V.company, status: 'active' });
    ids.companyEmpty = await insert(OBJ.company, { company_name: '   ', phone: V.phone, status: 'lost' });
    ids.named = await insert(OBJ.named, { name: V.name, title: V.nameTitle });
    ids.namedEmpty = await insert(OBJ.named, { name: '', title: V.emptyNameTitle });
    ids.titled = await insert(OBJ.titled, { title: V.title });
    ids.subjected = await insert(OBJ.subjected, { subject: V.subject });
    ids.pointer = await insert(OBJ.pointer, { name: V.pointerName, code: V.code });
    ids.credential = await insert(OBJ.credential, { name: V.credentialName, pass_code: V.secret });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  // ── acceptance 1: an object titled by `company_name` ───────────────────

  it('control: the registry resolves the company object to company_name, with no nameField authored', () => {
    expect((engine as any).getSchema(OBJ.company)?.nameField).toBe('company_name');
  });

  it('a company_name-titled object: the create row is labelled by the title and declares it as the source', async () => {
    const row = await rowOfType(OBJ.company, ids.company, 'created');
    expect(row.record_label).toBe(V.company);
    expect(labelSources(row)).toEqual(['company_name']);
    expect(String(row.summary)).toContain(V.company);
    expect(String(row.summary)).not.toContain(ids.company);
  });

  it('a company_name-titled object: the update and delete rows are labelled by the title too', async () => {
    const updated = await rowOfType(OBJ.company, ids.company, 'updated');
    expect(updated.record_label).toBe(V.companyRenamed);
    expect(labelSources(updated)).toEqual(['company_name']);
    const deleted = await rowOfType(OBJ.company, ids.company, 'deleted');
    expect(deleted.record_label).toBe(V.companyRenamed);
    expect(labelSources(deleted)).toEqual(['company_name']);
    expect(String(deleted.summary)).toContain(V.companyRenamed);
  });

  // ── acceptance 2: `name` / `title` / `subject` are labelled as before ──

  it('an object with name (and title) is labelled by name', async () => {
    const row = await rowOfType(OBJ.named, ids.named, 'created');
    expect(row.record_label).toBe(V.name);
    expect(labelSources(row)).toEqual(['name']);
  });

  it('an object with title is labelled by title, and one with subject by subject', async () => {
    const titled = await rowOfType(OBJ.titled, ids.titled, 'created');
    expect(titled.record_label).toBe(V.title);
    expect(labelSources(titled)).toEqual(['title']);
    const subjected = await rowOfType(OBJ.subjected, ids.subjected, 'created');
    expect(subjected.record_label).toBe(V.subject);
    expect(labelSources(subjected)).toEqual(['subject']);
  });

  it('an explicit nameField decides the label over a name field', async () => {
    const row = await rowOfType(OBJ.pointer, ids.pointer, 'created');
    expect(row.record_label).toBe(V.code);
    expect(labelSources(row)).toEqual(['code']);
  });

  // ── acceptance 3: an empty title value floors to the id ────────────────

  it('an empty (blank) title value floors to the id, declaring no source field', async () => {
    const row = await rowOfType(OBJ.company, ids.companyEmpty, 'created');
    expect(row.record_label).toBe(ids.companyEmpty);
    expect(labelSources(row)).toEqual([]);
  });

  it('an empty title floors to the id, never to another populated field', async () => {
    const row = await rowOfType(OBJ.named, ids.namedEmpty, 'created');
    expect(row.record_label).toBe(ids.namedEmpty);
    expect(labelSources(row)).toEqual([]);
    expect(JSON.stringify([row.record_label, row.summary])).not.toContain(V.emptyNameTitle);
  });

  it('a credential title field floors to the id: no credential value and no mask reaches the label', async () => {
    const row = await rowOfType(OBJ.credential, ids.credential, 'created');
    expect(row.record_label).toBe(ids.credential);
    expect(labelSources(row)).toEqual([]);
    expect(JSON.stringify([row.record_label, row.summary])).not.toContain(V.secret);
  });

  // ── acceptance 4: #21081's masking still holds on the resolved field ──

  it('a reader not served the resolved title field is served neither the label nor the summary carrying it', async () => {
    const atRest = await rowOfType(OBJ.company, ids.companyKept, 'created');
    expect(atRest.record_label).toBe(V.company);
    const rows = await rowsAbout(OBJ.company, ids.companyKept, UNSERVED_READER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('record_label');
    expect(rows[0]).not.toHaveProperty('summary');
    expect(JSON.stringify(rows)).not.toContain(V.company);
  });

  it('control: a reader served the title field keeps the label and the summary', async () => {
    const rows = await rowsAbout(OBJ.company, ids.companyKept, CONTROL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('record_label', V.company);
    expect(String(rows[0].summary)).toContain(V.company);
  });
});
