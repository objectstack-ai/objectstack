// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36860 — the generic metadata list reads the columns the type's
 * `/meta/types` entry serves (`entries[].list`, the spec's
 * `METADATA_LIST_REGISTRY`), ahead of the console's own declaration.
 *
 * What is pinned, each against a control:
 *
 *  - a served list decides the columns and their order, and its headers are
 *    shown exactly as served (already in the reader's locale), never replaced
 *    by the console's `engine.list.col.*` text for the same key;
 *  - each declared renderer draws its cell: a list joins, a count counts, a
 *    boolean marks, a dotted path reads into the body;
 *  - a key the stored row leaves out shows the schema default the served JSON
 *    Schema declares (what the runtime uses), and a key with no default shows
 *    the empty cell;
 *  - a type serving no list keeps the default name / label / description;
 *  - a console `listCells` override draws the cell of a served column, and a
 *    console `listExtraColumns` column follows the served ones.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// Dynamic imports the page's anchors and editors reach, paid at collection
// rather than inside a case's clocked window.
import '@object-ui/plugin-detail';
import '@objectstack/lint';

const HOOKS: Record<string, unknown>[] = [
  { name: 'stamp_owner', label: 'Stamp owner', object: 'account', events: ['beforeInsert', 'beforeUpdate'], async: true },
  // `priority` and `async` left at their schema defaults: stored rows omit them.
  { name: 'audit_all', label: 'Audit all', object: ['account', 'contact'], events: ['afterDelete'] },
];
const AGENTS: Record<string, unknown>[] = [{ name: 'helper', label: 'Helper', model: { provider: 'openai', model: 'gpt-4o' } }];
const QUEUES: Record<string, unknown>[] = [{ name: 'tier1', label: 'Tier 1', members: [{ type: 'user', id: 'a' }, { type: 'user', id: 'b' }] }];
const SKILLS: Record<string, unknown>[] = [{ name: 'triage', label: 'Triage', tools: ['a', 'b'] }];

const VIEWS: Record<string, unknown>[] = [
  { name: 'all_accounts', object: 'account', label: 'All accounts', viewKind: 'list', config: { type: 'kanban' } },
];

const CLIENT = {
  list: async (type: string) =>
    type === 'hook' ? HOOKS : type === 'agent' ? AGENTS : type === 'queue' ? QUEUES : type === 'skill' ? SKILLS : type === 'view' ? VIEWS : [],
};

// Headers as the server serves them to a zh-CN reader.
const HOOK_ENTRY = {
  type: 'hook',
  label: '钩子',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      priority: { type: 'number', default: 100 },
      async: { type: 'boolean', default: false },
      events: { type: 'array', items: { type: 'string' } },
    },
  },
  list: {
    data: { provider: 'schema', schemaId: 'hook' },
    columns: [
      { field: 'name', label: '名称' },
      { field: 'object', label: '对象', type: 'list' },
      { field: 'events', label: '事件', type: 'list' },
      { field: 'priority', label: '优先级' },
      { field: 'async', label: '异步', type: 'boolean' },
      { field: 'description', label: '描述' },
    ],
  },
};
const AGENT_ENTRY = {
  type: 'agent',
  label: 'Agent',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
  list: {
    data: { provider: 'schema', schemaId: 'agent' },
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'model.model', label: 'Model' },
    ],
  },
};
const QUEUE_ENTRY = {
  type: 'queue',
  label: 'Queue',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
  list: {
    data: { provider: 'schema', schemaId: 'queue' },
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'members', label: 'Members', type: 'count' },
    ],
  },
};
// Control: a type that serves no list.
const SKILL_ENTRY = { type: 'skill', label: 'Skill', allowEnvironmentOverlay: false, allowRuntimeCreate: true };
const VIEW_ENTRY = {
  type: 'view',
  label: 'View',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
  list: {
    data: { provider: 'schema', schemaId: 'view' },
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'type', label: 'Type', type: 'badge' },
    ],
  },
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [HOOK_ENTRY, AGENT_ENTRY, QUEUE_ENTRY, SKILL_ENTRY, VIEW_ENTRY],
  }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => true,
}));

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { registerBuiltinAnchors } from './anchors';
import { registerMetadataResource } from './registry';
import '../../services/builtinComponents';

registerBuiltinAnchors();
registerMetadataResource({
  type: 'queue',
  listCells: { members: { render: (v) => `${Array.isArray(v) ? v.length : 0} people` } },
  listExtraColumns: [{ key: '_packageId', label: 'Package' }],
});

afterEach(() => {
  cleanup();
});

function mount(type: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}?scope=environment`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function headersOf(): Promise<string[]> {
  const table = await screen.findByRole('table');
  return within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent?.trim() ?? '')
    .filter((text) => text !== '');
}

async function rowOf(name: string): Promise<string[]> {
  const cell = await screen.findByText(name);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return within(row).getAllByRole('cell').map((td) => td.textContent?.trim() ?? '');
}

describe('the generic list reads the served columns (objectstack#36860)', () => {
  it('a served list decides the columns, in order, under the served headers', async () => {
    mount('hook');
    const headers = await headersOf();
    expect(headers.slice(0, 6)).toEqual(['名称', '对象', '事件', '优先级', '异步', '描述']);
  });

  it('each declared renderer draws its cell, and an absent key shows its schema default', async () => {
    mount('hook');
    expect((await rowOf('stamp_owner')).slice(0, 5)).toEqual(['stamp_owner', 'account', 'beforeInsert, beforeUpdate', '100', '✓']);
    // `object` as a list of objects; `priority` / `async` absent → 100 / ✗.
    expect((await rowOf('audit_all')).slice(0, 5)).toEqual(['audit_all', 'account, contact', 'afterDelete', '100', '✗']);
  });

  it('a dotted path reads into the body', async () => {
    mount('agent');
    expect((await rowOf('helper')).slice(0, 2)).toEqual(['helper', 'gpt-4o']);
  });

  it('a type serving no list keeps the default columns (control)', async () => {
    mount('skill');
    const headers = await headersOf();
    // The setup list's default: label first (#27356), then description.
    expect(headers.slice(0, 2)).toEqual(['Label', 'Description']);
    expect(headers).not.toContain('Tools');
  });

  it('a console cell override draws a served column; a console extra column follows the served ones', async () => {
    mount('queue');
    expect((await headersOf()).slice(0, 3)).toEqual(['Name', 'Members', 'Package']);
    expect((await rowOf('tier1')).slice(0, 2)).toEqual(['tier1', '2 people']);
  });

  it('the view list keeps its derived display type through its console cell override', async () => {
    mount('view');
    expect((await rowOf('all_accounts')).slice(0, 2)).toEqual(['all_accounts', 'kanban']);
  });
});
