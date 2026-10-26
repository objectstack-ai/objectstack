/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The draft preview's non-happy pane is drawn by the shared view-state
 * vocabulary (objectstack#25915), so a failed overlay read and an app that is
 * not drafted yet are two different nodes to assistive technology: the
 * failure is the `role="alert"` `DataErrorState`, the empty pane the
 * `role="status"` `DataEmptyState`. Before, both were the same unlabelled
 * `Empty` block, and the failure was announced as nothing.
 *
 * The `t` mock returns each call site's `defaultValue`, which the i18n
 * call-site gate holds byte-equal to the `en` pack value.
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { PreviewDraftEmptyState } from '../PreviewDraftEmptyState';

describe('PreviewDraftEmptyState draws the shared view states (objectstack#25915)', () => {
  it('announces a failed overlay read as an alert, through DataErrorState', () => {
    render(<PreviewDraftEmptyState appName="crm" error={new Error('boom')} onRetry={() => {}} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-slot', 'data-error-state');
    expect(alert).toHaveTextContent('Draft preview failed to load');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('draws an app not yet drafted as a status, through DataEmptyState', () => {
    render(<PreviewDraftEmptyState appName="crm" error={null} onRetry={() => {}} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-slot', 'data-empty-state');
    expect(status).toHaveTextContent('isn’t in the draft yet');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('draws nothing drafted (no app in the URL) as a status too', () => {
    render(<PreviewDraftEmptyState onRetry={() => {}} />);

    expect(screen.getByRole('status')).toHaveTextContent('Nothing to preview yet');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['failed', new Error('boom')],
    ['empty', null],
  ])('keeps the one Retry control in the %s pane', (_label, error) => {
    const onRetry = vi.fn();
    render(<PreviewDraftEmptyState appName="crm" error={error} onRetry={onRetry} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('preview-draft-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
