/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30786 — plugin-designer's two object pages save the object as
 * its author wrote it, not as a Chinese console is served it.
 *
 * `MetadataFieldsPage` took its edit base from the item read (`client.get`) and
 * `MetadataObjectsPage` from the list (`client.list`). Both reads are
 * translated for the console's `Accept-Language` and both carry the platform's
 * injected columns, and both pages spread that served object back as the PUT
 * body. So in a zh-CN console one field relabel stored every other label in
 * Chinese, and the injected `owner_id` as an authored field.
 *
 * The edit base is now `overlay ?? code` off the layered read, which the server
 * serves untranslated (`authoredPublished('object', …)`, the reading the
 * console's other object editors share). The objects page keeps the listed,
 * translated object for DISPLAY, so it writes back only the keys the edit
 * changed.
 *
 * A REAL `MetadataClient` over a fetch double that serves the three reads the
 * way a zh-CN server does; assertions are on the captured PUT bytes. The two
 * presentational leaves are prop recorders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition, ObjectDefinition } from '@object-ui/types';

type Row = Record<string, unknown>;

/** The object as its author wrote it: the `code` layer. */
const CODE: Row = {
  name: 'showcase_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  description: 'A unit of work.',
  icon: 'check',
  fields: {
    title: { type: 'text', label: 'Title' },
    status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
  },
};

/** The platform's injected column: served on every read, authored by nobody. */
const OWNER_ID = { type: 'lookup', label: 'Owner', reference: 'sys_user' };

/** `effective`: governed (the injected column), served untranslated. */
const EFFECTIVE: Row = {
  ...CODE,
  fields: { ...(CODE.fields as Row), owner_id: OWNER_ID },
};

/** What the list and the item read serve to a zh-CN console. */
const SERVED_ZH: Row = {
  name: 'showcase_task',
  label: '任务',
  pluralLabel: '任务列表',
  description: '一项工作。',
  icon: 'check',
  fields: {
    title: { type: 'text', label: '标题' },
    status: { type: 'select', label: '状态', options: [{ label: '打开', value: 'open' }] },
    owner_id: { ...OWNER_ID, label: '所有者' },
  },
};

/** Every string in a body that is not source text. */
const cjk = (body: unknown): string[] =>
  (JSON.stringify(body).match(/[一-鿿]+/g) ?? []);

let designerProps: { fields: DesignerFieldDefinition[]; onFieldsChange?: (f: DesignerFieldDefinition[]) => void } | null = null;
let managerProps: { objects: ObjectDefinition[]; onObjectsChange?: (o: ObjectDefinition[]) => void } | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: NonNullable<typeof designerProps>) => {
    designerProps = props;
    return null;
  },
}));

