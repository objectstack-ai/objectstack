/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * objectui#4037 (migrated from objectstack#5019): on a record detail page a
 * `Field.address` value rendered as `{"street":"中策路 1 号","city":"杭州",…}`
 * while a `location` field in the same field group rendered formatted. The card
 * names TWO read surfaces — detail page read mode and the inline-edit read
 * state — and both take the same `displayValue` path through the display
 * registry, so both are pinned here.
 *
 * These are end-of-path tests: they drive the real `DetailSection`, not the
 * renderer, so they stay red if the registry entry regresses even when the
 * formatter itself is fine.
 */
describe('DetailSection — address fields render formatted, not as JSON (objectui#4037)', () => {
  // The read-mode desktop row (which carries the inline-edit affordance) only
  // renders above the mobile breakpoint.
  beforeAll(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });

  const objectSchema = {
    fields: {
      billing_address: { type: 'address' },
      office_location: { type: 'location' },
    },
  };

  const section: DetailViewSection = {
    fields: [
      { name: 'billing_address', label: '账单地址' },
      { name: 'office_location', label: '办公地点' },
    ],
  } as DetailViewSection;

  // The issue's evidence: one address field next to one location field.
  const data = {
    billing_address: {
      street: '中策路 1 号',
      city: '杭州',
      state: '浙江',
      postalCode: '310000',
      country: '中国',
    },
    office_location: { lat: 30.2741, lng: 120.1551 },
  };

  const FORMATTED = '中策路 1 号, 杭州, 浙江 310000, 中国';

  /** The stringified-object signature the issue reports. */
  function expectNoJsonSignature(text: string | null) {
    expect(text).not.toMatch(/"(street|city|state|postalCode|country)"\s*:/);
    expect(text).not.toContain('[object Object]');
  }

  it('renders a formatted address in detail page read mode', () => {
    const { container } = render(
      <DetailSection section={section} data={data} objectSchema={objectSchema} />,
    );
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
    expectNoJsonSignature(container.textContent);
  });

  it('renders a formatted address in the inline-edit read state', () => {
    // Inline edit available on the record (the parent supplies
    // `onEnterInlineEdit`), with no field actively being edited — the row the
    // card calls the inline-edit read state.
    const { container } = render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        onEnterInlineEdit={vi.fn()}
      />,
    );
    expect(screen.getByText(FORMATTED)).toBeInTheDocument();
    expectNoJsonSignature(container.textContent);
  });

  it('leaves the location field formatted (control — unchanged by this fix)', () => {
    // A real control renders `location` ALONE. Asserting over a container that
    // also holds the address field would make this case red for the address
    // regression — it would restate the tests above instead of controlling for
    // them. Isolated, it is green with the fix and green without it, which is
    // what "the sibling formatter is untouched" actually claims.
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'office_location', label: '办公地点' }] } as DetailViewSection}
        data={{ office_location: data.office_location }}
        objectSchema={objectSchema}
      />,
    );
    expect(screen.getByText('30.2741, 120.1551')).toBeInTheDocument();
    expectNoJsonSignature(container.textContent);
  });

  it('renders a partial address without dangling separators', () => {
    const { container } = render(
      <DetailSection
        section={{ fields: [{ name: 'billing_address', label: '账单地址' }] } as DetailViewSection}
        data={{ billing_address: { street: '中策路 1 号', city: '杭州' } }}
        objectSchema={objectSchema}
      />,
    );
    expect(screen.getByText('中策路 1 号, 杭州')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/undefined/);
  });
});
