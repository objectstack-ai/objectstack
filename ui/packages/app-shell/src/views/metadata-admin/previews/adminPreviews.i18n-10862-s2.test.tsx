// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 2 — the admin previews under zh-CN.
 *
 * `AppPreview`, `BookPreview`, `DatasourcePreview`, `EmailTemplatePreview`,
 * `PermissionPreview`, `PositionPreview` and `TranslationPreview` never read
 * the designer `t`: every word of their own rendered in English beside a
 * Chinese designer. Each now reads its `engine.*` rows in the `locale` its host
 * hands it (`ResourceEditPage`, `EmbeddedItemEditor` and `StudioDesignSurface`
 * pass `useMetadataLocale()` as the preview's `locale`).
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The slice-1 harness (`automationPreviews.i18n-10862.test.tsx`): every case
 * mounts the REAL preview under the i18n provider in its language and reads
 * what it rendered. A site is one designer word on the mount: an element's
 * whole text, a `title`, an `aria-label` or an input's `placeholder`. Each zh
 * expectation is read back from the catalogue and guarded by `zhRow`, so no
 * case passes on a missing row and none restates a translation. Each en case
 * reads the en row through `t` / `tFormat` for `en-US` rather than pin the
 * wording, so it is the control that the en row renders what the literal
 * rendered. A row with a code span in it (`{navigation}`, `{include}`, …) is
 * read with that hole filled by the code span's text.
 *
 * ── Left as written on purpose ───────────────────────────────────────────────
 * Author data (labels, names, doc names, config keys and values, variable
 * names, object and field names, the bundle's own locale), identifiers (nav
 * kinds, tab visibility values, access-scope tokens, the C / R / U / D column
 * letters, `SSL`) and notation (`∅`, `#1`) read the same in every locale; the
 * cases check a sample of each on the same mount.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

import { t, tFormat } from '../i18n';
import { AppPreview } from './AppPreview';
import { BookPreview } from './BookPreview';
import { DatasourcePreview } from './DatasourcePreview';
import { EmailTemplatePreview } from './EmailTemplatePreview';
import { PermissionPreview } from './PermissionPreview';
import { PositionPreview } from './PositionPreview';
import { TranslationPreview } from './TranslationPreview';

afterEach(cleanup);

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** The row `key` in `lang`, formatted with `vars`. */
function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/** One designer word on the mount, and the row it reads. */
interface Site {
  key: string;
  vars?: Vars;
  /** Where the row lands: an element's whole text (default), a `title`, an `aria-label` or a `placeholder`. */
  in?: 'text' | 'title' | 'aria-label' | 'placeholder';
  /** The element's whole text around the row, when the row is not all of it. */
  around?: (row: string) => string;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Whether some element on the page renders `text` in `where`. */
function rendered(where: NonNullable<Site['in']>, text: string): boolean {
  const els = Array.from(document.body.querySelectorAll<Element>('*'));
  if (where === 'text') return els.some((el) => norm(el.textContent) === text);
  return els.some((el) => el.getAttribute(where) === text);
}

/** The sites the mount does NOT render in `lang`, each with the text it was expected to show. */
function unrendered(lang: Lang, sites: Site[]): string[] {
  return sites
    .map((s) => {
      const r = row(lang, s.key, s.vars);
      const text = norm(s.around ? s.around(r) : r);
      return rendered(s.in ?? 'text', text) ? null : `${s.key} (${s.in ?? 'text'}): ${JSON.stringify(text)}`;
    })
    .filter((x): x is string => x !== null);
}

/** Every site renders its row in `lang`; under zh, every row is a real zh row. */
function expectSites(lang: Lang, sites: Site[]) {
  expect(unrendered(lang, sites)).toEqual([]);
  if (lang === 'zh') for (const s of sites) zhRow(s.key);
}

/** Author data, identifiers and notation: the same bytes in every locale. */
function expectAsWritten(texts: string[]) {
  expect(texts.filter((x) => !rendered('text', x))).toEqual([]);
}

// ─── AppPreview ──────────────────────────────────────────────────────────────

const APP_DRAFT = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' },
    { id: 'more', type: 'group', label: '', children: [{ id: 'home', type: 'page', label: 'Start', pageName: 'start' }] },
    { id: 'loose', label: 'Loose' },
  ],
};

