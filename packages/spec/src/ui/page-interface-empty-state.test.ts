// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23005] A list page carries its own `emptyState` —
 * `InterfacePageConfigSchema.emptyState`, the list view's {@link EmptyStateSchema}
 * taken by reference.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE PAGE DOOR ACCEPTS IT, byte-identical, with and without the link,
 *   through `InterfacePageConfigSchema` and through a whole `type: 'list'` page.
 * - §2 IT IS STILL CLOSED: an unknown key inside it is refused by the empty
 *   state at `emptyState` (`interfaceConfig.emptyState` on the page), and a
 *   refused link target at `….link.url`, each by code AND path, so a refusal
 *   for the wrong reason reds. The unknown-key control on `interfaceConfig`
 *   itself proves the widening did not open the page config.
 * - §3 ONE SHAPE: the member unwraps to `EmptyStateSchema` itself, by identity,
 *   and answers what it answers on every corpus value — triage ruled out a
 *   second empty-state shape, and a later copy reds the identity half even
 *   while it still agrees on today's corpus.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { InterfacePageConfigSchema, PageSchema } from './page.zod';
import { EmptyStateSchema } from './view.zod';

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

const CONFIG_BASE = { source: 'sys_package' } as const;

function listPage(interfaceConfig: Record<string, unknown>) {
  return PageSchema.safeParse({
    name: 'sys_package_mine',
    label: 'My Packages',
    type: 'list',
    object: 'sys_package',
    interfaceConfig,
    regions: [],
  });
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the page door accepts it
// ───────────────────────────────────────────────────────────────────────────

describe('§1 a list page accepts its own emptyState', () => {
  const ACCEPTED: ReadonlyArray<readonly [label: string, emptyState: Record<string, unknown>]> = [
    ['one plain sentence', { message: 'Packages you publish appear here.' }],
    ['a full empty state', { title: 'No packages yet', message: 'Packages you publish appear here.', icon: 'package' }],
    ['one plain sentence and one link', {
      message: 'Packages you publish appear here.',
      link: { label: 'How to publish a package', url: '/docs/publish-a-package' },
    }],
    ['a locale-map title and an external link', {
      title: { en: 'No packages yet', 'zh-CN': '还没有软件包' },
      link: { label: 'Publishing guide', url: 'https://docs.example.com/publish' },
    }],
  ];

  for (const [label, emptyState] of ACCEPTED) {
    it(`InterfacePageConfigSchema parses ${label}, byte-identical`, () => {
      const r = InterfacePageConfigSchema.safeParse({ ...CONFIG_BASE, emptyState });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data.emptyState).toStrictEqual(emptyState);
    });

    it(`a type: 'list' page parses ${label} under interfaceConfig`, () => {
      const r = listPage({ ...CONFIG_BASE, emptyState });
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data.interfaceConfig?.emptyState).toStrictEqual(emptyState);
    });
  }

  it('an absent emptyState stays absent', () => {
    const r = InterfacePageConfigSchema.safeParse(CONFIG_BASE);
    expect(issues(r)).toEqual([]);
    expect(r.success && 'emptyState' in r.data).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 still closed
// ───────────────────────────────────────────────────────────────────────────

describe('§2 the page config and its emptyState refuse what they do not declare', () => {
  it('LIT CONTROL — an unknown interfaceConfig key is still refused at the config itself', () => {
    const r = InterfacePageConfigSchema.safeParse({ ...CONFIG_BASE, emptyState: {}, notAPageConfigKey: 1 });
    expect(issues(r)).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });

  const REFUSED: ReadonlyArray<readonly [label: string, emptyState: unknown, code: string, path: string]> = [
    ['an unknown emptyState key', { title: 'None', notAnEmptyStateKey: 1 }, 'unrecognized_keys', 'emptyState'],
    ['an emptyState call to action', { action: { label: 'Publish' } }, 'unrecognized_keys', 'emptyState'],
    ['a bare-string emptyState', 'Nothing here', 'invalid_type', 'emptyState'],
    ['a link target the runner never opens', { link: { label: 'Docs', url: 'javascript:alert(1)' } }, 'custom', 'emptyState.link.url'],
    ['a link with an extra key', { link: { label: 'Docs', url: '/docs', openIn: 'new-tab' } }, 'unrecognized_keys', 'emptyState.link'],
  ];

  for (const [label, emptyState, code, path] of REFUSED) {
    it(`refuses ${label} — ${code} at ${path}`, () => {
      expect(issues(InterfacePageConfigSchema.safeParse({ ...CONFIG_BASE, emptyState }))).toEqual([{ code, path }]);
    });

    it(`a type: 'list' page refuses ${label} — ${code} at interfaceConfig.${path}`, () => {
      expect(issues(listPage({ ...CONFIG_BASE, emptyState }))).toEqual([{ code, path: `interfaceConfig.${path}` }]);
    });
  }

  it('the empty-state refusal answers `action` with the link and `addRecord`, at the page door too', () => {
    const r = InterfacePageConfigSchema.safeParse({ ...CONFIG_BASE, emptyState: { button: {} } });
    const message = r.success ? '' : r.error.issues[0].message;
    expect(message).toContain('`link` — `{ label, url }`');
    expect(message).toContain('`addRecord`');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one shape, not a copy of it
// ───────────────────────────────────────────────────────────────────────────

describe('§3 the list page holds EmptyStateSchema itself', () => {
  it('the emptyState member unwraps to EmptyStateSchema — the same def, by identity', () => {
    expect(InterfacePageConfigSchema.shape.emptyState.unwrap()._zod.def).toBe(EmptyStateSchema._zod.def);
  });

  it('the page config answers what EmptyStateSchema answers, one level down, on every corpus value', () => {
    const corpus: unknown[] = [
      {},
      { title: 'No packages yet', message: 'Packages you publish appear here.', icon: 'package' },
      { link: { label: 'Docs', url: '/docs' } },
      { link: { label: 'Docs', url: '//evil.example' } },
      { link: { url: '/docs' } },
      { title: 42 },
      { description: 'x' },
      { url: '/docs' },
      'Nothing here',
      null,
    ];
    for (const emptyState of corpus) {
      const direct = issues(EmptyStateSchema.safeParse(emptyState)).map(({ code, path }) => ({
        code,
        path: path ? `emptyState.${path}` : 'emptyState',
      }));
      expect(issues(InterfacePageConfigSchema.safeParse({ ...CONFIG_BASE, emptyState })), JSON.stringify(emptyState))
        .toEqual(direct);
    }
  });
});
