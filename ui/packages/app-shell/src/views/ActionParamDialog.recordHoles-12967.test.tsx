/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12967 — the param dialog fills a `${record.*}` hole in a param's
 * `helpText` through the `interpolate` its state carries.
 *
 * The runner hands the param-collection handler an `interpolate` bound to the
 * template scope it reads `confirmText` in (the row is `record` on a row
 * dispatch); both handlers (`useConsoleActionRuntime`, `RecordDetailView`) put
 * it on the dialog state. `helpText` may be an inline per-locale map that only
 * this dialog resolves, so the hole is filled here, on the picked string the
 * user reads. Without `interpolate` the text prints as authored.
 *
 * The real `ActionParamDialog` renders each case: what is asserted is the line
 * under the control.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActionParamDialog, type ParamDialogState } from './ActionParamDialog';

afterEach(() => cleanup());

/** Stands in for the runner's evaluator over `{ record: { display_name: 'Acme' } }`. */
const interpolate = (text: string) => text.replace(/\$\{record\.display_name\}/g, 'Acme');

function open(state: Partial<ParamDialogState>) {
  render(
    <ActionParamDialog
      state={{ open: true, resolve: vi.fn(), params: [], ...state } as ParamDialogState}
      onOpenChange={() => {}}
    />,
  );
}

describe('ActionParamDialog — a record hole in `helpText` is filled (objectui#12967)', () => {
  it('fills a string `helpText` through `interpolate`', async () => {
    open({
      interpolate,
      params: [{ name: 'reason', label: 'Reason', type: 'text', helpText: 'Why pause ${record.display_name}?' }],
    });
    expect(await screen.findByText('Why pause Acme?')).toBeTruthy();
    expect(screen.queryByText(/\$\{record\./)).toBeNull();
  });

  it('fills the string picked from an inline per-locale `helpText` map', async () => {
    open({
      interpolate,
      params: [{
        name: 'reason',
        label: 'Reason',
        type: 'text',
        helpText: { en: 'Why pause ${record.display_name}?' } as never,
      }],
    });
    expect(await screen.findByText('Why pause Acme?')).toBeTruthy();
  });

  it('CONTROL: without `interpolate` the `helpText` prints as authored', async () => {
    open({
      params: [{ name: 'reason', label: 'Reason', type: 'text', helpText: 'Why pause ${record.display_name}?' }],
    });
    expect(await screen.findByText('Why pause ${record.display_name}?')).toBeTruthy();
  });
});
