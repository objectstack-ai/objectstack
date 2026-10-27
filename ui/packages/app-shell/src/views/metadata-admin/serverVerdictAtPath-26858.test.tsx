// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26858 — an expression field reads the server's verdict at its
 * own path.
 *
 * Since objectstack#26707 a draft's `_diagnostics` carries what its publish
 * will refuse, and the banner and canvas Problems panel show it. The fields
 * themselves still printed their own client verdict: the RLS clause editor
 * said "Valid CEL" for a predicate over a formula field that publish refuses
 * (`rls-predicate-unenforceable`), and the flow edge condition said nothing
 * for a condition publish refuses (`expression-invalid`). Each field now asks
 * the page's served verdict (`DraftVerdictContext`) for the errors at exactly
 * its item-relative path, shows the server's message and withholds "Valid
 * CEL". ⛔ No rule is restated client-side: the verdicts below are served
 * doubles, and the fields are handed nothing but the path.
 *
 * Every absence is read against a presence from the same render: the clause
 * the verdict names beside the sibling clause it does not.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { PermissionAdvancedFacets } from './PermissionAdvancedFacets';
import { FlowEdgeInspector } from './inspectors/FlowEdgeInspector';
import { DraftVerdictContext, serverErrorsAt, type ServerDiagnostics } from './draftVerdict';
import type { MetadataSelection } from './preview-registry';

afterEach(cleanup);

const t = (k: string) => k;
const VALID = 'perm.cel.valid';

const RLS_REFUSAL =
  "rowLevelSecurity 'hot_deals' using reads 'deal_score', a formula field the database cannot filter on";

function verdict(errors: ServerDiagnostics['errors']): ServerDiagnostics {
  return { valid: false, errors };
}

const CLEAN = 'organization_id == current_user.organization_id';

async function renderRls(served: ServerDiagnostics | undefined, policies = 1) {
  const user = userEvent.setup();
  const rows = Array.from({ length: policies }, (_, i) => ({
    name: `p${i}`,
    object: 'account',
    operation: 'all',
    using: CLEAN,
    check: CLEAN,
    enabled: true,
  }));
  const facets = (
    <PermissionAdvancedFacets
      {...({
        draft: { rowLevelSecurity: rows },
        setDraft: () => {},
        writable: true,
        allSetNames: [] as string[],
        loadObjectFields: async () => ['organization_id', 'owner_id'],
        t,
      } as unknown as React.ComponentProps<typeof PermissionAdvancedFacets>)}
    />
  );
  render(served === undefined ? facets : <DraftVerdictContext.Provider value={served}>{facets}</DraftVerdictContext.Provider>);
  await user.click(screen.getByText('perm.rls.title'));
}

/** The editor wrapping each clause, in render order: policy 0 USING, policy 0 CHECK, policy 1 USING, … */
const clauseBoxes = () =>
  screen.getAllByRole('combobox').map((ta) => ta.closest('div')!.parentElement as HTMLElement);

describe('the RLS clause editor reads the served verdict at its path (objectstack#26858)', () => {
  it('a USING clause the server refuses shows the server message and no "Valid CEL"; its CHECK still reads valid', async () => {
    await renderRls(verdict([{ path: 'rowLevelSecurity.0.using', message: RLS_REFUSAL, code: 'rls-predicate-unenforceable' }]));
    // The CHECK clause's lint answered clean: the lint has spoken on both.
    await waitFor(() => expect(screen.getAllByText(VALID)).toHaveLength(1), { timeout: 3000 });
    const [using, check] = clauseBoxes();
    expect(within(using).getByText(RLS_REFUSAL)).toBeInTheDocument();
    expect(within(using).queryByText(VALID)).toBeNull();
    expect(within(using).getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
    expect(within(check).getByText(VALID)).toBeInTheDocument();
    expect(within(check).queryByText(RLS_REFUSAL)).toBeNull();
  });

  it('a verdict at another policy\'s clause does not leak to this one', async () => {
    await renderRls(verdict([{ path: 'rowLevelSecurity.1.using', message: RLS_REFUSAL, code: 'rls-predicate-unenforceable' }]), 2);
    await waitFor(() => expect(screen.getAllByText(VALID)).toHaveLength(3), { timeout: 3000 });
    const boxes = clauseBoxes();
    expect(within(boxes[0]).getByText(VALID)).toBeInTheDocument();
    expect(within(boxes[0]).queryByText(RLS_REFUSAL)).toBeNull();
    expect(within(boxes[2]).getByText(RLS_REFUSAL)).toBeInTheDocument();
  });

  it('control: no verdict at its path — or no verdict at all — and the clause still reads "Valid CEL"', async () => {
    await renderRls(verdict([{ path: 'objects.account.allowRead', message: 'unrelated', code: 'x' }]));
    await waitFor(() => expect(screen.getAllByText(VALID)).toHaveLength(2), { timeout: 3000 });
    cleanup();
    await renderRls(undefined);
    await waitFor(() => expect(screen.getAllByText(VALID)).toHaveLength(2), { timeout: 3000 });
  });
});

const EDGE_REFUSAL = "Unexpected token: EOF — source: `record.name ==`";

function edgeDraft() {
  return {
    variables: [{ name: 'threshold', type: 'number' }],
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'decide', type: 'decision' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'decide' },
      { id: 'e2', source: 'decide', target: 'end', type: 'conditional', condition: 'record.name ==' },
    ],
  };
}

function renderEdge(id: string, served: ServerDiagnostics | undefined) {
  const selection: MetadataSelection = { kind: 'edge', id };
  const inspector = (
    <FlowEdgeInspector
      type="flow"
      name="edge_cel"
      draft={edgeDraft()}
      selection={selection}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      locale="en-US"
      readOnly={false}
    />
  );
  return render(
    served === undefined ? inspector : <DraftVerdictContext.Provider value={served}>{inspector}</DraftVerdictContext.Provider>,
  );
}

describe('the flow edge condition reads the served verdict at its path (objectstack#26858)', () => {
  const served = verdict([{ path: 'edges.1.condition', message: EDGE_REFUSAL, code: 'expression-invalid' }]);

  it('the refused edge shows the server message under its condition', () => {
    renderEdge('e2', served);
    expect(screen.getByTestId('flow-edge-server-error')).toHaveTextContent(EDGE_REFUSAL);
  });

  it('the other edge of the same flow shows nothing', () => {
    renderEdge('e1', served);
    expect(screen.queryByText(EDGE_REFUSAL)).toBeNull();
  });

  it('control: with no served verdict the refused edge shows nothing from the server', () => {
    renderEdge('e2', undefined);
    expect(screen.queryByTestId('flow-edge-server-error')).toBeNull();
  });
});

describe('serverErrorsAt — equality on the served path, never a prefix', () => {
  const served = verdict([
    { path: 'edges.1.condition', message: 'a' },
    { path: 'edges.10.condition', message: 'b' },
    { path: 'edges.1', message: 'c' },
  ]);
  it('returns only the entries at exactly the path', () => {
    expect(serverErrorsAt(served, 'edges.1.condition').map((e) => e.message)).toEqual(['a']);
    expect(serverErrorsAt(served, 'edges.2.condition')).toEqual([]);
    expect(serverErrorsAt(served, undefined)).toEqual([]);
    expect(serverErrorsAt(undefined, 'edges.1.condition')).toEqual([]);
  });
});
