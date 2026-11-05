// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An out-of-office rule's "Valid Until" help says when the rule stops, not
 * which interval notation the check uses.
 *
 * The help tooltip on the `sys_approval_delegation` form is the served
 * translation of the field's `description`. It used to read "half-open
 * [from, until)" (zh-CN 「半开区间 [from, until)」): the shape of the check,
 * which an administrator has no use for. This pins the served zh-CN text and
 * the English source.
 */

import { describe, expect, it } from 'vitest';
import { ApprovalsTranslations } from './index.js';
import { SysApprovalDelegation } from '../sys-approval-delegation.object.js';

const INTERVAL_NOTATION = /半开区间|half-open|\[from, until\)/i;

type ObjectCopy = { fields?: Record<string, { help?: string }> };

describe('sys_approval_delegation.valid_until: help reads as administrator wording', () => {
  it('the served zh-CN help is Chinese and carries no interval notation', () => {
    const objects = (ApprovalsTranslations['zh-CN'] as { objects: Record<string, ObjectCopy> }).objects;
    const help = objects.sys_approval_delegation?.fields?.valid_until?.help ?? '';
    expect(help).toMatch(/[一-鿿]/);
    expect(help).not.toMatch(INTERVAL_NOTATION);
  });

  it('the English source carries no interval notation', () => {
    const description = (SysApprovalDelegation.fields as Record<string, { description?: string }>).valid_until
      ?.description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description).not.toMatch(INTERVAL_NOTATION);
  });
});
