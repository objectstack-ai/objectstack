/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetailSection } from '../DetailSection';
import type { DetailViewSection } from '@object-ui/types';

/**
 * Regression: in inline-edit mode a reference field (lookup / master_detail /
 * user) whose value arrived `$expand`-ed as a record object used to fall
 * through to a generic <input> and render `String({...})` → "[object Object]".
 * It must now render the lookup picker (no raw object leak) and never surface
 * the "[object Object]" string in any editable input.
 */
describe('DetailSection inline-edit reference fields', () => {
  const objectSchema = {
    fields: {
      project: { type: 'master_detail', reference: 'projects' },
      factory: { type: 'lookup', reference: 'factories' },
      title: { type: 'text' },
    },
  };

  const section: DetailViewSection = {
    fields: [
      { name: 'project', label: '所属项目' },
      { name: 'factory', label: '制作工厂' },
      { name: 'title', label: '标题' },
    ],
  } as DetailViewSection;

  // Values as the server returns them with $expand: nested record objects.
  const data = {
    project: { _id: 'p1', name: 'Apollo' },
    factory: { id: 'f9', name: 'Shenzhen Plant' },
    title: 'Hello',
  };

  it('never renders "[object Object]" for expanded reference values in edit mode', () => {
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        isEditing
      />,
    );
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(screen.queryByDisplayValue(/\[object Object\]/)).toBeNull();
  });

  it('renders an editable text input for plain text fields', () => {
    render(
      <DetailSection
        section={section}
        data={data}
        objectSchema={objectSchema}
        isEditing
      />,
    );
    // The plain text field keeps its string value in an editable input.
    expect(screen.getByDisplayValue('Hello')).toBeInTheDocument();
  });
});

/**
 * objectui#2572 (live dogfood find): the field enrichment copied an explicit
 * whitelist that dropped `min`/`max`/`step`, so a currency field declaring
 * `min: 0` rendered a numeric editor with no range constraints. The enrichment
 * must pass them through to the edit widget.
 */
describe('DetailSection inline-edit numeric constraints', () => {
  it('passes metadata min/max/step through to the numeric editor', () => {
    render(
      <DetailSection
        section={{ fields: [{ name: 'budget', label: 'Budget' }] } as DetailViewSection}
        data={{ budget: 150000 }}
        objectSchema={{ fields: { budget: { type: 'currency', scale: 2, min: 0, max: 500000 } } }}
        isEditing
      />,
    );
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '500000');
    expect(input).toHaveAttribute('step', '0.01');
    expect(input).toHaveValue(150000);
  });
});
