// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design mode menu's AI inquiry page entry (objectstack#37832): the
 * picker's 「AI inquiry」 adds one `ai:chat` component entry (ui ADR-0057
 * Amendment A4), offered only while the app has none; its form refuses what
 * `AiChatNavParamsSchema` refuses; 「Set as home」 moves it to the first place
 * of the top level and writes no `landing`; the save puts it where every other
 * menu edit goes, an installed app's customization package.
 *
 * Real subjects: the model functions, `saveAppMenu`, and the spec's own
 * `AppSchema` / `AiChatNavParamsSchema`. The package doors are fakes that
 * record what is written.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import { AI_CHAT_COMPONENT_REF, AiChatNavParamsSchema, AppSchema } from '@objectstack/spec/ui';
import {
  MENU_TARGET_KINDS,
  aiChatFormOf,
  aiChatOffered,
  aiChatParamsOf,
  asHome,
  canBeHome,
  entryFor,
  entryOf,
  insertEntry,
  isAiChatEntry,
  withEntryIds,
  type AiChatForm,
  type Menu,
} from '../designModeMenuModel';
import { saveAppMenu, type AppMenuSaveDoors } from '../designModeMenuSave';

const TEXTS = { notListed: 'not listed', pendingDraft: 'pending draft', noVersion: 'no version', notWritable: 'not writable' };

const ASK = { id: 'ask', type: 'component', label: 'Ask AI', componentRef: AI_CHAT_COMPONENT_REF };
const NAV: Menu = [
  { id: 'home', type: 'object', objectName: 'crm_lead' },
  {
    id: 'sales',
    type: 'group',
    label: 'Sales',
    children: [{ id: 'accounts', type: 'object', objectName: 'crm_account' }],
  },
];

const EMPTY: AiChatForm = { title: '', subtitle: '', placeholder: '', suggestions: '' };

/** Doors over an app stored with `stored` as its navigation, in a package listed `writable` or not. */
function doors(stored: Menu, writable: boolean) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: AppMenuSaveDoors = {
    listPackages: async () =>
      new Map([['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable, manifest: { version: '6.5.0' } }]]),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: false, writable: true };
    },
    client: {
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        const code = { name: 'crm', label: 'CRM', navigation: stored, _packageId: 'com.acme.crm' };
        return { code, effective: code };
      },
      save: async (...args) => {
        calls.push(['save', ...args]);
        return {};
      },
      publish: async (...args) => {
        calls.push(['publish', ...args]);
        return {};
      },
      reset: async (...args) => {
        calls.push(['reset', ...args]);
        return {};
      },
    },
  };
  return { d, calls };
}

/** The app document the save wrote. */
const savedApp = (calls: Array<[string, ...unknown[]]>) => calls.find(([c]) => c === 'save')![3] as Record<string, unknown>;

beforeEach(() => emitMetadataRefresh.mockReset());

describe('the AI inquiry entry the picker adds (objectstack#37832)', () => {
  it('is a kind of the picker, and the entry it adds is an `ai:chat` component entry the spec takes', () => {
    expect(MENU_TARGET_KINDS).toContain('aiChat');
    const entry = entryFor('aiChat', 'Ask AI', 'nav_item_1', undefined, { title: 'Ask about our policies', suggestions: ['How many leave days?'] });
    expect(entry).toEqual({
      id: 'nav_item_1',
      type: 'component',
      label: 'Ask AI',
      icon: 'sparkles',
      componentRef: 'ai:chat',
      params: { title: 'Ask about our policies', suggestions: ['How many leave days?'] },
    });
    expect(isAiChatEntry(entry)).toBe(true);
    expect(entryFor('aiChat', 'Ask AI', 'nav_item_1')).not.toHaveProperty('params');
    expect(AppSchema.safeParse({ name: 'crm', label: 'CRM', navigation: [...NAV, entry] }).success).toBe(true);
  });
});

describe('「AI inquiry」 is a singleton (objectstack#37832)', () => {
  const served = withEntryIds(NAV);

  it('is offered while the app has no `ai:chat` entry', () => {
    expect(aiChatOffered(served, served, NAV)).toBe(true);
  });

  it('is not offered once the menu holds one, at the top level or nested in a group', () => {
    expect(aiChatOffered([...served, ASK], served, NAV)).toBe(false);
    const nested = insertEntry(served, 'sales', 0, ASK);
    expect(aiChatOffered(nested, served, NAV)).toBe(false);
    // The spec's own rule refuses the second one the picker would have added.
    const second = entryFor('aiChat', 'Ask again', 'nav_item_9');
    const verdict = AppSchema.safeParse({ name: 'crm', label: 'CRM', navigation: [...nested, second] });
    expect(verdict.success).toBe(false);
    expect(verdict.error!.issues.map((issue) => issue.path.join('.'))).toContain('navigation.2');
  });

  it('is not offered when the stored menu holds one the reader was not shown, which the save keeps', () => {
    const stored = [...NAV, { ...ASK, requiredPermissions: ['ai.use'] }];
    expect(aiChatOffered(served, served, stored)).toBe(false);
  });

  it('is offered again once the shown entry is removed in the mode, since the save removes it too', () => {
    const shown = withEntryIds([...NAV, ASK]);
    expect(aiChatOffered(shown, shown, [...NAV, ASK])).toBe(false);
    const removed = shown.filter((entry) => entry.id !== 'ask');
    expect(aiChatOffered(removed, shown, [...NAV, ASK])).toBe(true);
  });

  it('is not offered while the stored menu is still being read', () => {
    expect(aiChatOffered(served, served, undefined)).toBe(false);
  });
});

