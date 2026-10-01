// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateObject` localizes an object's EMBEDDED `listViews` from the
 * catalog keys `os i18n extract` already writes for them —
 * `objects.<object>._views.<listViews key>.{label, description, bulkActions.*}`
 * (`pushViewEntries` in `packages/cli/src/utils/i18n-extract.ts`, called with
 * the record key) — and lets an explicit override beat that catalog by the
 * same comparison `translateView` applies to a served view document
 * (ADR-0029 D9.2a).
 *
 * Before this, the extractor wrote those keys and every shipped platform bundle
 * carried them (`sys_account._views.mine.label` → `我的链接`), while the served
 * object document kept the authored `My Links`: extract and serve disagreed,
 * and only a client re-translating with its own bundle showed the tab in the
 * reader's language.
 *
 * The fixture is `sys_account` as `@objectstack/platform-objects` ships it
 * (`identity/sys-account.object.ts`), its three list views transcribed with
 * the copy the catalog addresses, and the bundle carries the shipped `en` /
 * `zh-CN` `_views` leaves verbatim. Both are PARSED by the authoring schemas,
 * so a view address or catalog key either schema does not carry cannot pass
 * here. `spec` cannot import `platform-objects` (the dependency runs the other
 * way), which is why the shape is transcribed rather than imported.
 */

import { describe, it, expect } from 'vitest';
import { translateObject, translateMetadataDocument } from './i18n-resolver';
import { TranslationBundleSchema, type TranslationBundle } from './translation.zod';
import { ObjectListViewSchema } from '../ui/view.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** One embedded list view, parsed by the schema `ObjectSchema.listViews` uses. */
const view = (raw: Record<string, unknown>): any => ObjectListViewSchema.parse(raw);

/** `sys_account` as the package ships it — the PACKAGED base. */
const PACKAGED: any = {
  name: 'sys_account',
  label: 'Account',
  listViews: {
    mine: view({
      type: 'grid',
      name: 'mine',
      label: 'My Links',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'account_id', 'created_at', 'updated_at'],
    }),
    by_provider: view({
      type: 'grid',
      name: 'by_provider',
      label: 'By Provider',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'user_id', 'account_id', 'created_at'],
    }),
    all_links: view({
      type: 'grid',
      name: 'all_links',
      label: 'All',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id', 'user_id', 'account_id', 'created_at', 'updated_at'],
    }),
  },
};

/**
 * The shipped `_views` leaves (`en.objects.generated.ts` /
 * `zh-CN.objects.generated.ts`). `en` repeats the authored strings, which is
 * what extract writes for the source locale — and exactly as able to overwrite
 * an edit as a translation is.
 */
const BUNDLE: TranslationBundle = TranslationBundleSchema.parse({
  en: {
    objects: {
      sys_account: {
        label: 'Account',
        _views: { mine: { label: 'My Links' }, by_provider: { label: 'By Provider' }, all_links: { label: 'All' } },
      },
    },
  },
  'zh-CN': {
    objects: {
      sys_account: {
        label: '身份链接',
        _views: { mine: { label: '我的链接' }, by_provider: { label: '按提供方' }, all_links: { label: '全部' } },
      },
    },
  },
});

const zh = (doc: any, packagedBase?: unknown): any =>
  translateObject(doc, BUNDLE, { locale: 'zh-CN', packagedBase });

