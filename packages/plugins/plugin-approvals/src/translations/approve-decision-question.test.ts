// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `approval_approve` declares its decision question on the top-level
// `description`, as `approval_reject` beside it does.
//
// The console's parameter dialog shows an action's `description` as its
// subtitle and falls back to a generic "Please provide the required
// information to continue." when none is declared — so Approve opened a dialog
// that said nothing about what Confirm does, while Reject's said exactly that.
//
// The translated bundles are pinned with it: `os i18n extract --fill=default`
// seeds a NEW key with the English source in every locale, and that state is
// "in sync" to `check:i18n`. Every assertion on what is SERVED goes through the
// real resolver over the real object and this plugin's bundle, so a bundle
// that stopped being consulted shows up as English in the zh-CN case.

import { describe, it, expect } from 'vitest';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { ApprovalsTranslations } from './index.js';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { SysApprovalRequest } from '../sys-approval-request.object.js';

interface CopyAction {
  name?: string;
  description?: unknown;
}

const action = (doc: unknown, name: string): CopyAction => {
  const found = ((doc as { actions?: CopyAction[] }).actions ?? []).find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return found as CopyAction;
};

const bundleDescription = (bundle: unknown, name: string): unknown =>
  (bundle as any)?.sys_approval_request?._actions?.[name]?.description;

const TRANSLATED = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

describe('approval_approve — the decision question', () => {
  it('declares a top-level description, as approval_reject does', () => {
    for (const name of ['approval_approve', 'approval_reject']) {
      const { description } = action(SysApprovalRequest, name);
      expect(typeof description, `${name}.description`).toBe('string');
      expect((description as string).trim(), `${name}.description`).not.toBe('');
    }
  });

  it('the en bundle carries the declared question', () => {
    expect(bundleDescription(enObjects, 'approval_approve')).toBe(
      action(SysApprovalRequest, 'approval_approve').description,
    );
  });

  it.each(TRANSLATED)('%s translates it instead of echoing the English source', (locale, bundle) => {
    const translated = bundleDescription(bundle, 'approval_approve');
    expect(translated, `${locale} approval_approve.description missing`).toBeTruthy();
    expect(
      translated,
      `${locale} approval_approve.description is the English source the extractor seeds a new key with`,
    ).not.toBe(action(SysApprovalRequest, 'approval_approve').description);
  });

  it('the served object metadata carries the zh-CN question', () => {
    // The object-metadata read the console uses localizes through
    // `translateMetadataDocument('object', …)`; this plugin hands the i18n
    // service `ApprovalsTranslations`.
    const zh = translateMetadataDocument('object', SysApprovalRequest, ApprovalsTranslations, {
      locale: 'zh-CN',
    });
    const served = action(zh, 'approval_approve').description;
    expect(served).toBe(bundleDescription(zhCNObjects, 'approval_approve'));
    expect(served).not.toBe(action(SysApprovalRequest, 'approval_approve').description);
  });
});
