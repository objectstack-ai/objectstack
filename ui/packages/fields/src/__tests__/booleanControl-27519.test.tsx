/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27519 — one type-to-widget map for the two boolean types.
 *
 * Studio's type picker offers "Checkbox — shown as a checkbox" (`boolean`) and
 * "Toggle — shown as a switch" (`toggle`). Both resolve to the one
 * `field:boolean` widget, which drew a switch unless the field carried
 * `widget: 'checkbox'`, so a field authored as Checkbox drew a switch in the
 * record form and in the grid's inline editor. `resolveBooleanControl` is the
 * one answer every surface reads (the Studio canvas preview included, pinned
 * beside `ObjectFormDesigner`); these pin it and the two runtime hosts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { resolveBooleanControl } from '../index';
import { BooleanField } from '../widgets/BooleanField';
import { FieldEditWidget } from '../FieldEditWidget';

afterEach(cleanup);

describe('resolveBooleanControl', () => {
  it.each([
    [{ type: 'boolean' }, 'checkbox'],
    [{ type: 'toggle' }, 'switch'],
    // The bare widget id of a hand-authored form entry, and no type at all:
    // the `boolean` type's own face.
    [{ type: 'field:boolean' }, 'checkbox'],
    [{}, 'checkbox'],
    [undefined, 'checkbox'],
  ] as const)('%o draws a %s by its type', (field, control) => {
    expect(resolveBooleanControl(field)).toBe(control);
  });

  it.each([
    [{ type: 'boolean', widget: 'switch' }, 'switch'],
    [{ type: 'boolean', widget: 'toggle' }, 'switch'],
    [{ type: 'toggle', widget: 'checkbox' }, 'checkbox'],
    [{ type: 'toggle', widget: 'boolean' }, 'checkbox'],
  ] as const)('an explicit boolean widget wins: %o draws a %s', (field, control) => {
    expect(resolveBooleanControl(field)).toBe(control);
  });

  it('a widget that names no boolean face leaves the type to answer', () => {
    expect(resolveBooleanControl({ type: 'toggle', widget: 'star_rating' })).toBe('switch');
    expect(resolveBooleanControl({ type: 'boolean', widget: '' })).toBe('checkbox');
  });
});

const roleDrawn = (): string | null => {
  const el = document.querySelector('[role="switch"], [role="checkbox"]');
  return el?.getAttribute('role') ?? null;
};

describe('the record form widget and the inline editor draw the same face', () => {
  it.each([
    ['boolean', undefined, 'checkbox'],
    ['toggle', undefined, 'switch'],
    ['boolean', 'switch', 'switch'],
    ['toggle', 'checkbox', 'checkbox'],
  ] as const)('BooleanField: type %s, widget %s draws a %s', (type, widget, role) => {
    render(
      <BooleanField
        value={false}
        onChange={() => {}}
        field={{ name: 'urgent', label: 'Urgent', type, widget } as any}
      />,
    );
    expect(roleDrawn()).toBe(role);
  });

  it.each([
    ['boolean', 'checkbox'],
    ['toggle', 'switch'],
  ] as const)('FieldEditWidget: type %s draws a %s', (type, role) => {
    render(
      <FieldEditWidget
        value={false}
        onChange={() => {}}
        field={{ name: 'urgent', label: 'Urgent', type } as any}
      />,
    );
    expect(roleDrawn()).toBe(role);
  });
});
