/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `useActionTextLocalizer` keys an action's copy on the action's own object
 * (objectui#11439, triage's amended ruling, comment 6030552631).
 *
 * The key object is the action's declared `objectName`, else the host object
 * the caller draws it on — the object `translateObject` in `@objectstack/spec`
 * 17.7.0 stamps on an embedded action. A key object reads only that object's
 * `_actions.<name>` node; only an action with no key object reads
 * `globalActions.<name>`. So a bound action whose copy was filed under
 * `globalActions` shows its authored text here, as it does on every surface
 * the server translates.
 *
 * The bundle mirrors the console preview sample's case: `close_order` is bound
 * to `sales_order`.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, {
    config: { defaultLanguage: 'en', detectBrowserLanguage: false },
    children,
  });

/** A bound action, exactly as the console's `action` preview sample declares it. */
const CLOSE_ORDER = {
  name: 'close_order',
  label: 'Close Order',
  type: 'script',
  target: 'closeOrder',
  objectName: 'sales_order',
  confirmText: 'Close this order? This cannot be undone.',
  successMessage: 'Order closed.',
  locations: ['record_header'],
};

function setup(bundle: Record<string, unknown>) {
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  result.current.i18n.addResourceBundle('en', 'translation', { crm: bundle }, true, true);
  return result;
}

/** Copy filed ONLY under `globalActions` — the misfiling `os validate` refuses for a bound action. */
const GLOBAL_ONLY = {
  // Present so the namespace is discovered through `objects` as well.
  objects: { account: { label: '客户' } },
  globalActions: {
    close_order: { label: '关闭订单(全局)', confirmText: '全局确认', successMessage: '全局成功' },
    archive_order: { label: '归档订单(全局)' },
  },
};

/** The same copy filed where the spec reads it for a bound action. */
const OBJECT_SCOPED = {
  objects: {
    sales_order: {
      _actions: {
        close_order: { label: '关闭订单', confirmText: '确认关闭？', successMessage: '订单已关闭。' },
      },
    },
  },
  globalActions: {
    close_order: { label: '关闭订单(全局)', confirmText: '全局确认', successMessage: '全局成功' },
  },
};

describe('useActionTextLocalizer — the key object (objectui#11439)', () => {
  it('a bound action with only globalActions copy shows its authored text', () => {
    const result = setup(GLOBAL_ONLY);
    const localized = result.current.localize('sales_order', CLOSE_ORDER);
    expect(localized.label).toBe('Close Order');
    expect(localized.confirmText).toBe('Close this order? This cannot be undone.');
    expect(localized.successMessage).toBe('Order closed.');
  });

  it('a bound action reads its object-scoped copy', () => {
    const result = setup(OBJECT_SCOPED);
    const localized = result.current.localize('sales_order', CLOSE_ORDER);
    expect(localized.label).toBe('关闭订单');
    expect(localized.confirmText).toBe('确认关闭？');
    expect(localized.successMessage).toBe('订单已关闭。');
  });

  it('the declared objectName is the key even where the caller knows no object', () => {
    const result = setup(OBJECT_SCOPED);
    // `record:quick_actions` and `record:related_list` pass `undefined` when
    // their context carries no object; the action's own declaration still
    // names the node it is read from.
    expect(result.current.localize(undefined, CLOSE_ORDER).label).toBe('关闭订单');
    const globalOnly = setup(GLOBAL_ONLY);
    expect(globalOnly.current.localize(undefined, CLOSE_ORDER).label).toBe('Close Order');
  });

  it('the declared objectName wins over the host the caller passes', () => {
    const result = setup(OBJECT_SCOPED);
    expect(result.current.localize('account', CLOSE_ORDER).label).toBe('关闭订单');
  });

  it('an embedded action (no objectName) is keyed on its host, not on globalActions', () => {
    const result = setup(GLOBAL_ONLY);
    const { objectName: _bound, ...embedded } = CLOSE_ORDER;
    expect(result.current.localize('sales_order', embedded).label).toBe('Close Order');
    const scoped = setup(OBJECT_SCOPED);
    expect(scoped.current.localize('sales_order', embedded).label).toBe('关闭订单');
  });

  it('an action with no key object still reads globalActions', () => {
    const result = setup(GLOBAL_ONLY);
    const localized = result.current.localize(undefined, {
      name: 'archive_order',
      label: 'Archive Order',
      type: 'script',
      target: 'archiveOrder',
    });
    expect(localized.label).toBe('归档订单(全局)');
  });
});
