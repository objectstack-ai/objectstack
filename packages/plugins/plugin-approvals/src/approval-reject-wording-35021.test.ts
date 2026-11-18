// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Approval-rejection wording pin (#35021, ruling 6973602227, option A).
//
// In Chinese an approval rejection reads 驳回 (zh-Hant 駁回): the record-page
// lever this plugin declares (`approval_reject`), its confirm question and
// success toast, the `rejected` status, the `reject` row of the action history,
// and the email action-link confirm and result pages. The flow designer's
// approval branch and the server notifications (`./translations/messages.ts`)
// already say it, so every surface names one decision with one word. The
// stored values (`rejected`, `reject`) are not display text and do not change.
//
// The labels are read through the real resolvers, so the cases also prove the
// bundles are REACHED: the declared labels are English, and 驳回 can only come
// from a bundle.

import { describe, it, expect } from 'vitest';
import { translateObject, translateMetadataDocument } from '@objectstack/spec/system';

import { ApprovalsTranslations } from './translations/index.js';
import { zhCNObjects } from './translations/zh-CN.objects.generated.js';
import { zhHantObjects } from './translations/zh-Hant.objects.generated.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { renderConfirmPage, renderResultPage } from './action-link-pages.js';

const LOCALES = [
  { locale: 'zh-CN', bundle: zhCNObjects, reject: '驳回', deny: '拒绝' },
  { locale: 'zh-Hant', bundle: zhHantObjects, reject: '駁回', deny: '拒絕' },
] as const;

const optionLabel = (object: unknown, field: string, value: string, locale: string): string | undefined => {
  const doc = translateObject(object as any, ApprovalsTranslations, { locale });
  const options = (doc as any)?.fields?.[field]?.options as Array<{ value: string; label?: string }> | undefined;
  return options?.find((o) => o.value === value)?.label;
};

const servedAction = (locale: string, name: string): Record<string, unknown> | undefined => {
  const doc = translateMetadataDocument('object', SysApprovalRequest, ApprovalsTranslations, { locale });
  return ((doc as { actions?: Array<Record<string, unknown>> }).actions ?? []).find((a) => a.name === name);
};

/** Every string leaf of a bundle subtree, with its dotted path. */
const leaves = (node: unknown, path: string[] = []): Array<[string, string]> => {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, child]) => leaves(child, [...path, key]));
};

describe('approval rejection reads 驳回 (#35021)', () => {
  describe.each(LOCALES)('$locale', ({ locale, bundle, reject, deny }) => {
    it(`the reject lever, the rejected status and the reject history row read ${reject}`, () => {
      expect(servedAction(locale, 'approval_reject')?.label).toBe(reject);
      expect(optionLabel(SysApprovalRequest, 'status', 'rejected', locale)).toBe(`已${reject}`);
      expect(optionLabel(SysApprovalAction, 'action', 'reject', locale)).toBe(reject);
    });

    it(`the reject lever's question and success toast say ${reject}`, () => {
      const node = (bundle as any).sys_approval_request._actions.approval_reject;
      expect(node.description).toContain(reject);
      expect(node.successMessage).toContain(reject);
    });

    it(`no approval object string in the bundle says ${deny}`, () => {
      const all = [
        ...leaves((bundle as any).sys_approval_request, ['sys_approval_request']),
        ...leaves((bundle as any).sys_approval_action, ['sys_approval_action']),
      ];
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter(([, value]) => value.includes(deny))).toEqual([]);
    });
  });

  it('the email action-link pages say 驳回 for the reject decision', () => {
    const request = { id: 'req_1', record_id: 'rec_1', object_name: 'expense', process_name: 'p' } as any;
    const confirm = renderConfirmPage({
      request,
      action: 'reject',
      approverId: 'user_1',
      token: 'tok',
      actPath: '/act',
    });
    const result = renderResultPage('rejected', request);
    expect(confirm).toContain('驳回');
    expect(result).toContain('已驳回');
    expect([confirm, result].filter((page) => page.includes('拒绝'))).toEqual([]);
  });
});
