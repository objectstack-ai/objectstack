// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27799 — on the Studio Automations page, a flow's Problems list
 * and a node's value cell agree about a value written as a blank expression.
 *
 * The spec's value-slot rule is the one judge: the cell runs it live, and the
 * publish gate runs it on the stored draft, whose verdict the draft read
 * serves (`_diagnostics`). The page already handed that verdict to the
 * inspectors (objectstack#26858) but not to the canvas, so its Problems list
 * read "No problems" for a flow the publish refuses. It now reads the same
 * verdict, and both say the refusal in the same business words.
 *
 * The client is a server double that judges the way the server does: the save
 * door parses `FlowSchema` (the flow parse does not run the value-slot rule),
 * and the draft read folds in the publish gate's finding, which is the real
 * `validateStackExpressions` from `@objectstack/lint`, located at the node's
 * config key path re-spelled item-relative as the door does. The canvas is the real
 * `FlowPreview` beside a button that selects the Update Records node.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FlowSchema } from '@objectstack/spec/automation';
import { validateStackExpressions } from '@objectstack/lint';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'touch_account',
  label: 'Touch account',
  type: 'record_change',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { objectName: 'account', triggerType: 'on_update' } },
    { id: 'write', type: 'update_record', label: 'Write', config: { objectName: 'account' } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write' },
    { id: 'e2', source: 'write', target: 'end' },
  ],
};

type Entry = { path: string; message: string; code?: string };

const server = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null, draftReads: 0 }));

/** The save door's gate: the flow parse. */
function schemaErrors(body: unknown): Entry[] {
  const parsed = FlowSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/**
 * The door re-spells a gate path found on the written item item-relative
 * (`flows[0].nodes[1].config.fields.id` → `nodes.1.config.fields.id`) and keeps
 * any other as written: mirrors `itemRelativeIssuePath` in
 * `packages/metadata-protocol/src/metadata-diagnostics.ts`.
 */
function itemRelative(path: string): string {
  if (path !== 'flows[0]' && !path.startsWith('flows[0].') && !path.startsWith('flows[0][')) return path;
  return path.slice('flows[0]'.length).replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

/** The draft read's `_diagnostics`: the parse, plus what the publish gate refuses. */
function draftVerdict(body: Record<string, unknown>): { valid: boolean; errors?: Entry[] } {
  const publish = validateStackExpressions({ flows: [body] })
    .filter((i) => (i.severity ?? 'error') === 'error')
    .map((i) => ({ path: itemRelative(i.path ?? i.where), message: i.message, code: 'expression-invalid' }));
  const errors = [...schemaErrors(body), ...publish];
  return errors.length ? { valid: false, errors } : { valid: true };
}

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [{ name: 'touch_account', label: 'Touch account' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true })),
  getDraft: vi.fn(async (type: string, name: string) => {
    server.draftReads += 1;
    if (!server.draft) {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }
    return { type, name, item: { ...server.draft, _draft: true, _diagnostics: draftVerdict(server.draft) } };
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => {
    const issues = schemaErrors(item);
    if (issues.length) {
      throw Object.assign(new Error(`${type}/${name} failed spec validation`), { code: 'INVALID_METADATA', status: 422, issues });
    }
    server.draft = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    return { type, name, item };
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The engine palette / config-schema reads at their offline answer, and an
// empty field catalog (the shape `flowNodeLabels-13200.test.tsx` uses).
vi.mock('../metadata-admin/previews/useFlowNodePalette', async () => {
  const { NODE_PALETTE } = await import('../metadata-admin/previews/flow-canvas-parts');
  return { useActionConfigSchemas: () => ({}), useFlowNodePalette: () => NODE_PALETTE };
});
vi.mock('../metadata-admin/previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { getMetadataPreview, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { valueEnvelopeRefusal } from '../metadata-admin/inspectors/flow-value-envelope';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** The real flow canvas, plus a button that selects the Update Records node. */
function PreviewWithSelect(props: React.ComponentProps<typeof FlowPreview>) {
  return (
    <>
      <button type="button" onClick={() => props.onSelectionChange?.({ kind: 'node', id: 'write', label: 'Write' })}>
        select write
      </button>
      <FlowPreview {...props} />
    </>
  );
}

const NEEDED = () => t('engine.inspector.flowNode.kv.expressionNeeded');
const EMPTY = () => t('engine.flowProblems.empty');

const realFlow = getMetadataPreview('flow');
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  server.draft = JSON.parse(JSON.stringify(FLOW));
  server.draftReads = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('flow', PreviewWithSelect as never);
});

afterEach(() => {
  cleanup();
  if (realFlow) registerMetadataPreview('flow', realFlow);
});

/** Open the flow, select Update Records, add the value `id` and switch it to a blank expression. */
async function writeBlankExpression() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'select write' }, { timeout: 8000 }));
  // The node has two maps (Filter, Field values); the value goes in Field values.
  const adds = await screen.findAllByRole('button', { name: 'Add entry' }, { timeout: 8000 });
  const fieldValues = adds.find((b) => b.parentElement?.querySelector('label')?.textContent === 'Field values');
  expect(fieldValues).toBeTruthy();
  const readsBefore = server.draftReads;
  fireEvent.click(fieldValues!);
  const map = fieldValues!.parentElement!;
  const key = within(map).getByPlaceholderText('Key');
  fireEvent.change(key, { target: { value: 'id' } });
  fireEvent.blur(key);
  fireEvent.click(within(map).getByRole('button', { name: 'Write as a CEL expression' }));
  return { map, readsBefore };
}

