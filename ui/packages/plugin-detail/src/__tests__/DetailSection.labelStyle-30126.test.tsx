/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A record page writes every field label in one style (objectstack#30126
 * row 6).
 *
 * The sighting, in a zh console: `REPAIR COST` beside 负责人. The section
 * label carried a case transform, which only Latin text takes, so an
 * untranslated label read in capitals beside a translated one, and both
 * differed from the highlights strip above them. A section label now renders
 * as authored, in the strip's style.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { DetailViewSection, HighlightField } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

afterEach(() => cleanup());

const objectSchema = {
  fields: {
    repair_cost: { name: 'repair_cost', type: 'number', label: 'Repair Cost' },
    owner_name: { name: 'owner_name', type: 'text', label: '负责人' },
    status: { name: 'status', type: 'text', label: 'Status' },
  },
};

const data = { repair_cost: 1280, owner_name: '李四', status: 'Open' };

const section = {
  title: 'Details',
  fields: [
    { name: 'repair_cost', label: 'Repair Cost', type: 'number' },
    { name: 'owner_name', label: '负责人', type: 'text' },
  ],
} as unknown as DetailViewSection;

/** The element that holds exactly `text` (the label, not its row). */
const labelEl = (text: string) => screen.getByText(text, { exact: true });

describe('one field label style on a record page (objectstack#30126 row 6)', () => {
  it('a Latin label and a CJK label in a section share one style, with no case transform', () => {
    render(<DetailSection section={section} data={data} objectSchema={objectSchema} />);
    const latin = labelEl('Repair Cost');
    const cjk = labelEl('负责人');
    expect(latin.className).toBe(cjk.className);
    expect(latin.className.split(/\s+/)).not.toContain('uppercase');
  });

  it('a section label reads in the highlights strip’s style', () => {
    render(
      <>
        <HeaderHighlight
          fields={[{ name: 'status', label: 'Status' }] satisfies HighlightField[]}
          data={data}
          objectSchema={objectSchema}
        />
        <DetailSection section={section} data={data} objectSchema={objectSchema} />
      </>,
    );
    expect(labelEl('Repair Cost').className).toBe(labelEl('Status').className);
  });
});