describe('the AI inquiry form refuses what AiChatNavParamsSchema refuses (objectstack#37832)', () => {
  const refused: Array<[string, Partial<AiChatForm>, string]> = [
    ['a heading over 60 characters', { title: 'x'.repeat(61) }, 'title'],
    ['a subtitle over 200 characters', { subtitle: 'x'.repeat(201) }, 'subtitle'],
    ['a hint over 100 characters', { placeholder: 'x'.repeat(101) }, 'placeholder'],
    ['five suggested questions', { suggestions: 'a\nb\nc\nd\ne' }, 'suggestions'],
    ['a suggested question over 100 characters', { suggestions: `fine\n${'x'.repeat(101)}` }, 'suggestions'],
  ];
  it.each(refused)('refuses %s, under its field, as the schema does', (_what, patch, field) => {
    const verdict = aiChatParamsOf({ ...EMPTY, ...patch });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.issues.map((issue) => issue.field)).toEqual([field]);
    expect(verdict.issues[0]).toMatchObject({ code: 'too_big' });
    // The same copy, given to the schema directly, is refused there too.
    const raw = { ...patch, ...(patch.suggestions ? { suggestions: patch.suggestions.split('\n') } : {}) };
    expect(AiChatNavParamsSchema.safeParse(raw).success).toBe(false);
  });

  it('takes copy at each bound, trimmed, the empty lines of the suggestions dropped', () => {
    const verdict = aiChatParamsOf({
      title: ` ${'t'.repeat(60)} `,
      subtitle: 's'.repeat(200),
      placeholder: 'p'.repeat(100),
      suggestions: 'one\n\n  two  \nthree\nfour\n',
    });
    expect(verdict).toEqual({
      ok: true,
      params: { title: 't'.repeat(60), subtitle: 's'.repeat(200), placeholder: 'p'.repeat(100), suggestions: ['one', 'two', 'three', 'four'] },
    });
    expect(AiChatNavParamsSchema.safeParse(verdict.ok && verdict.params).success).toBe(true);
  });

  it('writes no params when every field is empty, so the page draws its default copy', () => {
    expect(aiChatParamsOf({ ...EMPTY, title: '   ', suggestions: '\n \n' })).toEqual({ ok: true, params: undefined });
  });

  it('fills the form from a record the schema takes, and from nothing else', () => {
    expect(aiChatFormOf({ title: 'Ask', suggestions: ['a', 'b'] })).toEqual({ ...EMPTY, title: 'Ask', suggestions: 'a\nb' });
    expect(aiChatFormOf({ heading: 'Ask' })).toEqual(EMPTY);
    expect(aiChatFormOf(undefined)).toEqual(EMPTY);
  });
});

describe('「Set as home」 reorders only (objectstack#37832)', () => {
  it('moves the entry to the first place of the top level, out of its group, everything else kept', () => {
    const menu = withEntryIds(insertEntry(NAV, 'sales', 1, ASK));
    expect(canBeHome(menu, 'ask')).toBe(true);
    const home = asHome(menu, 'ask');
    expect(home.map((entry) => entry.id)).toEqual(['ask', 'home', 'sales']);
    expect(home[0]).toBe(entryOf(menu, 'ask'));
    expect((home[2].children as Menu).map((entry) => entry.id)).toEqual(['accounts']);
    expect(canBeHome(home, 'ask')).toBe(false);
  });

  it('saves the new order and writes no `landing` key', async () => {
    const stored = [...NAV, ASK];
    const served = withEntryIds(stored);
    const { d, calls } = doors(stored, true);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation: asHome(served, 'ask') }, TEXTS, d);
    const app = savedApp(calls);
    expect(Object.keys(app).sort()).toEqual(['label', 'name', 'navigation']);
    expect((app.navigation as Menu).map((entry) => entry.id)).toEqual(['ask', 'home', 'sales']);
    expect(JSON.stringify(calls)).not.toContain('landing');
  });
});

describe('saving the AI inquiry entry (objectstack#37832)', () => {
  it('on an installed app, goes into its customization package and is published for everyone', async () => {
    const served = withEntryIds(NAV);
    const entry = entryFor('aiChat', 'Ask AI', 'nav_item_1', undefined, { title: 'Ask about our policies' });
    const { d, calls } = doors(NAV, false);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation: insertEntry(served, null, 2, entry) }, TEXTS, d);
    expect(calls.map(([c]) => c)).toEqual(['layered', 'ensure', 'save', 'publish']);
    expect(calls[2][4]).toEqual({ mode: 'draft', packageId: 'com.acme.crm.custom', ifNoneMatch: '*' });
    expect(calls[3]).toEqual(['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom' }]);
    const app = savedApp(calls);
    expect(app.overrides).toEqual({ package: 'com.acme.crm', basedOn: '6.5.0' });
    const saved = (app.navigation as Menu)[2];
    // Who sees it is left to Studio: the entry carries no audience, so everyone sees it.
    expect(saved).toEqual(entry);
    expect(saved).not.toHaveProperty('visible');
    expect(saved).not.toHaveProperty('requiredPermissions');
    const { overrides: _overrides, ...doc } = app;
    expect(AppSchema.safeParse(doc).success).toBe(true);
  });
});
