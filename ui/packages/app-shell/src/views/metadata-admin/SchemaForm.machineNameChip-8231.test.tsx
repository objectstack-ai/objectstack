// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8231 — WHEN the machine-name chip shows no longer depends on the
 * locale.
 *
 * Since objectui#13352 the machine name is no longer drawn inline beside the
 * label: the row shows the label only, and the name is offered on demand as
 * the label's hover tooltip (`title`, mirrored on `data-machine-name`). The
 * #8231 predicate is unchanged — it now decides WHEN that tooltip is offered —
 * so these pins read the `data-machine-name` set instead of `label code`.
 * "Chip" below means that on-demand hint.
 *
 * The chip beside a `SchemaForm` label answers "the label does not already
 * spell the machine name". It used to judge that against the VISIBLE label,
 * which in a localized panel is a translation: `prettify('columns')` can never
 * equal 「列数」, so the Chinese dashboard panel showed a chip beside every
 * field while the English one hid the chip beside the very same fields.
 *
 * Ruling 1 (comment 5749674288): judge the untranslated SOURCE label, which
 * the locale overlay (`metadata-form-i18n.ts`) now carries alongside its
 * translation. These pins read the rendered chip set in BOTH locales and
 * require it to be the same set, through each road a translated label reaches
 * a row: the spec-form overlay, the overlay after `mergeServerFields` grafts
 * server-only fields on, the overlay's synthesized composite children, and
 * the raw-schema label table (`translateSchemaFieldLabel`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaForm } from './SchemaForm';
import { getDashboardForm, getDashboardSchema } from './dashboard-schema';
import { localizeMetadataForm } from './metadata-form-i18n';
import { untranslatedFieldLabel } from './field-source-label';
import { mergeServerFields } from './mergeServerFields';

afterEach(cleanup);

type Language = 'en' | 'zh';

function renderIn(language: Language, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );
}

/** Every machine name a label offers on demand, sorted (objectui#13352). */
function chips(): string[] {
  // Guard: nothing is drawn inline any more, so an inline chip would be a
  // regression of #13352 rather than a hint this set should count.
  expect(document.querySelectorAll('label code')).toHaveLength(0);
  return Array.from(document.querySelectorAll('label[data-machine-name]'))
    .map((el) => el.getAttribute('data-machine-name') ?? '')
    .sort();
}

function chipsFor(language: Language, ui: () => React.ReactElement): string[] {
  renderIn(language, ui());
  const found = chips();
  cleanup();
  return found;
}

/** The four fields objectui#8218 saw chipped all at once in the zh panel. */
const DASHBOARD_LAYOUT_FIELDS = ['columns', 'gap', 'refreshIntervalSeconds', 'header'];

describe('#8231 · the Studio dashboard panel', () => {
  const dashboard = (language: Language) => () => (
    <SchemaForm
      schema={getDashboardSchema() as never}
      form={getDashboardForm(language) as never}
      value={{}}
      onChange={() => {}}
    />
  );

  it.each(['en', 'zh'] as const)('shows no chip beside the layout fields under %s', (language) => {
    renderIn(language, dashboard(language)());
    // Guard: the rows really rendered (and, in zh, really are translated).
    if (language === 'zh') expect(document.body.textContent).toContain('列数');
    for (const name of DASHBOARD_LAYOUT_FIELDS) {
      expect(
        document.querySelector(`[id="mdf-${name}"], [id="mdf-${name}-label"]`),
        `no row for ${name} under ${language}`,
      ).not.toBeNull();
      expect(chips(), `chip beside ${name} under ${language}`).not.toContain(name);
    }
  });

  it('renders the same chip set in both locales', () => {
    expect(chipsFor('zh', dashboard('zh'))).toEqual(chipsFor('en', dashboard('en')));
  });

  it('keeps the source label through mergeServerFields grafting a server-only field', () => {
    const merged = (language: Language) => {
      const bundledSchema = getDashboardSchema() as Record<string, unknown>;
      const { schema, form } = mergeServerFields({
        bundledSchema,
        bundledForm: getDashboardForm(language),
        serverSchema: {
          ...bundledSchema,
          properties: {
            ...(bundledSchema.properties as Record<string, unknown>),
            serverOnlyKnob: { type: 'string' },
          },
        },
        excludeFields: new Set(),
        sectionTitle: 'More fields',
      });
      // Guard: the graft really happened, so the copy path really ran.
      expect(form?.sections?.at(-1)?.label).toBe('More fields');
      return () => (
        <SchemaForm schema={schema as never} form={form as never} value={{}} onChange={() => {}} />
      );
    };
    const zh = chipsFor('zh', merged('zh'));
    expect(zh).not.toContain('columns');
    expect(zh).toEqual(chipsFor('en', merged('en')));
  });
});

