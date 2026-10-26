/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10132, half 1 — the RENDERED half.
 *
 * `@objectstack/spec` ships `GlobalFilterSchema.object`, whose describe text is
 * "Object whose `fields.<object>.<field>` translation-bundle entry resolves
 * this filter's field label and option labels". The Console never read it: a
 * dashboard filter declaring `object` and no `label`, viewed on a zh console,
 * painted the RAW FIELD NAME and left its option labels in the authored
 * English.
 *
 * ## Every case here is a LIT CONTROL, not an absence assertion
 *
 * "the key is not read" is not observable from one render — a missing
 * translation and an ignored key paint the same pixels. So each case renders
 * the SAME filter twice, once with the `fields.…` / `fieldOptions.…` bundle
 * entry available and once without, and asserts the two rendered strings
 * DIFFER. A fix that merely called a resolver (with the wrong bundle key, say)
 * would leave them equal and fail here.
 *
 * The bundle is written in the app-namespace shape `useObjectLabel` discovers
 * (`<ns>.fields.<object>.<field>`) because that resolver — the one lists and
 * forms already use — is the one the spec's text names. Nothing new is spelled
 * here.
 *
 * ## The opt-in control
 *
 * The last case renders a filter with NO `object` against the SAME bundle. It
 * must be unchanged: the key is the author's opt-in, so a filter that omits it
 * may not start resolving against an object nobody named.
 *
 * PREDICTIONS, written before the run: the two `object` cases are RED (both
 * renders paint the untranslated string, so the two sides are equal); the
 * opt-in control and the no-bundle fallback are GREEN on both sides.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { resolveDashboardFilterDefs, type DashboardFilterDef } from '@object-ui/core';
import { DashboardFilterBar } from '../DashboardFilterBar';

afterEach(cleanup);

/**
 * A translator's bundle, in the convention `useObjectLabel` reads: the field
 * label under `fields.<object>.<field>` and the picklist entry under
 * `fieldOptions.<object>.<field>.<value>`. `crm` is an app namespace because it
 * carries a `fields` sub-key — that is how the namespace is discovered.
 */
const TRANSLATED = {
  zh: {
    crm: {
      fields: { opportunity: { type: '类型' } },
      fieldOptions: { opportunity: { type: { new_business: '新业务' } } },
    },
  },
};

/** Stable config objects — `I18nProvider` rebuilds its instance when `config` changes identity. */
const WITH_BUNDLE = { defaultLanguage: 'zh', detectBrowserLanguage: false, resources: TRANSLATED };
const WITHOUT_BUNDLE = { defaultLanguage: 'zh', detectBrowserLanguage: false, resources: {} };

function renderBar(
  config: Record<string, unknown>,
  defs: DashboardFilterDef[],
  values: Record<string, unknown> = {},
) {
  return render(
    <I18nProvider persistLanguage={false} config={config as never}>
      <DashboardFilterBar defs={defs} values={values} onChange={vi.fn()} />
    </I18nProvider>,
  );
}

/** Built by the real normalizer — a hand-written def would not exercise the seam. */
function defsFor(filter: Record<string, unknown>): DashboardFilterDef[] {
  return resolveDashboardFilterDefs({ globalFilters: [filter] } as never);
}

const TYPED_FILTER = {
  name: 'type',
  field: 'type',
  object: 'opportunity',
  type: 'select',
  options: [{ value: 'new_business', label: 'New business' }],
};

/** Read the filter control's accessible name — where the FIELD label lands. */
function ariaLabelOf(name: string): string | null {
  return screen.getByTestId(`dashboard-filter-${name}`).getAttribute('aria-label');
}

describe('DashboardFilterBar — `GlobalFilterSchema.object` resolves the field label (objectui#10132)', () => {
  it('paints the bundle field label, and the raw name without it — the lit control', () => {
    renderBar(WITH_BUNDLE, defsFor(TYPED_FILTER));
    const lit = ariaLabelOf('type');
    cleanup();

    renderBar(WITHOUT_BUNDLE, defsFor(TYPED_FILTER));
    const unlit = ariaLabelOf('type');

    expect(lit).toBe('类型');
    // The reported symptom, kept as the other side of the control: with nothing
    // to resolve, the control still reads the raw field name it always did.
    expect(unlit).toBe('type');
    expect(lit).not.toBe(unlit);
  });

  it('prefers the bundle entry over an authored label, as lists and forms do', () => {
    // The convention this reuses resolves the bundle FIRST and falls back to the
    // metadata literal — `fieldLabel(object, field, fallback)`. A filter that
    // opts in by naming its object therefore behaves like every other field
    // label on the console, rather than becoming a second precedence rule.
    const withLabel = { ...TYPED_FILTER, label: 'Type' };

    renderBar(WITH_BUNDLE, defsFor(withLabel));
    expect(ariaLabelOf('type')).toBe('类型');
    cleanup();

    renderBar(WITHOUT_BUNDLE, defsFor(withLabel));
    expect(ariaLabelOf('type')).toBe('Type');
  });

  it('resolves the OPTION label through the same convention — the second lit control', () => {
    renderBar(WITH_BUNDLE, defsFor(TYPED_FILTER), { type: 'new_business' });
    const lit = screen.getByTestId('dashboard-filter-type').textContent;
    cleanup();

    renderBar(WITHOUT_BUNDLE, defsFor(TYPED_FILTER), { type: 'new_business' });
    const unlit = screen.getByTestId('dashboard-filter-type').textContent;

    expect(lit).toContain('新业务');
    // Untranslated, the authored English survives — an option label is not lost,
    // it is merely not translated. That is what makes this a translation gap.
    expect(unlit).toContain('New business');
    expect(lit).not.toBe(unlit);
  });

  it('leaves a filter that declares no `object` exactly as it renders today — the opt-in control', () => {
    // Same bundle, same field name, no `object`: nothing may resolve. The key is
    // the author's opt-in and a filter that omits it must not start reading a
    // bundle entry nobody pointed it at.
    const noObject = {
      name: 'type',
      field: 'type',
      type: 'select',
      label: 'Type',
      options: [{ value: 'new_business', label: 'New business' }],
    };

    renderBar(WITH_BUNDLE, defsFor(noObject), { type: 'new_business' });
    expect(ariaLabelOf('type')).toBe('Type');
    expect(screen.getByTestId('dashboard-filter-type').textContent).toContain('New business');
    expect(screen.getByTestId('dashboard-filter-type').textContent).not.toContain('新业务');
  });
});
