// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9652 — the flag a designer picker puts on a STORED value its roster
 * does not offer reads in the designer's locale.
 *
 * Five sites drew that flag as a hard-coded English template literal, so a
 * zh-CN author read `VALUE (not found)` / `(not in object)` / `(deprecated)` on
 * an otherwise Chinese inspector — on the one marker whose job is to explain
 * why a value looks wrong. The catalogue already carried `engine.form.notInObject`
 * in both locales; the sites simply did not reach for it.
 *
 * Every case reads the RENDERED text (a Radix trigger, or an open list's
 * option), never a label function in isolation: the defect was entirely in what
 * reached pixels.
 *
 * ## Two locale channels, both exercised
 *
 * - The inspectors that word their own flag (`ViewColumnInspector`,
 *   `ViewVariantInspector`, `FlowNodeConfigField`) have a `locale` prop and
 *   translate with it, so those cases pass `locale` and mount no provider.
 * - `InspectorSelectField`'s DEFAULT flag and `FlowObjectListField`'s select
 *   cells have no `locale` prop; they read `useMetadataLocale()`, so those cases
 *   mount an `I18nProvider` in the language under test.
 *
 * ## What the zh expectation is built from
 *
 * `VALUE` followed directly by the zh flag, with NO space: zh sets none before
 * the full-width bracket the flag opens with, which is exactly what a
 * `${v} (flag)` template literal at the call site could not express. The flag
 * text is read from the catalogue rather than retyped, and a guard below proves
 * it is a real zh value (not the key echoed back, not the English one), so no
 * case can pass vacuously on a missing row.
 *
 * ## The en cases are the pre-fix wording, byte for byte
 *
 * The en-US expectations are literals on purpose: the repair must not move the
 * English an existing author already reads.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

// `ViewColumnInspector` fetches its field roster and `ViewVariantInspector`
// fetches the object catalog through the shared metadata client. The roster
// ANSWERS here, without the stored field, so the answered arm (the only arm
// that may flag — objectui#8862 / objectui#9651) is the one on screen.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async () => ({
      name: 'invoices',
      fields: { stage: { type: 'text', label: 'Stage' } },
    })),
    list: vi.fn(async () => [] as unknown[]),
    withPreviewDrafts() { return this; },
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { t } from '../i18n';
import { InspectorSelectField } from './_shared';
import { ViewColumnInspector } from './ViewColumnInspector';
import { ViewVariantInspector } from './ViewVariantInspector';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import { FlowObjectListField } from './FlowObjectListField';
import type { FlowConfigColumn, FlowConfigField } from './flow-node-config';

afterEach(cleanup);

type Locale = 'en-US' | 'zh-CN';

/** The value followed by the zh flag the catalogue carries — no space. */
const zhFlagged = (value: string, flagKey: string) => `${value}${t(flagKey, 'zh-CN')}`;

/** The combobox a `<Label>` names — Radix renders `button[role=combobox]`. */
function trigger(name: string): HTMLElement {
  const el = screen.queryByRole('combobox', { name });
  expect(el, `a combobox named "${name}" is rendered at all`).not.toBeNull();
  return el as HTMLElement;
}

describe('the flag keys are real rows in both locales (non-vacuity guard)', () => {
  it.each(['engine.form.notInObject', 'engine.form.notFound', 'engine.form.deprecated'])(
    '%s is translated, not echoed and not English',
    (key) => {
      const zh = t(key, 'zh-CN');
      expect(zh, 'a missing zh row echoes the key back').not.toBe(key);
      expect(zh, 'the zh row must not be the English one').not.toBe(t(key, 'en-US'));
      // The composition below assumes the zh flag carries its own bracket.
      expect(zh.startsWith('（'), 'the zh flag opens with a full-width bracket').toBe(true);
    },
  );
});

describe('ViewColumnInspector — a column bound to a field the object does not have', () => {
  const draft = {
    name: 'invoices',
    label: 'Invoices',
    list: { type: 'grid', object: 'invoices', columns: [{ field: 'amount', label: 'Amount' }] },
  };

  function mount(locale: Locale) {
    render(
      <ViewColumnInspector
        type="view"
        name="invoices"
        draft={draft}
        selection={{ kind: 'column', id: 'list.columns[0]' } as never}
        onPatch={vi.fn()}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale={locale as never}
      />,
    );
    return trigger(t('engine.inspector.viewColumn.accessorKey', locale));
  }

  it('zh-CN: the flag is the catalogue\'s "not in object", after the value, unspaced', async () => {
    const el = mount('zh-CN');
    await waitFor(() => {
      expect(el.textContent).toBe(zhFlagged('amount', 'engine.form.notInObject'));
    });
  });

  it('en-US: the wording is unchanged', async () => {
    const el = mount('en-US');
    await waitFor(() => {
      expect(el.textContent).toBe('amount (not in object)');
    });
  });
});

