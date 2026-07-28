// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { Task } from '../objects/task.object';
import { en } from './en';
import { zhCN } from './zh-CN';
import { jaJP } from './ja-JP';
import type { TranslationData } from '@objectstack/spec/system';

/**
 * Translation Completeness Test
 *
 * Validates that every field and every select option in the Task object
 * definition has a corresponding translation in each locale.
 *
 * The object key comes from `Task.name`, not a literal: this suite used to
 * hard-code `objects.task` while the object is `todo_task`, so it stayed green
 * against a bundle the resolver could never find — a completeness test that
 * agreed with the bundle instead of with the metadata (issue #3583).
 */

const objectName = Task.name;

const fieldNames = Object.keys(Task.fields);

const selectFields = Object.entries(Task.fields)
  .filter(([, f]) => Array.isArray(f.options) && f.options.length > 0)
  .map(([name, f]) => ({
    name,
    values: f.options!.map((o: { value: string }) => o.value),
  }));

describe.each([
  ['en', en],
  ['zh-CN', zhCN],
  // ja-JP is the repo's only Japanese bundle — keep it held to the same
  // completeness bar as the other declared locales.
  ['ja-JP', jaJP],
] as [string, TranslationData][])('%s translation completeness', (locale, t) => {

  it(`should have "${objectName}" object translation`, () => {
    expect(t.objects?.[objectName]).toBeDefined();
    expect(t.objects?.[objectName]?.label).toBeTruthy();
  });

  it.each(fieldNames)('field: %s', (name) => {
    expect(
      t.objects?.[objectName]?.fields?.[name]?.label,
      `[${locale}] Missing label for field "${name}"`,
    ).toBeTruthy();
  });

  it.each(selectFields)('options: $name', ({ name, values }) => {
    for (const v of values) {
      expect(
        t.objects?.[objectName]?.fields?.[name]?.options?.[v],
        `[${locale}] Missing option "${v}" for field "${name}"`,
      ).toBeTruthy();
    }
  });
});
