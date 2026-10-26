/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12757 — `element:button` resolves its inline action's `I18nLabel`
 * copy in the user's locale before the runner sees it.
 *
 * The spec types an inline action's `label`, `confirmText`, `successMessage`
 * and `errorMessage` as `I18nLabel` — a string or a per-locale map. The runner
 * has no language, so it skips a map: the success toast fell back to the
 * runner's generic copy, and the confirm prompt and the param dialog's title
 * (the action's `label`) received an object. Every other action surface hands
 * the runner its copy through `useActionTextLocalizer`; these rows pin that
 * `element:button` does too, at what the user reads — the toast, the confirm
 * prompt — and at the def the handler receives.
 *
 * The action is nameless, like the producer's (objectstack-ai/cloud#2909's
 * invite button): an inline action need not carry a `name`, and without one
 * there is no bundle key, so the per-locale map is the only copy there is.
 *
 * Each row asserts the handler ran exactly once first (the positive control),
 * so a wrong toast is never "the harness executed nothing".
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ConfirmationHandler, ToastHandler } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import '../renderers/basic/elements';

let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let toast: Mock<ToastHandler>;
let confirm: Mock<ConfirmationHandler>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
  toast = vi.fn();
  confirm = vi.fn(async () => true);
});

function renderButtonIn(language: string, action: Record<string, unknown>) {
  const C = ComponentRegistry.get('element:button');
  if (!C) throw new Error('element:button not registered');
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider handlers={{ api }} onToast={toast} onConfirm={confirm}>
        <C
          schema={{
            type: 'element:button',
            properties: { label: { en: 'Invite member', 'zh-CN': '邀请成员' }, action },
          } as never}
        />
      </ActionProvider>
    </I18nProvider>,
  );
}

const dispatched = () => api.mock.calls[0][0];

/** The producer's shape: a nameless inline `api` action whose copy is a locale map. */
const INVITE = {
  type: 'api',
  target: '/api/v1/cloud/invitations',
  label: { en: 'Invite member', 'zh-CN': '邀请成员' },
  successMessage: { en: 'Invitation sent', 'zh-CN': '邀请已发送' },
};

describe('element:button resolves its inline action I18nLabel copy (objectui#12757)', () => {
  it('a locale-map successMessage toasts the zh-CN string under a zh-CN locale', async () => {
    renderButtonIn('zh-CN', INVITE);

    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toBe('邀请已发送');
    expect(toast.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'success' }));
  });

  it('label, confirmText and errorMessage maps reach the runner as zh-CN strings', async () => {
    api.mockImplementation(async () => ({ success: false, error: 'HTTP 500' }));
    renderButtonIn('zh-CN', {
      ...INVITE,
      confirmText: { en: 'Send the invitation?', 'zh-CN': '确认发送邀请吗?' },
      errorMessage: { en: 'Invitation failed', 'zh-CN': '邀请失败' },
    });

    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe('确认发送邀请吗?');
    // The label is what titles the param dialog the runtime opens.
    expect(dispatched().label).toBe('邀请成员');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toBe('邀请失败');
    expect(toast.mock.calls[0][1]).toEqual(expect.objectContaining({ type: 'error' }));
  });

  it('the same map reads the English entry under an en locale', async () => {
    renderButtonIn('en', INVITE);

    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(dispatched().label).toBe('Invite member');
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toBe('Invitation sent');
  });

  it('CONTROL: plain-string copy reaches the runner unchanged', async () => {
    renderButtonIn('zh-CN', {
      type: 'api',
      target: '/api/v1/cloud/invitations',
      label: 'Invite member',
      confirmText: 'Send the invitation?',
      successMessage: 'Invitation sent to ${result.email}',
      errorMessage: 'Invitation failed',
    });

    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toBe('Send the invitation?');
    expect(dispatched()).toEqual(expect.objectContaining({
      label: 'Invite member',
      confirmText: 'Send the invitation?',
      successMessage: 'Invitation sent to ${result.email}',
      errorMessage: 'Invitation failed',
    }));
  });
});
