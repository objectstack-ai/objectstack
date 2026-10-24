/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8678: four cell renderers drew a face that did not depend on the
 * value, so an EMPTY cell looked exactly like a populated one.
 *
 * `password` / `secret` drew the six-dot mask, and `vector` / `grid` printed
 * `[Vector]` / `[Grid]`, for every input including `null`. All four were
 * argument-less arrows in `getCellRenderer`'s standard table. A credential that
 * was never set was drawn exactly like one that is set, which is what the
 * platform's read contract exists to prevent: `SECRET_MASK` (imported below)
 * is served only for a set credential, and an unset one "reads back `null`
 * instead, never this mask".
 *
 * Found by objectui#8596's instrument (render every registered type against the
 * empty-shaped inputs, then diff), which is the only kind of reading that sees
 * this class: a value-independent renderer looks ordinary to a source read and
 * to any single-input render. The before/after census is in the PR. This file
 * re-derives the after side on every run instead of restating it.
 *
 * ── The ruling this implements (triage on the card) ───────────────────────
 * "Masking a populated `password` is correct and must stay. Drawing the mask
 * over `null` is the defect." The deliverable is that the EMPTY cases become
 * distinguishable. ⛔ No stored value is ever printed, so every populated case
 * below also asserts the value is absent from the DOM.
 *
 * ── "Empty", per value class, read from the spec (never from the card) ────
 *   - `password` / `secret` are `STRING_VALUE_TYPES` members. Empty is
 *     `TextCellRenderer`'s predicate: the floor on the coerced text. `{}` is a
 *     stored value (objectui#8596's string-class ruling) and a whitespace-only
 *     string is too, so both keep the mask. THE RULE pins this byte-equal to
 *     `text`.
 *   - `vector` is `z.array(z.number())` in `valueSchemaFor`. `grid` is not a
 *     spec `FieldType`, and its class is `GridField`'s own contract, an array
 *     of row objects. Empty for both is the floor exactly (`null`, `undefined`,
 *     `''`, `[]`). `{}` is NOT added: the spec's write seam refuses it for
 *     `vector` (pinned below as a premise), and `hasCellValue` in
 *     `@object-ui/plugin-detail` calls every object filled, so an extra `{}`
 *     clause would draw "No value" inside a row that band calls filled.
 *
 * ── What refuses the caricature ───────────────────────────────────────────
 * The caricature is "draw `EmptyValue` for everything", which satisfies every
 * empty row here. `POPULATED` refuses it: one real value per type, and each
 * must render the face it drew before this card BYTE-FOR-BYTE. The literal
 * bytes are pinned, because "unchanged" is the claim.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FieldType, SECRET_MASK, STRING_VALUE_TYPES, valueSchemaFor } from '@objectstack/spec/data';
import {
  getCellRenderer,
  listCellRendererTypes,
  resolveCellRendererType,
  type CellRendererProps,
} from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  const field = { type, name: type } as unknown as CellRendererProps['field'];
  return render(<Renderer value={value} field={field} />);
}

const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(empty?.getAttribute('aria-label'), `${label}: it must carry its accessible name`).toBe(
    'No value',
  );
}

/** The four types this card is about. */
const MASKED = ['password', 'secret'] as const;
const LITERAL = ['vector', 'grid'] as const;
const FOUR = [...MASKED, ...LITERAL] as const;

/**
 * The populated face each type drew BEFORE this card, as bytes. A stored value
 * must still produce exactly this.
 */
const POPULATED_FACE: Record<(typeof FOUR)[number], string> = {
  password: '<span>••••••</span>',
  secret: '<span>••••••</span>',
  vector: '<span class="text-gray-500 italic">[Vector]</span>',
  grid: '<span class="text-gray-500 italic">[Grid]</span>',
};

