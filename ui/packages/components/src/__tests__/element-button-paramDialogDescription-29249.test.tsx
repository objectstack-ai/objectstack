/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29249 — an inline `element:button` action's `description`
 * reaches the param dialog in the user's language.
 *
 * `InlineActionSchema` picks `description` (an `I18nLabel`: a string or a
 * per-locale map). The button hands its action to `useActionTextLocalizer`
 * before the runner, so a map collapses to the active language there; the
 * runner and the param-collection host have no language of their own.
 *
 * The path is the real one up to the param-collection seam: the registered
 * `element:button`, the real localizer, the real `ActionRunner` behind
 * `ActionProvider`. The dialog is this file's host, drawn with this package's
 * `Dialog` the way the console's `ActionParamDialog` (`@object-ui/app-shell`,
 * which this package cannot import) draws its line: the action's description,
 * else the generic `actionDialog.description`.
 *
 * Each row first asserts the dialog opened with the action's own title (the
 * positive control), so a missing line is never "no dialog opened".
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult, ParamCollectionHandler } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import '../renderers/basic/elements';

let api: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let handed: Array<ActionDef | undefined>;

beforeEach(() => {
  api = vi.fn(async () => ({ success: true }));
  handed = [];
});

/** The producer's shape: a nameless inline `api` action that collects params. */
const INVITE = {
  type: 'api',
  target: '/api/v1/cloud/invitations',
  label: { en: 'Invite member', 'zh-CN': '邀请成员' },
  params: [{ name: 'email', label: 'Email', type: 'email', required: true }],
};

const DESCRIPTION = {
  en: 'We e-mail them an invitation link.',
  'zh-CN': '我们会向对方发送一封邀请邮件。',
};

/**
 * The registered renderer, read once at module scope (a component created
 * during render remounts on every render). An unregistered `element:button`
 * fails the whole file here, before any row runs.
 */
function registeredElementButton() {
  const C = ComponentRegistry.get('element:button');
  if (!C) throw new Error('element:button not registered');
  return C;
}
const ElementButton = registeredElementButton();

/**
 * The param-collection host: opens a dialog from what the runner hands it and
 * leaves the promise pending, as a dialog awaiting its Confirm does.
 */
function ParamHost({ action }: { action: Record<string, unknown> }) {
  const { t } = useObjectTranslation();
  const [dialog, setDialog] = React.useState<{ title: string; description: string } | null>(null);
  const onParamCollection = React.useCallback<ParamCollectionHandler>((_params, dispatched) => {
    handed.push(dispatched);
    // A non-string reaching the host is drawn as nothing, so the assertions
    // below see the gap instead of React refusing an object child.
    const title = dispatched?.label;
    const description = dispatched?.description;
    setDialog({
      title: typeof title === 'string' ? title : '',
      description: typeof description === 'string' ? description : '',
    });
    return new Promise(() => {});
  }, []);
  return (
    <ActionProvider handlers={{ api }} onParamCollection={onParamCollection}>
      <ElementButton
        schema={{
          type: 'element:button',
          properties: { label: { en: 'Invite member', 'zh-CN': '邀请成员' }, action },
        }}
      />
      {dialog && (
        <Dialog open>
          <DialogContent>
            <DialogTitle>{dialog.title}</DialogTitle>
            <DialogDescription>{dialog.description || t('actionDialog.description')}</DialogDescription>
          </DialogContent>
        </Dialog>
      )}
    </ActionProvider>
  );
}

function renderIn(language: string, action: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ParamHost action={action} />
    </I18nProvider>,
  );
}

describe('element:button — the param dialog shows the inline description in the active language (objectstack#29249)', () => {
  it('a zh-CN/en map shows the zh-CN string under a zh-CN locale', async () => {
    renderIn('zh-CN', { ...INVITE, description: DESCRIPTION });

    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: '邀请成员' })).toBeTruthy();
    expect(dialog.textContent).toContain('我们会向对方发送一封邀请邮件。');
    // The runner was handed one string, never the map.
    expect(handed).toHaveLength(1);
    expect(handed[0]?.description).toBe('我们会向对方发送一封邀请邮件。');
    // Nothing runs until the dialog's own Confirm.
    expect(api).not.toHaveBeenCalled();
  });

  it('the same map shows the English string under an en locale', async () => {
    renderIn('en', { ...INVITE, description: DESCRIPTION });

    fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Invite member' })).toBeTruthy();
    expect(dialog.textContent).toContain('We e-mail them an invitation link.');
    expect(handed[0]?.description).toBe('We e-mail them an invitation link.');
  });

  it('no description: the dialog keeps its generic line', async () => {
    renderIn('zh-CN', INVITE);

    fireEvent.click(screen.getByRole('button', { name: '邀请成员' }));

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: '邀请成员' })).toBeTruthy();
    expect(dialog.textContent).toContain('请填写以下信息以继续操作。');
    expect(handed[0]?.description).toBeUndefined();
  });
});