describe('AppPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: the header, the nav rows and their tooltips`, () => {
      inLang(lang, <AppPreview type="app" name="crm" draft={APP_DRAFT} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.appPreview.openTitle', in: 'title' },
        { key: 'engine.appPreview.open' },
        { key: 'engine.appPreview.homeFirst', around: (r) => `${r}→ Accounts` },
        { key: 'engine.appPreview.unnamed' },
        { key: 'engine.appPreview.noType' },
        { key: 'engine.appPreview.noTypeTitle', in: 'title' },
      ]);
      expectAsWritten(['CRM', 'Accounts', 'Start', 'Loose', 'object', 'group', 'account']);
    });

    it(`${lang}: an app with no navigation`, () => {
      inLang(lang, <AppPreview type="app" name="crm" draft={{ name: 'crm' }} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.appPreview.homeNone' },
        { key: 'engine.appPreview.empty', vars: { navigation: 'navigation' } },
      ]);
    });
  }
});

// ─── BookPreview ─────────────────────────────────────────────────────────────

const BOOK_DRAFT = {
  name: 'crm_guide',
  label: 'CRM Guide',
  audience: { permissionSet: 'docs_readers' },
  groups: [
    { key: 'intro', label: 'Intro', order: 1, include: 'crm_guide_*', package: 'crm' },
    { key: 'faq', label: 'FAQ', include: { tag: 'faq' } },
    { key: 'picked', label: 'Picked', pages: ['---', '...', 'doc_a', {}] },
    { key: 'orphan', label: 'Orphan' },
    { label: 'Keyless', include: 'x_*' },
  ],
};

describe('BookPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an unnamed book`, () => {
      inLang(lang, <BookPreview type="book" name="" draft={{}} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.bookPreview.nameTitle' }, { key: 'engine.bookPreview.nameDescription' }]);
    });

    it(`${lang}: a book with no groups`, () => {
      inLang(lang, <BookPreview type="book" name="" draft={{ name: 'crm_guide', slug: 'crm-guide' }} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.bookPreview.treeTitle', in: 'title' },
        { key: 'engine.bookPreview.tree' },
        { key: 'engine.bookPreview.audience.org' },
        { key: 'engine.bookPreview.slug', vars: { slug: 'crm-guide' } },
        { key: 'engine.bookPreview.noGroups' },
        {
          key: 'engine.bookPreview.noGroupsDescription',
          vars: { groups: 'groups', include: 'include', glob: 'crm_guide_*', tag: '{ tag }' },
        },
      ]);
      expectAsWritten(['crm-guide']);
    });

    it(`${lang}: a book whose groups use every membership form`, () => {
      inLang(lang, <BookPreview type="book" name="" draft={BOOK_DRAFT} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.bookPreview.audience.permissionSet', vars: { name: 'docs_readers' } },
        { key: 'engine.bookPreview.orderTitle', in: 'title' },
        { key: 'engine.bookPreview.packageTitle', in: 'title' },
        { key: 'engine.bookPreview.globTitle', in: 'title' },
        { key: 'engine.bookPreview.tagTitle', in: 'title' },
        { key: 'engine.bookPreview.derived' },
        { key: 'engine.bookPreview.curatedTitle', in: 'title' },
        { key: 'engine.bookPreview.curated' },
        { key: 'engine.bookPreview.separator' },
        { key: 'engine.bookPreview.rest' },
        { key: 'engine.bookPreview.emptyPage' },
        {
          key: 'engine.bookPreview.noRule',
          vars: { include: 'include', pages: 'pages', group: 'group: "orphan"' },
        },
        { key: 'engine.bookPreview.noKey' },
      ]);
      expectAsWritten(['CRM Guide', 'Intro', 'intro', '#1', 'crm', 'crm_guide_*', 'faq', 'doc_a', 'Keyless']);
    });

    it(`${lang}: a public book`, () => {
      inLang(lang, <BookPreview type="book" name="" draft={{ name: 'crm_guide', audience: 'public' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.bookPreview.audience.public' }]);
    });
  }
});

