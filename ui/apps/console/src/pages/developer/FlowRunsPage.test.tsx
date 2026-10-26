/**
 * Flow Runs — a screen flow triggered from the Test Run panel must be
 * completable, not left suspended.
 *
 * Regression for framework#3528: the panel triggered the flow, dumped the
 * `{ status: 'paused', runId, screen }` envelope as JSON and stopped — the run
 * stayed paused forever and the resume endpoint was never called from any
 * developer surface. The panel now hands the pause to the shared FlowRunner.
 *
 * jsdom integration test — no backend; the automation client and the
 * authenticated fetch the runner resumes through are both stubbed.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted so the vi.mock factories below can close over them, and so the
// adapter is a STABLE singleton (a fresh object per render loops the page's
// fetch effects).
const { execute, ADAPTER, authFetch } = vi.hoisted(() => {
  const flow = {
    name: 'reassign_wizard',
    label: 'Reassign',
    variables: [{ name: 'recordId', type: 'text', isInput: true }],
  };
  // The trigger response for a screen flow: suspended at its `screen` node.
  const execute = vi.fn(async () => ({
    success: true,
    status: 'paused',
    runId: 'run_1',
    durationMs: 3,
    // The flow's served label (objectui#11092): the runner names the flow by it.
    flowLabel: 'Reassign',
    screen: {
      nodeId: 'collect',
      title: 'New Assignee',
      fields: [{ name: 'new_assignee', label: 'New Assignee', type: 'text', required: true }],
    },
  }));
  const ADAPTER = {
    getClient: () => ({
      // The served list item IS the flow definition (objectui#12829).
      meta: { getItems: async (type: string) => (type === 'flow' ? [flow] : []) },
      automation: { execute, listRuns: async () => ({ runs: [] }) },
    }),
  };
  const authFetch = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { success: true, durationMs: 9 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  return { execute, ADAPTER, authFetch };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => {
  // The runner itself is the real component — this test asserts it is mounted
  // AND that it resumes, so stubbing it would defeat the purpose.
  const { FlowRunner } = await import('../../../../../packages/app-shell/src/views/FlowRunner');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAdapter: () => ADAPTER,
    useMetadata: () => ({ objects: [] }),
    FlowRunner,
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => authFetch,
}));

// Imported AFTER the mocks so the page picks them up.
import { FlowRunsPage } from './FlowRunsPage';

beforeEach(() => {
  execute.mockClear();
  authFetch.mockClear();
});
afterEach(cleanup);

describe('Flow Runs — screen flows are completable from the Test Run panel', () => {
  it('renders the paused screen and resumes the run on Submit', async () => {
    const user = userEvent.setup();
    render(<FlowRunsPage />);

    await screen.findByRole('button', { name: /Run Flow/i });
    await user.click(screen.getByRole('button', { name: /Run Flow/i }));

    // The pause opens the shared screen-flow runner instead of dead-ending.
    await waitFor(() => expect(execute).toHaveBeenCalledWith('reassign_wizard', expect.any(Object)));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New Assignee');

    // The dialog's field is the last textbox on the page (the panel's own
    // input-variable boxes render above it).
    const textboxes = screen.getAllByRole('textbox');
    await user.type(textboxes[textboxes.length - 1], 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        '/api/v1/automation/reassign_wizard/runs/run_1/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ inputs: { new_assignee: 'ada@example.com' } }),
        }),
      ),
    );
  });

  it('offers a "Continue run" affordance after the runner is dismissed', async () => {
    const user = userEvent.setup();
    render(<FlowRunsPage />);

    await screen.findByRole('button', { name: /Run Flow/i });
    await user.click(screen.getByRole('button', { name: /Run Flow/i }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The suspension is durable — the tester can reopen the pending screen.
    const resume = await screen.findByRole('button', { name: /Continue run/i });
    await user.click(resume);
    expect(await screen.findByRole('dialog')).toHaveTextContent('New Assignee');
  });

  it('names the flow by the trigger answer\'s served label, on the run and on Continue run (objectui#11092)', async () => {
    const user = userEvent.setup();
    render(<FlowRunsPage />);

    await screen.findByRole('button', { name: /Run Flow/i });
    await user.click(screen.getByRole('button', { name: /Run Flow/i }));
    const first = within(await screen.findByRole('dialog'));
    expect(first.getByText('Reassign')).toBeInTheDocument();
    expect(first.queryByText('reassign_wizard')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: /Continue run/i }));
    const reopened = within(await screen.findByRole('dialog'));
    expect(reopened.getByText('Reassign')).toBeInTheDocument();
    expect(reopened.queryByText('reassign_wizard')).not.toBeInTheDocument();
  });
});
