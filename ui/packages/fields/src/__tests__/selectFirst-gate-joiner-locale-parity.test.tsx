/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dependency-gate hint reads the SAME way whichever caller produced it, in
 * every locale — objectui#4026.
 *
 * The gate sentence is deliberately shared: `lookup.selectFirst` and
 * `fields.options.selectFirst` are one wording, and the form renderer's own
 * comment says the two callers exist so "the gate can never read differently
 * depending on which side produced it". That invariant held for the sentence
 * and not for its `{{fields}}` slot, which each caller filled with a hardcoded
 * separator — and not even the same one:
 *
 *     LookupField      Select Account, Lead Source first
 *     form renderer    Select Account / Lead Source first
 *
 * A separator is a property of the LOCALE, not of the code (the finding behind
 * `validation.formInvalidJoiner`, objectstack#5407), so both spellings were
 * also wrong under zh/ja, which enumerate with U+3001, and under ar, which
 * uses U+060C.
 *
 * Three call sites fill that slot, not two — `OptionsEmptyState` is the
 * standalone-widget caller of `fields.options.selectFirst` that the form
 * renderer's comment refers to, and it hardcoded `' / '` as well. Fixing only
 * the two the card names would have left the shared sentence still reading two
 * ways, so all three are asserted here together.
 *
 * The cross-caller assertion is EQUALITY rather than three copies of an
 * expected string: a joiner that later changes wrongly-but-consistently is a
 * translation bug, while one that changes inconsistently is this defect coming
 * back. The per-script cases below cover the first half.
 *
 * This file lives in `@object-ui/fields` because it is the only package that
 * can see both sides — fields depends on components, not the reverse.
 */

import type { ReactNode } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Module scope, NOT a `beforeAll` — a cold transform billed to `hookTimeout` is
// this repo's known flake generator (AGENTS.md 测试纪律 / objectui#3010). This
// import pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { LookupField } from '../widgets/LookupField';
import { OptionsEmptyState } from '../widgets/OptionsEmptyState';

/** U+3001 IDEOGRAPHIC COMMA — the CJK list separator. */
const CJK_COMMA = '、';
/** U+060C ARABIC COMMA. */
const ARABIC_COMMA = '،';

/** The two controlling fields, named the way the user sees them on the form. */
const PARENT_A = { name: 'crm_account', label: 'Account' };
const PARENT_B = { name: 'lead_source', label: 'Lead Source' };
const PARENT_LABELS = { [PARENT_A.name]: PARENT_A.label, [PARENT_B.name]: PARENT_B.label };

/**
 * Surfaces the `emptyHint` the FORM computed, verbatim. The gate hint reaches a
 * registered option widget as that prop (objectui#3231), so this is
 * `gatedHint`'s own output with no other widget's formatting in between.
 *
 * The value is RENDERED rather than captured into a module variable: writing to
 * one during render is a side effect (`react-hooks/globals`), and a probe that
 * renders what it received needs no such write. `String(...)` so a hint that
 * failed to compute reads as `"undefined"` and fails the comparison loudly
 * instead of comparing empty to empty.
 */
function EmptyHintProbe(props: any) {
  return <div data-testid="form-gate-probe">{String(props.emptyHint)}</div>;
}

const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })) } as any;

beforeAll(() => {
  // `field:select` belongs to this package's registry index, which this file
  // deliberately does not import — so the probe shadows nothing.
  ComponentRegistry.register('field:select', EmptyHintProbe, { namespace: 'test' });
}, 30000);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});

afterEach(() => cleanup());

const withLocale = (language: string, ui: ReactNode) => (
  <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
    {ui}
  </I18nProvider>
);

/** `packages/fields` — the lookup widget's gate (`lookup.selectFirst`). */
function lookupGateHint(language: string): string {
  render(
    withLocale(
      language,
      <LookupField
        field={
          {
            name: 'contact',
            label: 'Contact',
            reference: 'crm_contact',
            reference_field: 'name',
            dependsOn: [PARENT_A.name, PARENT_B.name],
          } as any
        }
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={dataSource}
        {...({
          dependentValues: { [PARENT_A.name]: null, [PARENT_B.name]: null },
          dependsOnLabels: PARENT_LABELS,
        } as any)}
      />,
    ),
  );
  // The `title` rather than the text content: it is the whole sentence and
  // nothing else, so it can be compared for EQUALITY. Its agreement with the
  // visible copy is pinned in `LookupField.gateHintLabel.test.tsx`.
  const title = screen.getByTestId('lookup-trigger-gated').getAttribute('title');
  cleanup();
  return String(title);
}