// ─── DatasourcePreview ───────────────────────────────────────────────────────

const DATASOURCE_DRAFT = {
  name: 'warehouse',
  label: 'Warehouse',
  driver: 'postgres',
  active: false,
  config: { host: 'db.internal', password: 'hunter2', options: { a: 1, b: 2 } },
  pool: { max: 5, idle: { ms: 1000 } },
};

describe('DatasourcePreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an empty draft`, () => {
      inLang(lang, <DatasourcePreview type="datasource" name="" draft={{}} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.datasourcePreview.empty' }]);
    });

    it(`${lang}: a configured datasource`, () => {
      inLang(lang, <DatasourcePreview type="datasource" name="warehouse" draft={DATASOURCE_DRAFT} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.datasourcePreview.disabled' },
        { key: 'engine.datasourcePreview.connection' },
        { key: 'engine.datasourcePreview.redacted' },
        { key: 'engine.datasourcePreview.keyCount', vars: { count: 2 } },
        { key: 'engine.datasourcePreview.pool' },
        { key: 'engine.datasourcePreview.keyCount', vars: { count: 1 } },
        { key: 'engine.datasourcePreview.notConfigured' },
      ]);
      expectAsWritten(['Warehouse', 'postgres', 'host', 'db.internal', '••••••', 'SSL']);
    });

    it(`${lang}: a named datasource with no driver and no config`, () => {
      inLang(lang, <DatasourcePreview type="datasource" name="scratch" draft={{ name: 'scratch' }} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.datasourcePreview.unknownDriver' },
        { key: 'engine.datasourcePreview.active' },
        { key: 'engine.datasourcePreview.noConfig' },
      ]);
    });
  }
});

// ─── EmailTemplatePreview ────────────────────────────────────────────────────

/** The iframe's `srcdoc` — the sandboxed body the author sees. */
function srcDoc(): string {
  return document.body.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
}

describe('EmailTemplatePreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an empty template`, () => {
      inLang(lang, <EmailTemplatePreview type="email_template" name="" draft={{}} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.emailTemplatePreview.empty' }]);
    });

    it(`${lang}: a subject-only template with a variable`, () => {
      const draft = { subject: 'Hi {{first_name}}', from: 'team@example.com' };
      inLang(lang, <EmailTemplatePreview type="email_template" name="" draft={draft} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.emailTemplatePreview.from' },
        { key: 'engine.emailTemplatePreview.to' },
        { key: 'engine.emailTemplatePreview.subject' },
        { key: 'engine.emailTemplatePreview.frameTitle', in: 'title' },
        { key: 'engine.emailTemplatePreview.variables' },
        { key: 'engine.emailTemplatePreview.samplePlaceholder', vars: { name: 'first_name' }, in: 'placeholder' },
      ]);
      // The sandboxed body: the empty-body note is the designer's own word too.
      const emptyBody = row(lang, 'engine.emailTemplatePreview.emptyBody');
      expect(srcDoc()).toContain(`<p style="color:#888">${emptyBody}</p>`);
      if (lang === 'zh') zhRow('engine.emailTemplatePreview.emptyBody');
      expectAsWritten(['team@example.com', 'Hi', 'first_name']);
    });

    it(`${lang}: a body with no variables`, () => {
      const draft = { subject: 'Hello', bodyHtml: '<p>Welcome</p>' };
      inLang(lang, <EmailTemplatePreview type="email_template" name="" draft={draft} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.emailTemplatePreview.noVariables', vars: { var: '{{var}}' } }]);
      expect(srcDoc()).toContain('<p>Welcome</p>');
    });
  }
});

// ─── PermissionPreview ───────────────────────────────────────────────────────

