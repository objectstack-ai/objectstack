// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DatasetDimensionSchema.nullLabel` — the display name of a dimension's null
 * bucket (ruling 6358843349 on #25330, letter A; the spec half, #25391).
 *
 * The key is optional display copy in the `label` slot's own type
 * (`I18nLabelSchema`): the plain string and the inline locale map both parse,
 * an absent key parses exactly as before it existed, and the dimension stays a
 * closed shape — the new key widens the accept set by one name and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { DatasetDimensionSchema, DatasetSchema } from './dataset.zod';

const dimension = { name: 'user', field: 'user_id', type: 'lookup' as const };

describe('DatasetDimensionSchema.nullLabel', () => {
  it('accepts the plain-string form and keeps the value', () => {
    const parsed = DatasetDimensionSchema.safeParse({ ...dimension, nullLabel: 'System' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.nullLabel).toBe('System');
  });

  it('accepts the inline locale-map form and keeps the value', () => {
    const nullLabel = { en: 'System', 'zh-CN': '系统' };
    const parsed = DatasetDimensionSchema.safeParse({ ...dimension, nullLabel });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.nullLabel).toEqual(nullLabel);
  });

  it('an absent nullLabel parses exactly as before: no key is materialized', () => {
    const parsed = DatasetDimensionSchema.safeParse(dimension);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(dimension);
    expect(Object.prototype.hasOwnProperty.call(parsed.data, 'nullLabel')).toBe(false);
  });

  it('refuses a value that is not a label, at the key', () => {
    const parsed = DatasetDimensionSchema.safeParse({ ...dimension, nullLabel: 42 });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.code, i.path])).toEqual([['invalid_union', ['nullLabel']]]);
  });

  it('the dimension still refuses an undeclared key beside it', () => {
    const parsed = DatasetDimensionSchema.safeParse({ ...dimension, nullLabel: 'System', emptyText: 'System' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('a whole dataset carrying it parses clean', () => {
    const parsed = DatasetSchema.safeParse({
      name: 'events_by_user',
      label: 'Events by User',
      object: 'sys_event',
      dimensions: [{ ...dimension, nullLabel: 'System' }],
      measures: [{ name: 'event_count', aggregate: 'count' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.dimensions[0]?.nullLabel).toBe('System');
  });
});
