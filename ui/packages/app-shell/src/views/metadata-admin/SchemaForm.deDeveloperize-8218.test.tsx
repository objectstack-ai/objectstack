// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8218 — the metadata-admin form stops reading as a developer tool.
 *
 * `SchemaForm` + `widgets.tsx` were built for an administrator editing metadata.
 * Studio's 「界面」 property panel now grafts the very same form in front of an
 * AI-build MAKER, so four developer-facing habits landed in a fully Chinese
 * surface. These pin the three that are mechanically checkable from the
 * rendered output:
 *
 *   1. the machine-name tooltip is translated, in both locales (and, since
 *      objectui#8231, WHEN it is offered is judged on the source label, alike
 *      in both locales; since objectui#13352 it is the label's on-demand
 *      `title`, no longer an inline chip);
 *   2. a master-detail column whose item schema carries no `title` gets a
 *      humanised header instead of the raw JSON Schema key;
 *   3. a numeric field grays its schema `default` in as a PLACEHOLDER and
 *      forwards `minimum` / `maximum` / `multipleOf` to the control.
 *
 * Plus a parity pin over the keys the sweep introduced, because this console's
 * `engine.*` table is the ONE string table the repo's i18n gates cannot see
 * (see `./i18n.ts`'s header and `packages/i18n/README.md`) — nothing else would
 * notice an entry added to `en` and forgotten in `zh`.
 *
 * ## What is deliberately NOT pinned here
 *
 * The LOCALIZED column name. `dashboard.header.actions[]` shows `Label` /
 * `Action Url` after this change, not 「标签」/「链接」, and that is the correct
 * outcome for this repo: the header text can only come from the JSON Schema's
 * `items.properties.<k>.title`, which no localization overlay reaches, and the
 * spec emits none. Both halves are upstream — see the PR body.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaForm } from './SchemaForm';
import { t } from './i18n';
import { localizeMetadataForm } from './metadata-form-i18n';

afterEach(cleanup);

function renderIn(language: 'en' | 'zh', ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );
}

/* ── 1. machine-name chip tooltip ─────────────────────────────────────────── */

// REWRITTEN by objectui#8231 — read this before "restoring" the old fixture.
//
// This block used to hand `SchemaForm` a field already labelled 「列数」 and
// read the chip beside `columns`, with the comment: "The chip renders only
// when the visible label does NOT already spell the machine name — which,
// under a localized panel, is EVERY field". That was the DEFECT, used as the
// fixture's mechanism: the chip's predicate compared `prettify(name)` with
// the TRANSLATED label, so a localized panel showed it beside every field and
// an English one hid it beside the same fields. objectui#8231 (ruling 1,
// comment 5749674288) moved the predicate onto the untranslated SOURCE label,
// which the locale overlay now carries alongside its translation. After that
// fix the old fixture would still render a chip, but only because a
// hand-written 「列数」 never went through the overlay and so reads as its own
// source: it would pin nothing about when the chip shows.
//
// So the fixture now goes through the real overlay (`localizeMetadataForm`),
// and the pin asserts the locale-independent predicate itself: the chip is
// ABSENT beside `gap`, whose source label is absent and so humanizes to its
// own name, and PRESENT beside `columns`, whose source label ("Grid width")
// does not spell it, in BOTH locales. The tooltip assertions ride on the
// chip that is present.
//
// objectui#13352 then moved the name off the row: the label is shown alone,
// and the name is the label's on-demand `title` ("Machine name: columns"),
// mirrored on `data-machine-name`. Same predicate, same translated word; the
// pins below read the label's attributes instead of an inline `<code>`.
const CHIP_SCHEMA = {
  type: 'object',
  properties: {
    columns: { type: 'integer', minimum: 1, maximum: 24 },
    gap: { type: 'integer' },
  },
} as never;

const CHIP_SOURCE_FORM = {
  type: 'simple',
  sections: [
    {
      label: 'Layout',
      fields: [
        { field: 'columns', type: 'number', label: 'Grid width' },
        { field: 'gap', type: 'number' },
      ],
    },
  ],
};

function chipForm(language: 'en' | 'zh') {
  return localizeMetadataForm(CHIP_SOURCE_FORM, 'dashboard', language) as never;
}

function renderChipForm(language: 'en' | 'zh') {
  return renderIn(
    language,
    <SchemaForm schema={CHIP_SCHEMA} form={chipForm(language)} value={{}} onChange={() => {}} />,
  );
}

/** The label that offers `name` on demand, or null (objectui#13352). */
function hintFor(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`label[data-machine-name="${name}"]`);
}