const PERMISSION_DRAFT = {
  name: 'sales',
  label: 'Sales',
  isDefault: true,
  objects: {
    account: {
      allowEdit: true,
      allowDelete: true,
      modifyAllRecords: true,
      readScope: 'own',
      writeScope: 'unit',
    },
    contact: { allowRead: true },
  },
  fields: {
    'account.secret': { readable: false },
    'account.notes': { readable: true, editable: true },
  },
  systemPermissions: ['manage_users'],
  tabPermissions: { account: 'visible' },
  rowLevelSecurity: [{ name: 'own_rows' }],
};

describe('PermissionPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an empty permission set`, () => {
      inLang(lang, <PermissionPreview type="permission" name="p" draft={{ name: 'p' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.permissionPreview.empty' }]);
    });

    it(`${lang}: the matrix, its legend and the sanity checks`, () => {
      inLang(lang, <PermissionPreview type="permission" name="sales" draft={PERMISSION_DRAFT} locale={LOCALE[lang]} />);
      const warn = (key: string, vars?: Vars): Site => ({ key, vars, around: (r) => `account: ${r}` });
      expectSites(lang, [
        { key: 'engine.permissionPreview.kind.default' },
        { key: 'engine.permissionPreview.pill.objects', vars: { count: 2 } },
        { key: 'engine.permissionPreview.pill.systemPerms', vars: { count: 1 } },
        { key: 'engine.permissionPreview.pill.tabs', vars: { count: 1 } },
        { key: 'engine.permissionPreview.pill.rls', vars: { count: 1 } },
        { key: 'engine.permissionPreview.section.objects' },
        { key: 'engine.permissionPreview.section.fields' },
        { key: 'engine.permissionPreview.section.system' },
        { key: 'engine.permissionPreview.section.tabs' },
        { key: 'engine.permissionPreview.col.object' },
        { key: 'engine.permissionPreview.cap.create', in: 'title' },
        { key: 'engine.permissionPreview.cap.read', in: 'title' },
        { key: 'engine.permissionPreview.cap.edit', in: 'title' },
        { key: 'engine.permissionPreview.cap.delete', in: 'title' },
        { key: 'engine.permissionPreview.cap.export', in: 'title' },
        { key: 'engine.permissionPreview.cap.transfer', in: 'title' },
        { key: 'engine.permissionPreview.cap.viewAll', in: 'title' },
        { key: 'engine.permissionPreview.cap.modifyAll', in: 'title' },
        { key: 'engine.permissionPreview.col.scopeTitle', in: 'title' },
        { key: 'engine.permissionPreview.col.scope' },
        { key: 'engine.permissionPreview.readScope', in: 'title' },
        { key: 'engine.permissionPreview.writeScope', in: 'title' },
        { key: 'engine.permissionPreview.scopeDefault' },
        { key: 'engine.permissionPreview.fls.hidden' },
        { key: 'engine.permissionPreview.fls.editable' },
        { key: 'engine.permissionPreview.sanityOther', vars: { count: 4 } },
        warn('engine.permissionPreview.warn.editWithoutRead'),
        warn('engine.permissionPreview.warn.deleteWithoutRead'),
        warn('engine.permissionPreview.warn.modifyAllWithoutViewAll'),
        warn('engine.permissionPreview.warn.writeWiderThanRead', { write: 'unit', read: 'own' }),
        { key: 'engine.permissionPreview.granted', in: 'aria-label' },
        { key: 'engine.permissionPreview.notGranted', in: 'aria-label' },
        { key: 'engine.permissionPreview.granted' },
        { key: 'engine.permissionPreview.notGranted' },
        { key: 'engine.permissionPreview.legend.bypass' },
        { key: 'engine.permissionPreview.legend.key' },
      ]);
      expectAsWritten(['Sales', 'sales', 'account', 'contact', 'secret', 'notes', 'manage_users', 'visible', 'C', 'V*', 'own', 'unit']);
    });

    it(`${lang}: one failed sanity check`, () => {
      const draft = { name: 'p2', objects: { lead: { allowEdit: true } } };
      inLang(lang, <PermissionPreview type="permission" name="p2" draft={draft} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.permissionPreview.kind.set' },
        { key: 'engine.permissionPreview.sanityOne', vars: { count: 1 } },
      ]);
    });
  }
});

