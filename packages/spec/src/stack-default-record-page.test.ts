// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One default record page per object per deployment — the stack contract's
 * door (maintainer ruling A on #23015, record 6134056653).
 *
 * `defineStack` (and so `os validate`, `os build` and a source boot, which all
 * load a stack through it) refuses two `isDefault: true` record pages for one
 * object inside one stack, and `composeStacks` refuses the pair across the
 * stacks it composes. Both name every page and where it sits, in the
 * cross-reference envelope.
 *
 * Refusals assert the ADR-0112 envelope (`code` + `status`), the issue count
 * and the named subjects — the object and both pages with their positions —
 * never a bare `toThrow()`, which a refusal for any other reason would satisfy.
 * Every refusal row's CONTROL differs from it by one key alone.
 *
 * `defaultRecordPageObject` is the one reading the registry and the metadata
 * save door ask too, so its own cases are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { defineStack, composeStacks } from './stack.zod';
import { defaultRecordPageObject } from './ui/default-record-page';
import { PageSchema } from './ui/page.zod';

type Refusal = Error & { code?: string; status?: number; issues?: readonly string[] };

const manifest = (id: string) => ({
  id,
  namespace: id.split('.').pop()!.replace(/-/g, ''),
  name: id.split('.').pop()!,
  version: '1.0.0',
  type: 'module' as const,
});

const task = {
  name: 'drp_task',
  label: 'Task',
  sharingModel: 'private' as const,
  fields: { title: { type: 'text' as const, label: 'Title' } },
};

const project = { ...task, name: 'drp_project', label: 'Project' };

/** A record page; `isDefault` and `object` are the only keys a case varies. */
const recordPage = (name: string, object: string, isDefault: boolean, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record' as const,
  object,
  isDefault,
  regions: [],
  ...extra,
});

const refusalOf = (fn: () => unknown): Refusal | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

const stack = (pages: unknown[], id = 'com.example.drp') =>
  ({ manifest: manifest(id), objects: [task, project], pages }) as any;

describe('defaultRecordPageObject — the one reading every door asks', () => {
  it('names the object of an isDefault record page', () => {
    expect(defaultRecordPageObject(recordPage('p', 'drp_task', true))).toBe('drp_task');
  });

  it('reads an absent `type` as the declared default, record', () => {
    const { type: _omit, ...untyped } = recordPage('p', 'drp_task', true);
    expect(defaultRecordPageObject(untyped)).toBe('drp_task');
    // The constant it reads is the one the schema's default is built from.
    expect(PageSchema.parse({ name: 'probe_page', label: 'Probe' }).type).toBe('record');
  });

  it.each([
    ['isDefault false', recordPage('p', 'drp_task', false)],
    ['isDefault absent', (() => { const { isDefault: _o, ...rest } = recordPage('p', 'drp_task', true); return rest; })()],
    ['isDefault a truthy non-boolean', { ...recordPage('p', 'drp_task', true), isDefault: 'true' }],
    ['a home page', { ...recordPage('p', 'drp_task', true), type: 'home' }],
    ['a list page', { ...recordPage('p', 'drp_task', true), type: 'list' }],
    ['a record page bound to no object', (() => { const { object: _o, ...rest } = recordPage('p', 'x', true); return rest; })()],
    ['an empty object', recordPage('p', '', true)],
    ['not an object', 'p'],
    ['null', null],
  ])('answers undefined for %s', (_label, page) => {
    expect(defaultRecordPageObject(page)).toBeUndefined();
  });

  it('reads no undeclared spelling — `default` and `objectName` decide nothing', () => {
    expect(defaultRecordPageObject({ name: 'p', type: 'record', objectName: 'drp_task', default: true })).toBeUndefined();
  });
});