describe('#8218 · machine-name tooltip is translated', () => {
  it('reads Chinese under a Chinese provider', () => {
    renderChipForm('zh');
    // The overlay really translated the label — otherwise this pins nothing.
    const label = screen.getByText('列数');
    expect(label.tagName).toBe('LABEL');
    expect(label).toBe(hintFor('columns'));
    expect(label).toHaveAttribute('title', '机器名: columns');
  });

  it('reads English under an English provider', () => {
    renderChipForm('en');
    expect(hintFor('columns')).toHaveAttribute('title', 'Machine name: columns');
  });

  it('never emits the untranslated literal in the Chinese panel', () => {
    renderChipForm('zh');
    expect(document.body.innerHTML).not.toContain('Machine name');
  });

  it.each(['en', 'zh'] as const)(
    'judges the SOURCE label, not the translation, under %s (objectui#8231)',
    (language) => {
      renderChipForm(language);
      // `gap` has no source label: its English label IS the humanized name.
      expect(hintFor('gap')).toBeNull();
      // `columns` is sourced as "Grid width", which does not spell it.
      expect(hintFor('columns')).not.toBeNull();
      // Neither name is drawn as text on the row (objectui#13352).
      expect(screen.queryByText('columns')).toBeNull();
      expect(screen.queryByText('gap')).toBeNull();
    },
  );
});

// Section 3 below reuses this: a field hand-labelled 「列数」 that bypasses the
// overlay. It reads the numeric control, never the chip.
const COLUMNS_FORM = {
  type: 'simple',
  sections: [{ label: 'Layout', fields: [{ field: 'columns', type: 'number', label: '列数' }] }],
} as never;

/* ── 2. master-detail headers ─────────────────────────────────────────────── */

// Shaped after `DashboardSchema.header.actions` as the spec actually emits it:
// every item property carries `description` and NONE carries `title`.
const ACTIONS_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      title: 'Header actions',
      items: {
        type: 'object',
        required: ['label', 'actionUrl'],
        properties: {
          label: { type: 'string', description: 'Action button label' },
          actionUrl: { type: 'string', description: 'URL or target for the action' },
          actionType: { type: 'string', description: 'Type of action' },
          icon: { type: 'string', description: 'Icon identifier for the action button' },
        },
      },
    },
  },
} as never;

const ACTIONS_FORM = {
  type: 'simple',
  sections: [{ label: 'Header', fields: [{ field: 'actions' }] }],
} as never;

describe('#8218 · a title-less master-detail column is not a raw schema key', () => {
  it('humanises every header the item schema leaves untitled', () => {
    renderIn('zh', <SchemaForm schema={ACTIONS_SCHEMA} form={ACTIONS_FORM} value={{ actions: [{}] }} onChange={() => {}} />);
    const headers = Array.from(document.querySelectorAll('th')).map((th) => th.textContent?.replace('*', '').trim());
    expect(headers).toContain('Label');
    expect(headers).toContain('Action Url');
    expect(headers).toContain('Action Type');
    expect(headers).toContain('Icon');
    // The regression itself: the raw camelCase keys must be gone.
    expect(headers).not.toContain('actionUrl');
    expect(headers).not.toContain('actionType');
  });

  it("still prefers the item schema's own `title` when it has one", () => {
    const titled = {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: { type: 'object', properties: { actionUrl: { type: 'string', title: 'Destination' } } },
        },
      },
    } as never;
    renderIn('en', <SchemaForm schema={titled} form={ACTIONS_FORM} value={{ actions: [{}] }} onChange={() => {}} />);
    const headers = Array.from(document.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toContain('Destination');
    expect(headers).not.toContain('Action Url');
  });
});

/* ── 3. numeric fields: default as placeholder, schema bounds honoured ────── */

function numberInput(): HTMLInputElement {
  const el = document.querySelector('input[type="number"]');
  expect(el, 'no numeric input rendered').not.toBeNull();
  return el as HTMLInputElement;
}