describe('Automations page — Problems and the node agree on a blank expression (objectstack#27799)', () => {
  it('the publish verdict on the blank value is the node cell\'s own refusal: one judge', () => {
    const blank = { dialect: 'cel', source: '' };
    const write = { ...FLOW.nodes[1], config: { objectName: 'account', fields: { id: blank } } };
    const body = { ...FLOW, nodes: [FLOW.nodes[0], write, FLOW.nodes[2]] };
    // The flow parse lets the value through, so the draft is stored …
    expect(schemaErrors(body)).toEqual([]);
    // … and the publish verdict refuses it with exactly what the cell's live spec parse says.
    expect((draftVerdict(body).errors ?? []).map((e) => e.message)).toEqual(valueEnvelopeRefusal(blank));
  });

  it('the node cell and the Problems list both name the blank expression, in the same words', async () => {
    const { map, readsBefore } = await writeBlankExpression();

    // The node: business words, not the envelope's wire shape.
    expect(within(map).getByRole('alert').textContent).toBe(NEEDED());

    // The draft is stored, and its verdict read again …
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
    await waitFor(() => expect(server.draftReads).toBeGreaterThan(readsBefore), { timeout: 6000 });

    // … and the Problems list says what the publish will refuse, and where.
    fireEvent.click(screen.getByTestId('auto-tab-problems'));
    const target = await screen.findByTestId('flow-problem-target', {}, { timeout: 6000 });
    expect(screen.queryByText(EMPTY())).toBeNull();
    const row = target.closest('li')!;
    expect(within(row).getByText(NEEDED())).toBeInTheDocument();
    // The row is located at the node itself (#28192): its name, keyed by its id.
    expect(target.textContent).toBe('Write');
    expect(target.getAttribute('title')).toBe('write');
    expect(screen.getByTestId('auto-problems-count')).toHaveTextContent('1');
  });

  it('control: once the expression is written, the cell and the Problems list clear together', async () => {
    const { map } = await writeBlankExpression();
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
    fireEvent.click(screen.getByTestId('auto-tab-problems'));
    await screen.findByTestId('flow-problem-target', {}, { timeout: 6000 });

    const saves = mockClient.save.mock.calls.length;
    const source = within(map).getByPlaceholderText('CEL expression, e.g. joinNonEmpty(…)');
    fireEvent.change(source, { target: { value: 'record.id' } });
    fireEvent.blur(source);

    expect(within(map).queryByRole('alert')).toBeNull();
    await waitFor(() => expect(mockClient.save.mock.calls.length).toBeGreaterThan(saves), { timeout: 6000 });
    expect(await screen.findByText(EMPTY(), {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-problem-target')).toBeNull();
  });
});
