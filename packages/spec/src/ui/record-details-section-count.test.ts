// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23013 — a `record:details` section heading can show how many values a
 * multi-value field holds on the current record: `count: { field }` on the
 * section, and the `{{ count }}` hole in its `label`.
 *
 * Pinned through the door that parses page-component props,
 * `ComponentPropsMap['record:details']` (the `@objectstack/lint` component-props
 * pass dispatches on exactly this map). The field-existence and multi-value
 * halves are cross-schema and are pinned in `@objectstack/lint`'s
 * `validate-page-field-bindings.test.ts`.
 *
 * Refusals assert the issue `code` and `path` (and, where the issue names a
 * subject, that subject) — never the prose around it.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, RecordDetailsProps, SECTION_HEADING_COUNT_HOLE } from './component.zod';

const parse = (section: Record<string, unknown>) =>
  ComponentPropsMap['record:details'].safeParse({ sections: [section] });

const issuesOf = (r: ReturnType<typeof parse>): z.core.$ZodIssue[] =>
  r.success ? [] : r.error.issues;

/** The producer shape: the plan-gap heading from the accepted wording. */
const PLAN_GAP = {
  name: 'plan_gap',
  label: '{{ count }} 项功能需要更高套餐 · 查看',
  fields: ['capabilities_not_on_plan'],
  collapsible: true,
  defaultCollapsed: true,
  count: { field: 'capabilities_not_on_plan' },
};

describe('record:details section `count` — accepted shapes', () => {
  it('parses the plan-gap heading and the key survives the parse', () => {
    const r = parse(PLAN_GAP);
    expect(r.success).toBe(true);
    const section = r.success ? (r.data.sections?.[0] as Record<string, unknown>) : undefined;
    expect(section?.count).toEqual({ field: 'capabilities_not_on_plan' });
    expect(section?.label).toBe(PLAN_GAP.label);
  });

  it('is the same schema object the page door dispatches on', () => {
    expect(ComponentPropsMap['record:details']).toBe(RecordDetailsProps);
  });

  it('takes the hole with or without inner whitespace', () => {
    for (const label of ['{{count}} tags', '{{ count }} tags', 'Tags ({{  count  }})']) {
      expect(parse({ label, fields: ['tags'], count: { field: 'tags' } }).success, label).toBe(true);
    }
  });

  it('takes an inline locale map whose every locale writes the hole', () => {
    const r = parse({
      label: { en: '{{ count }} features need a higher plan', 'zh-CN': '{{ count }} 项功能需要更高套餐 · 查看' },
      fields: ['capabilities_not_on_plan'],
      count: { field: 'capabilities_not_on_plan' },
    });
    expect(r.success).toBe(true);
  });

  it('materializes nothing when omitted, and a label without a hole is untouched', () => {
    const r = parse({ label: 'Details', fields: ['notes'] });
    expect(r.success).toBe(true);
    const section = r.success ? (r.data.sections?.[0] as Record<string, unknown>) : undefined;
    expect(section && 'count' in section).toBe(false);
  });

  it('does NOT refuse a `{{ count }}` hole in a section that declares no `count` (no narrowing of `label`)', () => {
    expect(parse({ label: '{{ count }} items', fields: ['notes'] }).success).toBe(true);
  });
});

describe('record:details section `count` — the label must show it', () => {
  it('refuses `count` on a section with no `label`', () => {
    const issues = issuesOf(parse({ fields: ['tags'], count: { field: 'tags' } }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['sections', 0, 'label']]]);
  });

  it('refuses a label with no `{{ count }}` hole', () => {
    const issues = issuesOf(parse({ label: 'Tags', fields: ['tags'], count: { field: 'tags' } }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['sections', 0, 'label']]]);
  });

  it('refuses an inline locale map at the locale that lacks the hole, and only there', () => {
    const issues = issuesOf(parse({
      label: { en: '{{ count }} tags', 'zh-CN': '标签' },
      fields: ['tags'],
      count: { field: 'tags' },
    }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['sections', 0, 'label', 'zh-CN']]]);
  });

  it('refuses any other hole — another variable, or the count with a formatter — naming it', () => {
    for (const [label, named] of [
      ['{{ count }} tags on {{ name }}', '{{ name }}'],
      ['{{ count | number }} tags', '{{ count | number }}'],
      ['{{count, number}} tags', '{{ count, number }}'],
    ] as const) {
      const issues = issuesOf(parse({ label, fields: ['tags'], count: { field: 'tags' } }));
      expect(issues.map((i) => [i.code, i.path]), label).toEqual([['custom', ['sections', 0, 'label']]]);
      expect(issues[0]?.message, label).toContain(named);
    }
  });

  it('refuses the single-brace spellings, which a heading never interpolates', () => {
    for (const label of ['{count} tags', '${count} tags', '{{ count }} tags, {count} total']) {
      const issues = issuesOf(parse({ label, fields: ['tags'], count: { field: 'tags' } }));
      expect(issues.map((i) => [i.code, i.path]), label).toEqual([['custom', ['sections', 0, 'label']]]);
    }
  });

  it('refuses `count` beside `group` — the heading there is the group\'s own label', () => {
    const issues = issuesOf(parse({ group: 'plan', count: { field: 'tags' } }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['sections', 0, 'count']]]);
  });
});

describe('record:details section `count` — the shape is strict', () => {
  it('refuses a `count.field` that is not one bare machine name', () => {
    for (const field of ['account.tags', 'Tags', 'tag-list', '']) {
      const issues = issuesOf(parse({ label: '{{ count }} tags', fields: ['tags'], count: { field } }));
      expect(issues.map((i) => [i.code, i.path]), field).toEqual([
        ['invalid_format', ['sections', 0, 'count', 'field']],
      ]);
    }
  });

  it('refuses an unknown key under `count`, and a `count` that is not an object', () => {
    const extra = issuesOf(parse({
      label: '{{ count }} tags', fields: ['tags'], count: { field: 'tags', where: { active: true } },
    }));
    expect(extra.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['sections', 0, 'count']]]);

    const bare = issuesOf(parse({ label: '{{ count }} tags', fields: ['tags'], count: 'tags' }));
    expect(bare.map((i) => [i.code, i.path])).toEqual([['invalid_type', ['sections', 0, 'count']]]);

    const empty = issuesOf(parse({ label: '{{ count }} tags', fields: ['tags'], count: {} }));
    expect(empty.map((i) => [i.code, i.path])).toEqual([['invalid_type', ['sections', 0, 'count', 'field']]]);
  });
});

describe('SECTION_HEADING_COUNT_HOLE — the one grammar the judge and the renderer read', () => {
  it('is non-global, so sharing it carries no lastIndex state', () => {
    expect(SECTION_HEADING_COUNT_HOLE.flags).not.toContain('g');
  });

  it('matches the double-brace hole with free inner whitespace, and nothing else', () => {
    for (const s of ['{{count}}', '{{ count }}', 'x {{  count  }} y']) expect(SECTION_HEADING_COUNT_HOLE.test(s), s).toBe(true);
    for (const s of ['{count}', '${count}', '{{ counts }}', '{{ count | number }}', 'count']) {
      expect(SECTION_HEADING_COUNT_HOLE.test(s), s).toBe(false);
    }
  });
});
