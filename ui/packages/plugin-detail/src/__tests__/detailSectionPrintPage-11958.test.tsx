/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11958 — on a page that declares `print`, a collapsible detail
 * section draws open.
 *
 * `record:details` is in the spec's printable block subset because it prints
 * every field it declares. A section collapsed on screen unmounts its rows
 * (Radix `CollapsibleContent`), so on paper it would carry its heading and
 * none of its values. Under a `PrintPageProvider` (mounted by `PageRenderer`
 * for a page whose `print` is an object) the section is open whatever its
 * `defaultCollapsed`; off a print page the disclosure state is unchanged.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer, PrintPageProvider } from '@object-ui/react';
// Module scope: importing the package index runs the registrations under test.
import '../index';

const collapsedSection = {
  type: 'detail-section',
  title: 'Billing Address',
  collapsible: true,
  defaultCollapsed: true,
  fields: [
    { name: 'street', label: 'Street' },
    { name: 'city', label: 'City' },
  ],
} as never;

const RECORD = { street: '1 Market St', city: 'San Francisco' };

afterEach(() => cleanup());

describe('a collapsible detail section on a print page draws open (objectui#11958)', () => {
  it('a section authored collapsed shows its values under a print page', () => {
    render(
      <PrintPageProvider value={{ paperSize: 'A4' }}>
        <SchemaRenderer schema={collapsedSection} data={RECORD} />
      </PrintPageProvider>,
    );
    expect(screen.getByText('1 Market St')).toBeTruthy();
    // Open, with no disclosure control left on paper (objectui#12732).
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });

  it('CONTROL — off a print page the same section stays collapsed', () => {
    render(<SchemaRenderer schema={collapsedSection} data={RECORD} />);
    expect(screen.queryByText('1 Market St')).toBeNull();
    expect(document.querySelector('[aria-expanded="false"]')).not.toBeNull();
  });
});
