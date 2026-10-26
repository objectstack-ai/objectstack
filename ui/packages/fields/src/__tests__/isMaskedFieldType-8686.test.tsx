/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `isMaskedFieldType()` is THE authority for "is this field type's cell drawn
 * as a mask?" (objectui#8686), and `MASKED_FIELD_TYPES` is the set behind it.
 *
 * Before this card the fact had no queryable home: the mask lived as two table
 * entries inside `getCellRenderer`'s standard map, so every consumer that had
 * to honour it (the detail page's copy refusal, objectui#8440) kept its own
 * list. The ruling on objectui#8686: the predicate reads the LIVE renderer
 * registration where it can, falling back to the declared set.
 *
 * Three families of pins:
 *
 *  - DECLARED — every member of the set answers `true` AND its cell really
 *    draws the mask, with a lit non-masked control. The set is tied to what
 *    the cell draws, not only to itself.
 *  - CENSUS — over every type `getCellRenderer` resolves to a renderer of its
 *    own, the predicate agrees with the resolver: `true` exactly where the
 *    resolved renderer is the mask. A future edit that grows the table with a
 *    second masked entry outside the set, or answers from a list again, goes
 *    red by name.
 *  - RUNTIME — the override behaviour the ruling asked to be decided:
 *    registering the mask under a NEW type masks it; replacing a declared
 *    type's mask with one of this package's renderers unmasks it; replacing it
 *    with a host component this package cannot read keeps the declared answer.
 *
 * ⚠️ `registerFieldRenderer` has no inverse and the RUNTIME cases mutate the
 * registry, so this file is a `.tsx`: it lands in the `dom` project, which keeps
 * `isolate: true` (the `unit` project shares one module graph across files).
 * The pristine-state families are declared first and run first, and every
 * override case restores the mask it replaced.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import {
  getCellRenderer,
  isMaskedFieldType,
  listCellRendererTypes,
  MASKED_FIELD_TYPES,
  registerFieldRenderer,
  TextCellRenderer,
  type CellRendererProps,
} from '../index';

afterEach(() => cleanup());

const MASK_TEXT = '••••••';
const RAW = 'objectui-8686-raw-credential';

/**
 * The mask renderer, captured through the public resolver BEFORE anything in
 * this file touches the registry. It is not exported, and does not need to be:
 * `getCellRenderer('password')` is how a host reaches it too.
 */
const MASK_RENDERER = getCellRenderer('password');

function renderCell(type: string, value: unknown): HTMLElement {
  const Renderer = getCellRenderer(type);
  const field = { type, name: type } as unknown as CellRendererProps['field'];
  return render(<Renderer value={value} field={field} />).container;
}

describe('objectui#8686 — DECLARED: the set, the predicate and the drawn mask are one fact', () => {
  it('the declared set is non-empty, so every loop below runs', () => {
    expect(MASKED_FIELD_TYPES.size, 'an empty set would make the loops vacuous').toBeGreaterThan(0);
  });

  for (const type of MASKED_FIELD_TYPES) {
    it(`\`${type}\` is masked: the predicate says so AND the cell draws the mask`, () => {
      expect(isMaskedFieldType(type), `${type} is a declared masked type`).toBe(true);
      const cell = renderCell(type, RAW);
      expect(cell.textContent, `${type}: the cell drew the mask`).toBe(MASK_TEXT);
      expect(cell.innerHTML, `${type}: the stored value never reaches the DOM`).not.toContain(RAW);
    });
  }

  it('LIT CONTROL — `text` is not masked, and its cell draws the value', () => {
    expect(MASKED_FIELD_TYPES.has('text'), 'control: `text` is not declared masked').toBe(false);
    expect(isMaskedFieldType('text'), '`text` is not masked').toBe(false);
    const cell = renderCell('text', RAW);
    expect(cell.textContent, 'the same probe value IS drawn by a non-masked cell').toContain(RAW);
  });

  it('no type, and spellings the cell path does not resolve, are not masked', () => {
    expect(isMaskedFieldType(undefined)).toBe(false);
    expect(isMaskedFieldType('')).toBe(false);
    expect(isMaskedFieldType('objectui-8686-never-registered')).toBe(false);
    // The form-alias spelling renders in the clear: `getCellRenderer` is an
    // exact-key lookup and does not resolve `field:` aliases.
    expect(getCellRenderer('field:password'), 'control: the alias spelling falls to text').toBe(
      TextCellRenderer,
    );
    expect(isMaskedFieldType('field:password'), 'so it is not masked either').toBe(false);
  });
});

describe('objectui#8686 — CENSUS: the predicate agrees with the resolver on every registered type', () => {
  it('`true` exactly where the resolved renderer is the mask, over the live registry reading', () => {
    const types = listCellRendererTypes();
    // Lit halves: the population holds every declared member and at least one
    // type that is not masked, so the agreement below compares both answers.
    for (const t of MASKED_FIELD_TYPES) expect(types, `${t} is in the census`).toContain(t);
    expect(types, 'a non-masked control type is in the census').toContain('text');

    const disagreeing = types.filter(
      (t) => isMaskedFieldType(t) !== (getCellRenderer(t) === MASK_RENDERER),
    );
    expect(disagreeing, 'types where the predicate and the drawn cell disagree').toEqual([]);

    const masked = types.filter((t) => isMaskedFieldType(t));
    expect(
      [...masked].sort(),
      'with nothing registered at runtime, the masked types are exactly the declared set',
    ).toEqual([...MASKED_FIELD_TYPES].sort());
  });
});

describe('objectui#8686 — RUNTIME: the live registration is read, the declared set is the fallback', () => {
  it('registering THE mask under a NEW type masks it, with no declared-set edit', () => {
    const type = 'objectui_8686_api_token';
    // Control leg — attributes the answer below to the registration.
    expect(isMaskedFieldType(type), 'control: an unregistered type is not masked').toBe(false);
    expect(renderCell(type, RAW).textContent, 'control: it draws the value').toContain(RAW);
    cleanup();

    registerFieldRenderer(type, getCellRenderer('password'));

    expect(MASKED_FIELD_TYPES.has(type), 'the declared set was not edited').toBe(false);
    expect(isMaskedFieldType(type), 'the live registration is read').toBe(true);
    expect(renderCell(type, RAW).textContent, 'and the cell draws the mask').toBe(MASK_TEXT);
  });

  it("replacing a declared type's mask with one of this package's renderers UNMASKS it", () => {
    const type = 'password';
    expect(isMaskedFieldType(type), 'control: masked before the override').toBe(true);
    try {
      registerFieldRenderer(type, TextCellRenderer);
      // The override took effect: the cell now shows the value.
      expect(renderCell(type, RAW).textContent, 'the overridden cell draws the value').toContain(
        RAW,
      );
      expect(isMaskedFieldType(type), 'the predicate follows the cell').toBe(false);
    } finally {
      registerFieldRenderer(type, MASK_RENDERER);
    }
    expect(isMaskedFieldType(type), 'restored: masked again').toBe(true);
  });

  it("replacing a declared type's mask with a HOST component keeps the declared answer", () => {
    const type = 'secret';
    // A host's own mask: this package cannot tell it from a component that
    // prints the value, so it answers with the declared set, on the side that
    // withholds the value.
    const HostMask: React.FC<CellRendererProps> = () => <span>[hidden by host]</span>;
    expect(isMaskedFieldType(type), 'control: masked before the override').toBe(true);
    try {
      registerFieldRenderer(type, HostMask);
      expect(getCellRenderer(type), 'the override took effect').toBe(HostMask);
      expect(isMaskedFieldType(type), 'an unreadable override falls back to the declared set').toBe(
        true,
      );
    } finally {
      registerFieldRenderer(type, MASK_RENDERER);
    }
  });

  it('a HOST component under an undeclared type is not masked: the set is the only fallback', () => {
    const type = 'objectui_8686_host_only';
    const HostCell: React.FC<CellRendererProps> = () => <span>host</span>;
    registerFieldRenderer(type, HostCell);
    expect(getCellRenderer(type), 'control: the host component is registered').toBe(HostCell);
    expect(isMaskedFieldType(type)).toBe(false);
  });
});
