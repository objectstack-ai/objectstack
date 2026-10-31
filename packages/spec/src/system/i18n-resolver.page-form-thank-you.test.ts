// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translatePage` localizes a page `object-form` component's thank-you
 * panel — the `title` and `message` of a `kind: 'thank-you'`
 * `properties.submitBehavior` (`ObjectFormPropsSchema.submitBehavior`, the
 * form view's own member by reference) — through
 * `pages.<page>.components.<id>.submitBehavior.{title,message}`, addressed by
 * the form component's own id and applied by the same function, and so the
 * same rules, as a form view's panel.
 *
 * Before this, the panel had no translation key at all: the strict
 * `components.<id>` entry declared no `submitBehavior`, and `translatePage`
 * never read one. A page that embeds a thank-you form confirmed the submit in
 * the authoring language on a translated page.
 *
 * The page and the bundle node are PARSED by the authoring schemas, so an
 * address neither schema carries cannot pass.
 */

import { describe, it, expect } from 'vitest';
import { translatePage, translateMetadataDocument } from './i18n-resolver';
import { TranslationDataSchema, type TranslationBundle } from './translation.zod';
import { PageSchema } from '../ui/page.zod';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const PAGE = {
  name: 'project_wizard',
  label: 'New Project',
  type: 'app' as const,
  regions: [
    {
      name: 'main',
      components: [
        {
          id: 'project_form',
          type: 'object-form',
          properties: {
            objectName: 'project',
            mode: 'create',
            title: 'Create a Project',
            submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Your project is ready.' },
          },
        },
        // Authors a title and no message: the bundle's message must not invent one.
        {
          id: 'title_only_form',
          type: 'object-form',
          properties: { objectName: 'project', submitBehavior: { kind: 'thank-you', title: 'Got it' } },
        },
        // Not a thank-you panel: its keys translate nothing.
        {
          id: 'redirect_form',
          type: 'object-form',
          properties: { objectName: 'project', submitBehavior: { kind: 'redirect', url: '/projects' } },
        },
        // Authors a panel the bundle carries no key for.
        {
          id: 'referral_form',
          type: 'object-form',
          properties: { objectName: 'project', submitBehavior: { kind: 'thank-you', title: 'Referral sent' } },
        },
        // Not an `object-form`: a `submitBehavior` key under its id is not a panel's.
        {
          id: 'summary_card',
          type: 'page:card',
          properties: { title: 'Summary' },
        },
        // Nested in a container: reached by the id route.
        {
          id: 'side_card',
          type: 'page:card',
          properties: {
            title: 'Quick add',
            children: [
              {
                id: 'quick_form',
                type: 'object-form',
                properties: { objectName: 'project', submitBehavior: { kind: 'thank-you', title: 'Added' } },
              },
            ],
          },
        },
      ],
    },
  ],
};

const PAGE_ZH = {
  components: {
    project_form: {
      title: '创建项目',
      submitBehavior: { title: '项目已创建', message: '您的项目已就绪。' },
    },
    title_only_form: { submitBehavior: { title: '收到', message: 'MUST-NOT-APPLY' } },
    redirect_form: { submitBehavior: { title: 'MUST-NOT-APPLY', message: 'MUST-NOT-APPLY' } },
    summary_card: { submitBehavior: { title: 'MUST-NOT-APPLY' } },
    quick_form: { submitBehavior: { title: '已添加' } },
  },
};
const PAGE_EN = { components: { project_form: { submitBehavior: { title: 'Project created' } } } };

const BUNDLE: TranslationBundle = {
  en: { pages: { project_wizard: PAGE_EN } } as any,
  'zh-CN': { pages: { project_wizard: PAGE_ZH } } as any,
};

const components = (page: any): any[] => page.regions[0].components;
const byId = (page: any, id: string): any => {
  const found = components(page).find((c) => c.id === id)
    ?? components(page).flatMap((c) => c.properties?.children ?? []).find((c: any) => c.id === id);
  if (!found) throw new Error(`fixture missing ${id}`);
  return found;
};

describe("translatePage — an `object-form`'s thank-you panel, keyed `components.<id>.submitBehavior`", () => {
  it('composes the identity this test is pinned to — legal fixtures, the panel lives under `properties`', () => {
    const page = PageSchema.safeParse(PAGE);
    expect(page.success, JSON.stringify(page.error?.issues)).toBe(true);
    for (const node of [PAGE_ZH, PAGE_EN]) {
      const parsed = TranslationDataSchema.safeParse({ pages: { project_wizard: node } });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('a zh-CN pack yields the translated panel title and message', () => {
    const out = translateMetadataDocument('page', clone(PAGE), BUNDLE, { locale: 'zh-CN' });
    expect(byId(out, 'project_form').properties.submitBehavior)
      .toEqual({ kind: 'thank-you', title: '项目已创建', message: '您的项目已就绪。' });
    // The form's own heading is translated beside it, from its own key.
    expect(byId(out, 'project_form').properties.title).toBe('创建项目');
    // A form nested in a container is reached by the same id route.
    expect(byId(out, 'quick_form').properties.submitBehavior).toEqual({ kind: 'thank-you', title: '已添加' });
  });

  it('a locale the bundle lacks reads the declared fallback chain — ja-JP over `[zh-CN]`', () => {
    const out = translatePage(clone(PAGE), BUNDLE, { locale: 'ja-JP', fallbackChain: ['zh-CN'] });
    expect(byId(out, 'project_form').properties.submitBehavior.title).toBe('项目已创建');
    expect(byId(out, 'project_form').properties.submitBehavior.message).toBe('您的项目已就绪。');
  });

  it('a missing key yields the authored panel', () => {
    const out = translatePage(clone(PAGE), BUNDLE, { locale: 'zh-CN' });
    expect(byId(out, 'referral_form').properties.submitBehavior).toEqual({ kind: 'thank-you', title: 'Referral sent' });
  });

  it('CONTROL: a panel that authors no message gains none — the bundle key does not invent one', () => {
    const out = translatePage(clone(PAGE), BUNDLE, { locale: 'zh-CN' });
    const behavior = byId(out, 'title_only_form').properties.submitBehavior;
    expect(behavior).toEqual({ kind: 'thank-you', title: '收到' });
    expect('message' in behavior).toBe(false);
  });

  it('CONTROL: a `redirect` behavior is not a panel — its keys translate nothing and the component is kept', () => {
    const doc = clone(PAGE);
    const out = translatePage(doc, BUNDLE, { locale: 'zh-CN' });
    expect(byId(out, 'redirect_form')).toEqual(byId(doc, 'redirect_form'));
    expect(byId(out, 'redirect_form').properties.submitBehavior).toEqual({ kind: 'redirect', url: '/projects' });
  });

  it("CONTROL: a key under another component's id does not reach the form, and a non-form component gains no panel", () => {
    const elsewhere: TranslationBundle = {
      'zh-CN': { pages: { project_wizard: { components: { referral_form: { submitBehavior: { title: '项目已创建' } } } } } } as any,
    };
    const out = translatePage(clone(PAGE), elsewhere, { locale: 'zh-CN' });
    expect(byId(out, 'project_form').properties.submitBehavior.title).toBe('Project created');
    const card = byId(translatePage(clone(PAGE), BUNDLE, { locale: 'zh-CN' }), 'summary_card');
    expect('submitBehavior' in card.properties).toBe(false);
  });

  it("CONTROL: the panel title key does not reach the component's title, and the title key does not reach the panel", () => {
    const titleOnly: TranslationBundle = {
      'zh-CN': { pages: { project_wizard: { components: { project_form: { title: '创建项目' } } } } } as any,
    };
    const viaTitle = byId(translatePage(clone(PAGE), titleOnly, { locale: 'zh-CN' }), 'project_form');
    expect(viaTitle.properties.title).toBe('创建项目');
    expect(viaTitle.properties.submitBehavior.title).toBe('Project created');
    const panelOnly: TranslationBundle = {
      'zh-CN': { pages: { project_wizard: { components: { project_form: { submitBehavior: { title: '项目已创建' } } } } } } as any,
    };
    const viaPanel = byId(translatePage(clone(PAGE), panelOnly, { locale: 'zh-CN' }), 'project_form');
    expect(viaPanel.properties.title).toBe('Create a Project');
    expect(viaPanel.properties.submitBehavior.title).toBe('项目已创建');
  });

  it('CONTROL: an `object-form` without an id has no key', () => {
    const anonymous = clone(PAGE);
    delete (components(anonymous)[0] as any).id;
    const out = translatePage(anonymous, BUNDLE, { locale: 'zh-CN' });
    expect(components(out)[0].properties.submitBehavior.title).toBe('Project created');
  });

  it('the page document is not mutated', () => {
    const doc = clone(PAGE);
    translatePage(doc, BUNDLE, { locale: 'zh-CN' });
    expect(byId(doc, 'project_form').properties.submitBehavior).toEqual(PAGE.regions[0].components[0].properties.submitBehavior);
  });
});

describe('the `pages.<page>.components.<id>.submitBehavior` translation face', () => {
  const issuesOf = (node: unknown) => {
    const parsed = TranslationDataSchema.safeParse({ pages: { project_wizard: { components: { project_form: node } } } });
    return parsed.success ? [] : parsed.error.issues;
  };

  it('carries the thank-you `title` and `message` and nothing else', () => {
    expect(issuesOf({ submitBehavior: { title: '项目已创建', message: '您的项目已就绪。' } })).toEqual([]);
    const [issue] = issuesOf({ submitBehavior: { title: '项目已创建', url: '/zh/projects' } });
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.path).toEqual(['pages', 'project_wizard', 'components', 'project_form', 'submitBehavior']);
  });

  it('refuses a copied `kind` with a prescription naming the two translatable strings', () => {
    const [issue] = issuesOf({ submitBehavior: { kind: 'thank-you', title: '项目已创建' } });
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('`title` and `message`');
  });
});
