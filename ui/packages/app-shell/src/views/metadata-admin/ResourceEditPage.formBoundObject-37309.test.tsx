// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37309 — the metadata editor binds its field pickers to the
 * object the type's FORM declares, so a knowledge source's pickers offer the
 * fields of its `source.object`.
 *
 * `field-multi` reads no `dependsOn`: it draws the one catalog the editor
 * binds, and the editor found that object on a fixed list of draft paths
 * (`interfaceConfig.source`, `data.object`, `object`, `objectName`). A
 * knowledge source keeps its object at `source.object`, which was on no list,
 * so its content and filter pickers offered nothing. The editor now also reads
 * the path the form declares: the catalog row's `dependsOn` under the
 * composites it sits in.
 *
 * Two layers: the derivation over every form the spec registers (the paths it
 * answers agree with the fixed list where the list already answered), and the
 * real `MetadataResourceEditPage` mounting a knowledge source, read off its
 * catalog request and the field labels its picker draws.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/formula';
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { knowledgeSourceForm } from '@objectstack/spec/ai';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';

import { declaredBoundObjectPath, objectNameAt } from './formBoundObject';

const TASK = {
  name: 'acme_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Task title' }, notes: { type: 'textarea', label: 'Task notes' }, status: { type: 'text', label: 'Task status' } },
};

const SOURCE = vi.hoisted(() => ({
  item: {
    name: 'task_notes',
    label: 'Task notes',
    source: { kind: 'object', object: 'acme_task', content: ['title', 'notes'], metadataFields: ['status'] },
  } as Record<string, unknown>,
}));

/** The server's `/meta/types` row for `knowledge_source`: the served form and the served schema. */
const ENTRY = {
  type: 'knowledge_source',
  name: 'knowledge_source',
  label: 'Knowledge Source',
  allowRuntimeCreate: true,
  form: knowledgeSourceForm,
  schema: z.toJSONSchema(getMetadataTypeSchema('knowledge_source')!, { unrepresentable: 'any' }),
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: SOURCE.item, code: SOURCE.item, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string, name: string) => (type === 'object' && name === TASK.name ? TASK : null)),
  references: vi.fn(async () => []),
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [ENTRY] }),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
import './register-builtins';
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

afterEach(() => {
  cleanup();
  mockClient.get.mockClear();
});

describe('the object a form\'s field pickers are bound to, as the form declares it (objectstack#37309)', () => {
  it('a knowledge source declares `source.object`; the pack, the page and the view declare what the fixed list already read', () => {
    expect(declaredBoundObjectPath(METADATA_FORM_REGISTRY.knowledge_source)).toBe('source.object');
    expect(declaredBoundObjectPath(METADATA_FORM_REGISTRY.ai_context)).toBe('object');
    expect(declaredBoundObjectPath(METADATA_FORM_REGISTRY.page)).toBe('interfaceConfig.source');
    expect(declaredBoundObjectPath(METADATA_FORM_REGISTRY.view)).toBe('data.object');
  });

  it('a repeater\'s rows are not walked: their `dependsOn` names a key of each row', () => {
    const form = { sections: [{ fields: [{ field: 'rows', type: 'repeater', fields: [{ field: 'f', widget: 'field-ref', dependsOn: 'object' }] }] }] };
    expect(declaredBoundObjectPath(form)).toBeUndefined();
    expect(declaredBoundObjectPath(undefined)).toBeUndefined();
  });

  it('reads only a non-empty string at the path', () => {
    expect(objectNameAt({ source: { object: 'acme_task' } }, 'source.object')).toBe('acme_task');
    expect(objectNameAt({ source: { object: '' } }, 'source.object')).toBeUndefined();
    expect(objectNameAt({ source: 'acme_task' }, 'source.object')).toBeUndefined();
    expect(objectNameAt({ source: { object: 'acme_task' } }, undefined)).toBeUndefined();
  });
});

describe('MetadataResourceEditPage — a knowledge source\'s field pickers offer its object\'s fields (objectstack#37309)', () => {
  it('reads the catalog of `source.object`, and the content picker draws that object\'s field labels', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/knowledge_source/task_notes']}>
        <MetadataResourceEditPage type="knowledge_source" name="task_notes" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockClient.get).toHaveBeenCalledWith('object', 'acme_task'), { timeout: 8000 });
    // The labels are the catalog's, so they show only once the catalog is bound to the right object.
    expect(await screen.findByText('Task title', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('Task status')).toBeInTheDocument();
  });

  it('CONTROL: a source with no object yet reads no catalog', async () => {
    const before = SOURCE.item;
    SOURCE.item = { name: 'task_notes', label: 'Task notes', source: { kind: 'object', content: ['title'] } };
    try {
      render(
        <MemoryRouter initialEntries={['/metadata/knowledge_source/task_notes']}>
          <MetadataResourceEditPage type="knowledge_source" name="task_notes" />
        </MemoryRouter>,
      );
      expect((await screen.findAllByText('title', {}, { timeout: 8000 })).length).toBeGreaterThan(0);
      expect(mockClient.get.mock.calls.filter(([type]) => type === 'object')).toEqual([]);
    } finally {
      SOURCE.item = before;
    }
  });
});