vi.mock('./ObjectManager', () => ({
  ObjectManager: (props: NonNullable<typeof managerProps>) => {
    managerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';
import { MetadataObjectsPage } from './MetadataObjectsPage';

let overlay: Row | null = null;
let layersStatus = 200;
let puts: Row[] = [];
let itemReads = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function zhClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    headers: { 'Accept-Language': 'zh-CN' },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Row;
        puts.push(body);
        overlay = body;
        return json({ success: true, name: 'showcase_task' });
      }
      if (/\/meta\/object\/showcase_task\/layers(\?|$)/.test(url)) {
        if (layersStatus !== 200) return json({ error: 'not found' }, layersStatus);
        return json({
          type: 'object',
          name: 'showcase_task',
          code: CODE,
          overlay,
          effective: overlay ? { ...overlay, fields: { ...(overlay.fields as Row), owner_id: OWNER_ID } } : EFFECTIVE,
        });
      }
      if (/\/meta\/object\/showcase_task(\?|$)/.test(url)) {
        itemReads += 1;
        return json({ type: 'object', name: 'showcase_task', item: SERVED_ZH });
      }
      if (/\/meta\/object(\?|$)/.test(url)) return json({ items: [SERVED_ZH] });
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  overlay = null;
  layersStatus = 200;
  puts = [];
  itemReads = 0;
  designerProps = null;
  managerProps = null;
});

afterEach(() => {
  designerProps = null;
  managerProps = null;
});

describe('objectstack#30786 · MetadataFieldsPage edits the object as authored', () => {
  async function renderFields() {
    render(<MetadataFieldsPage objectName="showcase_task" client={zhClient()} />);
    await waitFor(() => expect(designerProps).not.toBeNull());
  }

  async function relabel(name: string, label: string) {
    const before = puts.length;
    const next = designerProps!.fields.map((f) => (f.name === name ? { ...f, label } : f));
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts.length).toBe(before + 1));
    return puts[puts.length - 1];
  }

  it('hands the designer the authored fields: source labels, no injected column', async () => {
    await renderFields();
    expect(designerProps!.fields.map((f) => [f.name, f.label])).toEqual([
      ['title', 'Title'],
      ['status', 'Status'],
    ]);
    expect(itemReads).toBe(0);
  });

  it('a field relabel PUTs source text everywhere else, and no `owner_id`', async () => {
    await renderFields();
    const body = await relabel('title', 'Task title');
    expect(cjk(body)).toEqual([]);
    expect(body.label).toBe('Task');
    expect(body.description).toBe('A unit of work.');
    const fields = body.fields as Record<string, Row>;
    expect(Object.keys(fields)).toEqual(['title', 'status']);
    expect(fields.title.label).toBe('Task title');
    expect(fields.status.label).toBe('Status');
    expect(fields.status.options).toEqual([{ label: 'Open', value: 'open' }]);
  });

  it('the save after the post-save reload is still source text', async () => {
    await renderFields();
    await relabel('title', 'Task title');
    await waitFor(() => expect(designerProps!.fields.find((f) => f.name === 'title')?.label).toBe('Task title'));
    const second = await relabel('status', 'State');
    expect(cjk(second)).toEqual([]);
    const fields = second.fields as Record<string, Row>;
    expect(fields.title.label).toBe('Task title');
    expect(fields.status.label).toBe('State');
  });

  it('an overlay is the base when there is one (`overlay ?? code`)', async () => {
    overlay = { ...CODE, label: 'Job', fields: { title: { type: 'text', label: 'Heading' } } };
    await renderFields();
    expect(designerProps!.fields.map((f) => f.label)).toEqual(['Heading']);
    const body = await relabel('title', 'Job title');
    expect(body.label).toBe('Job');
    expect(Object.keys(body.fields as Row)).toEqual(['title']);
  });

  it('a name the layered read does not hold is "not found", and nothing is sent', async () => {
    layersStatus = 404;
    render(<MetadataFieldsPage objectName="showcase_task" client={zhClient()} />);
    await waitFor(() =>
      expect(screen.getByTestId('metadata-fields-page-error').textContent).toContain('not found'),
    );
    expect(puts).toEqual([]);
  });
});

describe('objectstack#30786 · MetadataObjectsPage writes only what the edit changed, over the object as authored', () => {
  async function renderObjects() {
    render(<MetadataObjectsPage client={zhClient()} />);
    await waitFor(() => expect(managerProps?.objects).toHaveLength(1));
  }

  async function editObject(patch: Partial<ObjectDefinition>) {
    const before = puts.length;
    const next = managerProps!.objects.map((o) => ({ ...o, ...patch }));
    await act(async () => {
      managerProps!.onObjectsChange!(next);
    });
    await waitFor(() => expect(puts.length).toBe(before + 1));
    return puts[puts.length - 1];
  }

  it('keeps showing the listed object, as the console is served it', async () => {
    await renderObjects();
    expect(managerProps!.objects[0].label).toBe('任务');
  });

  it('a description edit PUTs the authored labels, fields and no `owner_id`', async () => {
    await renderObjects();
    const body = await editObject({ description: 'One piece of work.' });
    expect(cjk(body)).toEqual([]);
    expect(body.label).toBe('Task');
    expect(body.pluralLabel).toBe('Tasks');
    expect(body.description).toBe('One piece of work.');
    const fields = body.fields as Record<string, Row>;
    expect(Object.keys(fields)).toEqual(['title', 'status']);
    expect(fields.title.label).toBe('Title');
  });

  it('a label edit writes the new label, and leaves the untouched ones authored', async () => {
    await renderObjects();
    const body = await editObject({ label: 'Work item' });
    expect(body.label).toBe('Work item');
    expect(body.pluralLabel).toBe('Tasks');
    expect(body.description).toBe('A unit of work.');
    expect(cjk(body)).toEqual([]);
  });

  it('an overlay is the base when there is one (`overlay ?? code`)', async () => {
    overlay = { ...CODE, pluralLabel: 'Jobs' };
    await renderObjects();
    const body = await editObject({ icon: 'star' });
    expect(body.icon).toBe('star');
    expect(body.pluralLabel).toBe('Jobs');
    expect(body.label).toBe('Task');
  });

  it('a listed object the layered read cannot answer is not saved, and the row says so', async () => {
    await renderObjects();
    layersStatus = 404;
    const next = managerProps!.objects.map((o) => ({ ...o, description: 'Changed.' }));
    await act(async () => {
      managerProps!.onObjectsChange!(next);
    });
    await waitFor(() =>
      expect(screen.getByTestId('metadata-objects-page-error').textContent).toContain(
        'Save showcase_task: the object as authored could not be read',
      ),
    );
    expect(puts).toEqual([]);
  });
});
