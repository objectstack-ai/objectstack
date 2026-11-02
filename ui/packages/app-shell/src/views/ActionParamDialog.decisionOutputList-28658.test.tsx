/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A free-value decision output declared `multiple: true` is collected and sent
 * as a list of strings (objectstack#28658).
 *
 * The approvals decision door judges each output's shape against its
 * declaration: `multiple: true` takes a list with no entry twice, anything else
 * one value. The Console used to render every free-value output as one text box
 * whose help said "Comma-separate multiple values", so a list output reached
 * the server as one comma string and was refused.
 *
 * This runs the real path a decision takes in the browser: the params
 * `decisionOutputParams` synthesizes, through `resolveActionParams`, into the
 * real `ActionParamDialog` and its lazy field widgets, out through the values
 * the dialog resolves with and the record header's `foldDecisionOutputs`. The
 * Approval Center's api action hands the same values to the runtime's
 * `outputs.KEY` fold, which passes each value on untouched (pinned with a list
 * value in `packages/runtime/src/domains/api-action-forward.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resolveActionParams } from '@object-ui/fields';
import { ActionParamDialog } from './ActionParamDialog';
import { decisionOutputParams, foldDecisionOutputs } from '../utils/decisionOutputParams';

const t = (key: string) => key;

function openDecisionDialog() {
  const synthesized = decisionOutputParams(
    [
      { key: 'labels', label: 'Labels', type: 'text', multiple: true },
      { key: 'note', label: 'Note' },
    ],
    t,
    { decision: 'approve' },
  );
  const params = resolveActionParams(synthesized as any, {
    objectName: 'sys_approval_request',
    objects: [],
    fieldLabel: (_o: string, _f: string, d: string) => d,
    fieldOptionLabel: (_o: string, _f: string, _v: any, d: string) => d,
  } as any);
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params, title: 'Approve', resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

describe('ActionParamDialog — a multiple free-value decision output is sent as a list (objectstack#28658)', () => {
  it('collects trimmed, distinct entries and sends a list; a single-value output keeps its comma', async () => {
    const resolve = openDecisionDialog();

    const labels = await screen.findByLabelText(/Labels/);
    for (const typed of ['  alpha ', 'alpha', '   ', 'beta']) {
      fireEvent.change(labels, { target: { value: typed } });
      fireEvent.keyDown(labels, { key: 'Enter' });
    }
    // A typed entry still in the box is committed when the box loses focus.
    fireEvent.change(labels, { target: { value: 'gamma' } });
    fireEvent.blur(labels);

    fireEvent.change(await screen.findByLabelText(/Note/), { target: { value: 'a, b' } });
    fireEvent.click(screen.getByRole('button', { name: 'actionDialog.confirm' }));

    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const collected = resolve.mock.calls[0][0];
    expect(collected).toEqual({ 'outputs.labels': ['alpha', 'beta', 'gamma'], 'outputs.note': 'a, b' });
    expect(foldDecisionOutputs(collected)).toEqual({
      rest: {},
      outputs: { labels: ['alpha', 'beta', 'gamma'], note: 'a, b' },
    });
  });
});
