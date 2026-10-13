// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The approve action's success toast names what was approved (#23157), and
// every shipped locale says so too.
//
// The copy is an `I18nLabel` the console resolves from these bundles BEFORE it
// fills the `${result.*}` tokens, so a locale whose value drops the token
// toasts the bare verb in that language while English names the record. No
// drift gate sees that: `check:i18n` reads a translated-locale value as
// hand-written text and never compares its tokens with the source's.

import { describe, it, expect } from 'vitest';
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

const tokensOf = (copy: string): string[] => [...copy.matchAll(/\$\{result\.[\w.]+\}/g)].map((m) => m[0]).sort();

const sourceCopy = (): string =>
  ((SysApprovalRequest as any).actions as any[]).find((a) => a.name === 'approval_approve').successMessage;

const bundleCopy = (bundle: unknown): string | undefined =>
  (bundle as any)?.sys_approval_request?._actions?.approval_approve?.successMessage;

describe('approval_approve success copy names the approved request in every locale (#23157)', () => {
  it('the source copy reads the request title from the decide answer', () => {
    expect(tokensOf(sourceCopy())).toEqual(['${result.request.record_title}']);
  });

  it('every locale carries the same tokens as the source, so no language toasts the bare verb', () => {
    for (const [locale, bundle] of LOCALES) {
      const copy = bundleCopy(bundle);
      expect(copy, `${locale} approval_approve.successMessage`).toBeTruthy();
      expect(tokensOf(copy!), `${locale} approval_approve.successMessage tokens`).toEqual(tokensOf(sourceCopy()));
    }
  });

  it('the English bundle is the source copy, and the other locales translate it', () => {
    expect(bundleCopy(enObjects)).toBe(sourceCopy());
    for (const [locale, bundle] of LOCALES) {
      if (locale === 'en') continue;
      expect(bundleCopy(bundle), `${locale} echoes the English source`).not.toBe(sourceCopy());
    }
  });
});
