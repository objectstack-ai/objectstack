/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8677 — `signature` is a `STRING_VALUE_TYPES` member, and its cell
 * answered `{}` with the media rule instead of its value class's answer.
 *
 * `@objectstack/spec` places `signature` in `STRING_VALUE_TYPES` ("Value is a
 * plain string"; the write seam is `z.string()` — a data-URI PNG), NOT in
 * `FILE_REFERENCE_TYPES` with `image` / `avatar`. objectui#8580 ruled the cell
 * output of that class's empty-shaped values and objectui#8596 applied the
 * ruling to the rest of the class: `[]`, `''` and `null` draw the shared
 * "No value" affordance, and `{}` prints `coerceToSafeValue`'s answer exactly
 * as `text` prints it, because the record IS storing something. `signature`
 * was the straggler: `getCellRenderer` mapped it to `ImageCellRenderer`, whose
 * answer for a value with nothing to draw is the MEDIA rule — "No value" — so
 * `{}` drew the affordance where every sibling printed `[Object]`.
 *
 * Measured through `getCellRenderer` before and after the fix, the four
 * empty-shaped inputs: only the `{}` cell moved; `[]`, `''` and `null` render
 * the same bytes on both sides (the affordance, which both renderers draw).
 * The before/after readings are in the PR; this file re-derives the after
 * side on every run rather than restating it.
 *
 * ── What is read, not written down ────────────────────────────────────────
 *   - The class is `STRING_VALUE_TYPES` IMPORTED from the installed
 *     `@objectstack/spec`, never a copied list: a member joining or leaving
 *     the class moves this census with it.
 *   - The reference face is `text`'s, rendered live — ⛔ no stored bytes.
 *   - The class's masked credential types draw ONE face for every stored value
 *     (the mask), and since objectui#8678 the shared affordance when nothing is
 *     stored. `{}` is a stored value to them, so they still cannot "match"
 *     `text` there, and they are excluded by name. The exclusion is itself
 *     measured: a member listed there that starts drawing its value turns the
 *     census red, so the list cannot outlive its reason.
 *
 * ── What must NOT move (the load-bearing half) ────────────────────────────
 * The caricature is "`signature` prints its coerced text for everything". It
 * passes every empty-shaped row. What refuses it:
 *   1. `POPULATED`, which renders a real signature — the stored data-URI
 *      string, and the URL / reference shapes the image arm already resolved —
 *      and requires an `<img>` byte-equal to what `image` draws for the same
 *      value, and
 *   2. the `image` / `avatar` CONTROLS, which still answer `{}` with the
 *      affordance (the media rule is right for them) and still resolve to
 *      `ImageCellRenderer` itself.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, with the SAME specifier `MarkdownCellRenderer`'s `React.lazy`
// factory uses, so the markdown sibling is resolved before any assertion
// reads it — AGENTS.md 测试纪律.
import '../widgets/MarkdownContent.js';
import { STRING_VALUE_TYPES, FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import {
  getCellRenderer,
  listCellRendererTypes,
  resolveCellRendererType,
  ImageCellRenderer,
  type CellRendererProps,
} from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  // `value` is `any` on the props already; the probe field is a stand-in, not
  // a full `FieldMetadata`, which is all a read-mode cell reads here.
  const field = { type, name: type } as unknown as CellRendererProps['field'];
  return render(<Renderer value={value} field={field} />);
}

/** Let the (already imported) lazy markdown pipeline resolve its Suspense. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

const textOf = (root: HTMLElement) => (root.textContent ?? '').replace(/\s+/g, ' ').trim();

interface Face {
  text: string;
  hasAffordance: boolean;
  html: string;
}

async function faceOf(type: string, value: unknown): Promise<Face> {
  const { container } = renderCell(type, value);
  await settle();
  const face = {
    text: textOf(container),
    hasAffordance: affordance(container) !== null,
    html: container.innerHTML,
  };
  cleanup();
  return face;
}

/** The four empty-shaped inputs objectui#8580 ruled for the string class. */
const EMPTY_SHAPED: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['[]', []],
  ['{}', {}],
  ["''", ''],
  ['null', null],
];

/**
 * Members of the class whose face never depends on WHAT is stored. A masked
 * credential draws the same dots for every stored value, `{}` included, and the
 * shared affordance only when nothing is stored (objectui#8678). Excluded from
 * the sibling comparison by name; `THE CENSUS` measures that each one really
 * is masked, so this list goes red rather than stale.
 */
const MASKED_FACES: ReadonlySet<string> = new Set(['password', 'secret']);

const REGISTERED: ReadonlySet<string> = new Set(listCellRendererTypes());

