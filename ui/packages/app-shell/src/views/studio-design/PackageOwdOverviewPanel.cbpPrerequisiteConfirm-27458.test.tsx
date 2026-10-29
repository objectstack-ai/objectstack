// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27458 — saving a row as `controlled_by_parent` makes its
 * `master_detail` required, and the server's destructive-change guard answers
 * that with 409 `DESTRUCTIVE_CHANGE`. The panel names the prerequisite (the
 * relationship that becomes required) and offers it: confirming retries the
 * same save with `force`; cancelling saves nothing. The guard is not bypassed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const CBP_LABEL = t('engine.studio.settings.sharingControlledByParent', 'en-US');
const GUARD_MESSAGE = "Field 'project' is now required but has no default value";

type Body = Record<string, unknown>;
type SaveCall = { name: string; body: Body; force: boolean };

function refusal(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code, issues: [{ kind: 'required_added', path: 'fields.project', message }] });
}

/** A client whose save refuses with `refuse` unless the call carries `force`. */
function renderPanel(refuse: () => Error) {
  const body: Body = {
    name: 'qnine_step',
    label: 'QN Step',
    sharingModel: 'private',
    fields: { name: { type: 'text' }, project: { type: 'master_detail', reference: 'qnine_project' } },
  };
  const calls: SaveCall[] = [];
  const client = {
    list: async () => [{ name: 'qnine_step', label: 'QN Step' }],
    listDrafts: async () => [],
    layered: async () => ({ effective: body, code: null }),
    getDraft: async () => null,
    save: async (_type: string, name: string, saved: Body, opts: { force?: boolean }) => {
      calls.push({ name, body: saved, force: opts?.force === true });
      if (!opts?.force) throw refuse();
      return saved;
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
  render(<PackageOwdOverviewPanel client={client} packageId="com.qa.rnine" locale="en-US" />);
  return { calls };
}

async function pickCbpAndSave() {
  await screen.findByTestId('owd-row-qnine_step');
  fireEvent.keyDown(screen.getByTestId('owd-internal-qnine_step'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: CBP_LABEL }));
  fireEvent.click(screen.getByTestId('owd-save'));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('PackageOwdOverviewPanel — the controlled-by-parent prerequisite (objectstack#27458)', () => {
  const destructive = () => refusal(409, 'DESTRUCTIVE_CHANGE', GUARD_MESSAGE);

  it('a 409 DESTRUCTIVE_CHANGE opens a confirm naming the relationship, with no error banner', async () => {
    const { calls } = renderPanel(destructive);
    await pickCbpAndSave();
    const dialog = await screen.findByTestId('owd-cbp-prereq');
    expect(dialog).toHaveTextContent('project → qnine_project');
    expect(dialog).toHaveTextContent(GUARD_MESSAGE);
    expect(calls).toHaveLength(1);
    expect(calls[0].force).toBe(false);
    expect(screen.queryByText(GUARD_MESSAGE, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('confirming retries the same save with force, and it lands', async () => {
    const { calls } = renderPanel(destructive);
    await pickCbpAndSave();
    fireEvent.click(await screen.findByTestId('owd-cbp-prereq-confirm'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].force).toBe(true);
    expect(calls[1].body).toEqual(calls[0].body);
    expect(calls[1].body.sharingModel).toBe('controlled_by_parent');
    expect((calls[1].body.fields as Record<string, Body>).project.required).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('owd-cbp-prereq')).not.toBeInTheDocument());
  });

  it('cancelling saves nothing and leaves the row unsaved, without an error', async () => {
    const { calls } = renderPanel(destructive);
    await pickCbpAndSave();
    await screen.findByTestId('owd-cbp-prereq');
    fireEvent.click(screen.getByRole('button', { name: t('engine.cancel', 'en-US') }));
    await waitFor(() => expect(screen.queryByTestId('owd-cbp-prereq')).not.toBeInTheDocument());
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.force)).toBe(false);
    expect(screen.getByTestId('owd-dirty-qnine_step')).toBeInTheDocument();
    expect(screen.queryByText(GUARD_MESSAGE)).not.toBeInTheDocument();
  });

  it('any other refusal still shows the error, and opens no confirm', async () => {
    const { calls } = renderPanel(() => refusal(422, 'INVALID_METADATA', 'Invalid object body'));
    await pickCbpAndSave();
    expect(await screen.findByText(/Invalid object body/)).toBeInTheDocument();
    expect(screen.queryByTestId('owd-cbp-prereq')).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });
});
