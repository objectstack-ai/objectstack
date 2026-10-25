/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10900 — the runner's own success toast goes through the host's
 * translator; an author's `successMessage` never does. A server message is no
 * longer a toast at all (objectui#11344): with no author copy, the runner's own
 * text is shown.
 *
 * A zh-CN session saw "Action completed successfully" after a welcome CTA: the
 * runner's fallback was an English literal with no way to reach a translator,
 * because this package takes no i18n dependency. `setTranslator` is the
 * injected seam (the same shape `recordDelete` takes its `t` in); the React
 * owners of a runner install the session's `t` there. Those owners are pinned
 * in `@object-ui/react`'s `ActionProvider.defaultSuccessToast-10900` suite; this
 * one pins the runner half on its own.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner, type ToastHandler } from '../ActionRunner';

const SUCCEEDS = async () => ({ success: true });

describe('ActionRunner — the default success toast is translatable (objectui#10900)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('script', SUCCEEDS);
  });

  it('with no translator installed, the toast is the English source', async () => {
    await runner.execute({ type: 'script', name: 'welcome_cta' });
    expect(toast).toHaveBeenCalledWith('Action completed successfully', expect.objectContaining({ type: 'success' }));
  });

  it('with a translator, the toast is its answer for the pack key, asked with the English default', async () => {
    const translate = vi.fn((_key: string, _options: { defaultValue: string }) => '操作已成功完成');
    runner.setTranslator(translate);

    await runner.execute({ type: 'script', name: 'welcome_cta' });

    expect(translate).toHaveBeenCalledWith('actions.completedSuccessfully', {
      defaultValue: 'Action completed successfully',
    });
    expect(toast).toHaveBeenCalledWith('操作已成功完成', expect.objectContaining({ type: 'success' }));
  });

  it("an author's successMessage reaches the toast verbatim and the translator is never asked", async () => {
    const translate = vi.fn(() => '操作已成功完成');
    runner.setTranslator(translate);

    await runner.execute({ type: 'script', name: 'welcome_cta', successMessage: 'Welcome aboard' });

    expect(toast).toHaveBeenCalledWith('Welcome aboard', expect.objectContaining({ type: 'success' }));
    expect(translate).not.toHaveBeenCalled();
  });

  it('a server-returned message is not the toast: the default is, in the translator\'s language', async () => {
    // This row pinned the opposite until objectui#11344 — the server's
    // sentence reached the toast verbatim, in whatever language the server
    // wrote it. Ruling A on objectstack-ai/cloud#2315 retired that rung, so
    // with no author copy the toast is the runner's own text, translated.
    const translate = vi.fn(() => '操作已成功完成');
    runner.setTranslator(translate);
    runner.registerHandler('script', async () => ({ success: true, data: { message: 'Published v1.2.0' } }));

    await runner.execute({ type: 'script', name: 'publish' });

    expect(toast).toHaveBeenCalledWith('操作已成功完成', expect.objectContaining({ type: 'success' }));
    expect(toast).not.toHaveBeenCalledWith('Published v1.2.0', expect.anything());
    expect(translate).toHaveBeenCalledWith('actions.completedSuccessfully', {
      defaultValue: 'Action completed successfully',
    });
  });

  it('an empty answer from the translator falls back to the English source, not an empty toast', async () => {
    runner.setTranslator(() => '');
    await runner.execute({ type: 'script', name: 'welcome_cta' });
    expect(toast).toHaveBeenCalledWith('Action completed successfully', expect.objectContaining({ type: 'success' }));
  });
});
