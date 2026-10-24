/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#5378 + objectui#5377 — the getting-started guide's own `object-form`
 * snippet is RENDERED here, not read.
 *
 * This block was already context-wired, so the guide's `dataSource` PROP reached
 * it as a React prop and never as context: measured `getObjectSchema` **0**,
 * `findOne` **0**, a card with no fields and no error. The key axis compounded
 * it — the page named the object with `object`, and this block declares
 * `objectName` (as required then; not since objectui#11605).
 *
 * ## The correction this file exists to keep
 *
 * `recordId` → `resourceId` is right ONLY for `detail-view`. `object-form`
 * genuinely reads `recordId` (`ObjectForm.tsx`, `findOne(schema.objectName,
 * schema.recordId)`), so a blanket rename across the guide's five snippets —
 * which is what "fix the keys" reads like from a distance — would have taken
 * this block from working to broken while the PR reported success. The rename
 * is asserted to BREAK this block below, so nobody has to remember.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Module-scope side-effect imports: the registry must hold `object-form` and the
// field widgets it renders into before the first render (AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/fields';
import '../index';

const GUIDE = path.resolve(__dirname, '../../../../content/docs/guide/building-crud-app.md');

const TASK_SCHEMA = {
  name: 'task',
  label: 'Task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

const RECORD = { id: '42', title: 'Write the guide', status: 'Todo' };

/** See the twin helper in `plugin-grid`'s probe — same rule, same reason. */
function guideSchemas(key: string): any[] {
  const src = fs.readFileSync(GUIDE, 'utf8');
  const needle = `type: '${key}'`;
  const out: any[] = [];
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    const start = src.lastIndexOf('{', at);
    let depth = 0;
    let end = start;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    out.push(
      new Function(
        'TaskSchema', 'editId', 'taskId', 'activeView', 'searchQuery',
        `return (${src.slice(start, end + 1)});`,
      )(TASK_SCHEMA, '42', '42', 'all', ''),
    );
  }
  return out;
}

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [RECORD], total: 1 }),
    findOne: vi.fn().mockResolvedValue(RECORD),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(TASK_SCHEMA),
  };
}

const FORM_SNIPPETS = guideSchemas('object-form');
const SNIPPET = FORM_SNIPPETS[0];

beforeEach(() => cleanup());

describe('guide/building-crud-app.md — the `object-form` snippet actually renders', () => {
  it('publishes exactly one form snippet', () => {
    expect(FORM_SNIPPETS).toHaveLength(1);
  });

  it('fetches the object schema and the edited record under the provider wiring', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={SNIPPET} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('task'));
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalledTimes(1));
    expect(adapter.findOne.mock.calls[0].slice(0, 2)).toEqual(['task', '42']);
    // A form that resolved its object renders the object's fields; the
    // field-less card was the whole silent failure.
    await waitFor(() => expect(container.textContent).toContain('Title'));
  });

  it('names the object with `objectName` — `object` fetches nothing', async () => {
    // The guide writes the props in the node's `properties` bag, the spelling
    // the spec declares (objectui#10859 batch 4); `SchemaRenderer` hoists it.
    const { objectName, ...rest } = SNIPPET.properties;
    const asItWas = { ...SNIPPET, properties: { ...rest, object: objectName } };

    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={asItWas} />
      </SchemaRendererProvider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
    expect(adapter.findOne).not.toHaveBeenCalled();
  });

  it('keeps `recordId` — the `resourceId` spelling loads no record HERE', async () => {
    // The correction, pinned. `detail-view` wants `resourceId`; this block does
    // not, and a sweep across the guide would have swapped a working key for a
    // dead one.
    expect(SNIPPET.properties.recordId).toBe('42');

    const { recordId, ...rest } = SNIPPET.properties;
    const swept = { ...SNIPPET, properties: { ...rest, resourceId: recordId } };

    const adapter = makeAdapter();
    render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <SchemaRenderer schema={swept} />
      </SchemaRendererProvider>,
    );

    // The object schema still resolves — the form still knows WHICH object —
    // but there is no record to load, which is the shape of the damage: a form
    // that looks configured and silently edits nothing.
    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('task'));
    expect(adapter.findOne).not.toHaveBeenCalled();
  });
});

describe('object-form — a block that resolves no adapter says so (objectui#5378 item 2)', () => {
  it('reports "No data source resolved" instead of a field-less card', async () => {
    const { findByTestId } = render(<SchemaRenderer schema={SNIPPET} />);
    const panel = await findByTestId('object-form-no-data-source');
    expect(panel).toHaveAttribute('role', 'alert');
    expect(panel.textContent).toContain('object-form');
    expect(panel.textContent).toContain('task');
    expect(panel.textContent).toContain('SchemaRendererProvider');
  });

  it('stays silent for inline `customFields`, which need no adapter', async () => {
    const { queryByTestId } = render(
      <SchemaRenderer
        schema={{
          type: 'object-form',
          objectName: 'task',
          customFields: [{ name: 'title', type: 'text', label: 'Title' }],
        } as any}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(queryByTestId('object-form-no-data-source')).toBeNull();
  });
});
