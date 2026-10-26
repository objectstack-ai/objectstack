/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:quick_actions` — one bundle entry, one fate (objectui#4265).
 *
 * This bar resolved the button `label` through the `_actions.<name>.label`
 * convention, but `executeAction(name)` ran the def straight out of the array
 * it was given — so the ActionRunner saw the AUTHORED `confirmText` /
 * `successMessage` while the button beside it already read the translation.
 * That is the card's "same entry, two fates" verbatim.
 *
 * Nothing about the resolution is stubbed: a real `I18nProvider` holds the
 * zh-CN bundle, a real `ActionProvider` runs the real ActionRunner, and the
 * assertions read what the confirm / toast handlers actually received.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

/** The authored action, as `src/actions/lead.actions.ts` declares it. */
const CONVERT_LEAD = {
  name: 'convert_lead',
  type: 'custom-run',
  label: 'Convert Lead',
  confirmText: 'Are you sure you want to convert this lead?',
  successMessage: 'Lead converted.',
  locations: ['record_header'],
};

const ZH_BUNDLE = {
  crm: {
    objects: {
      lead: {
        _actions: {
          convert_lead: {
            label: '转化线索',
            confirmText: '确认要转化此线索吗？',
            successMessage: '线索转化成功！',
          },
        },
      },
    },
  },
};

function BundleLoader({ bundle, children }: { bundle?: unknown; children: React.ReactNode }) {
  const { i18n } = useObjectTranslation();
  const [ready, setReady] = React.useState(!bundle);
  React.useEffect(() => {
    if (!bundle) return;
    i18n.addResourceBundle('en', 'translation', bundle as Record<string, unknown>, true, true);
    setReady(true);
  }, [bundle, i18n]);
  return ready ? <>{children}</> : null;
}

/**
 * The handler signatures, taken from `ActionProvider` rather than restated.
 *
 * These mocks are the assertion surface of every case below — each one reads
 * `.mock.calls[0][0]` to check WHICH STRING the provider was handed. Declared as
 * bare `vi.fn(async () => true)` / `vi.fn()` they had no parameters at all, so
 * `calls[0]` was the empty tuple and `calls[0][0]` did not exist: the compiler
 * could not see the argument these tests exist to inspect, and reported it the
 * moment this package's tests were type-checked (TS2493). Deriving from the
 * component's own props types the argument as the message it is, and keeps the
 * mocks from drifting off the handler contract they impersonate.
 */
type ActionProviderProps = React.ComponentProps<typeof ActionProvider>;
type ConfirmHandler = NonNullable<ActionProviderProps['onConfirm']>;
type ToastHandler = NonNullable<ActionProviderProps['onToast']>;

function mount(opts: { bundle?: unknown; action?: Record<string, unknown> } = {}) {
  const onConfirm = vi.fn<ConfirmHandler>(async () => true);
  const onToast = vi.fn<ToastHandler>();
  const handler = vi.fn(async () => ({ success: true }));
  const utils = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BundleLoader bundle={opts.bundle}>
        <ActionProvider onConfirm={onConfirm} onToast={onToast} handlers={{ 'custom-run': handler }}>
          <RecordContextProvider objectName="lead" recordId="lead_1" data={{ id: 'lead_1' }}>
            <RecordQuickActionsRenderer
              schema={{ actions: [opts.action ?? CONVERT_LEAD] } as any}
            />
          </RecordContextProvider>
        </ActionProvider>
      </BundleLoader>
    </I18nProvider>,
  );
  return { ...utils, onConfirm, onToast, handler };
}

beforeEach(() => vi.clearAllMocks());

describe('record:quick_actions — translated confirmText (objectui#4265)', () => {
  it('resolves the button AND the confirm dialog body from the same bundle entry', async () => {
    const { onConfirm } = mount({ bundle: ZH_BUNDLE });

    fireEvent.click(await screen.findByRole('button', { name: '转化线索' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toBe('确认要转化此线索吗？');
  });

  it('resolves successMessage from the same entry', async () => {
    const { onToast } = mount({ bundle: ZH_BUNDLE });

    fireEvent.click(await screen.findByRole('button', { name: '转化线索' }));

    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0][0]).toBe('线索转化成功！');
  });

  it('falls back to the authored strings with no bundle entry (control)', async () => {
    const { onConfirm, onToast } = mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Convert Lead' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toBe('Are you sure you want to convert this lead?');
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0][0]).toBe('Lead converted.');
  });
});
