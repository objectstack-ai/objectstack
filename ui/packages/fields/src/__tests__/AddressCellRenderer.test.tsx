/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4037 (migrated from objectstack#5019): a `Field.address` value read
 * as stringified JSON on the record detail page — `{"street":"中策路 1 号",…}` —
 * because the DISPLAY registry mapped `address` to `JsonCellRenderer`, while
 * `location` next to it in the same field group had a real formatter. The
 * create/edit dialog rendered the same field correctly, so the gap was
 * display-side only.
 *
 * Every case below resolves its renderer through `getCellRenderer` — the
 * display resolver the detail page itself calls — rather than importing
 * `AddressCellRenderer` directly, so these tests fail on the JSON signature if
 * the registry entry ever regresses, not merely if the formatter changes.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

/** Resolve + render exactly the way `DetailSection` builds a read-mode value. */
function renderThroughDisplayRegistry(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(<Renderer value={value as any} field={{ type } as any} />);
}

/** The stringified-object signature this issue is about. */
function expectNoJsonSignature(text: string | null) {
  expect(text).not.toMatch(/[{}]/);
  expect(text).not.toMatch(/"(street|city|state|postalCode|country)"/);
  expect(text).not.toMatch(/undefined/);
}

/** The record from the issue's evidence table. */
const ISSUE_ADDRESS = {
  street: '中策路 1 号',
  city: '杭州',
  state: '浙江',
  postalCode: '310000',
  country: '中国',
};

describe('address display renderer (objectui#4037)', () => {
  it('renders a populated address as a formatted line, not stringified JSON', () => {
    const { container } = renderThroughDisplayRegistry('address', ISSUE_ADDRESS);
    expectNoJsonSignature(container.textContent);
    expect(
      screen.getByText('中策路 1 号, 杭州, 浙江 310000, 中国'),
    ).toBeInTheDocument();
  });

  it('resolves `address` through the display registry the way it resolves `location`', () => {
    // The issue's decisive comparison: one address field beside one location
    // field, same record, same page. Both must be formatted; neither may fall
    // through to object stringification.
    const address = renderThroughDisplayRegistry('address', ISSUE_ADDRESS);
    const location = renderThroughDisplayRegistry('location', { lat: 30.2741, lng: 120.1551 });
    expectNoJsonSignature(address.container.textContent);
    expectNoJsonSignature(location.container.textContent);
    expect(location.container.textContent).toContain('30.2741');
  });

  it('carries the full value: every authored sub-field appears', () => {
    const { container } = renderThroughDisplayRegistry('address', ISSUE_ADDRESS);
    for (const part of Object.values(ISSUE_ADDRESS)) {
      expect(container.textContent).toContain(part);
    }
  });
});

describe('address display renderer — partial values render gracefully', () => {
  it('drops missing parts instead of leaving dangling separators', () => {
    const { container } = renderThroughDisplayRegistry('address', {
      street: '中策路 1 号',
      city: '杭州',
    });
    expect(screen.getByText('中策路 1 号, 杭州')).toBeInTheDocument();
    expectNoJsonSignature(container.textContent);
    expect(container.textContent).not.toMatch(/,\s*$/);
    expect(container.textContent).not.toMatch(/,\s*,/);
  });

  it('renders a street-only address as just the street', () => {
    renderThroughDisplayRegistry('address', { street: '中策路 1 号' });
    expect(screen.getByText('中策路 1 号')).toBeInTheDocument();
  });

  it('keeps state and postal code in one group, either alone', () => {
    const stateOnly = renderThroughDisplayRegistry('address', { city: 'SF', state: 'CA' });
    expect(stateOnly.container.textContent).toBe('SF, CA');
    const postalOnly = renderThroughDisplayRegistry('address', { city: 'SF', postalCode: '94102' });
    expect(postalOnly.container.textContent).toBe('SF, 94102');
    const both = renderThroughDisplayRegistry('address', {
      city: 'SF',
      state: 'CA',
      postalCode: '94102',
    });
    expect(both.container.textContent).toBe('SF, CA 94102');
  });

  it('ignores whitespace-only parts rather than spacing over them', () => {
    const { container } = renderThroughDisplayRegistry('address', {
      street: '  ',
      city: '杭州',
      country: '',
    });
    expect(container.textContent).toBe('杭州');
  });

  it('reads a legacy `zipCode` postal code (objectstack#5143 data)', () => {
    // Records written by builds up to 17.0.0-rc.1 stored the postal code under
    // `zipCode`. The input widget reads it; the detail page must not drop it.
    const { container } = renderThroughDisplayRegistry('address', {
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94102',
    });
    expect(container.textContent).toBe('San Francisco, CA 94102');
  });
});

describe('address display renderer — nothing is silently swallowed', () => {
  it('shows the empty placeholder for a null value and for `{}`', () => {
    const nullValue = renderThroughDisplayRegistry('address', null);
    expect(nullValue.container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    const emptyObject = renderThroughDisplayRegistry('address', {});
    expect(emptyObject.container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
  });

  it('keeps an unrecognized shape visible as JSON rather than blanking it', () => {
    // Strictly better than today, never worse: a value the formatter cannot
    // read retains the current compact-JSON rendering instead of disappearing.
    const { container } = renderThroughDisplayRegistry('address', { unexpected: 'data' });
    expect(container.textContent).toContain('unexpected');
  });

  it('passes a plain string address straight through', () => {
    renderThroughDisplayRegistry('address', '中策路 1 号, 杭州');
    expect(screen.getByText('中策路 1 号, 杭州')).toBeInTheDocument();
  });
});

describe('address display renderer — controls (unchanged surfaces)', () => {
  it('leaves `location` and `geolocation` formatting untouched', () => {
    const location = renderThroughDisplayRegistry('location', { lat: 30.2741, lng: 120.1551 });
    expect(location.container.textContent).toBe('30.2741, 120.1551');
    const geo = renderThroughDisplayRegistry('geolocation', { latitude: 30.2741, longitude: 120.1551 });
    expect(geo.container.textContent).toBe('30.2741, 120.1551');
  });

  it('leaves genuinely structural types stringifying as JSON', () => {
    // `address` moved out of the JSON bucket; `json` / `object` stay in it.
    // `composite` / `record` moved out too (objectui#11697): they draw labelled
    // sub-values, pinned in `compositeRecordCell-11697.test.tsx`.
    for (const type of ['json', 'object']) {
      const { container } = renderThroughDisplayRegistry(type, { a: 1 });
      expect(container.textContent).toBe('{"a":1}');
    }
  });
});