describe('#8218 · numeric fields surface their default and their bounds', () => {
  it('grays the schema `default` in as a placeholder, and does not write it', () => {
    const schema = {
      type: 'object',
      properties: { columns: { type: 'integer', default: 12, minimum: 1, maximum: 24 } },
    } as never;
    renderIn('en', <SchemaForm schema={schema} form={COLUMNS_FORM} value={{}} onChange={() => {}} />);
    const input = numberInput();
    expect(input).toHaveAttribute('placeholder', '12');
    // Placeholder, not value: an untouched field still saves as absent, so
    // "leave it on the default" stays distinct from "pin it to today's 12".
    expect(input.value).toBe('');
  });

  it('forwards minimum / maximum / multipleOf onto the control', () => {
    const schema = {
      type: 'object',
      properties: { columns: { type: 'integer', minimum: 1, maximum: 24, multipleOf: 1 } },
    } as never;
    renderIn('en', <SchemaForm schema={schema} form={COLUMNS_FORM} value={{ columns: 4 }} onChange={() => {}} />);
    const input = numberInput();
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '24');
    expect(input).toHaveAttribute('step', '1');
  });

  it('lets an explicit form-spec bound win over the schema one', () => {
    const schema = { type: 'object', properties: { columns: { type: 'integer', minimum: 1, maximum: 24 } } } as never;
    const form = {
      type: 'simple',
      sections: [{ label: 'Layout', fields: [{ field: 'columns', type: 'number', label: '列数', min: 2, max: 8 }] }],
    } as never;
    renderIn('en', <SchemaForm schema={schema} form={form} value={{}} onChange={() => {}} />);
    const input = numberInput();
    expect(input).toHaveAttribute('min', '2');
    expect(input).toHaveAttribute('max', '8');
  });

  it('emits no placeholder or bounds when the schema declares none', () => {
    const schema = { type: 'object', properties: { columns: { type: 'number' } } } as never;
    renderIn('en', <SchemaForm schema={schema} form={COLUMNS_FORM} value={{}} onChange={() => {}} />);
    const input = numberInput();
    expect(input).not.toHaveAttribute('placeholder');
    expect(input).not.toHaveAttribute('min');
    expect(input).not.toHaveAttribute('max');
    expect(input).not.toHaveAttribute('step');
  });

  // The same two files render numbers twice; a bound honoured in one and
  // dropped in the other is the drift this pins shut. This one goes through
  // `widgets.tsx`'s master-detail CELL renderer.
  it('applies the same treatment inside a master-detail cell', () => {
    const schema = {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', properties: { span: { type: 'integer', default: 3, minimum: 1, maximum: 12 } } },
        },
      },
    } as never;
    const form = { type: 'simple', sections: [{ label: 'S', fields: [{ field: 'rows' }] }] } as never;
    renderIn('en', <SchemaForm schema={schema} form={form} value={{ rows: [{}] }} onChange={() => {}} />);
    const input = document.querySelector('td input[type="number"]') as HTMLInputElement | null;
    expect(input, 'no numeric cell rendered').not.toBeNull();
    expect(input).toHaveAttribute('placeholder', '3');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '12');
  });
});

/* ── 4. the sweep's keys exist in BOTH locale tables ──────────────────────── */

// Every key the #8218 sweep introduced. This console's `engine.*` table is
// invisible to the repo's i18n parity gates, so a key added to one table and
// forgotten in the other would ship as an English string inside the Chinese
// panel — the exact defect the sweep was for.
const SWEPT_KEYS = [
  'engine.form.machineName',
  'engine.form.sectionN',
  'engine.form.notConfigured',
  'engine.form.configure',
  'engine.form.removeNamed',
  'engine.form.moveUp',
  'engine.form.moveDown',
  'engine.form.noneShort',
  'engine.form.filterModeNone',
  'engine.form.filterModeTabs',
  'engine.form.filterModeDropdown',
  'engine.form.filterElement',
  'engine.form.removeField',
  'engine.form.addFilterField',
  'engine.form.bindObjectForFilterFields',
  'engine.form.tabLabel',
  'engine.form.moveTabUp',
  'engine.form.moveTabDown',
  'engine.form.removeTab',
  'engine.form.bindObjectForTabRules',
  'engine.form.bindObjectForConditions',
  'engine.form.addActionButtonPlain',
  'engine.form.addActionButton',
  'engine.form.allActionsAdded',
  'engine.form.bindObjectForActions',
  'engine.form.color',
  'engine.form.colorHexPlaceholder',
  'engine.form.secretSetTypeToReplace',
  'engine.form.secretSetLeaveBlank',
  'engine.form.enterAValue',
  'engine.form.secretValue',
  'engine.form.hideValue',
  'engine.form.revealValue',
  'engine.form.clear',
  'engine.form.anOption',
  'engine.form.selectDepToConfigure',
  'engine.form.noConfigNeeded',
  'engine.form.readOnly',
  'engine.form.loadingEditor',
] as const;

describe('#8218 · the swept strings resolve in both locales', () => {
  it('every key is present in the en and zh tables', () => {
    for (const key of SWEPT_KEYS) {
      // `t()` echoes the key back when the table has no entry.
      expect(t(key, 'en-US'), `EN missing ${key}`).not.toBe(key);
      expect(t(key, 'zh-CN'), `ZH missing ${key}`).not.toBe(key);
    }
  });

  it('the prose keys actually say something different in Chinese', () => {
    // `colorHexPlaceholder` is a notation and is intentionally identical, so it
    // is excluded rather than silently weakening the assertion for the rest.
    const NOTATION_ONLY = new Set(['engine.form.colorHexPlaceholder']);
    for (const key of SWEPT_KEYS) {
      if (NOTATION_ONLY.has(key)) continue;
      expect(t(key, 'zh-CN'), `ZH is a copy of EN for ${key}`).not.toBe(t(key, 'en-US'));
    }
    // And the excluded one really is the notation, not an untranslated string
    // that slipped into the exemption.
    expect(t('engine.form.colorHexPlaceholder', 'zh-CN')).toBe('#RRGGBB');
  });

  it('the placeholder tokens the callers pass are the ones the templates use', () => {
    for (const locale of ['en-US', 'zh-CN'] as const) {
      expect(t('engine.form.sectionN', locale)).toContain('{n}');
      expect(t('engine.form.removeNamed', locale)).toContain('{name}');
      expect(t('engine.form.selectDepToConfigure', locale)).toContain('{dep}');
      expect(t('engine.form.noConfigNeeded', locale)).toContain('{value}');
    }
  });
});
