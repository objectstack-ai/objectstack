/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10712 — a superseded read must not commit over the current one.
 *
 * Every layout `ObjectForm` routes to (the default arm, `DrawerForm`,
 * `ModalForm`, `SplitForm`, `TabbedForm`, `WizardForm`) makes two reads before
 * it can draw: the object schema (`getObjectSchema`, keyed on `objectName` and
 * the data source) and the record (`findOne`, keyed on the record). When the
 * form is pointed at another object or record while a read is in flight, the
 * earlier read is SUPERSEDED: whatever it answers, and whenever, it must
 * neither replace what the current read commits nor end the loading state the
 * current read is still in.
 *
 * PR objectui#10704 (objectui#10682) scoped each read's FAILURE to its current
 * run (`loadFailure.ts`). This pin is about the rest of what a run writes: the
 * values (`setFormData` / `setInitialData`), the object schema
 * (`setObjectSchema`) and the `loading` release.
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration (`object-form` is the one door all six are reached through).
 * Every read is a promise the test settles by hand, so each ordering below is
 * the ordering the reads really land in; no timer decides it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-form` through this package's own entry.
import './index';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type SchemaRead = Deferred<any> & { objectName: string };
type RecordRead = Deferred<any> & { objectName: string; recordId: string };

/** Every schema read and record read returns a promise the test settles by hand. */
function makeDeferredDataSource() {
  const schemaReads: SchemaRead[] = [];
  const recordReads: RecordRead[] = [];
  const dataSource = {
    getObjectSchema: vi.fn((objectName: string) => {
      const d = deferred<any>();
      schemaReads.push({ ...d, objectName });
      return d.promise;
    }),
    findOne: vi.fn((objectName: string, recordId: string) => {
      const d = deferred<any>();
      recordReads.push({ ...d, objectName, recordId });
      return d.promise;
    }),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { dataSource, schemaReads, recordReads };
}

type DS = ReturnType<typeof makeDeferredDataSource>['dataSource'];

/** The `n`-th read (1-based) once it has been issued. */
async function nth<T>(reads: T[], n: number): Promise<T> {
  await waitFor(() => {
    if (reads.length < n) throw new Error(`read ${n} not issued yet (${reads.length} so far)`);
  });
  return reads[n - 1];
}

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

/** The object's one `name` field, labelled so the schema a form drew from can be read off the screen. */
const answerSchema = (read: SchemaRead, label: string) =>
  settle(() => read.resolve({ name: read.objectName, fields: { name: { type: 'text', label } } }));
const answerRecord = (read: RecordRead, name: string) =>
  settle(() => read.resolve({ id: read.recordId, name }));
const fail = (read: Deferred<any>, message: string) => settle(() => read.reject(new Error(message)));

/** The six layouts, each reached through `object-form`; `undefined` is the default arm. */
const FORMS: ReadonlyArray<{ form: string; formType: string | undefined }> = [
  { form: 'ObjectForm (default arm)', formType: undefined },
  { form: 'DrawerForm', formType: 'drawer' },
  { form: 'ModalForm', formType: 'modal' },
  { form: 'SplitForm', formType: 'split' },
  { form: 'TabbedForm', formType: 'tabbed' },
  { form: 'WizardForm', formType: 'wizard' },
];

/** An edit-mode form over one `name` field; every layout takes sections. */
const blockFor = (formType: string | undefined, over: Record<string, unknown> = {}) => ({
  type: 'object-form',
  objectName: 'deal',
  mode: 'edit',
  recordId: 'r1',
  sections: [{ name: 'main', label: 'Main', fields: ['name'] }],
  ...(formType ? { formType } : {}),
  ...over,
});

function mount(dataSource: DS, block: Record<string, unknown>) {
  const tree = (b: Record<string, unknown>) => (
    <SchemaRendererProvider dataSource={dataSource as any}>
      <SchemaRenderer schema={b as any} />
    </SchemaRendererProvider>
  );
  const view = render(tree(block));
  return { rerender: (next: Record<string, unknown>) => view.rerender(tree(next)) };
}

/** The `name` input's value, or `null` while no form is drawn (drawer and modal portal out). */
const shownValue = () =>
  (document.body.querySelector('input[name="name"]') as HTMLInputElement | null)?.value ?? null;

const shownText = () => document.body.textContent ?? '';

/** Lands every record read issued so far and not yet settled, so a form that went back to loading draws again. */
async function answerOutstanding(reads: RecordRead[], settled: Set<RecordRead>, name: string) {
  for (const read of reads) {
    if (settled.has(read)) continue;
    settled.add(read);
    await answerRecord(read, name);
  }
}

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  // A superseded failure below is logged by the form; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe.each(FORMS)('$form keeps what its CURRENT read committed (objectui#10712)', ({ formType }) => {
  it('control: a single record read draws its record', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1), 'Deal name');
    await answerRecord(await nth(recordReads, 1), 'One');

    await waitFor(() => expect(shownValue()).toBe('One'));
    expect(shownText()).toContain('Deal name');
    expect(dataSource.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(dataSource.findOne).toHaveBeenCalledTimes(1);
  });

  it('values: a SUPERSEDED record read that lands last leaves the current record on screen', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1), 'Deal name');
    const first = await nth(recordReads, 1);

    // Another record is asked for while the first read is still in flight.
    view.rerender(blockFor(formType, { recordId: 'r2' }));
    const second = await nth(recordReads, 2);
    expect(second.recordId).toBe('r2');
    await answerRecord(second, 'Two');
    await waitFor(() => expect(shownValue()).toBe('Two'));

    await answerRecord(first, 'One (stale)');
    await settle(() => {});

    expect(shownValue(), 'the superseded read for r1 replaced the values of r2').toBe('Two');
  });

  it('loading: a SUPERSEDED record read that lands first does not end the loading state the current read is in', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    await answerSchema(await nth(schemaReads, 1), 'Deal name');
    const first = await nth(recordReads, 1);

    view.rerender(blockFor(formType, { recordId: 'r2' }));
    const second = await nth(recordReads, 2);
    await answerRecord(first, 'One (stale)');
    await settle(() => {});

    expect(shownValue(), 'a superseded read drew a form while the current read was pending').toBeNull();

    await answerRecord(second, 'Two');
    await waitFor(() => expect(shownValue(), 'the current read did not end the loading state').toBe('Two'));
  });

  it('schema: a SUPERSEDED schema read that lands last leaves the current object schema on screen', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const settled = new Set<RecordRead>();
    const view = mount(dataSource, blockFor(formType));
    const dealSchema = await nth(schemaReads, 1);

    // The form is pointed at another object while the first schema read is in flight.
    view.rerender(blockFor(formType, { objectName: 'lead' }));
    const leadSchema = await nth(schemaReads, 2);
    expect(leadSchema.objectName).toBe('lead');
    await answerSchema(leadSchema, 'Lead name');
    await answerOutstanding(recordReads, settled, 'Lead one');
    await waitFor(() => expect(shownValue()).toBe('Lead one'));
    expect(shownText()).toContain('Lead name');

    await answerSchema(dealSchema, 'Deal name');
    await settle(() => {});
    // A form the stale schema sent back to loading re-reads its record; land
    // that read too, so what is read off the screen is a drawn form.
    await answerOutstanding(recordReads, settled, 'Lead one');
    await waitFor(() => expect(shownValue()).toBe('Lead one'));

    expect(shownText(), 'the superseded schema of `deal` replaced the schema of `lead`').not.toContain('Deal name');
    expect(shownText()).toContain('Lead name');
  });

  it('loading: a SUPERSEDED schema read that fails does not end the loading state the current schema read is in', async () => {
    const { dataSource, schemaReads, recordReads } = makeDeferredDataSource();
    const view = mount(dataSource, blockFor(formType));
    const dealSchema = await nth(schemaReads, 1);

    view.rerender(blockFor(formType, { objectName: 'lead' }));
    const leadSchema = await nth(schemaReads, 2);
    // Control leg: nothing is drawn while both schema reads are pending.
    expect(document.body.querySelector('form')).toBeNull();

    await fail(dealSchema, 'superseded schema read failed');
    await settle(() => {});

    expect(
      document.body.querySelector('form'),
      'a superseded schema failure drew a form while the current schema read was pending',
    ).toBeNull();

    await answerSchema(leadSchema, 'Lead name');
    await answerRecord(await nth(recordReads, 1), 'Lead one');
    await waitFor(() => expect(shownValue()).toBe('Lead one'));
  });
});
