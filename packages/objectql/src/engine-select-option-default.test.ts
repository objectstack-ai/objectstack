// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The select idiom is real on the insert path (#7246).
 *
 * `SelectOption.default` has been authorable and spec-valid since the schema was
 * written, and nothing on the insert path read it: `applyFieldDefaults` resolved
 * `f.defaultValue` and never `options`, so a create that omitted the field
 * stored `null` — not the option marked `default: true`. The key's ONE consumer
 * anywhere in the repo was lint's `isNullableField`, which concluded the column
 * was always-valued on the strength of that declaration, and that verdict is
 * **build-breaking**. So the single place the key was read trusted it, and the
 * place that would have made it true ignored it.
 *
 * Maintainer ruling (2026-08-10, issue #7246): enforce. These tests pin the
 * whole contract that ruling names, plus the three shapes it leaves to the
 * implementation:
 *
 *   - the fallback fires when the field declares no `defaultValue`;
 *   - `defaultValue` WINS when both are declared — the more specific
 *     declaration (the precedence pin the ruling asks for by name);
 *   - presence is the engine's own `dv == null` test, so `defaultValue: ''` is a
 *     real default that wins;
 *   - `multiple: true` assembles an ARRAY, because that field stores one;
 *   - an option value is a plain LITERAL — never routed through the
 *     `DEFAULT_VALUE_TOKENS` branches, which is why the fallback resolves in the
 *     `defaultValue == null` arm rather than upstream of the token tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { DEFAULT_VALUE_TOKEN_CURRENT_USER } from '@objectstack/spec/data';

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    async findOne(object: string) { return storeFor(object).values().next().value ?? null; },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update() { return null; },
    async upsert(object: string, data: Record<string, unknown>) { return this.create(object, data); },
    async delete() { return true; },
    async count(object: string) { return storeFor(object).size; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const sys = { context: { isSystem: true } } as any;

describe('[#7246] the option marked `default: true` is the field default', () => {
  let engine: ObjectQL;

  /** Mirrors `showcase_task`: a status select whose initial value is declared only on the option. */
  const task = {
    name: 'opt_task',
    label: 'Task',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
      status: {
        name: 'status', label: 'Status', type: 'select' as const,
        options: [
          { label: 'Backlog', value: 'backlog', default: true },
          { label: 'Active', value: 'active' },
        ],
      },
    },
  };

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(task, 'test.issue7246');
  });

  it('fills an OMITTED field with the marked option — the issue repro', async () => {
    // Before this change the row stored `null`, while lint's `isNullableField`
    // was already telling predicates the column could never be null.
    const row: any = await engine.insert('opt_task', { title: 'A' }, sys);
    expect(row.status).toBe('backlog');
  });

  it('fills an EXPLICIT null too — the unpicked-control shape (#2706)', async () => {
    // A form serializes an untouched select to `null`, not to omission. The
    // insert path treats both as "not supplied", and the fallback rides the
    // same test rather than inventing a second presence rule.
    const row: any = await engine.insert('opt_task', { title: 'B', status: null }, sys);
    expect(row.status).toBe('backlog');
  });

  it('never overwrites a caller-supplied value', async () => {
    const row: any = await engine.insert('opt_task', { title: 'C', status: 'active' }, sys);
    expect(row.status).toBe('active');
  });

  it('leaves the field alone when NO option is marked', async () => {
    engine.registry.registerObject({
      ...task,
      name: 'opt_unmarked',
      fields: {
        ...task.fields,
        status: {
          ...task.fields.status,
          options: [{ label: 'Backlog', value: 'backlog' }, { label: 'Active', value: 'active' }],
        },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_unmarked', { title: 'D' }, sys);
    expect(row.status).toBeUndefined();
  });
});

describe('[#7246] precedence — `defaultValue` beats the option flag', () => {
  let engine: ObjectQL;

  /** The ui#4047 reporter's shape: BOTH spellings on one field, and they DISAGREE. */
  const both = {
    name: 'opt_both',
    label: 'Both',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
      status: {
        name: 'status', label: 'Status', type: 'select' as const,
        defaultValue: 'approved',
        options: [
          { label: 'Draft', value: 'draft', default: true },
          { label: 'Approved', value: 'approved' },
        ],
      },
    },
  };

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(both, 'test.issue7246');
  });

  it('PIN: the field-level `defaultValue` wins — the more specific declaration', async () => {
    // The ruling's precedence rule. `defaultValue` names a value for THIS
    // field; the option flag describes the shared option list, so the field
    // wins and the flag is inert here exactly as it was everywhere before.
    const row: any = await engine.insert('opt_both', { title: 'A' }, sys);
    expect(row.status).toBe('approved');
    expect(row.status).not.toBe('draft');
  });

  it("PIN: `defaultValue: ''` is a REAL default and still wins", async () => {
    // Presence is the engine's own `dv == null` test — `'' == null` is false.
    // Reading presence as truthiness instead would hand this field to the
    // option fallback and silently store 'draft' where the author declared
    // "empty". Same rule that makes a caller-supplied `''` a real value.
    //
    // Declared as `text`, not `select`, on purpose: `validateRecord` checks a
    // single-valued `select`/`radio` value against `optionValues(def.options)`,
    // and `''` is not among them — so a `select` with `defaultValue: ''` is
    // rejected as `invalid_option` before this precedence is observable. That
    // rejection is pre-existing and unrelated (it predates this change and is
    // unmoved by it); this test is about which of the two DECLARATIONS the
    // engine reads, so it uses a type whose values are free-form.
    engine.registry.registerObject({
      ...both,
      name: 'opt_empty',
      fields: {
        ...both.fields,
        status: { ...both.fields.status, type: 'text' as const, defaultValue: '' },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_empty', { title: 'B' }, sys);
    expect(row.status).toBe('');
  });

  it('an Expression-envelope `defaultValue` also wins, and still evaluates', async () => {
    // The envelope resolves to `approved` — a DECLARED option, so the record
    // stays spec-valid and the only thing under test is which declaration the
    // engine read. (An expression yielding a non-option value is rejected by
    // `validateRecord`'s `invalid_option` check, which is a separate contract
    // this change neither touches nor relies on.)
    engine.registry.registerObject({
      ...both,
      name: 'opt_expr',
      fields: {
        ...both.fields,
        status: { ...both.fields.status, defaultValue: { dialect: 'cel', source: "'approved'" } },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_expr', { title: 'C' }, sys);
    expect(row.status).toBe('approved');
    expect(row.status).not.toBe('draft');
  });
});

describe('[#7246] an option value is a LITERAL, never a runtime token', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
  });

  it('an option spelled `current_user` stores the twelve characters, not the actor id', async () => {
    // `current_user` is a spec-valid option value (a lowercase machine
    // identifier), and as an OPTION it is a picklist entry — not the
    // `DEFAULT_VALUE_TOKENS` instruction of the same spelling. This is why the
    // fallback resolves inside the `defaultValue == null` arm: routing it
    // through the token branches would silently store the acting user's id in
    // a picklist column. Structural, not a name check.
    engine.registry.registerObject({
      name: 'opt_tokenish',
      label: 'Tokenish',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        assignee_kind: {
          name: 'assignee_kind', label: 'Kind', type: 'select' as const,
          options: [
            { label: 'Current user', value: DEFAULT_VALUE_TOKEN_CURRENT_USER, default: true },
            { label: 'Queue', value: 'queue' },
          ],
        },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_tokenish', {}, { context: { userId: 'usr_7' } } as any);
    expect(row.assignee_kind).toBe(DEFAULT_VALUE_TOKEN_CURRENT_USER);
    expect(row.assignee_kind).not.toBe('usr_7');
  });
});

describe('[#7246] the default follows the FIELD shape, not the option count', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
  });

  const multi = (name: string, options: unknown[], extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      tags: { name: 'tags', label: 'Tags', type: 'select' as const, options, ...extra },
    },
  });

  it('`multiple: true` assembles an ARRAY of every marked option, in declaration order', async () => {
    engine.registry.registerObject(multi('opt_multi', [
      { label: 'Important', value: 'important', default: true },
      { label: 'Quick', value: 'quick' },
      { label: 'Review', value: 'review', default: true },
    ], { multiple: true }) as any, 'test.issue7246');
    const row: any = await engine.insert('opt_multi', {}, sys);
    expect(row.tags).toEqual(['important', 'review']);
  });

  it('`multiple: true` with ONE marked option is still an array — shape follows the field', async () => {
    // Not a style preference: `validateRecord`'s multi-value branch REJECTS a
    // non-array outright (`invalid_type_array`), so a bare scalar default here
    // would fail the engine's own validator on the very insert it was meant to
    // complete — and every driver persisting this column as Array/JSON would
    // have stored the wrong shape if it got through.
    engine.registry.registerObject(multi('opt_multi_one', [
      { label: 'Important', value: 'important', default: true },
      { label: 'Quick', value: 'quick' },
    ], { multiple: true }) as any, 'test.issue7246');
    const row: any = await engine.insert('opt_multi_one', {}, sys);
    expect(row.tags).toEqual(['important']);
  });

  it('a SINGLE-valued field takes the FIRST marked option — one slot, declaration order decides', async () => {
    // Neither `Field.select` nor `SelectOptionSchema` dedupes the flag, so this
    // is reachable metadata. Refusing it would fail a spec-valid declaration at
    // runtime; first-wins is deterministic and is what a picker preselects.
    engine.registry.registerObject(multi('opt_multi_marked', [
      { label: 'Important', value: 'important', default: true },
      { label: 'Review', value: 'review', default: true },
    ]) as any, 'test.issue7246');
    const row: any = await engine.insert('opt_multi_marked', {}, sys);
    expect(row.tags).toBe('important');
  });

  it('an option marked default but carrying NO value declares nothing — the field is left unset', async () => {
    engine.registry.registerObject(multi('opt_valueless', [
      { label: 'Broken', default: true },
      { label: 'Quick', value: 'quick' },
    ]) as any, 'test.issue7246');
    const row: any = await engine.insert('opt_valueless', {}, sys);
    expect(row.tags).toBeUndefined();
    expect(row.tags).not.toBeNull();
  });
});