describe('defineStack — two default record pages for one object in one stack', () => {
  it('is refused, naming the object, both pages and their positions', () => {
    const err = refusalOf(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), recordPage('task_b', 'drp_task', true)])),
    );
    expect(err, 'the stack was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toMatch(
      /^Object 'drp_task' has two default record pages in `pages`: 'task_a' \(stack\.pages\[0\]\) and 'task_b' \(stack\.pages\[1\]\)\. Set `isDefault: false` on all but one of them\./,
    );
    expect(err!.message).toContain('defineStack cross-reference validation failed (1 issue):');
  });

  it('control: the same two pages with one of them not a default is accepted', () => {
    expect(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), recordPage('task_b', 'drp_task', false)])),
    ).not.toThrow();
  });

  it('control: two objects with one default record page each is accepted', () => {
    expect(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), recordPage('project_a', 'drp_project', true)])),
    ).not.toThrow();
  });

  it('an isDefault page that is not a record page is no second default — the page parse refuses its flag (#23610)', () => {
    const err = refusalOf(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), { name: 'task_home', label: 'Home', type: 'home', isDefault: true }])),
    );
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect((err as { issues?: Array<{ path: unknown[] }> })!.issues!.map((i) => i.path.join('.'))).toEqual(['pages.1.isDefault']);
  });

  it('control: the same home page without the flag sits beside the default record page', () => {
    expect(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), { name: 'task_home', label: 'Home', type: 'home' }])),
    ).not.toThrow();
  });

  it('a page that leaves `type` out is a record page, and counts', () => {
    const { type: _omit, ...untyped } = recordPage('task_b', 'drp_task', true);
    const err = refusalOf(() => defineStack(stack([recordPage('task_a', 'drp_task', true), untyped])));
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err!.issues![0]).toContain("'task_a' (stack.pages[0]) and 'task_b' (stack.pages[1])");
  });

  it('three defaults are one finding naming all three', () => {
    const err = refusalOf(() =>
      defineStack(stack([
        recordPage('task_a', 'drp_task', true),
        recordPage('task_b', 'drp_task', true),
        recordPage('task_c', 'drp_task', true),
      ])),
    );
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toContain("has 3 default record pages in `pages`: 'task_a' (stack.pages[0]), 'task_b' (stack.pages[1]) and 'task_c' (stack.pages[2])");
  });

  it('the object need not be one the stack defines — a platform object\'s record page counts', () => {
    const err = refusalOf(() =>
      defineStack({
        manifest: manifest('com.example.drp-platform'),
        pages: [recordPage('org_a', 'sys_organization', true), recordPage('org_b', 'sys_organization', true)],
      } as any),
    );
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err!.issues![0]).toMatch(/^Object 'sys_organization' has two default record pages/);
  });

  it('two entries under ONE name are the duplicate-entry finding only, not a second default', () => {
    const err = refusalOf(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), recordPage('task_a', 'drp_task', true)])),
    );
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toMatch(/^Page 'task_a' is declared twice in `pages`/);
  });

  it('`strict: false` skips it, like every cross-reference check', () => {
    expect(() =>
      defineStack(stack([recordPage('task_a', 'drp_task', true), recordPage('task_b', 'drp_task', true)]), { strict: false }),
    ).not.toThrow();
  });
});

describe('composeStacks — two default record pages for one object across the stacks it composes', () => {
  // Object-less stacks: the pages bind an object neither declares (a platform
  // object's record page is the live case), which the rule never needs.
  const a = () => defineStack({ manifest: manifest('com.example.drp-a'), pages: [recordPage('task_a', 'drp_task', true)] } as any);
  const b = (page = recordPage('task_b', 'drp_task', true)) =>
    defineStack({ manifest: manifest('com.example.drp-b'), pages: [page] } as any);

  it('is refused, naming both stacks\' pages', () => {
    const err = refusalOf(() => composeStacks([a(), b()]));
    expect(err, 'the composition was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toContain(
      "Object 'drp_task' has two default record pages in the composed stacks: "
        + "'task_a' ('com.example.drp-a' (stack #0) pages[0]) and 'task_b' ('com.example.drp-b' (stack #1) pages[0])",
    );
    expect(err!.message).toContain('composeStacks artifact cross-reference validation failed (1 issue):');
  });

  it('is refused under `manifest: \'preserve\'` too — each stack a package of one artifact', () => {
    const err = refusalOf(() => composeStacks([a(), b()], { manifest: 'preserve' }));
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it('under `preserve`, one page name in two stacks is two packages\' pages, and is refused', () => {
    const err = refusalOf(() => composeStacks([a(), b(recordPage('task_a', 'drp_task', true))], { manifest: 'preserve' }));
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err!.issues![0]).toContain("'task_a' ('com.example.drp-a' (stack #0) pages[0]) and 'task_a' ('com.example.drp-b' (stack #1) pages[0])");
  });

  it('control: the second stack\'s page not a default composes', () => {
    expect(() => composeStacks([a(), b(recordPage('task_b', 'drp_task', false))])).not.toThrow();
  });

  it('control: one default per object across the stacks composes', () => {
    expect(() => composeStacks([a(), b(recordPage('project_b', 'drp_project', true))])).not.toThrow();
  });
});
