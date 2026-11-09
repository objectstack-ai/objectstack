/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An `action_button` whose handler declares `confirmText` asks before it
 * invokes.
 *
 * The spec's `SpecifierHandlerSchema` declares `confirmText` on its `http` and
 * `action` arms ("Confirm dialog text before invoking (omit = no confirm)").
 * The pins:
 *
 *   - declared → the click opens a confirmation carrying that text; Cancel
 *     invokes nothing; Continue invokes exactly once;
 *   - the text resolves through `settings.NAMESPACE.actions.ID.confirmText`
 *     when the page's label helpers carry a translation for it;
 *   - undeclared (and a `navigate` handler, which has no such key) → the click
 *     invokes at once, with no dialog, as before.
 */

import type { ReactElement } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';
import type { SettingsLabelHelpers } from '../useSettingsLabel';

afterEach(() => {
  cleanup();
});

function withI18n(ui: ReactElement) {
  return <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>{ui}</I18nProvider>;
}

const CONFIRM = 'Rebuild the whole index? Searches are slower until it finishes.';

function actionSpec(handler: Specifier['handler']): Specifier {
  return { type: 'action_button', id: 'rebuild_index', label: 'Rebuild index', handler };
}

function renderAction(spec: Specifier, labels?: SettingsLabelHelpers) {
  const onAction = vi.fn();
  render(withI18n(<SettingsField spec={spec} value={undefined} onChange={() => {}} onAction={onAction} labels={labels} />));
  return onAction;
}

describe('SettingsField action_button — a declared confirmText asks before invoking', () => {
  for (const handler of [
    { kind: 'http', method: 'POST', url: '/api/v1/search/rebuild', confirmText: CONFIRM },
    { kind: 'action', name: 'rebuild_index', confirmText: CONFIRM },
  ] as const) {
    describe(`a ${handler.kind} handler`, () => {
      it('opens a confirmation carrying the declared text and invokes nothing on click', () => {
        const onAction = renderAction(actionSpec(handler));
        fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent(CONFIRM);
        expect(onAction).not.toHaveBeenCalled();
      });

      it('Cancel closes the confirmation and invokes nothing', () => {
        const onAction = renderAction(actionSpec(handler));
        fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(onAction).not.toHaveBeenCalled();
      });

      it('Continue invokes the action exactly once', () => {
        const onAction = renderAction(actionSpec(handler));
        fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alertdialog')).toBeNull();
      });
    });
  }

  it('shows the translation the actions.ID.confirmText slot carries', () => {
    const actionConfirm = vi.fn((_id: string, _fallback: string | undefined) => 'Translated confirmation');
    const labels = {
      actionLabel: (_id: string, fallback: string) => fallback,
      actionConfirm,
    } as unknown as SettingsLabelHelpers;
    renderAction(actionSpec({ kind: 'action', name: 'rebuild_index', confirmText: CONFIRM }), labels);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Translated confirmation');
    expect(actionConfirm).toHaveBeenCalledWith('rebuild_index', CONFIRM);
  });
});

describe('SettingsField action_button — no confirmText invokes on click', () => {
  for (const handler of [
    { kind: 'http', method: 'POST', url: '/api/v1/search/rebuild' },
    { kind: 'action', name: 'rebuild_index' },
    { kind: 'navigate', url: '/system/search' },
    undefined,
  ] as const) {
    it(`${handler ? `a ${handler.kind} handler` : 'no handler'} invokes at once with no dialog`, () => {
      const onAction = renderAction(actionSpec(handler));
      fireEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  }
});