describe('ViewVariantInspector — a view type the spec no longer offers', () => {
  function mount(locale: Locale) {
    render(
      <ViewVariantInspector
        type="view"
        name="invoices"
        draft={{ name: 'invoices', label: 'Invoices', list: { type: 'legacy_board', object: 'invoices' } }}
        onPatch={vi.fn()}
        onSelectionChange={() => {}}
        onClearSelection={() => {}}
        readOnly={false}
        locale={locale}
        variantKey="list"
        familyKey="list"
        isHome={false}
        objectFieldsOverride={[]}
      />,
    );
    return trigger(t('engine.inspector.view.type', locale));
  }

  it('zh-CN: the flag is the catalogue\'s "not found"', () => {
    expect(mount('zh-CN').textContent).toBe(zhFlagged('legacy_board', 'engine.form.notFound'));
  });

  it('en-US: the wording is unchanged', () => {
    expect(mount('en-US').textContent).toBe('legacy_board (not found)');
  });
});

describe('FlowNodeConfigField — a select value the node no longer offers', () => {
  const ACTION_TYPE: FlowConfigField = {
    id: 'actionType',
    path: ['config', 'actionType'],
    label: 'Action type',
    kind: 'select',
    options: [
      { value: 'invoke_function', label: 'Call function' },
      { value: 'email', label: 'Email' },
    ],
  };

  const mount = (locale: Locale) => {
    render(<FlowNodeConfigField field={ACTION_TYPE} value="sms" onCommit={() => {}} locale={locale} />);
    return trigger('Action type');
  };

  it('zh-CN: the flag is the catalogue\'s "deprecated"', () => {
    expect(mount('zh-CN').textContent).toBe(zhFlagged('sms', 'engine.form.deprecated'));
  });

  it('en-US: the wording is unchanged', () => {
    expect(mount('en-US').textContent).toBe('sms (deprecated)');
  });
});

describe('FlowObjectListField — a select cell holding a retired enum member', () => {
  const COLUMNS: FlowConfigColumn[] = [
    {
      key: 'type',
      label: 'Type',
      kind: 'select',
      options: [
        { value: 'user', label: 'User' },
        { value: 'position', label: 'Position' },
      ],
    },
  ];

  function mount(language: 'en' | 'zh') {
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <FlowObjectListField
          label="Approvers"
          columns={COLUMNS}
          value={[{ type: 'role' }]}
          onCommit={vi.fn()}
          addLabel="Add"
          removeLabel="Remove"
          emptyLabel="None"
        />
      </I18nProvider>,
    );
  }

  it('zh: the flag follows the active language', () => {
    mount('zh');
    expect(screen.getByText(zhFlagged('role', 'engine.form.deprecated'))).toBeInTheDocument();
    expect(screen.queryByText('role (deprecated)')).toBeNull();
  });

  it('en: the wording is unchanged', () => {
    mount('en');
    expect(screen.getByText('role (deprecated)')).toBeInTheDocument();
  });
});

describe('InspectorSelectField — the DEFAULT flag, for every call site that words none', () => {
  const OPTIONS = [{ value: 'profile', label: 'Profile' }];

  function mount(language: 'en' | 'zh') {
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <InspectorSelectField label="Group" value="retired_group" options={OPTIONS} onCommit={vi.fn()} />
      </I18nProvider>,
    );
    return trigger('Group');
  }

  it('zh: the default flag follows the active language', () => {
    expect(mount('zh').textContent).toBe(zhFlagged('retired_group', 'engine.form.notFound'));
  });

  it('en: the wording is unchanged', () => {
    expect(mount('en').textContent).toBe('retired_group (not found)');
  });

  it('a call site\'s own wording still wins over the default', () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <InspectorSelectField
          label="Group"
          value="retired_group"
          options={OPTIONS}
          onCommit={vi.fn()}
          unknownValueLabel={(v) => `${v} OWN`}
        />
      </I18nProvider>,
    );
    expect(trigger('Group').textContent).toBe('retired_group OWN');
  });
});