describe('translateObject — embedded listViews read the `_views` keys the extractor writes', () => {
  it("serves sys_account's `mine` tab translated in zh-CN — and every sibling tab", () => {
    const out = zh(clone(PACKAGED), PACKAGED);
    expect(out.listViews.mine.label).toBe('我的链接');
    expect(out.listViews.by_provider.label).toBe('按提供方');
    expect(out.listViews.all_links.label).toBe('全部');
    // The object's own label was already translated; it still is.
    expect(out.label).toBe('身份链接');
  });

  it('serves the same tabs with no packaged base known (the pre-override answer: the catalog applies)', () => {
    expect(zh(clone(PACKAGED)).listViews.mine.label).toBe('我的链接');
  });

  it('keys on the listViews RECORD key — the extractor\'s key — never on the view\'s own `name`', () => {
    // `pushViewEntries` is handed the record key (`Object.entries(obj.listViews)`),
    // so that is the one address a translation exists under. A view whose
    // optional `name` says something else is still the tab under its key.
    const doc = clone(PACKAGED);
    doc.listViews.mine.name = 'my_accounts';
    expect(zh(doc, PACKAGED).listViews.mine.label).toBe('我的链接');
  });

  it('the control — a view with no catalog entry keeps its authored label', () => {
    const doc = clone(PACKAGED);
    doc.listViews.recent = view({
      type: 'grid',
      label: 'Recently Linked',
      data: { provider: 'object', object: 'sys_account' },
      columns: ['provider_id'],
    });
    const out = zh(doc);
    expect(out.listViews.recent.label).toBe('Recently Linked');
    // …and the tabs that DO have entries are translated beside it.
    expect(out.listViews.mine.label).toBe('我的链接');
  });

  it('the control — an object whose catalog carries no `_views` hands back the very same listViews', () => {
    const doc = { ...clone(PACKAGED), name: 'sys_untranslated' };
    const out = translateObject(doc, BUNDLE, { locale: 'zh-CN' }) as any;
    expect(out.listViews).toBe(doc.listViews);
    expect(out.listViews.mine.label).toBe('My Links');
  });

  it('no bundle at all hands back the very same listViews', () => {
    const doc = clone(PACKAGED);
    expect((translateObject(doc, undefined, { locale: 'zh-CN' }) as any).listViews).toBe(doc.listViews);
  });

  it('an object with no listViews gains none', () => {
    const doc = { name: 'sys_account', label: 'Account' };
    expect('listViews' in translateObject(doc, BUNDLE, { locale: 'zh-CN' })).toBe(false);
  });

  it('walks the request locale the same way every other resolver does (BCP-47 base language)', () => {
    expect(translateObject(clone(PACKAGED), BUNDLE, { locale: 'zh' }).listViews.mine.label).toBe('我的链接');
  });

  it('a request for the default locale answers with the authored label, never a fallback chain entry', () => {
    // The #15711 rule `localeChain` carries: the shared lookup is what makes
    // the embedded tab obey it too.
    const out = translateObject(clone(PACKAGED), BUNDLE, {
      locale: 'fr-FR',
      defaultLocale: 'fr-FR',
      fallbackChain: ['zh-CN'],
    }) as any;
    expect(out.listViews.mine.label).toBe('My Links');
  });

  it('does not mutate either input document', () => {
    const doc = clone(PACKAGED);
    doc.listViews.mine.label = 'My Links (edited)';
    const before = clone(doc);
    const packagedBefore = clone(PACKAGED);
    zh(doc, PACKAGED);
    expect(doc).toEqual(before);
    expect(PACKAGED).toEqual(packagedBefore);
  });

  it('reaches the generic dispatcher — translateMetadataDocument("object") translates the tabs', () => {
    // The REST boundary never calls `translateObject` directly.
    const out = translateMetadataDocument('object', clone(PACKAGED), BUNDLE, { locale: 'zh-CN', packagedBase: PACKAGED });
    expect(out.listViews.mine.label).toBe('我的链接');
  });
});

describe('translateObject — embedded listViews: description and bulk-action copy', () => {
  const WITH_COPY: any = {
    name: 'sys_account',
    listViews: {
      mine: view({
        type: 'grid',
        label: 'My Links',
        description: 'Accounts linked to you',
        data: { provider: 'object', object: 'sys_account' },
        columns: ['provider_id'],
        bulkActionDefs: [
          {
            name: 'mark_reviewed',
            label: 'Mark reviewed',
            operation: 'update',
            patch: { reviewed: true },
            confirmText: 'Mark the selected accounts reviewed?',
            confirmLabel: 'Mark them',
            params: [{ name: 'note', type: 'text', label: 'Note', help: 'Kept in the audit log', placeholder: 'Optional' }],
          },
        ],
      }),
    },
  };

  const COPY_BUNDLE: TranslationBundle = TranslationBundleSchema.parse({
    'zh-CN': {
      objects: {
        sys_account: {
          _views: {
            mine: {
              label: '我的链接',
              description: '与你关联的账户',
              bulkActions: {
                mark_reviewed: {
                  label: '标记已复核',
                  confirmText: '确定将所选账户标记为已复核吗？',
                  confirmLabel: '确认标记',
                  params: { note: { label: '备注', help: '记录在审计日志中', placeholder: '选填' } },
                },
              },
            },
          },
        },
      },
    },
  });

  const translate = (doc: any, packagedBase?: unknown): any =>
    translateObject(doc, COPY_BUNDLE, { locale: 'zh-CN', packagedBase });
  const def = (doc: any) => doc.listViews.mine.bulkActionDefs[0];

  it('translates the description and the bulk-action defs authored ON the embedded view', () => {
    // An embedded view carries its defs on itself — the authored address the
    // extractor reads (`view.bulkActionDefs`) — not under the `config` a served
    // view document nests them in.
    const out = translate(clone(WITH_COPY), WITH_COPY);
    expect(out.listViews.mine.description).toBe('与你关联的账户');
    expect(def(out)).toMatchObject({ label: '标记已复核', confirmText: '确定将所选账户标记为已复核吗？', confirmLabel: '确认标记' });
    expect(def(out).params[0]).toMatchObject({ label: '备注', help: '记录在审计日志中', placeholder: '选填' });
    // Nothing else on the def moved.
    expect(def(out)).toMatchObject({ operation: 'update', patch: { reviewed: true } });
  });

  it('an edited def string beats the catalog; the untouched ones on it stay translated', () => {
    const doc = clone(WITH_COPY);
    def(doc).label = 'Close out';
    def(doc).params[0].help = 'Shown to admins';
    const out = translate(doc, WITH_COPY);
    expect(def(out).label).toBe('Close out');
    expect(def(out).confirmText).toBe('确定将所选账户标记为已复核吗？');
    expect(def(out).params[0].help).toBe('Shown to admins');
    expect(def(out).params[0].label).toBe('备注');
  });

  it('an edited description beats the catalog; the label beside it stays translated', () => {
    const doc = clone(WITH_COPY);
    doc.listViews.mine.description = 'Our accounts';
    const out = translate(doc, WITH_COPY);
    expect(out.listViews.mine.description).toBe('Our accounts');
    expect(out.listViews.mine.label).toBe('我的链接');
  });
});