/** `packages/components` — the form renderer's `gatedHint` memo. */
function formGateHint(language: string): string {
  const Form = ComponentRegistry.get('form')!;
  render(
    withLocale(
      language,
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: PARENT_A.name, label: PARENT_A.label, type: 'input', defaultValue: '' },
            { name: PARENT_B.name, label: PARENT_B.label, type: 'input', defaultValue: '' },
            {
              name: 'contact',
              label: 'Contact',
              // The prefixed id `mapFieldTypeToFormType` emits, so the field
              // resolves through the registry and reaches the probe.
              type: 'field:select',
              dependsOn: [PARENT_A.name, PARENT_B.name],
              options: [
                { label: 'Anything', value: 'a', visibleWhen: "record.crm_account == 'x'" },
              ],
            },
          ],
        }}
      />,
    ),
  );
  const hint = screen.getByTestId('form-gate-probe').textContent ?? '';
  cleanup();
  return hint;
}

/** `packages/fields` — the standalone option widget's own gate copy. */
function optionsEmptyStateGateHint(language: string): string {
  // No `emptyHint`: this is the standalone path, where the widget owns the
  // sentence. It interpolates raw metadata names because it has no host to
  // resolve labels — which is what the form renderer's comment describes. The
  // JOINER is what is compared, so both sides are handed the same name set.
  const { container } = render(
    withLocale(
      language,
      <OptionsEmptyState gated dependsOnFields={[PARENT_A.label, PARENT_B.label]} />,
    ),
  );
  const text = container.textContent ?? '';
  cleanup();
  return text;
}

/** zh/ja enumerate with U+3001, ar with U+060C, Latin scripts and ko with ", ". */
const LOCALES: Array<{ language: string; joiner: string }> = [
  { language: 'en', joiner: ', ' },
  { language: 'de', joiner: ', ' },
  { language: 'ko', joiner: ', ' },
  { language: 'zh', joiner: CJK_COMMA },
  { language: 'ja', joiner: CJK_COMMA },
  { language: 'ar', joiner: `${ARABIC_COMMA} ` },
];

describe('selectFirst gate hint — one joiner, every caller (objectui#4026)', () => {
  it.each(LOCALES)(
    'the lookup and the form produce the identical sentence under $language',
    ({ language }) => {
      const fromLookup = lookupGateHint(language);
      const fromForm = formGateHint(language);

      // The defect, stated directly: same controlling fields, same locale, two
      // different sentences.
      expect(fromForm).toBe(fromLookup);
      // Neither side is empty or a raw key — an equality that both failed the
      // same way would otherwise pass.
      expect(fromLookup).toContain(PARENT_A.label);
      expect(fromLookup).toContain(PARENT_B.label);
    },
  );

  it.each(LOCALES)(
    'the standalone option widget joins the same way under $language',
    ({ language }) => {
      // The third caller of `fields.options.selectFirst`, and the one the form
      // renderer's comment names. It hardcoded `' / '` too.
      expect(optionsEmptyStateGateHint(language)).toBe(formGateHint(language));
    },
  );

  it.each(LOCALES)('enumerates with the separator declared by $language', ({ language, joiner }) => {
    const sentence = lookupGateHint(language);

    expect(sentence).toContain(`${PARENT_A.label}${joiner}${PARENT_B.label}`);
    // The literal this replaced, asserted negatively so a re-inlined separator
    // cannot pass by rendering the right thing elsewhere in the sentence.
    // `' / '` appears in no pack's copy, in any locale.
    expect(sentence).not.toContain(' / ');
    // And where the pack does NOT use a comma+space, the other old literal
    // must be gone too.
    if (joiner !== ', ') {
      expect(sentence).not.toContain(`${PARENT_A.label}, `);
    }
  });

  it('does not leak the CJK comma into a Latin session, or a comma into zh', () => {
    // The two SIDES of the locale defect, in the one place all callers meet.
    expect(lookupGateHint('en')).not.toContain(CJK_COMMA);
    expect(formGateHint('en')).not.toContain(CJK_COMMA);
    expect(lookupGateHint('zh')).not.toContain(', ');
    expect(formGateHint('zh')).not.toContain(', ');
  });
});
