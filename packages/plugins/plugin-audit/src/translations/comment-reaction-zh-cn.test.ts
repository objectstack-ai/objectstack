// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_comment_reaction` reads in Chinese under zh-CN.
 *
 * It is one of this package's four objects and the only one whose zh-CN bundle
 * still held the English extract fill, so its rows on Setup's 审计日志 (a
 * reaction added or removed) named it `Comment Reaction`. Judged on what the
 * plugin SERVES (`AuditTranslations`, after the source-hash fallback).
 */

import { describe, it, expect } from 'vitest';
import { AuditTranslations } from './index.js';
import { SysCommentReaction } from '../objects/sys-comment-reaction.object.js';

const CJK = /[一-鿿]/;

type ObjectEntry = { label?: string; pluralLabel?: string; description?: string; fields?: Record<string, { label?: string; help?: string }> };

const entry = ((AuditTranslations['zh-CN'] as { objects?: Record<string, ObjectEntry> }).objects ?? {})[SysCommentReaction.name];

describe('zh-CN — sys_comment_reaction', () => {
  it('the object is named and described in Chinese', () => {
    expect(entry?.label).toMatch(CJK);
    expect(entry?.pluralLabel).toMatch(CJK);
    expect(entry?.description).toMatch(CJK);
  });

  it('every declared field label, and every help, is in Chinese', () => {
    const untranslated: string[] = [];
    for (const [name, field] of Object.entries<any>((SysCommentReaction as any).fields)) {
      const leaf = entry?.fields?.[name];
      if (!CJK.test(leaf?.label ?? '')) untranslated.push(`${name}.label = ${leaf?.label}`);
      if (field.description && !CJK.test(leaf?.help ?? '')) untranslated.push(`${name}.help = ${leaf?.help}`);
    }
    expect(untranslated).toEqual([]);
  });
});
