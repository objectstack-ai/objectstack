/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `page:header` actions — one bundle entry, one fate (objectui#4265).
 *
 * An AUTHORED record page embeds its action buttons on `page:header.actions`
 * (the surface `page-header-actions.test.tsx` covers), and those defs reach
 * this renderer straight from page metadata — no host pre-localizes them. The
 * header used to resolve `label` through the `_actions.<name>.label`
 * convention and then dispatch the SAME action's `confirmText` /
 * `successMessage` untouched, which is the card's symptom exactly: the button
 * renders 转化线索 while the confirm dialog body renders the authored English.
 *
 * These pins run the real ActionRunner (via `ActionProvider`) and read what the
 * confirm handler and the toast handler actually receive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ConfirmationHandler, ToastHandler } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

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

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

/**
 * Loads the bundle into the live i18next instance before the header renders,
 * so the first paint already sees it (no act() churn mid-assertion).
 */
function BundleLoader({ bundle, children }: { bundle: unknown; children: React.ReactNode }) {
  const { i18n } = useObjectTranslation();
  const [ready, setReady] = React.useState(!bundle);
  React.useEffect(() => {
    if (!bundle) return;
    i18n.addResourceBundle('en', 'translation', bundle as Record<string, unknown>, true, true);
    setReady(true);
  }, [bundle, i18n]);
  return ready ? <>{children}</> : null;
}

function renderHeader(opts: { bundle?: unknown; action?: Record<string, unknown> }) {
  // Typed with the handler signatures `@object-ui/core` declares: a bare
  // `vi.fn(async () => true)` is zero-arity, so `onConfirm.mock.calls[0][0]` —
  // the translated message these tests exist to pin — was the empty tuple's
  // element 0 as far as the compiler was concerned (objectui#4040).
  const onConfirm = vi.fn<ConfirmationHandler>(async () => true);
  const onToast = vi.fn<ToastHandler>();
  const handler = vi.fn(async () => ({ success: true }));
  const utils = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BundleLoader bundle={opts.bundle}>
        <ActionProvider
          onConfirm={onConfirm}
          onToast={onToast}
          handlers={{ 'custom-run': handler }}
        >
          <RecordContextProvider
            objectName="lead"
            recordId="lead_1"
            data={{ id: 'lead_1', name: 'Ada' }}
            objectSchema={{ name: 'lead', label: 'Lead' }}
          >
            <PageHeader
              schema={{
                type: 'page:header',
                title: 'Lead',
                actions: [opts.action ?? CONVERT_LEAD],
              }}
            />
          </RecordContextProvider>
        </ActionProvider>
      </BundleLoader>
    </I18nProvider>,
  );
  return { ...utils, onConfirm, onToast, handler };
}

beforeEach(() => vi.clearAllMocks());

describe('page:header actions — translated confirmText (objectui#4265)', () => {
  it('renders the translated button AND opens the confirm dialog with the translated body', async () => {
    const { onConfirm } = renderHeader({ bundle: ZH_BUNDLE });

    const button = await screen.findByRole('button', { name: '转化线索' });
    fireEvent.click(button);

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    // The reported defect: this argument used to be the authored English
    // literal while the button above already read 转化线索.
    expect(onConfirm.mock.calls[0][0]).toBe('确认要转化此线索吗？');
  });

  it('passes the translated successMessage to the toast', async () => {
    const { onToast } = renderHeader({ bundle: ZH_BUNDLE });

    fireEvent.click(await screen.findByRole('button', { name: '转化线索' }));

    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0][0]).toBe('线索转化成功！');
  });

  it('renders the authored strings when the bundle has no entry (control)', async () => {
    const { onConfirm, onToast } = renderHeader({ bundle: undefined });

    const button = await screen.findByRole('button', { name: 'Convert Lead' });
    fireEvent.click(button);

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toBe('Are you sure you want to convert this lead?');
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0][0]).toBe('Lead converted.');
  });

  it('does not open a confirm dialog for an action that declares no confirmText', async () => {
    const { confirmText: _c, ...noConfirm } = CONVERT_LEAD;
    const { onConfirm, handler } = renderHeader({ bundle: ZH_BUNDLE, action: noConfirm });

    fireEvent.click(await screen.findByRole('button', { name: '转化线索' }));

    await waitFor(() => expect(handler).toHaveBeenCalled());
    // A bundle entry must not be able to bolt a confirmation gate onto an
    // action whose metadata never declared one.
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
