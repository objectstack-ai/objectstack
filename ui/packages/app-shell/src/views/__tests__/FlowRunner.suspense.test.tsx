// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: mounting the screen-flow runner must never tear down its host.
 *
 * An `object-form` step renders ObjectForm, whose field widgets are lazy. That
 * suspension used to unwind to the HOST's nearest <Suspense> — on surfaces
 * where that is the route-level boundary, React swapped the whole page for the
 * fallback and remounted it, destroying the host's state along with the dialog
 * driving the paused run. The screen vanished before it could be filled in and
 * no resume was ever issued: "Submit does nothing", from a cause that has
 * nothing to do with the submit handler (framework#3528).
 *
 * The unit tests around it never caught this because they render FlowRunner
 * directly with an eagerly-imported body. This one reproduces the real shape:
 * a lazy screen body, a route-level boundary above the host, and host state
 * that must still be there afterwards.
 */

import { Suspense, lazy, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ObjectForm stands in for any lazily-loaded screen body. It resolves only when
// this deferred promise settles, so the suspension is observable mid-flight.
let releaseForm: () => void = () => {};
const formLoaded = new Promise<void>((resolve) => { releaseForm = resolve; });

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: lazy(async () => {
    await formLoaded;
    return { default: ({ schema }: any) => <button onClick={() => schema?.onSuccess?.({ id: 'rec_1' })}>Save &amp; Continue</button> };
  }),
}));

const { FlowRunner } = await import('../FlowRunner');

const OBJECT_FORM_STATE = {
  flowName: 'convert_lead',
  runId: 'run-1',
  screen: {
    nodeId: 'account',
    kind: 'object-form' as const,
    title: 'Step 1 · Customer',
    objectName: 'crm_account',
    mode: 'create' as const,
    idVariable: 'account_id',
    fields: [],
  },
};

/**
 * A host that owns state the way a real page does. The mount id is minted once
 * per mount, so a remount — which is what a suspension escaping to the route
 * boundary causes, taking the host's state and this dialog with it — shows up
 * as a bumped id rather than as a subtle missing-state symptom.
 */
let mounts = 0;
function Host({ authFetch }: { authFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const [mountId] = useState(() => ++mounts);
  return (
    <div>
      <span data-testid="host-mount-id">{mountId}</span>
      <FlowRunner
        state={OBJECT_FORM_STATE}
        authFetch={authFetch}
        baseUrl=""
        dataSource={{}}
        onClose={() => {}}
        onComplete={() => {}}
      />
    </div>
  );
}

describe('FlowRunner — a lazy screen body must not unwind past the dialog', () => {
  it('keeps the route-level boundary (and the host) intact while the body loads', async () => {
    const user = userEvent.setup();
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { success: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(
      <Suspense fallback={<div>ROUTE FALLBACK</div>}>
        <Host authFetch={authFetch} />
      </Suspense>,
    );

    const mountId = screen.getByTestId('host-mount-id').textContent;

    // Mid-suspension: the runner's own boundary absorbs it. The route-level
    // fallback must NOT be showing, and the host must still be the same mount.
    expect(screen.queryByText('ROUTE FALLBACK')).not.toBeInTheDocument();
    expect(screen.getByTestId('host-mount-id')).toHaveTextContent(mountId!);
    expect(screen.getByRole('dialog')).toHaveTextContent('Step 1 · Customer');

    releaseForm();

    // Body resolves in place; the host was never remounted and the run is
    // still resumable.
    await waitFor(() => expect(screen.getByRole('button', { name: /Save & Continue/ })).toBeInTheDocument());
    expect(screen.getByTestId('host-mount-id')).toHaveTextContent(mountId!);

    await user.click(screen.getByRole('button', { name: /Save & Continue/ }));
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        '/api/v1/automation/convert_lead/runs/run-1/resume',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ inputs: { account_id: 'rec_1' } }) }),
      ),
    );
  });
});