describe('[#7246] the lint heuristic and the engine agree BY CONSTRUCTION', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver().driver, true);
    await engine.init();
  });

  it('no `type` test — `isNullableField` has none either, so neither may have one', async () => {
    // lint's `isNullableField` reads `options[].default` without asking the
    // field's type. If the engine gated the fallback on `type === 'select'`,
    // any other typed field carrying an option list would be called
    // always-valued by a BUILD-BREAKING verdict while still storing null.
    engine.registry.registerObject({
      name: 'opt_untyped',
      label: 'Untyped',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        channel: {
          name: 'channel', label: 'Channel', type: 'text' as const,
          options: [{ label: 'Email', value: 'email', default: true }, { label: 'SMS', value: 'sms' }],
        },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_untyped', {}, sys);
    expect(row.channel).toBe('email');
  });

  it('only the CANONICAL `default` spelling is read — aliases are normalized before the engine', async () => {
    // `isDefault` / `selected` are `SelectOptionSchema` authoring aliases,
    // rewritten to `default` at parse time. Honouring them here would make the
    // engine fill fields lint calls nullable — a disagreement in the harmless
    // direction, but a disagreement, and it would move the alias contract out
    // of the schema that owns it.
    engine.registry.registerObject({
      name: 'opt_alias',
      label: 'Alias',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        status: {
          name: 'status', label: 'Status', type: 'select' as const,
          options: [{ label: 'Draft', value: 'draft', isDefault: true }, { label: 'Done', value: 'done' }],
        },
      },
    } as any, 'test.issue7246');
    const row: any = await engine.insert('opt_alias', {}, sys);
    expect(row.status).toBeUndefined();
  });
});
