/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The grid's cell face names its column with the label the header prints
 * (objectui#11689, the family site seat 1 recorded from objectui#11721).
 *
 * A face that names its own column — `BooleanCellRenderer`'s badge for a
 * `false` on a status-named column, when this was written — reads
 * `field.label`. The grid handed it the AUTHORED label while its header
 * printed the translated one, so under a non-en pack the badge sat under a
 * translated header and named the column in the authored language. The face
 * is now handed the header's own resolved label.
 *
 * objectui#13412 retired that badge: a `false` on any boolean is the plain
 * unchecked box, and the box names its column by its accessible name, read
 * from the same `field.label`. So the pin now reads the label off the box.
 *
 * Driven through each grid path that builds a face from the object schema:
 * object-shaped columns, string columns, and no columns at all (the columns
 * generated from the schema). Every case renders under a REAL `I18nProvider`;
 * the field label's zh translation is an app bundle key, the way a deployed
 * app's bundle carries it.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

afterEach(() => cleanup());

const OBJECT = 'sys_business_unit';
// Each def carries its `name`: the generated-columns path hands the face the
// def itself, as the other two paths do (a separate, pre-existing property of
// that path, not judged here).
const OBJECT_FIELDS = {
  name: { name: 'name', type: 'text', label: 'Name' },
  active: { name: 'active', type: 'boolean', label: 'Active' },
};
const ROWS = [{ id: 'r1', name: 'Retired Office', active: false }];

const dataSource = {
  find: async () => ({ data: ROWS, total: ROWS.length }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => true,
  getObjectSchema: async () => ({ name: OBJECT, fields: OBJECT_FIELDS }),
};

/** The three schema-backed column paths. */
const SHAPES: Record<string, Record<string, unknown>> = {
  'object-shaped columns': { columns: [{ field: 'name' }, { field: 'active' }] },
  'string columns': { columns: ['name', 'active'] },
  'columns generated from the schema': {},
};

function mount(language: string, shape: Record<string, unknown>) {
  return render(
    <I18nProvider
      config={{
        defaultLanguage: language,
        detectBrowserLanguage: false,
        resources: {
          zh: { testapp: { fields: { [OBJECT]: { active: '启用' } }, fieldOptions: {} } },
        },
      }}
      persistLanguage={false}
    >
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, ...shape } as never}
          dataSource={dataSource as never}
        />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The `active` cell's checkbox, once the schema-typed face is on screen. */
async function box(name: string): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('checkbox', { name }));
}

const headerNamed = (text: string) =>
  screen.getAllByRole('columnheader').find((h) => h.textContent?.includes(text));

describe('the grid cell face names its column as the header does (objectui#11689)', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    describe(name, () => {
      it('zh: the box is named by the translated label', async () => {
        mount('zh', shape);
        expect(await box('启用')).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByTestId('boolean-warning-badge')).toBeNull();
        // …and the label is the header's, not a second translation of it.
        expect(headerNamed('启用'), 'the header prints the translated label').toBeDefined();
      });

      it('en: the box is named Active', async () => {
        mount('en', shape);
        expect(await box('Active')).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByTestId('boolean-warning-badge')).toBeNull();
        expect(headerNamed('Active')).toBeDefined();
      });
    });
  }
});