// ─── PositionPreview ─────────────────────────────────────────────────────────

describe('PositionPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an unnamed position`, () => {
      inLang(lang, <PositionPreview type="position" name="" draft={{}} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.positionPreview.empty' }]);
    });

    it(`${lang}: the permissions note`, () => {
      const draft = { name: 'sales_rep', label: 'Sales Rep', description: 'Works the pipeline.' };
      inLang(lang, <PositionPreview type="position" name="sales_rep" draft={draft} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.positionPreview.noAccess' },
        { key: 'engine.positionPreview.permissionSets' },
        {
          key: 'engine.positionPreview.bind',
          vars: { name: 'sales_rep', permissionSets: row(lang, 'engine.positionPreview.permissionSets') },
        },
      ]);
      expectAsWritten(['Sales Rep', 'sales_rep', 'Works the pipeline.']);
    });

    // objectui#13304 — a position that declares its sets lists them instead.
    it(`${lang}: the declared permission sets`, () => {
      const draft = { name: 'sales_rep', label: 'Sales Rep', permissionSets: ['sales_user', 'report_viewer'] };
      inLang(lang, <PositionPreview type="position" name="sales_rep" draft={draft} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.positionPreview.permissionSets' },
        {
          key: 'engine.positionPreview.grantsVia',
          vars: { permissionSets: row(lang, 'engine.positionPreview.permissionSets') },
        },
        { key: 'engine.positionPreview.visibility' },
      ]);
      expectAsWritten(['Sales Rep', 'sales_rep', 'sales_user', 'report_viewer']);
    });
  }
});

// ─── TranslationPreview ──────────────────────────────────────────────────────

const TRANSLATION_DRAFT = {
  name: 'fr_bundle',
  label: 'French',
  locale: 'fr-FR',
  data: {
    objects: { account: { label: 'Compte' } },
    messages: { a: 'Un', b: 'Deux', c: 'Trois', d: 'Quatre', e: 'Cinq', f: 'Six' },
  },
};

describe('TranslationPreview reads the designer locale (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an empty bundle`, () => {
      inLang(lang, <TranslationPreview type="translation" name="" draft={{ locale: 'fr-FR' }} locale={LOCALE[lang]} />);
      expectSites(lang, [{ key: 'engine.translationPreview.empty' }]);
    });

    it(`${lang}: the coverage header and the category cards`, () => {
      inLang(lang, <TranslationPreview type="translation" name="fr_bundle" draft={TRANSLATION_DRAFT} locale={LOCALE[lang]} />);
      expectSites(lang, [
        { key: 'engine.translationPreview.coverage' },
        { key: 'engine.translationPreview.totalKeys', vars: { count: 7 } },
        { key: 'engine.translationPreview.category.objects' },
        { key: 'engine.translationPreview.category.picklists' },
        { key: 'engine.translationPreview.category.apps' },
        { key: 'engine.translationPreview.category.messages' },
        { key: 'engine.translationPreview.category.globalActions' },
        { key: 'engine.translationPreview.category.dashboards' },
        { key: 'engine.translationPreview.category.datasets' },
        { key: 'engine.translationPreview.category.pages' },
        { key: 'engine.translationPreview.category.flows' },
        { key: 'engine.translationPreview.category.metadataForms' },
        { key: 'engine.translationPreview.category.settingsCommon' },
        { key: 'engine.translationPreview.categoryEmpty' },
        { key: 'engine.translationPreview.more', vars: { count: 1 } },
        { key: 'engine.translationPreview.keyCountOne', vars: { count: 1 } },
      ]);
      // The bundle's own locale is author data, not the designer's language.
      expectAsWritten(['French', 'fr-FR', 'account', '"Un"', '2/11 (18%)']);
    });
  }
});