/** One real stored value per type: the lit control. */
const POPULATED_VALUE: Record<(typeof FOUR)[number], unknown> = {
  password: 'hunter2',
  // What the platform actually serves for a set secret on a masked read.
  secret: SECRET_MASK,
  vector: [0.12, -0.5, 0.33],
  grid: [{ product: 'Widget', qty: 2 }],
};

/**
 * THE CENSUS for the four: objectui#8596's inputs plus `undefined`, and what
 * each type must draw. `true` means the shared affordance, `false` means the
 * populated face in `POPULATED_FACE`.
 */
const EMPTY_SHAPED: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['[]', []],
  ['{}', {}],
  ["''", ''],
  ['null', null],
  ['undefined', undefined],
];
const DRAWS_AFFORDANCE: Record<(typeof FOUR)[number], Record<string, boolean>> = {
  password: { '[]': true, '{}': false, "''": true, null: true, undefined: true },
  secret: { '[]': true, '{}': false, "''": true, null: true, undefined: true },
  vector: { '[]': true, '{}': false, "''": true, null: true, undefined: true },
  grid: { '[]': true, '{}': false, "''": true, null: true, undefined: true },
};

describe('objectui#8678 — an empty password / secret / vector / grid cell says "No value"', () => {
  describe('THE PREMISE — read from the installed spec, not from this file', () => {
    it('`password` / `secret` are string-class members, and `vector` / `grid` are not', () => {
      for (const t of MASKED) {
        expect(STRING_VALUE_TYPES.has(t), `${t} is a STRING_VALUE_TYPES member`).toBe(true);
      }
      for (const t of LITERAL) {
        expect(STRING_VALUE_TYPES.has(t), `${t} is NOT a string-class member`).toBe(false);
      }
    });

    it('the spec write seam refuses `{}` for a `vector`, and `grid` is no spec field type at all', () => {
      const vector = valueSchemaFor({ type: 'vector' });
      // The lit half first: the schema accepts a real embedding, so the refusal
      // below is a refusal and not a schema that rejects everything.
      expect(vector.safeParse([0.1, 0.2]).success, 'a real embedding is a vector').toBe(true);
      expect(vector.safeParse({}).success, '{} is not a vector').toBe(false);
      expect(FieldType.options, 'control: `vector` IS a spec field type').toContain('vector');
      expect(FieldType.options, '`grid` is not a spec field type').not.toContain('grid');
    });

    it('all four are registered cell-renderer types (the census population is real)', () => {
      const registered = listCellRendererTypes();
      for (const t of FOUR) expect(registered, `${t} is registered`).toContain(t);
    });
  });

  describe('THE CENSUS — what each of the four draws for every empty-shaped input', () => {
    for (const type of FOUR) {
      for (const [label, value] of EMPTY_SHAPED) {
        const empty = DRAWS_AFFORDANCE[type][label];
        it(`THE CENSUS — \`${type}\` holding ${label} draws ${empty ? 'the affordance' : 'its stored-value face'}`, () => {
          const { container } = renderCell(type, value);
          if (empty) {
            // Defect-absence FIRST: on the unfixed tree this is the sentence
            // that fails (the mask or the literal over nothing).
            expect(
              container.innerHTML,
              `${type} holding ${label}: nothing is stored, so the stored-value face is a false claim`,
            ).not.toBe(POPULATED_FACE[type]);
            expectAffordance(container, `${type} holding ${label}`);
          } else {
            expect(affordance(container), `${type} holding ${label}: this is a stored value`).toBeNull();
            expect(container.innerHTML, `${type} holding ${label}: the stored-value face is unchanged`).toBe(
              POPULATED_FACE[type],
            );
          }
        });
      }
    }
  });

  describe('THE RULE — `password` / `secret` answer "empty" exactly as `text` does', () => {
    for (const type of MASKED) {
      it(`THE RULE — \`${type}\` renders BYTE-EQUAL to \`text\` for every input \`text\` calls empty`, () => {
        for (const [label, value] of [...EMPTY_SHAPED, ["['']", ['']] as const]) {
          const control = renderCell('text', value);
          const controlHtml = control.container.innerHTML;
          const controlEmpty = affordance(control.container) !== null;
          cleanup();
          const { container } = renderCell(type, value);
          if (controlEmpty) {
            expect(container.innerHTML, `${type} holding ${label}: must render what \`text\` renders`).toBe(
              controlHtml,
            );
          } else {
            // `text` prints the coerced value. A masked type must NOT: it draws
            // the mask and nothing of the value.
            expect(container.innerHTML, `${type} holding ${label}: a stored value keeps the mask`).toBe(
              POPULATED_FACE[type],
            );
          }
          cleanup();
        }
      });
    }

    it('THE RULE — control: `text` really does call some of those inputs empty and not others', () => {
      // Without this, a `text` that drew the affordance for everything (or for
      // nothing) would make the rule above compare against a constant.
      expect(affordance(renderCell('text', null).container), 'text calls null empty').not.toBeNull();
      cleanup();
      expect(affordance(renderCell('text', {}).container), 'text calls {} a value').toBeNull();
    });
  });

  describe('POPULATED — a stored value keeps its face byte-for-byte (refuses "EmptyValue for everything")', () => {
    for (const type of FOUR) {
      it(`POPULATED — \`${type}\` holding a real value draws exactly the face it drew before`, () => {
        const { container } = renderCell(type, POPULATED_VALUE[type]);
        expect(affordance(container), `${type}: a stored value is not "No value"`).toBeNull();
        expect(container.innerHTML, `${type}: the populated face is unchanged`).toBe(POPULATED_FACE[type]);
      });
    }

    for (const type of MASKED) {
      it(`POPULATED — \`${type}\` never puts the stored value in the DOM, text or attribute`, () => {
        const secretValue = 'sk_live_do_not_render';
        const { container } = renderCell(type, secretValue);
        // Lit half: the cell rendered something, so the absence below is not an
        // empty container passing by default.
        expect(container.innerHTML, `${type}: the mask rendered`).toBe(POPULATED_FACE[type]);
        expect(container.innerHTML, `${type}: the stored value must not reach the DOM`).not.toContain(
          secretValue,
        );
      });
    }
  });

  describe('THE BOUNDARY — what counts as stored, per value class', () => {
    for (const type of MASKED) {
      it(`THE BOUNDARY — \`${type}\` holding a whitespace-only string keeps the mask, as \`text\` keeps its spaces`, () => {
        const { container } = renderCell(type, '   ');
        expect(affordance(container), `${type}: a blank credential is still a set one`).toBeNull();
        expect(container.innerHTML).toBe(POPULATED_FACE[type]);
      });
    }

    for (const type of LITERAL) {
      it(`THE BOUNDARY — \`${type}\` holding an object with a member keeps its literal (real data is never hidden)`, () => {
        const { container } = renderCell(type, { a: 1 });
        expect(affordance(container), `${type}: an object with a member is not "No value"`).toBeNull();
        expect(container.innerHTML).toBe(POPULATED_FACE[type]);
      });
    }
  });

  describe('IDENTITY — every table entry is ONE component across resolutions', () => {
    it('every registered type resolves to the same function object twice', () => {
      // `EmptyValue` holds a hook. An inline arrow in the standard table is a
      // new component TYPE on every resolution, and both production call sites
      // resolve inside render, so React would remount the cell and tear that
      // hook down per render. This card turned the last four inline entries
      // into named renderers, so the property now holds table-wide.
      const types = listCellRendererTypes();
      expect(types.length, 'the registry reading is not empty').toBeGreaterThan(0);
      for (const t of FOUR) expect(types, `${t} is covered`).toContain(t);
      const unstable = types.filter((t) => getCellRenderer(t) !== getCellRenderer(t));
      expect(unstable, 'types whose renderer is a fresh function on every resolution').toEqual([]);
    });
  });
});
