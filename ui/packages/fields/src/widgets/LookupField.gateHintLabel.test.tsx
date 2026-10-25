/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A gated lookup names its controlling field by LABEL — objectstack#5407.
 *
 * The gate sentence (`lookup.selectFirst`) is translated in all ten packs, but
 * its `{{fields}}` interpolation came straight off `dependsOn`, which holds
 * API names. So the rendered hint was localized around a raw identifier in
 * every locale, English included:
 *
 *     en    Select crm_account first
 *     zh-CN 请先选择crm_account
 *
 * The `en` row is why this is not merely an i18n bug: an English user was shown
 * an internal identifier. The form renderer knows the label (it already
 * resolves the same map for the fixed-option widgets' `emptyHint`) and now
 * hands it over as `dependsOnLabels`.
 *
 * All three gated surfaces are asserted — the trigger's visible text, the
 * trigger's `title`, and the "browse all" button's `title` — because they were
 * three independent copies of the same expression and a fix applied to one of
 * them looks identical from the outside.
 */

import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LookupField } from './LookupField';

/** Mirrors the reported metadata: the parent field's API name IS an object-ish
 *  name (`crm_account`), which is exactly what made the leak so legible. */
const gatedField = {
  name: 'contact',
  label: 'Contact',
  reference: 'crm_contact',
  reference_field: 'name',
  dependsOn: ['crm_account'],
} as any;

const dataSource = { find: vi.fn(async () => ({ data: [], total: 0 })) } as any;

function renderGated(extra: Record<string, unknown>) {
  return render(
    <LookupField
      field={gatedField}
      value={undefined}
      onChange={vi.fn()}
      readonly={false}
      dataSource={dataSource}
      {...({ dependentValues: { crm_account: null }, ...extra } as any)}
    />,
  );
}

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

describe('LookupField gate hint names the controlling field (objectstack#5407)', () => {
  it('interpolates the label the host supplied, not the API name', () => {
    renderGated({ dependsOnLabels: { crm_account: 'Account' } });

    const trigger = screen.getByTestId('lookup-trigger-gated');
    expect(trigger).toHaveTextContent('Select Account first');
    // The identifier must be gone from the copy entirely, not merely
    // accompanied by the label.
    expect(trigger).not.toHaveTextContent('crm_account');
    expect(trigger).toHaveAttribute('title', 'Select Account first');
  });

  it('labels the gated "browse all" button the same way', () => {
    renderGated({ dependsOnLabels: { crm_account: 'Account' } });

    const browse = screen.getByTestId('browse-all-records');
    expect(browse).toBeDisabled();
    expect(browse).toHaveAttribute('title', 'Select Account first');
  });

  it('joins several controlling fields by their labels', () => {
    render(
      <LookupField
        field={{ ...gatedField, dependsOn: ['crm_account', 'lead_source'] }}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={dataSource}
        {...({
          dependentValues: { crm_account: null, lead_source: null },
          dependsOnLabels: { crm_account: 'Account', lead_source: 'Lead Source' },
        } as any)}
      />,
    );

    expect(screen.getByTestId('lookup-trigger-gated')).toHaveTextContent(
      'Select Account, Lead Source first',
    );
  });

  it('falls back to the API name for a field the host did not map', () => {
    // Standalone use (no host form) has to keep rendering what it rendered
    // before — the map is an enrichment, not a new requirement. This is also
    // the assertion that would go red if `dependsOnLabels` were consulted for
    // its VALUES rather than keyed by field name.
    renderGated({ dependsOnLabels: { some_other_field: 'Irrelevant' } });

    expect(screen.getByTestId('lookup-trigger-gated')).toHaveTextContent(
      'Select crm_account first',
    );
  });

  it('falls back to the API name when the host passes no map at all', () => {
    renderGated({});

    expect(screen.getByTestId('lookup-trigger-gated')).toHaveTextContent(
      'Select crm_account first',
    );
  });
});
