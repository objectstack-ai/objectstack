// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 队列 and 队列成员 pages read in Chinese on a zh-CN console.
 *
 * Setup's Queues and Queue Members pages draw their title, the 新建 button
 * (「新建」 + the object label), the list columns and every form field's
 * label and help from the served translation of `sys_queue` and
 * `sys_queue_member`. This package's bundle carried its three sharing objects
 * only, so both pages fell back to the English object metadata and the button
 * read 「新建Queue」. This pins what the bundle serves for both objects.
 */

import { describe, expect, it } from 'vitest';
import { SharingTranslations } from './index.js';
import { SysQueue, SysQueueMember } from '../objects/index.js';

type FieldCopy = { label?: string; help?: string; options?: Record<string, string> };
type ObjectCopy = { label?: string; pluralLabel?: string; description?: string; fields?: Record<string, FieldCopy> };

const HAN = /[一-鿿]/;

describe('queue pages: the served zh-CN bundle translates sys_queue and sys_queue_member', () => {
  const zhCN = (SharingTranslations['zh-CN'] as { objects: Record<string, ObjectCopy> }).objects;

  it('names the two objects 队列 and 队列成员', () => {
    expect(zhCN.sys_queue?.label).toBe('队列');
    expect(zhCN.sys_queue?.pluralLabel).toBe('队列');
    expect(zhCN.sys_queue_member?.label).toBe('队列成员');
    expect(zhCN.sys_queue_member?.pluralLabel).toBe('队列成员');
  });

  for (const schema of [SysQueue, SysQueueMember]) {
    it(`${schema.name}: the page description and every field label and help are Chinese`, () => {
      const copy = zhCN[schema.name];
      expect(copy?.description ?? '').toMatch(HAN);
      for (const [field, def] of Object.entries(schema.fields as Record<string, { description?: string }>)) {
        expect(copy?.fields?.[field]?.label ?? '', `${schema.name}.${field}.label`).toMatch(HAN);
        if (def.description) {
          expect(copy?.fields?.[field]?.help ?? '', `${schema.name}.${field}.help`).toMatch(HAN);
        }
      }
    });
  }

  it('sys_queue_member: every member type option is Chinese', () => {
    const options = zhCN.sys_queue_member?.fields?.recipient_type?.options ?? {};
    expect(Object.keys(options).sort()).toEqual(
      ['business_unit', 'position', 'team', 'unit_and_subordinates', 'user'],
    );
    for (const [value, label] of Object.entries(options)) expect(label, value).toMatch(HAN);
  });
});