describe('translateObject — embedded listViews: the catalog loses to an explicit override (ADR-0029 D9.2a)', () => {
  const edited = (label: string) => {
    const doc = clone(PACKAGED);
    doc.listViews.mine.label = label;
    return doc;
  };

  it("an org overlay's edited tab label is served — in zh-CN and in the source locale", () => {
    for (const locale of ['zh-CN', 'en']) {
      const out = translateObject(edited('My Links (edited)'), BUNDLE, { locale, packagedBase: PACKAGED }) as any;
      expect(out.listViews.mine.label, locale).toBe('My Links (edited)');
    }
  });

  it('judges each tab SEPARATELY — the unedited siblings stay translated', () => {
    const out = zh(edited('My Links (edited)'), PACKAGED);
    expect(out.listViews.by_provider.label).toBe('按提供方');
    expect(out.listViews.all_links.label).toBe('全部');
  });

  it('NO packaged base supplied → the catalog applies (unknown is not authored)', () => {
    expect(zh(edited('My Links (edited)')).listViews.mine.label).toBe('我的链接');
    expect(zh(edited('My Links (edited)'), null).listViews.mine.label).toBe('我的链接');
  });

  it('a reset (the served tab equals the packaged one again) restores the translated shipped label', () => {
    expect(zh(edited('My Links (edited)'), PACKAGED).listViews.mine.label).toBe('My Links (edited)');
    expect(zh(clone(PACKAGED), PACKAGED).listViews.mine.label).toBe('我的链接');
  });

  it('the ruled edge — an edit back to exactly the shipped string is a no-op, and a non-string label is never an override', () => {
    expect(zh(edited('My Links'), PACKAGED).listViews.mine.label).toBe('我的链接');
    const map = clone(PACKAGED);
    map.listViews.mine.label = { en: 'Mine', 'zh-CN': '我的' };
    expect(zh(map, PACKAGED).listViews.mine.label).toBe('我的链接');
  });

  it('a tab the package does not ship was authored after the fact and keeps its label', () => {
    // A base that IS known but carries no such view: every string on it
    // diverged, the rule a dashboard widget or a bulk-action def the package
    // never shipped follows. The catalog entry under the same bare key
    // translates some OTHER view and must not reach this one.
    const base = { ...clone(PACKAGED), listViews: { by_provider: PACKAGED.listViews.by_provider } };
    const out = zh(clone(PACKAGED), base);
    expect(out.listViews.mine.label).toBe('My Links');
    expect(out.listViews.by_provider.label).toBe('按提供方');
    // A base with no listViews at all: the same answer for every tab.
    expect(zh(clone(PACKAGED), { name: 'sys_account' }).listViews.mine.label).toBe('My Links');
  });

  it('the object-scalar rule and the tab rule are independent comparisons', () => {
    const doc = edited('My Links (edited)');
    doc.label = 'Linked Identity';
    const out = zh(doc, PACKAGED);
    expect(out.label).toBe('Linked Identity');
    expect(out.listViews.mine.label).toBe('My Links (edited)');
    expect(out.listViews.by_provider.label).toBe('按提供方');
  });
});