describe('#8231 · a source label that does not spell the name', () => {
  const SCHEMA = { type: 'object', properties: { columns: { type: 'integer' } } } as never;
  const SOURCE = {
    type: 'simple',
    sections: [{ label: 'Layout', fields: [{ field: 'columns', type: 'number', label: 'Grid width' }] }],
  };
  const form = (language: Language) => () => (
    <SchemaForm
      schema={SCHEMA}
      form={localizeMetadataForm(SOURCE, 'dashboard', language) as never}
      value={{}}
      onChange={() => {}}
    />
  );

  it('shows the chip in both locales', () => {
    expect(chipsFor('en', form('en'))).toEqual(['columns']);
    expect(chipsFor('zh', form('zh'))).toEqual(['columns']);
  });
});

describe('#8231 · the raw-schema label table', () => {
  // No form: rows are labelled by `translateSchemaFieldLabel`, which turns the
  // schema title "Source" into 「源节点」 under zh.
  const SCHEMA = {
    type: 'object',
    properties: {
      source: { type: 'string', title: 'Source' },
      rls: { type: 'string' },
    },
  } as never;
  const flat = () => <SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} />;

  it('judges the schema title, not its translation', () => {
    renderIn('zh', flat());
    expect(document.body.textContent).toContain('源节点');
    cleanup();
    // `rls` → "Rls" matches its own name, so neither row is chipped — alike.
    expect(chipsFor('zh', flat)).toEqual(chipsFor('en', flat));
    expect(chipsFor('zh', flat)).not.toContain('source');
  });
});

describe('#8231 · untranslatedFieldLabel', () => {
  const SOURCE = {
    type: 'simple',
    sections: [
      {
        label: 'Layout',
        fields: [
          { field: 'columns', label: 'Grid width' },
          { field: 'gap' },
          { field: 'header', type: 'composite' },
        ],
      },
    ],
  };
  type Field = { field: string; label?: string; fields?: Field[] };
  const fieldsOf = (form: unknown) =>
    (form as { sections: Array<{ fields: Field[] }> }).sections[0].fields;

  it('answers the pre-overlay label under zh, never the translation', () => {
    const [columns, gap, header] = fieldsOf(localizeMetadataForm(SOURCE, 'dashboard', 'zh'));
    expect(columns.label).toBe('列数');
    expect(untranslatedFieldLabel(columns)).toBe('Grid width');
    expect(gap.label).toBe('间距');
    expect(untranslatedFieldLabel(gap)).toBeUndefined();
    // The composite's children are synthesized from the bundle: authored with
    // no label, so their source is absent, whatever their translation says.
    const showTitle = header.fields?.find((f) => f.field === 'showTitle');
    expect(showTitle?.label).toBe('显示标题');
    expect(untranslatedFieldLabel(showTitle)).toBeUndefined();
  });

  it('answers a field its own label when no overlay touched it', () => {
    const en = localizeMetadataForm(SOURCE, 'dashboard', 'en');
    expect(en).toBe(SOURCE);
    expect(untranslatedFieldLabel(fieldsOf(en)[0])).toBe('Grid width');
    // A type the bundle does not carry is handed back untouched, too.
    expect(localizeMetadataForm(SOURCE, 'report', 'zh')).toBe(SOURCE);
    expect(untranslatedFieldLabel({ label: '列数' })).toBe('列数');
    expect(untranslatedFieldLabel(undefined)).toBeUndefined();
  });

  it('does not mutate the form it localizes, and does not serialize the stamp', () => {
    const before = JSON.stringify(SOURCE);
    const zh = localizeMetadataForm(SOURCE, 'dashboard', 'zh');
    expect(JSON.stringify(SOURCE)).toBe(before);
    expect(JSON.stringify(zh)).not.toContain('sourceLabel');
    // Only `FormFieldSpec` keys are enumerable: the overlay's own `helpText`
    // and `label`, never a string-keyed stamp.
    expect(Object.keys(fieldsOf(zh)[0]).sort()).toEqual(['field', 'helpText', 'label']);
  });
});
