// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every request action's success toast names the request it acted on
// (#23157), and every shipped locale says so too.
//
// The copy is a `template` slot (#24814) the console resolves from these
// bundles BEFORE it fills the `{{ result.* }}` holes, so a locale whose value drops the hole
// toasts the bare verb in that language while English names the record. No
// drift gate sees that: `check:i18n` reads a translated-locale value as
// hand-written text and never compares its tokens with the source's.

import { describe, it, expect } from 'vitest';
import { templateSlotSource } from '@objectstack/spec/automation';
import { SysApprovalRequest } from '../sys-approval-request.object.js';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

const LOCALES = [
  ['en', enObjects],
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

/** Every action declared on the request object, with its source copy. */
// [#24814] `successMessage` is a `template` slot: the parsed object carries the
// envelope, read through the template judge's one reader.
const ACTIONS = ((SysApprovalRequest as any).actions as Array<{ name: string; successMessage?: unknown }>)
  .map((a) => [a.name, templateSlotSource(a.successMessage) ?? ''] as const);

const tokensOf = (copy: string): string[] => [...copy.matchAll(/\{\{ result\.[\w.]+ \}\}/g)].map((m) => m[0]).sort();

const bundleCopy = (bundle: unknown, action: string): string | undefined =>
  (bundle as any)?.sys_approval_request?._actions?.[action]?.successMessage;

describe('each sys_approval_request action\'s success copy names the request, in every locale (#23157)', () => {
  it('armed: the object declares all nine request actions', () => {
    expect(ACTIONS.map(([name]) => name).sort()).toEqual([
      'approval_approve', 'approval_comment', 'approval_reassign', 'approval_recall', 'approval_reject',
      'approval_remind', 'approval_request_info', 'approval_resubmit', 'approval_send_back',
    ]);
  });

  it('every source copy reads the request title from its route\'s answer', () => {
    for (const [name, copy] of ACTIONS) {
      expect(tokensOf(copy), `${name}.successMessage`).toEqual(['{{ result.request.record_title }}']);
    }
  });

  it('every locale carries the same tokens as the source, so no language toasts the bare verb', () => {
    for (const [locale, bundle] of LOCALES) {
      for (const [name, copy] of ACTIONS) {
        const translated = bundleCopy(bundle, name);
        expect(translated, `${locale} ${name}.successMessage`).toBeTruthy();
        expect(tokensOf(translated!), `${locale} ${name}.successMessage tokens`).toEqual(tokensOf(copy));
      }
    }
  });

  it('the English bundle is the source copy, and the other locales translate it', () => {
    for (const [name, copy] of ACTIONS) {
      expect(bundleCopy(enObjects, name), `en ${name}`).toBe(copy);
      for (const [locale, bundle] of LOCALES) {
        if (locale === 'en') continue;
        expect(bundleCopy(bundle, name), `${locale} ${name} echoes the English source`).not.toBe(copy);
      }
    }
  });
});
