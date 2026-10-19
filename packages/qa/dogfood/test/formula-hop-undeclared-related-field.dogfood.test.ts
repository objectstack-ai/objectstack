// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24410] A formula that reads, through a lookup, a field the lookup's target
// does not declare — on a real boot: the real `ObjectQL`, SQL driver, REST,
// auth and metadata layers.
//
// ## The two halves
//
// - The save door. `PUT /api/v1/meta/object/:name` refuses a formula reading
//   `record.book.name` when `rhf_book` declares no `name`, under the existing
//   `EXPRESSION_INVALID` rule, naming the field and the target object. The
//   same object with the formula reading a declared field saves.
// - The read. A formula already stored with such a read (here: declared in
//   code, which this door never judged) reads `null` with its fault report,
//   and a VALID sibling formula reading through the SAME lookup is served
//   exactly as it is when it is read alone (`?fields=`).
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const SYS = { context: { isSystem: true } } as const;
const BOOK_TITLE = 'RHFBOOK71';
const READER_NAME = 'RHFREADER72';
/** The valid sibling's expression, and what it reads for the fixture row. */
const VALID = "joinNonEmpty([record.book.title, record.reader.reader_name], ' · ')";
const VALID_VALUE = `${BOOK_TITLE} · ${READER_NAME}`;
/** Reads a field `rhf_book` does not declare. */
const UNDECLARED = 'record.book.name';

const object = (name: string, fields: Record<string, unknown>) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: 'public_read_write', fields } as never);

const loanFields = (extra: Record<string, unknown> = {}) => ({
  label: Field.text({ label: 'Label' }),
  book: Field.lookup('rhf_book', { label: 'Book' }),
  reader: Field.lookup('rhf_reader', { label: 'Reader' }),
  summary: Field.formula({ label: 'Summary', expression: VALID, returnType: 'text' } as never),
  ...extra,
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.formula-hop-undeclared', namespace: 'rhf', version: '0.0.0', type: 'app',
    name: 'Formula Hop Undeclared Field Fixture',
    description: 'A loan whose formulas read through a lookup to a book and a reader.',
  },
  objects: [
    object('rhf_book', { title: Field.text({ label: 'Title' }) }),
    object('rhf_reader', { reader_name: Field.text({ label: 'Reader Name' }) }),
    // The stored bad formula: declared in code, beside the valid sibling.
    object('rhf_loan', loanFields({
      bad_title: Field.formula({ label: 'Bad Title', expression: UNDECLARED, returnType: 'text' } as never),
    })),
  ],
});

/** The object body a `PUT /meta/object/:name` writes: plain JSON, as Studio or an AI author sends it. */
const saveBody = (name: string, expression: string) => ({
  name,
  label: name,
  pluralLabel: name,
  sharingModel: 'public_read_write',
  fields: {
    label: { type: 'text', label: 'Label' },
    book: { type: 'lookup', label: 'Book', reference: 'rhf_book' },
    summary: { type: 'formula', label: 'Summary', expression, returnType: 'text' },
  },
});

type Row = Record<string, any>;

describe('[#24410] a formula reading a field its lookup target does not declare', () => {
  let stack: VerifyStack;
  let token = '';
  let loanId = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const rowsOf = (json: any): Row[] => (Array.isArray(json?.data) ? json.data : json?.data?.records ?? json?.records ?? []);

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0]);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    token = await stack.signIn();
    const book = await ql.insert('rhf_book', { title: BOOK_TITLE }, SYS);
    const reader = await ql.insert('rhf_reader', { reader_name: READER_NAME }, SYS);
    loanId = String((await ql.insert('rhf_loan', { label: 'loan', book: book.id, reader: reader.id }, SYS)).id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the save door refuses the read, naming the field and the target object', async () => {
    const saved = await call('PUT', '/meta/object/rhf_loan_saved', saveBody('rhf_loan_saved', UNDECLARED));
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    const text = JSON.stringify(saved.json);
    expect(text).toContain('EXPRESSION_INVALID');
    expect(text).toContain("field 'summary' expression");
    expect(text).toMatch(/`name`[^"]*`rhf_book`/);
  });

  it('control: the same object reading a declared field of the target saves', async () => {
    const saved = await call('PUT', '/meta/object/rhf_loan_ok', saveBody('rhf_loan_ok', 'record.book.title'));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
  });

  it('a stored bad formula reads null while its valid sibling is served as it is alone', async () => {
    const alone = await call('GET', '/data/rhf_loan?fields=summary');
    expect(alone.status, JSON.stringify(alone.json)).toBe(200);
    // One loan exists; a `fields=` projection carries no `id`.
    expect(rowsOf(alone.json), JSON.stringify(alone.json)).toHaveLength(1);
    const aloneRow = rowsOf(alone.json)[0];
    // Armed: the valid formula hydrates through both lookups when read alone.
    expect(aloneRow?.summary, JSON.stringify(alone.json)).toBe(VALID_VALUE);

    const list = await call('GET', '/data/rhf_loan');
    expect(list.status, JSON.stringify(list.json)).toBe(200);
    const listed = rowsOf(list.json).find((r) => String(r.id) === loanId);
    expect(listed?.bad_title, JSON.stringify(list.json)).toBeNull();
    expect(listed?.summary, JSON.stringify(list.json)).toBe(VALID_VALUE);

    const one = await call('GET', `/data/rhf_loan/${loanId}`);
    expect(one.status, JSON.stringify(one.json)).toBe(200);
    const row: Row = one.json?.data?.record ?? one.json?.record ?? one.json?.data ?? one.json;
    expect(row.bad_title, JSON.stringify(one.json)).toBeNull();
    expect(row.summary, JSON.stringify(one.json)).toBe(VALID_VALUE);
  });
});
