// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app-scoped record page — `PageSchema.apps` (maintainer ruling A on
 * #28979, record 6573557633).
 *
 * A record page names the apps whose routes open it for its object. Inside
 * one of them that page opens; everywhere else, Setup included, the object's
 * one `isDefault` record page still opens. The rule is the default's one level
 * down: at most one record page per object PER APP, refused by `defineStack`
 * and `composeStacks` the way a second default is (the registry's package door
 * and the metadata save door are pinned in their own packages), naming both
 * pages. The default and an app's page are two slots and coexist.
 *
 * Refusals assert the ADR-0112 envelope (`code` + `status`), the issue count
 * and the named subjects; every refusal row has a control that differs from
 * it by one key alone.
 */
import { describe, expect, it } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';
import { defaultRecordPageObject, misplacedDefaultPageRefusal } from './ui/default-record-page';
import { PageSchema } from './ui/page.zod';

type Refusal = Error & { code?: string; status?: number; issues?: readonly unknown[] };

const manifest = (id: string) => ({
  id,
  namespace: id.split('.').pop()!.replace(/-/g, ''),
  name: id.split('.').pop()!,
  version: '1.0.0',
  type: 'module' as const,
});

/** A record page of `object`; `apps` and `isDefault` are the keys a case varies. */
const recordPage = (name: string, object: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record' as const,
  object,
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

const stack = (pages: unknown[], id = 'com.example.arp') => ({ manifest: manifest(id), pages }) as any;

const issuesOf = (value: unknown) => {
  const r = PageSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

describe('PageSchema.apps — the key', () => {
  it('a record page bound to an object takes `apps`, alone or beside `isDefault`', () => {
    expect(issuesOf(recordPage('member', 'sys_user', { apps: ['duly'] }))).toEqual([]);
    expect(issuesOf(recordPage('member', 'sys_user', { apps: ['duly', 'crm'], isDefault: true }))).toEqual([]);
    expect(PageSchema.parse(recordPage('member', 'sys_user', { apps: ['duly'] })).apps).toEqual(['duly']);
  });

  it('absent is unchanged — the parse adds nothing', () => {
    expect(PageSchema.parse(recordPage('member', 'sys_user')).apps).toBeUndefined();
  });

  it('an empty list is refused (a scope with no app decides nothing)', () => {
    expect(issuesOf(recordPage('member', 'sys_user', { apps: [] })).map((i) => [i.code, i.path])).toEqual([['too_small', 'apps']]);
  });

  it('an app listed twice is refused at the repeat', () => {
    const issues = issuesOf(recordPage('member', 'sys_user', { apps: ['duly', 'crm', 'duly'] }));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', 'apps.2']]);
    expect(issues[0]!.message).toContain("App 'duly' is listed twice in `apps`");
  });

  it('an entry that is not an app name (lowercase snake_case) is refused', () => {
    expect(issuesOf(recordPage('member', 'sys_user', { apps: ['Duly App'] })).map((i) => i.path)).toEqual(['apps.0']);
  });

  it.each([
    ['a home page', { name: 'pg', label: 'P', type: 'home', apps: ['duly'] }, "`type: 'home'`"],
    ['an app page', { name: 'pg', label: 'P', type: 'app', apps: ['duly'] }, "`type: 'app'`"],
    ['a record page bound to no object', { name: 'pg', label: 'P', type: 'record', apps: ['duly'] }, 'bound to no `object`'],
  ])('is refused on %s, at `apps`, in the registry door\'s sentence', (_label, page, subject) => {
    const issues = issuesOf(page);
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', 'apps']]);
    expect(issues[0]!.message).toContain(subject);
    expect(issues[0]!.message).toBe(misplacedDefaultPageRefusal(page));
  });

  it('a misplaced page carrying both keys is told about both, each at its own path', () => {
    const issues = issuesOf({ name: 'pg', label: 'P', type: 'home', isDefault: true, apps: ['duly'] });
    expect(issues.map((i) => i.path)).toEqual(['isDefault', 'apps']);
  });

  it('the describe carries no planned marker (the console reads the key) and no tracker number', () => {
    const description = PageSchema.shape.apps.description ?? '';
    expect(description).toMatch(/^The apps whose routes open this record page /);
    expect(description).not.toMatch(/PLANNED|not yet rendered|until the console reads it/i);
    expect(description).not.toMatch(/#\d{3,}/);
  });
});

describe('defaultRecordPageObject(page, app) — the one reading of an app\'s slot', () => {
  it('names the object of a record page scoped to the app', () => {
    expect(defaultRecordPageObject(recordPage('member', 'sys_user', { apps: ['duly'] }), 'duly')).toBe('sys_user');
  });

  it('answers undefined for an app the page does not name, and for the default slot when not isDefault', () => {
    const page = recordPage('member', 'sys_user', { apps: ['duly'] });
    expect(defaultRecordPageObject(page, 'setup')).toBeUndefined();
    expect(defaultRecordPageObject(page)).toBeUndefined();
  });

  it('a default page holds no app slot unless it names the app — the two slots are apart', () => {
    const page = recordPage('user_detail', 'sys_user', { isDefault: true });
    expect(defaultRecordPageObject(page)).toBe('sys_user');
    expect(defaultRecordPageObject(page, 'duly')).toBeUndefined();
  });

  it.each([
    ['a home page', { name: 'p', type: 'home', object: 'sys_user', apps: ['duly'] }],
    ['a record page bound to no object', { name: 'p', type: 'record', apps: ['duly'] }],
    ['`apps` that is not an array', { name: 'p', type: 'record', object: 'sys_user', apps: 'duly' }],
  ])('answers undefined for %s', (_label, page) => {
    expect(defaultRecordPageObject(page, 'duly')).toBeUndefined();
  });
});

describe('defineStack — two record pages for one object in one app', () => {
  it('is refused, naming the object, the app, both pages and their positions', () => {
    const err = refusalOf(() =>
      defineStack(stack([
        recordPage('member_a', 'sys_user', { apps: ['duly'] }),
        recordPage('member_b', 'sys_user', { apps: ['duly'] }),
      ])),
    );
    expect(err, 'the stack was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toMatch(
      /^Object 'sys_user' has two record pages for app 'duly' in `pages`: 'member_a' \(stack\.pages\[0\]\) and 'member_b' \(stack\.pages\[1\]\)\. Remove 'duly' from `apps` on all but one of them\./,
    );
  });

  it('control: the same two pages scoped to different apps are accepted', () => {
    expect(() =>
      defineStack(stack([
        recordPage('member_a', 'sys_user', { apps: ['duly'] }),
        recordPage('member_b', 'sys_user', { apps: ['crm'] }),
      ])),
    ).not.toThrow();
  });

  it('a page scoped to two apps holds both: a second page in either app is refused, the other app untouched', () => {
    const err = refusalOf(() =>
      defineStack(stack([
        recordPage('member_a', 'sys_user', { apps: ['duly', 'crm'] }),
        recordPage('member_b', 'sys_user', { apps: ['crm'] }),
      ])),
    );
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toMatch(/^Object 'sys_user' has two record pages for app 'crm' in `pages`/);
  });

  it('control: a page scoped to two apps alone is accepted', () => {
    expect(() => defineStack(stack([recordPage('member_a', 'sys_user', { apps: ['duly', 'crm'] })]))).not.toThrow();
  });

  it('the default and an app\'s page for one object coexist — two slots, no precedence', () => {
    expect(() =>
      defineStack(stack([
        recordPage('user_detail', 'sys_user', { isDefault: true }),
        recordPage('member', 'sys_user', { apps: ['duly'] }),
      ])),
    ).not.toThrow();
  });

  it('one page may be the default and an app\'s page at once', () => {
    expect(() =>
      defineStack(stack([
        recordPage('user_detail', 'sys_user', { isDefault: true, apps: ['setup'] }),
        recordPage('member', 'sys_user', { apps: ['duly'] }),
      ])),
    ).not.toThrow();
  });

  it('a second default is still refused as a default, never as an app\'s page', () => {
    const err = refusalOf(() =>
      defineStack(stack([
        recordPage('user_detail', 'sys_user', { isDefault: true }),
        recordPage('member', 'sys_user', { isDefault: true, apps: ['duly'] }),
      ])),
    );
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toMatch(/^Object 'sys_user' has two default record pages in `pages`/);
  });
});

describe('composeStacks — two record pages for one object in one app across the stacks', () => {
  const a = () => defineStack(stack([recordPage('member_a', 'sys_user', { apps: ['duly'] })], 'com.example.arp-a'));
  const b = (page: unknown = recordPage('member_b', 'sys_user', { apps: ['duly'] })) =>
    defineStack(stack([page], 'com.example.arp-b'));

  it('is refused, naming both stacks\' pages and the app', () => {
    const err = refusalOf(() => composeStacks([a(), b()]));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toContain(
      "Object 'sys_user' has two record pages for app 'duly' in the composed stacks: "
        + "'member_a' ('com.example.arp-a' (stack #0) pages[0]) and 'member_b' ('com.example.arp-b' (stack #1) pages[0])",
    );
  });

  it('is refused under `manifest: \'preserve\'` too', () => {
    expect(refusalOf(() => composeStacks([a(), b()], { manifest: 'preserve' }))?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it('control: the second stack\'s page scoped to another app composes', () => {
    expect(() => composeStacks([a(), b(recordPage('member_b', 'sys_user', { apps: ['crm'] }))])).not.toThrow();
  });

  it('control: the second stack\'s page the default instead composes beside the app\'s page', () => {
    expect(() => composeStacks([a(), b(recordPage('member_b', 'sys_user', { isDefault: true }))])).not.toThrow();
  });
});
