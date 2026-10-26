// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **One expression, one verdict — judged against the scope the engine binds**
 * (objectui#11789).
 *
 * A record-triggered flow's Start node read "Valid CEL" and, directly below it,
 * "`record` is not a reference in scope at this step." for the same entry
 * condition. Two defects shared that one screen:
 *
 *  1. the scope Studio judged the Start node against had no `record`, while the
 *     engine binds it there: `seedRunVariables` seeds `record`, `$record`, the
 *     record's own fields and `previous` before the start-condition gate runs;
 *  2. when a root really is out of scope, the raw CEL editor still said "Valid
 *     CEL" above the scope note, because its lint only knows the CEL scope roots.
 *     The scope verdict replaces the syntax verdict, so the panel says one thing.
 *
 * Measured through the WHOLE inspector, never a hand-built scope: a draft goes
 * in, `useFlowScope` resolves it, and `FlowNodeConfigField` → `ConditionBuilder`
 * → `CelPredicateField` render what an author sees. The per-trigger scope table
 * itself is pinned in `inspectors/flow-scope.test.ts`.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Same network stubs as the sibling FlowNodeInspector suites: the engine
// config-schema hook (the inspector then uses its hardcoded field groups), the
// trigger object's field catalog, and the shared metadata client.
vi.mock('./previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
const FIELDS = vi.hoisted(() => [
  { name: 'status', label: 'Status', type: 'text', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
]);
vi.mock('./previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: FIELDS, loading: false, error: null }),
}));
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

/**
 * The real CEL lint, observed. Every result the raw editor receives is kept, so
 * a negative assertion below reads the editor AFTER its lint answered (and can
 * show the lint answered "clean"), never a screen caught before the debounce.
 */
const lint = vi.hoisted(() => ({ results: [] as Array<Promise<unknown[]>> }));
vi.mock('./celAuthoring', async (importOriginal) => {
  const real = await importOriginal<typeof import('./celAuthoring')>();
  return {
    ...real,
    lintCelPredicate: (...args: Parameters<typeof real.lintCelPredicate>) => {
      const p = real.lintCelPredicate(...args);
      lint.results.push(p);
      return p;
    },
  };
});

import { FlowNodeInspector } from './inspectors/FlowNodeInspector';
import { CelPredicateField } from './CelPredicateField';
import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';

afterEach(() => {
  cleanup();
  lint.results.length = 0;
});

beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

const VALID = 'Valid CEL';
const SCOPE_NOTE = /is not a reference in scope at this step|Not in scope:/;

function renderStartNode(config: Record<string, unknown>, variables?: unknown[]) {
  const draft = {
    ...(variables ? { variables } : {}),
    nodes: [{ id: 'start', type: 'start', label: 'When a lead changes', config }],
    edges: [],
  };
  return render(
    <FlowNodeInspector
      type="flow"
      name="lead_followup"
      draft={draft}
      selection={{ kind: 'node', id: 'start' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
}

/** Switch the entry condition's row builder to its raw CEL editor — the
 *  editor the card was read off. */
async function openRawEditor(container: HTMLElement) {
  const toggle = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Expression'));
  expect(toggle, 'the entry condition opens in row mode with an Expression toggle').toBeTruthy();
  await userEvent.click(toggle!);
}

/** Wait until the raw editor's lint has answered, and hand back its last answer. */
async function settledLint(): Promise<unknown[]> {
  await waitFor(() => expect(lint.results.length).toBeGreaterThan(0), { timeout: 3000 });
  const all = await Promise.all(lint.results);
  await act(async () => {});
  return all[all.length - 1];
}

const UPDATE_TRIGGER = { triggerType: 'record-after-update', objectName: 'crm_lead' };

describe('objectui#11789 a record-triggered Start node is judged against the scope the engine binds', () => {
  it("`record.status == 'done' && previous.status != 'done'` on an update trigger reads only \"Valid CEL\"", async () => {
    const { container } = renderStartNode({
      ...UPDATE_TRIGGER,
      condition: "record.status == 'done' && previous.status != 'done'",
    });
    // Row mode first: no scope note under the rows either.
    expect(screen.queryByText(SCOPE_NOTE)).toBeNull();
    await openRawEditor(container);
    expect(await screen.findByText(VALID, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(SCOPE_NOTE)).toBeNull();
  });

  it("control: the bare spelling `status == 'done' && previous.status != 'done'` is unchanged", async () => {
    const { container } = renderStartNode({
      ...UPDATE_TRIGGER,
      condition: "status == 'done' && previous.status != 'done'",
    });
    expect(screen.queryByText(SCOPE_NOTE)).toBeNull();
    await openRawEditor(container);
    expect(await screen.findByText(VALID, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(SCOPE_NOTE)).toBeNull();
  });

  it('a schedule-triggered Start node does not gain `record`: the scope note names it, and nothing says "Valid CEL"', () => {
    // A declared variable makes the scope KNOWN at this node; with none, the
    // ref check has no roots and stays silent by design ("scope unknown").
    renderStartNode(
      { triggerType: 'schedule', schedule: { expression: '0 7 * * *' }, condition: "record.status == 'done'" },
      [{ name: 'threshold', type: 'number' }],
    );
    expect(screen.getByText('`record` is not a reference in scope at this step.')).toBeInTheDocument();
    expect(screen.queryByText(VALID)).toBeNull();
  });
});

describe('objectui#11789 one verdict: an out-of-scope root replaces "Valid CEL"', () => {
  it('a root the CEL lint accepts but the engine never binds here reads the scope note alone', async () => {
    // `trigger` is a CEL scope root (the approval approver's submit-time
    // snapshot), so the lint is clean; a flow's start condition binds no
    // `trigger`, so the flow scope check is the verdict that holds.
    const { container } = renderStartNode({
      ...UPDATE_TRIGGER,
      condition: "status == 'done' && trigger.status != 'done'",
    });
    await openRawEditor(container);
    const issues = await settledLint();
    // The premise: the syntax verdict on its own WOULD be "Valid CEL".
    expect(issues).toEqual([]);
    expect(screen.getByText('`trigger` is not a reference in scope at this step.')).toBeInTheDocument();
    expect(screen.queryByText(VALID)).toBeNull();
  });

  it('the editor itself: a host scope issue withholds "Valid CEL"; without one the clean verdict shows', async () => {
    const t = (k: string) => k;
    const { rerender } = render(
      <CelPredicateField value="status == 'done'" onChange={() => {}} label="Entry" fieldNames={['status']} t={t} scopeIssue />,
    );
    expect(await settledLint()).toEqual([]);
    expect(screen.queryByText('perm.cel.valid')).toBeNull();
    rerender(<CelPredicateField value="status == 'done'" onChange={() => {}} label="Entry" fieldNames={['status']} t={t} />);
    expect(await screen.findByText('perm.cel.valid')).toBeInTheDocument();
  });

  it("control: the permission matrix's RLS editor still reads \"Valid CEL\" for a clean clause", async () => {
    const t = (k: string) => k;
    const user = userEvent.setup();
    render(
      <PermissionAdvancedFacets
        {...({
          draft: {
            rowLevelSecurity: [
              { name: 'p1', object: 'account', operation: 'all', using: 'organization_id == current_user.organization_id', check: '', enabled: true },
            ],
          },
          setDraft: () => {},
          writable: true,
          allSetNames: [] as string[],
          loadObjectFields: async () => ['organization_id', 'owner_id'],
          t,
        } as unknown as ComponentProps<typeof PermissionAdvancedFacets>)}
      />,
    );
    await user.click(screen.getByText('perm.rls.title'));
    expect(await screen.findByText('perm.cel.valid', {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