/** The value class, read from the spec, restricted to types with a renderer. */
const CLASS_MEMBERS: readonly string[] = [...STRING_VALUE_TYPES].filter((t) => REGISTERED.has(t)).sort();

/** The siblings `signature` is held to: every value-bearing class member. */
const SIBLINGS: readonly string[] = CLASS_MEMBERS.filter(
  (t) => t !== 'signature' && !MASKED_FACES.has(t),
);

/** A real stored signature: the widget saves `canvas.toDataURL('image/png')`. */
const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('objectui#8677 — `signature` answers empty-shaped values as its value class does', () => {
  describe('THE PREMISE — read from the installed spec, not from this file', () => {
    it('the spec puts `signature` in the string class and `image` / `avatar` in the media class', () => {
      expect(STRING_VALUE_TYPES.has('signature'), 'signature is a STRING_VALUE_TYPES member').toBe(true);
      expect(FILE_REFERENCE_TYPES.has('signature'), 'signature is NOT a file reference').toBe(false);
      for (const media of ['image', 'avatar'] as const) {
        expect(FILE_REFERENCE_TYPES.has(media), `${media} is a FILE_REFERENCE_TYPES member`).toBe(true);
        expect(STRING_VALUE_TYPES.has(media), `${media} is NOT a string-class member`).toBe(false);
      }
    });

    it('the census population is real: the class has registered members, `text` among the siblings', () => {
      // A comparison over an empty sibling list passes without comparing
      // anything. `text` is the class's reference renderer — its presence is
      // the control that the filter above did not empty the list.
      expect(CLASS_MEMBERS, 'signature has a cell renderer of its own').toContain('signature');
      expect(SIBLINGS, 'text is a sibling signature is compared against').toContain('text');
      for (const t of MASKED_FACES) {
        expect(STRING_VALUE_TYPES.has(t), `${t}: an exclusion must name a class member`).toBe(true);
      }
    });
  });

  describe('THE CENSUS — `signature` against its value class, for [] / {} / \'\' / null', () => {
    for (const [label, value] of EMPTY_SHAPED) {
      it(`THE CENSUS — \`signature\` holding ${label} renders BYTE-EQUAL to \`text\``, async () => {
        const control = await faceOf('text', value);
        // The control must be REAL before anything is compared to it: `{}`
        // prints the coerced text, the other three draw the affordance.
        if (label === '{}') {
          expect(control.text, 'control: `text` prints [Object] for {}').toBe('[Object]');
          expect(control.hasAffordance, 'control: `text` does not draw the affordance for {}').toBe(false);
        } else {
          expect(control.hasAffordance, `control: \`text\` draws the affordance for ${label}`).toBe(true);
        }

        const signature = await faceOf('signature', value);
        expect(
          signature.html,
          `signature holding ${label}: must render exactly what \`text\` renders`,
        ).toBe(control.html);
      });

      it(`THE CENSUS — \`signature\` holding ${label} draws the face every value-bearing sibling draws`, async () => {
        const signature = await faceOf('signature', value);
        const disagree: string[] = [];
        for (const sibling of SIBLINGS) {
          const face = await faceOf(sibling, value);
          if (face.text !== signature.text || face.hasAffordance !== signature.hasAffordance) {
            disagree.push(`${sibling} → ${JSON.stringify(face.text)} (affordance: ${face.hasAffordance})`);
          }
        }
        expect(
          disagree,
          `siblings whose face for ${label} differs from signature's ` +
            `${JSON.stringify(signature.text)} (affordance: ${signature.hasAffordance})`,
        ).toEqual([]);
      });
    }

    it('THE CENSUS — each excluded member really draws a masked face', async () => {
      for (const t of MASKED_FACES) {
        const a = await faceOf(t, 'alpha');
        const b = await faceOf(t, 'bravo');
        const object = await faceOf(t, {});
        expect(
          [b.html, object.html],
          `${t}: excluded as masked, so every stored value, {} included, must draw the same face`,
        ).toEqual([a.html, a.html]);
        expect(a.text, `${t}: the stored value never reaches the DOM`).not.toContain('alpha');
        expect(a.hasAffordance, `${t}: a stored value is not "No value"`).toBe(false);
        // The half objectui#8678 moved: this used to require `null` to draw the
        // mask too, which asserted a credential the record never held.
        const empty = await faceOf(t, null);
        expect(empty.hasAffordance, `${t}: nothing stored draws the shared affordance`).toBe(true);
      }
    });
  });

  describe('THE DEFECT — `{}` is not "No value" for a string-class member', () => {
    it('THE DEFECT — `signature` holding {} draws no affordance and prints [Object]', () => {
      const { container } = renderCell('signature', {});
      // Defect-absence FIRST: on the unfixed tree this is the sentence that
      // fails (the media rule's "No value").
      expect(
        affordance(container),
        'signature: {} is something the record stores, so "No value" is false of it',
      ).toBeNull();
      expect(container.querySelector('img'), 'signature: {} has no image to draw').toBeNull();
      expect(textOf(container), 'signature: reads {} as the string class reads it').toBe('[Object]');
    });

    it('an object the image arm cannot draw reads as `text` reads it, name and all', async () => {
      // The same arm, beyond {}: an object carrying a display name prints it
      // (objectui#8596's rule for the class), one carrying neither a name nor
      // an image prints [Object].
      for (const value of [{ name: 'Ada Lovelace' }, { note: 'x' }]) {
        const control = await faceOf('text', value);
        const signature = await faceOf('signature', value);
        expect(signature.html, `signature holding ${JSON.stringify(value)}: as \`text\``).toBe(control.html);
        expect(signature.hasAffordance, `signature holding ${JSON.stringify(value)}: not "No value"`).toBe(
          false,
        );
      }
    });
  });

  describe('POPULATED — a real signature still renders its image', () => {
    const POPULATED: ReadonlyArray<readonly [label: string, value: unknown, src: string]> = [
      ['the stored data-URI string', DATA_URI, DATA_URI],
      ['an expanded { url }', { url: 'https://cdn.example.com/s.png' }, 'https://cdn.example.com/s.png'],
      ['an unexpanded { id } reference', { id: 'sig_1', name: 'Signed' }, '/api/v1/storage/files/sig_1'],
    ];

    for (const [label, value, src] of POPULATED) {
      it(`POPULATED — ${label} draws its image, byte-equal to what \`image\` draws`, async () => {
        const { container } = renderCell('signature', value);
        const img = container.querySelector('img');
        expect(img, `signature holding ${label}: still draws an image`).not.toBeNull();
        expect(img?.getAttribute('src'), `signature holding ${label}: the image is the stored one`).toBe(src);
        expect(affordance(container), `signature holding ${label}: a populated cell is not "No value"`).toBeNull();
        const signatureHtml = container.innerHTML;
        cleanup();

        const image = await faceOf('image', value);
        expect(signatureHtml, `signature holding ${label}: the image arm IS the image renderer`).toBe(image.html);
      });
    }

    it('POPULATED — several images still draw as the image cell draws them', async () => {
      const value = ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'];
      const signature = await faceOf('signature', value);
      const image = await faceOf('image', value);
      expect(signature.html, 'several signature images render as `image` renders them').toBe(image.html);
      const { container } = renderCell('signature', value);
      expect(container.querySelectorAll('img').length, 'both images are drawn').toBe(2);
    });
  });

  describe('THE CONTROLS — `image` / `avatar` are a different value class, and did not move', () => {
    it('`image` and `avatar` still resolve to `ImageCellRenderer` itself', () => {
      expect(getCellRenderer('image'), 'image still resolves to ImageCellRenderer').toBe(ImageCellRenderer);
      expect(getCellRenderer('avatar'), 'avatar still resolves to ImageCellRenderer').toBe(ImageCellRenderer);
    });

    for (const media of ['image', 'avatar'] as const) {
      it(`\`${media}\` still answers every empty-shaped value, {} included, with the affordance (the media rule)`, async () => {
        for (const [label, value] of EMPTY_SHAPED) {
          const face = await faceOf(media, value);
          expect(face.hasAffordance, `${media} holding ${label}: "No value" is true of a file with no url`).toBe(
            true,
          );
          expect(face.text, `${media} holding ${label}: the affordance's glyph`).toBe('—');
        }
      });

      it(`\`${media}\` still draws a populated value as an image`, async () => {
        const { container } = renderCell(media, { url: 'https://cdn.example.com/a.png' });
        expect(
          container.querySelector('img')?.getAttribute('src'),
          `${media}: a populated value still draws its image`,
        ).toBe('https://cdn.example.com/a.png');
      });
    }

    it('THE BOUNDARY — `signature` and `image` part ways on {} and ONLY on {}', async () => {
      // One statement of the rule, both sides visible: the string class and
      // the media class agree on [], '' and null, and disagree on {} because
      // "No value" is false of a string-class value and true of a file value.
      for (const [label, value] of EMPTY_SHAPED) {
        const signature = await faceOf('signature', value);
        const image = await faceOf('image', value);
        if (label === '{}') {
          expect(signature.html, 'on {} the two classes answer differently').not.toBe(image.html);
        } else {
          expect(signature.html, `on ${label} the two classes answer alike`).toBe(image.html);
        }
      }
    });
  });
});
