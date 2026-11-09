/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An action's declared `preflight` read in its param dialog (objectstack#31808).
 *
 * The flow under test is the cloud consumer's: an install action whose dialog
 * reads an upgrade plan for the environment and version the user picks, shows
 * its findings, and carries the plan's confirmation token into the submit.
 * The pieces are the real ones: the runner's `interpolateRead` (a real
 * `ActionRunner`), the real companion resolver with the spec's `ActionSchema`
 * judging the block, and the real dialog. Only the network (`apiFetch`) and
 * the lazy field widgets are doubles. `t()` answers its key, followed by its
 * options as JSON, so no language's wording is pinned.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { ActionRunner, type ActionParamDef, type ActionResult, type PreflightReadFiller } from '@object-ui/core';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
    language: 'en',
  }),
}));

vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  getLazyFieldWidget: () => ({ id, value, onChange }: any) => (
    <input id={id} data-testid={`widget-${id}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { SchemaRendererContext } from '@object-ui/react';
import { ActionParamDialog, type ParamDialogState } from './ActionParamDialog';
import { resolveParamDialogCompanion } from './actionDialogCompanion';

const PARAMS: ActionParamDef[] = [
  { name: 'environment_id', label: 'Environment', type: 'text', required: true },
  { name: 'version', label: 'Version', type: 'text', required: true },
  { name: 'confirm_schema_upgrade', label: 'Schema change confirmation', type: 'text', required: true },
];

const PLAN_URL =
  '/api/v1/cloud/packages/${ctx.recordId}/upgrade-plan?environment_id=${param.environment_id}&version=${param.version}';

/** The cloud consumer's action, as its author writes it. */
function installAction(preflight: Record<string, unknown> = {}) {
  return {
    name: 'install_package',
    label: 'Install',
    type: 'api',
    target: '/api/v1/cloud/packages/${ctx.recordId}/install',
    params: PARAMS,
    preflight: {
      read: { url: PLAN_URL },
      path: 'data',
      fields: [{ path: 'findings', label: 'Schema findings', format: 'json' }],
      seed: [{ param: 'confirm_schema_upgrade', path: 'verdict.findingSet' }],
      ...preflight,
    },
  };
}

/** The upgrade plan's answer, in the `{ success, data }` envelope. */
function plan(findingSet: string, findings: unknown[] = [{ table: 'crm_account', change: 'add column' }]) {
  return { success: true, data: { findings, verdict: { findingSet } } };
}

function answer(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** A deferred the test settles by hand, to hold a read in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let apiFetch: ReturnType<typeof vi.fn>;

/**
 * Run `action` on a real runner whose context names the record page's record,
 * and mount the dialog the param-collection handler opens, the way the
 * console's handlers compose it. Resolves once the dialog is up, with the
 * runner's `api` handler double and the run's outcome.
 */
async function openDialog(
  action: Record<string, unknown>,
  { record = { id: 'pkg_1', name: 'crm' }, fill }: {
    /** `null`: a runner whose context names no record. */
    record?: Record<string, unknown> | null;
    fill?: PreflightReadFiller;
  } = {},
) {
  const runner = new ActionRunner(record ? { record } : {});
  const api = vi.fn(async (): Promise<ActionResult> => ({ success: true }));
  runner.registerHandler('api', api);
  let setState!: (s: ParamDialogState) => void;
  function Host() {
    const [state, set] = React.useState<ParamDialogState>({ open: false, params: [] });
    setState = set;
    return (
      <SchemaRendererContext.Provider value={{ apiFetch } as never}>
        <ActionParamDialog state={state} onOpenChange={(open) => { if (!open) set((s) => ({ ...s, open: false })); }} />
      </SchemaRendererContext.Provider>
    );
  }
  render(<Host />);
  runner.setParamCollectionHandler((params, dispatched, _interpolate, _run, interpolateRead) =>
    new Promise((resolve) => {
      act(() => {
        setState({
          open: true,
          params,
          title: 'Install',
          resolve,
          companion: resolveParamDialogCompanion(undefined, dispatched?.name, undefined, {
            preflight: dispatched?.preflight,
            params,
            interpolateRead: fill ?? interpolateRead,
          }),
        });
      });
    }));
  const outcome = runner.execute(action as never);
  await screen.findByTestId('action-preflight-panel');
  return { api, outcome };
}

const panel = () => screen.getByTestId('action-preflight-panel');
const confirm = () => screen.getByRole('button', { name: 'actionDialog.confirm' });
const type = (name: string, value: string) =>
  fireEvent.change(screen.getByTestId(`widget-${name}`), { target: { value } });

// Each test reads its own URLs: the shared reader joins a read of the same URL
// that is still in flight, and a test may leave one pending on purpose.
let envSeq = 0;
let env = 'env_0';

beforeEach(() => {
  apiFetch = vi.fn(async () => answer(plan('fs_abc')));
  envSeq += 1;
  env = `env_${envSeq}`;
});

describe('the cloud-shaped flow: read, show, seed, submit (objectstack#31808)', () => {
  it('waits for the params its URL reads, then reads once, shows the findings and submits the token verbatim', async () => {
    const { api, outcome } = await openDialog(installAction());

    // Nothing to read yet: the URL reads two params the user has not given.
    expect(panel().getAttribute('data-status')).toBe('waiting');
    expect(within(panel()).getByText(/actionDialog\.preflight\.waiting/).textContent)
      .toContain('Environment, Version');
    expect(apiFetch).not.toHaveBeenCalled();

    type('environment_id', env);
    expect(apiFetch).not.toHaveBeenCalled();
    type('version', '2.0.0');

    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('ready'));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0])
      .toBe(`/api/v1/cloud/packages/pkg_1/upgrade-plan?environment_id=${env}&version=2.0.0`);
    expect(apiFetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    // The declared field, through the result dialog's renderer.
    expect(within(panel()).getByText('Schema findings')).toBeTruthy();
    expect(panel().textContent).toContain('crm_account');

    // The seeded param is drawn read-only: no widget is built for it.
    expect(screen.getByTestId('param-carry-over-confirm_schema_upgrade')).toBeTruthy();
    expect(screen.queryByTestId('widget-confirm_schema_upgrade')).toBeNull();
    expect(screen.getByText('actionDialog.preflight.seededHint')).toBeTruthy();

    fireEvent.click(confirm());
    await outcome;
    expect(api).toHaveBeenCalledTimes(1);
    const [dispatched] = api.mock.calls[0] as unknown as [{ params: Record<string, unknown> }];
    expect(dispatched.params).toMatchObject({
      environment_id: env,
      version: '2.0.0',
      confirm_schema_upgrade: 'fs_abc',
    });
  });

  it('reads again when a param the URL reads changes, and seeds from the new answer', async () => {
    apiFetch = vi.fn(async (url: string) => answer(plan(url.endsWith('3.0.0') ? 'fs_three' : 'fs_two')));
    const { api, outcome } = await openDialog(installAction());
    type('environment_id', env);
    type('version', '2.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('ready'));
    type('version', '3.0.0');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('ready'));
    fireEvent.click(confirm());
    await outcome;
    const [dispatched] = api.mock.calls[0] as unknown as [{ params: Record<string, unknown> }];
    expect(dispatched.params.confirm_schema_upgrade).toBe('fs_three');
  });
});

describe('a stale answer is never shown or seeded (objectstack#31808)', () => {
  it('an answer to a URL the dialog moved on from is dropped, even when it arrives last', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    apiFetch = vi.fn((url: string) => (url.endsWith('version=1.0.0') ? first.promise : second.promise));
    const { api, outcome } = await openDialog(installAction());
    type('environment_id', env);
    type('version', '1.0.0');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    type('version', '2.0.0');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(panel().getAttribute('data-status')).toBe('loading');

    // The current URL's answer first, then the old one.
    await act(async () => { second.resolve(answer(plan('fs_current'))); });
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('ready'));
    await act(async () => { first.resolve(answer(plan('fs_stale', [{ table: 'stale_table' }]))); });

    expect(panel().getAttribute('data-status')).toBe('ready');
    expect(panel().textContent).not.toContain('stale_table');
    fireEvent.click(confirm());
    await outcome;
    expect(api).toHaveBeenCalledTimes(1);
    const [dispatched] = api.mock.calls[0] as unknown as [{ params: Record<string, unknown> }];
    expect(dispatched.params.confirm_schema_upgrade).toBe('fs_current');
  });

  it('a change of URL clears the seed until the new URL answers', async () => {
    const second = deferred<Response>();
    apiFetch = vi.fn((url: string) => (url.endsWith('version=1.0.0')
      ? Promise.resolve(answer(plan('fs_one')))
      : second.promise));
    const { api } = await openDialog(installAction());
    type('environment_id', env);
    type('version', '1.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('ready'));
    type('version', '2.0.0');
    expect(panel().getAttribute('data-status')).toBe('loading');
    // Confirm now would submit the old plan's token for the new version: it
    // is held by the seeded param's `required` mark instead.
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText(/actionDialog\.requiredError/)).toBeTruthy());
    expect(api).not.toHaveBeenCalled();
  });
});

describe('a read that does not answer holds Confirm (objectstack#31808)', () => {
  it('a failed read draws the error panel, leaves the seed empty, and Confirm does not run', async () => {
    apiFetch = vi.fn(async () => answer({ error: 'boom' }, 500));
    const { api } = await openDialog(installAction());
    type('environment_id', env);
    type('version', '2.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('failed'));
    expect(within(panel()).getByRole('alert').textContent).toContain('actionDialog.preflight.failed');
    expect(within(panel()).getByRole('alert').textContent).toContain('answered 500');
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText(/actionDialog\.requiredError/)).toBeTruthy());
    expect(api).not.toHaveBeenCalled();
  });

  it('an answer without the seed path is a failed read, and seeds nothing', async () => {
    apiFetch = vi.fn(async () => answer({ success: true, data: { findings: [] } }));
    const { api } = await openDialog(installAction());
    type('environment_id', env);
    type('version', '2.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('failed'));
    expect(panel().textContent).toContain('verdict.findingSet');
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText(/actionDialog\.requiredError/)).toBeTruthy());
    expect(api).not.toHaveBeenCalled();
  });
});

describe('a read that may not be sent is not sent (objectstack#31808)', () => {
  it('a block the spec refuses (another origin) is drawn as refused and never read', async () => {
    const { api } = await openDialog(installAction({ read: { url: 'https://evil.example/plan?v=${param.version}' } }));
    expect(panel().getAttribute('data-status')).toBe('refused');
    expect(within(panel()).getByRole('alert').textContent).toContain('actionDialog.preflight.refused');
    expect(within(panel()).getByRole('alert').textContent).toContain('preflight.read.url');
    type('environment_id', env);
    type('version', '2.0.0');
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByText(/actionDialog\.requiredError/)).toBeTruthy());
    expect(api).not.toHaveBeenCalled();
  });

  it('a filled URL that is not a path on this origin is refused before any request', async () => {
    const fill: PreflightReadFiller = () => '//evil.example/plan';
    await openDialog(installAction(), { fill });
    type('environment_id', env);
    type('version', '2.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('refused'));
    expect(panel().textContent).toContain('//evil.example/plan');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a `${ctx.record.FIELD}` hole the dispatch cannot bind sends nothing and says so', async () => {
    const { api } = await openDialog(
      installAction({ read: { url: '/api/v1/cloud/packages/plan?name=${ctx.record.name}&version=${param.version}' } }),
      { record: null },
    );
    type('version', '2.0.0');
    await waitFor(() => expect(panel().getAttribute('data-status')).toBe('unbound'));
    expect(within(panel()).getByRole('alert').textContent).toContain('actionDialog.preflight.unbound');
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getAllByText(/actionDialog\.requiredError/).length).toBeGreaterThan(0));
    expect(api).not.toHaveBeenCalled();
  });

  it('CONTROL: the same hole on a record page header dispatch is bound to the page record and read', async () => {
    await openDialog(
      installAction({ read: { url: '/api/v1/cloud/packages/plan?name=${ctx.record.name}&version=${param.version}' } }),
      { record: { id: 'pkg_1', name: 'crm' } },
    );
    type('version', '2.0.0');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/cloud/packages/plan?name=crm&version=2.0.0');
  });
});
