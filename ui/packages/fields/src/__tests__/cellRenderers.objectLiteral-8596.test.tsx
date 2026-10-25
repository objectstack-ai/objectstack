/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8596 — an object literal is not a cell value, and six renderer
 * families invented an IDENTITY for it.
 *
 * The `[]` column of this census is closed (objectui#8481 → objectui#8490 →
 * objectui#8580). This is the `{}` column. It was measured the same way, and
 * only that way: all 53 registered field types rendered through
 * `getCellRenderer` against `[]`, `{}`, `''` and `null` — 212 cells — on
 * `4eb665bcf`, then re-rendered after the fix and diffed. A regex over class
 * strings under-counted this class three separate times; the instrument is
 * below, as `THE CENSUS`, so it stays runnable.
 *
 * Measured before → after, `{}` column only (14 of 212 cells moved; the `[]`,
 * `''` and `null` columns are byte-identical):
 *
 * | field types                                        | renderer                  | `{}` before                                    | `{}` after                     |
 * |----------------------------------------------------|---------------------------|------------------------------------------------|--------------------------------|
 * | email, url, phone                                  | Email/Url/PhoneCell       | a LIVE anchor — `mailto:[Object]`, `[Object]`, `tel:[Object]` — plus a copy button | `[Object]`, as `text` prints it |
 * | color                                              | `ColorSwatchCellRenderer` | a swatch whose `background` was `[object Object]` | `[Object]`, as `text` prints it |
 * | select, status, multiselect, radio, checkboxes, tags | `SelectCellRenderer`      | a badge reading `[Object Object]`               | a badge reading `[Object]`     |
 * | user                                               | `UserCellRenderer`        | an avatar captioned `U`, labelled `User`        | `[Object]`, as `lookup` prints it |
 * | file, video, audio                                 | `FileCellRenderer`        | a chip named `File`                             | the shared `EmptyValue`        |
 *
 * ── Two rows the card named that are NOT here, both verified ──────────────
 *   - `boolean` / `toggle` LANDED (objectui#8582 / PR #8594, `70c452369`).
 *     Measured on this base, `{}` already draws the shared affordance. Not
 *     re-ruled, and pinned unchanged in `THE CENSUS` below.
 *   - `location` / `geolocation` (and `json` / `object` / `composite` /
 *     `record`) print the `{}` literal behind objectui#8481's DECLARED
 *     json-literal fence. Left alone deliberately; pinned unchanged.
 *   - `date` drew `formatDate`'s hand-rolled em-dash with no accessible name
 *     — objectui#8581's subject, the same renderer. This change did not touch
 *     it, and `THE CENSUS` pinned that it did not: the row was recorded as a
 *     dash that is NOT the affordance, so a fix landing on it here would have
 *     to move a pin rather than pass silently. It did: objectui#8581 landed,
 *     `DateCellRenderer` now answers every unparsable value with the shared
 *     affordance, and this file's two `date` assertions moved with it — the
 *     census row to `true`, and THE BOUNDARY to the fix's own record.
 *
 * ── The direction is not open per family: `valueSchemaFor`'s arm decides ──
 * Read from `@objectstack/spec` `src/data/field-value.zod.ts` (v17.3.0), per
 * family, before choosing — the card's instruction, and it separated the
 * families that print from the family that does not:
 *
 *   - `email` / `url` / `phone` / `color` are `STRING_VALUE_TYPES` — "Value is
 *     a plain string", write seam `z.string()`. The SAME set objectui#8580
 *     ruled on for `markdown` / `html` / `richtext`, and that ruling settles
 *     `{}` away from the "no value" affordance and toward the family's
 *     existing coercion: the record IS storing something, so "No value" would
 *     be false. So they print `coerceToSafeValue`'s answer — pinned BYTE-EQUAL
 *     to what `text` prints for `{}` below, so the rule cannot drift — and
 *     they draw no affordance that asserts more than that: `mailto:[Object]`
 *     cannot send mail, a copy button offers `[Object]` to the clipboard, and
 *     `background: [object Object]` is a declaration the browser drops.
 *   - the option families resolve through `SINGLE_OPTION_TYPES` /
 *     `MULTI_OPTION_TYPES` to `z.enum(codes)` — or `z.string()` when no
 *     options are declared. Either way the value is a STRING code, so the same
 *     coercion answers it; the badge stays, because a badge is how this family
 *     shows any code it was given, including one it does not recognize.
 *     (`status` is an objectui renderer alias, not a spec `FieldType`; it
 *     reaches `SelectCellRenderer` through this repo's own map and inherits
 *     the ruling from it, not from the spec.)
 *   - `user` shares `REFERENCE_VALUE_TYPES`' arm with `lookup` /
 *     `master_detail` / `tree`: `ReferenceIdValueSchema` when stored, and in
 *     expanded form `z.union([ReferenceIdValueSchema, z.record(…)])` — an
 *     OPEN record, whose "shape is that object's contract, not this field's".
 *     The spec therefore cannot tell `user` from `lookup` here, and `lookup`
 *     already answers an object it cannot name with the coerced text. Pinned
 *     byte-equal to `lookup` below.
 *   - `file` / `video` / `audio` are the family where the answer DIFFERS, and
 *     the spec names the input: `FileValueSchema` makes `url` "the one
 *     required member" and says a value with no `url` — "an empty object, a
 *     `{ name }` fragment, a number — is now rejected". `{}` is a value of
 *     neither the stored (`sys_file` id) nor the expanded form, so the record
 *     holds no file and "No value" is TRUE of it. `image` / `avatar` — the
 *     same spec family — already answered `{}` that way; `file` now agrees,
 *     and the two are pinned against each other.
 *
 * ⛔ Nothing here invents a renderer-side fallback (AGENTS.md #0.1). Every
 * family lands on a coercion this package already had, or on the affordance a
 * sibling in its own spec family already drew.
 *
 * ── Why the load-bearing cases are the ones that must NOT move ────────────
 * The caricature is the shared `EmptyValue` drawn for every cell — "the
 * mutation that makes the code answer the same thing for everything". It
 * satisfies every vivid assertion in this file: the checked checkbox is gone,
 * the `mailto:[Object]` anchor is gone, the `[object Object]` swatch is gone.
 * What refuses it is:
 *
 *   1. `THE CENSUS`, whose `{}` column pins the twenty types that already
 *      coerced correctly — `number` / `currency` / `percent` / `slider` /
 *      `rating` / `text` / `code` / `formula` / `lookup` among them — as
 *      printing their text, and
 *   2. `POPULATED`, which renders a real value into all 53 types and asserts
 *      that NONE of them draws the affordance.
 *
 * Both were RUN against the caricature; the observed failure sentences are
 * recorded in the PR, per test, from vitest's JSON reporter.
 *
 * ⚠️ A matrix pin over an EMPTY set passes. Both matrices run through
 * {@link assertCensusComplete}, which asserts the exact expected size before
 * anything is rendered, and `THE CENSUS` includes a meta-test proving that
 * guard throws when the set is emptied — a census that silently renders 0
 * types is the failure mode this file exists to avoid.
 *
 * ── Assertion order ───────────────────────────────────────────────────────
 * Each defect case asserts the ARTEFACT'S ABSENCE first (no anchor, no
 * swatch, no avatar, no `[Object Object]`, no chip) and the replacement
 * second, so the unfixed tree fails on a different sentence from a harness
 * that has lost its navigation target. Both were observed.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
// Module scope, with the SAME specifier `MarkdownCellRenderer`'s `React.lazy`
// factory uses, so the markdown pipeline is resolved before any assertion
// waits on it — AGENTS.md 测试纪律.
import '../widgets/MarkdownContent.js';
import { getCellRenderer, listCellRendererTypes, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** Let the (already imported) lazy markdown pipeline resolve its Suspense. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The shared "No value" affordance — a muted glyph carrying an aria-label. */
const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

const textOf = (root: HTMLElement) => (root.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The emptiness guard both matrices below run through.
 *
 * A `for` loop over an empty table asserts nothing and reports success, which
 * is exactly how a census stops measuring without anyone noticing. This throws
 * on the wrong size BEFORE a single cell is rendered, and the meta-test in
 * `THE CENSUS` pins that it does.
 */
function assertCensusComplete(entries: readonly unknown[], expected: number, what: string): void {
  if (entries.length !== expected) {
    throw new Error(
      `${what}: expected exactly ${expected} registered field types, got ${entries.length}. ` +
        'A census over a short or empty set passes without measuring anything.',
    );
  }
}

/**
 * Every type `getCellRenderer` resolves to a renderer of its own — READ from
 * the registry, ⛔ never written down (objectui#8734).
 *
 * This was the literal `53`. A literal is a population the census can no longer
 * notice moving: register a 54th cell renderer and its row is simply absent
 * from the table below, every assertion here still passes, and the new type
 * goes out unmeasured. `listCellRendererTypes()` is `@object-ui/fields`' live
 * reading of that same registry, so the size assertion and the set assertion
 * below both fail — by NAME — the moment the population moves.
 */
const REGISTERED_TYPES: readonly string[] = listCellRendererTypes();
const REGISTERED_TYPE_COUNT = REGISTERED_TYPES.length;

/** Which types a census table is missing, and which it invented. */
function censusDrift(entries: ReadonlyArray<readonly [string, ...unknown[]]>): {
  missing: string[];
  unknown: string[];
} {
  const measured = new Set(entries.map(([t]) => t));
  return {
    missing: REGISTERED_TYPES.filter((t) => !measured.has(t)),
    unknown: [...measured].filter((t) => !REGISTERED_TYPES.includes(t)).sort(),
  };
}

/**
 * `THE CENSUS` — what every registered type draws for `{}`, on this base.
 *
 * `text` is the coerced face of an object with no display name: the one answer
 * `coerceToSafeValue` has, and the string of characters every row marked
 * `'[Object]'` below must print. `affordance` records whether the cell draws
 * the shared "No value" glyph.
 *
 * ⚠️ `date` was recorded as `'—'` WITHOUT the affordance while
 * objectui#8581 was open: that dash was `formatDate`'s own and belonged to
 * that card's renderer, not this one's. objectui#8581 has since landed —
 * `DateCellRenderer` now intercepts every value it cannot parse (`{}` coerces
 * to `[Object]`, which `new Date` rejects) and returns the shared affordance,
 * so the row reads `true` here. Exactly as this file predicted: the fix had to
 * MOVE this pin rather than pass silently. The `date` census row and THE
 * BOUNDARY below are now this file's record of the other card's landing, and
 * the reason for the `{}` face itself is unchanged — `[Object]` is not a date.
 */
const OBJECT_LITERAL_CENSUS: ReadonlyArray<readonly [type: string, text: string, hasAffordance: boolean]> = [
  // ── the twenty that already coerced correctly — LOAD-BEARING ────────────
  ['text', '[Object]', false],
  ['textarea', '[Object]', false],
  ['markdown', '[Object]', false],
  ['html', '[Object]', false],
  ['richtext', '[Object]', false],
  ['code', '[Object]', false],
  ['qrcode', '[Object]', false],
  ['time', '[Object]', false],
  ['auto_number', '[Object]', false],
  ['number', '[Object]', false],
  ['currency', '[Object]', false],
  ['percent', '[Object]', false],
  ['progress', '[Object]', false],
  ['slider', '[Object]', false],
  ['rating', '[Object]', false],
  ['formula', '[Object]', false],
  ['summary', '[Object]', false],
  ['lookup', '[Object]', false],
  ['master_detail', '[Object]', false],
  ['tree', '[Object]', false],
  // ── the fourteen this change moved ──────────────────────────────────────
  ['email', '[Object]', false],
  ['url', '[Object]', false],
  ['phone', '[Object]', false],
  ['color', '[Object]', false],
  ['user', '[Object]', false],
  ['select', '[Object]', false],
  ['status', '[Object]', false],
  ['multiselect', '[Object]', false],
  ['radio', '[Object]', false],
  ['checkboxes', '[Object]', false],
  ['tags', '[Object]', false],
  ['file', '—', true],
  ['video', '—', true],
  ['audio', '—', true],
  // ── the straggler, moved by objectui#8677 ───────────────────────────────
  // A `STRING_VALUE_TYPES` member that was registered to `ImageCellRenderer`
  // and drew the affordance for {}. It now reads {} as `text` does; the pin
  // that holds it to its value class is `cellRenderers.signatureValueClass-8677`.
  ['signature', '[Object]', false],
  // ── already the affordance before this change ───────────────────────────
  ['boolean', '—', true],   // objectui#8582 / PR #8594 — landed, not re-ruled
  ['toggle', '—', true],    // objectui#8582 / PR #8594 — landed, not re-ruled
  ['datetime', '—', true],
  ['image', '—', true],
  ['avatar', '—', true],
  ['address', '—', true],
  ['repeater', '—', true],
  // ── objectui#8481's declared json-literal fence — deliberately untouched ─
  ['location', '{}', false],
  ['geolocation', '{}', false],
  ['json', '{}', false],
  ['object', '{}', false],
  ['composite', '{}', false],
  ['record', '{}', false],
  // ── a stored value's face, unchanged: `{}` is not "No value" to these ──
  // objectui#8678 moved only the floor members (`[]`, `''`, `null`) onto the
  // affordance. `{}` keeps the mask or the literal; the reason per value class
  // is in `cellRenderers.valueIndependent-8678`.
  ['password', '••••••', false],
  ['secret', '••••••', false],
  ['vector', '[Vector]', false],
  ['grid', '[Grid]', false],
  // ── objectui#8581 LANDED: the hand-rolled dash became the affordance ──
  ['date', '—', true],
  // ── objectui#12045: the pointer pair's default face ─────────────────────
  // Its value is a `RecordPointer`; anything else (this `{}`) is handed to the
  // text cell unchanged, so it reads exactly as `text` does.
  ['record_pointer_card', '[Object]', false],
  // ── objectui#12613: the two widget-hinted reference cells ───────────────
  // `{}` names no object and no recipient, so nothing is asked and both draw
  // the text cell's face for it, exactly as `text` does.
  ['object-ref', '[Object]', false],
  ['recipient-picker', '[Object]', false],
];

/** A real value per type — the POPULATED half, which refuses the caricature. */
const POPULATED_CENSUS: ReadonlyArray<readonly [type: string, value: unknown]> = [
  ['text', 'hello'],
  ['textarea', 'hello'],
  ['markdown', '**bold**'],
  ['html', '<p>hi</p>'],
  ['richtext', '<p>hi</p>'],
  ['code', '{"ok": true}'],
  ['qrcode', 'QR-1'],
  ['time', '09:30'],
  ['auto_number', 'A-0001'],
  ['number', 42],
  ['currency', 42],
  ['percent', 42],
  ['progress', 42],
  ['slider', 42],
  ['rating', 4],
  ['formula', 'computed'],
  ['summary', 7],
  ['lookup', 'rec_1'],
  ['master_detail', 'rec_1'],
  ['tree', 'rec_1'],
  ['email', 'ada@example.com'],
  ['url', 'https://objectstack.ai'],
  ['phone', '+15551234567'],
  ['color', '#ff0000'],
  ['user', { name: 'Ada Lovelace' }],
  ['select', 'active'],
  ['status', 'active'],
  ['multiselect', ['active']],
  ['radio', 'active'],
  ['checkboxes', ['active']],
  ['tags', ['active']],
  ['file', { url: 'https://cdn.example.com/c.pdf', name: 'contract.pdf' }],
  ['video', { url: 'https://cdn.example.com/c.mp4', name: 'clip.mp4' }],
  ['audio', { url: 'https://cdn.example.com/c.mp3', name: 'take.mp3' }],
  ['image', { url: 'https://cdn.example.com/a.png' }],
  ['avatar', { url: 'https://cdn.example.com/a.png' }],
  ['signature', { url: 'https://cdn.example.com/s.png' }],
  ['boolean', true],
  ['toggle', true],
  ['date', '2024-07-04'],
  ['datetime', '2024-07-04T07:00:00.000Z'],
  ['location', { lat: 30.2741, lng: 120.1551 }],
  ['geolocation', { lat: 30.2741, lng: 120.1551 }],
  ['address', { street: '1 Main St', city: 'Hangzhou' }],
  ['json', { ok: true }],
  ['object', { ok: true }],
  ['composite', { ok: true }],
  ['record', { ok: true }],
  ['repeater', [{ a: 1 }]],
  ['password', 'hunter2'],
  ['secret', 'hunter2'],
  ['vector', [1, 2, 3]],
  ['grid', [[1]]],
  ['record_pointer_card', { objectName: 'invoice', recordId: 'inv_1' }],
  ['object-ref', 'crm_account'],
  ['recipient-picker', 'sales_manager'],
];

describe('objectui#8596 — an object literal is not a cell value, and these renderers invented one', () => {
  describe('THE CENSUS — the instrument, not a grep', () => {
    it('THE CENSUS — the guard refuses a short or EMPTY set (a census over nothing passes)', () => {
      // The failure mode this file exists to avoid, pinned as a behaviour:
      // without this, deleting the table's rows turns every matrix below into
      // a green test that renders nothing.
      expect(() => assertCensusComplete([], REGISTERED_TYPE_COUNT, 'census')).toThrowError(
        new RegExp(`expected exactly ${REGISTERED_TYPE_COUNT} registered field types, got 0`),
      );
      expect(() => assertCensusComplete(OBJECT_LITERAL_CENSUS, REGISTERED_TYPE_COUNT, 'census')).not.toThrow();
      expect(new Set(OBJECT_LITERAL_CENSUS.map(([t]) => t)).size, 'the census must not repeat a type').toBe(
        REGISTERED_TYPE_COUNT,
      );
    });

    it('⭐ THE CENSUS IS THE REGISTRY — a newly registered type cannot escape it silently', () => {
      // objectui#8734. The size check above is necessary and NOT sufficient:
      // it would still pass if a type were swapped for another. These name the
      // difference, so a 54th renderer arrives as a red row calling itself out
      // rather than as an absence nobody can see.
      const objectDrift = censusDrift(OBJECT_LITERAL_CENSUS);
      expect(objectDrift.missing, 'registered types this census never measured').toEqual([]);
      expect(objectDrift.unknown, 'types this census measures that the registry does not have').toEqual([]);

      const populatedDrift = censusDrift(POPULATED_CENSUS);
      expect(populatedDrift.missing, 'registered types the populated census never measured').toEqual([]);
      expect(
        populatedDrift.unknown,
        'types the populated census measures that the registry does not have',
      ).toEqual([]);

      // The reading is a reading, not a second constant: an empty answer here
      // would make every assertion above vacuously true.
      expect(REGISTERED_TYPE_COUNT, 'the registry reading is not empty').toBeGreaterThan(0);
    });

    it('THE CENSUS — every registered type draws its measured face for {}', async () => {
      assertCensusComplete(OBJECT_LITERAL_CENSUS, REGISTERED_TYPE_COUNT, 'census');
      let measured = 0;
      for (const [type, text, hasAffordance] of OBJECT_LITERAL_CENSUS) {
        const { container } = renderCell(type, {});
        await settle();
        expect(
          textOf(container),
          `${type} holding {}: the measured face moved`,
        ).toBe(text);
        expect(
          affordance(container) !== null,
          `${type} holding {}: the affordance's presence moved`,
        ).toBe(hasAffordance);
        // `[object Object]` is `String()`'s artefact. No cell prints it.
        expect(
          textOf(container),
          `${type} holding {}: [object Object] is String()'s artefact, not a rendering`,
        ).not.toContain('[object Object]');
        measured += 1;
        cleanup();
      }
      expect(measured, 'the census must have rendered every registered type').toBe(REGISTERED_TYPE_COUNT);
    });
  });

  describe('THE DEFECT — {} no longer fabricates an identity', () => {
    for (const type of ['email', 'phone'] as const) {
      it(`THE DEFECT — \`${type}\` holding {} draws no live anchor and no copy button`, () => {
        const { container } = renderCell(type, {});

        // Defect-absence FIRST: on the unfixed tree this is the sentence that
        // fails (`href="mailto:[Object]"` / `tel:[Object]`).
        expect(
          container.querySelector('a[href]'),
          `${type}: an object is not an address — an anchor here links nowhere`,
        ).toBeNull();
        expect(
          container.querySelector('button'),
          `${type}: a copy button offers to put [Object] on the clipboard`,
        ).toBeNull();
        expect(
          affordance(container),
          `${type}: {} is not "No value" — the record is storing something`,
        ).toBeNull();
        expect(
          textOf(container),
          `${type}: an object with no display name reads as the string class reads it`,
        ).toBe('[Object]');
      });
    }

    it('THE DEFECT — `url` holding {} draws no `target="_blank"` anchor', () => {
      const { container } = renderCell('url', {});
      expect(
        container.querySelector('a[href]'),
        'url: an object is not a URL — an anchor here navigates nowhere',
      ).toBeNull();
      expect(affordance(container), 'url: {} is not "No value"').toBeNull();
      expect(textOf(container), 'url: reads as the string class reads it').toBe('[Object]');
    });

    it('THE DEFECT — `color` holding {} draws no swatch and never prints [object Object]', () => {
      const { container } = renderCell('color', {});
      expect(
        textOf(container),
        'color: `background: [object Object]` was a declaration the browser drops',
      ).not.toContain('[object Object]');
      expect(
        container.querySelector('span[aria-hidden="true"]'),
        'color: a swatch is a claim about a colour, and [Object] is not one',
      ).toBeNull();
      expect(affordance(container), 'color: {} is not "No value"').toBeNull();
      expect(textOf(container), 'color: reads as the string class reads it').toBe('[Object]');
    });

    for (const type of ['select', 'status', 'multiselect', 'radio', 'checkboxes', 'tags'] as const) {
      it(`THE DEFECT — \`${type}\` holding {} prints [Object], not the literal [Object Object]`, () => {
        const { container } = renderCell(type, {});
        expect(
          textOf(container),
          `${type}: [Object Object] was humanizeLabel(String({})) — an option code nobody stored`,
        ).not.toContain('[Object Object]');
        expect(
          affordance(container),
          `${type}: {} is not "No value" — the record is storing something`,
        ).toBeNull();
        expect(
          textOf(container),
          `${type}: an unrecognized value reads as the string class reads it`,
        ).toBe('[Object]');
      });
    }

    it('THE DEFECT — `user` holding {} draws no avatar and is not captioned "User"', () => {
      const { container } = renderCell('user', {});
      expect(
        textOf(container),
        'user: "User" was a name invented for a record that has none',
      ).not.toContain('User');
      expect(
        container.querySelector('.rounded-full'),
        'user: an avatar asserts a person whose initial is U — the record names nobody',
      ).toBeNull();
      expect(affordance(container), 'user: {} is not "No value"').toBeNull();
      expect(textOf(container), 'user: reads as the reference class reads it').toBe('[Object]');
    });

    for (const type of ['file', 'video', 'audio'] as const) {
      it(`THE DEFECT — \`${type}\` holding {} draws no chip named "File"`, () => {
        const { container } = renderCell(type, {});
        expect(
          textOf(container),
          `${type}: "File" was a chip for an attachment that does not exist`,
        ).not.toContain('File');
        // The spec's media value requires `url`; `{}` is a value of neither
        // form, so here "No value" is TRUE.
        expectAffordance(container, type);
      });
    }
  });

  describe('THE RULE — pinned against the sibling that already answered correctly', () => {
    it('THE RULE — `email` / `url` / `phone` / `color` / `user` read for {} EXACTLY as `text` reads it', async () => {
      const control = renderCell('text', {});
      const controlText = textOf(control.container);
      const controlHtml = control.container.innerHTML;
      // Pin the control as REAL before comparing to it: on the caricature both
      // sides are the affordance, and the affordance equals the affordance.
      expect(controlText, 'control: `text` must print something for {}').toBe('[Object]');
      expect(
        affordance(control.container),
        'control: `text` does not draw the affordance for {}',
      ).toBeNull();
      cleanup();

      for (const type of ['email', 'url', 'phone', 'color', 'user'] as const) {
        const { container } = renderCell(type, {});
        await settle();
        expect(
          container.innerHTML,
          `${type}: must render BYTE-EQUAL to what \`text\` renders for {}`,
        ).toBe(controlHtml);
        cleanup();
      }
    });

    it('THE RULE — `user` reads for {} exactly as `lookup` does (one spec arm, two types)', () => {
      const control = renderCell('lookup', {});
      const controlHtml = control.container.innerHTML;
      expect(textOf(control.container), 'control: `lookup` must print [Object] for {}').toBe('[Object]');
      cleanup();

      const { container } = renderCell('user', {});
      expect(container.innerHTML, 'user must render as `lookup` renders for {}').toBe(controlHtml);
    });

    it('THE RULE — `file` / `video` / `audio` read for {} exactly as `image` does (one spec family)', () => {
      const control = renderCell('image', {});
      const controlHtml = control.container.innerHTML;
      expect(
        control.container.querySelector('[data-slot="empty-value"]'),
        'control: `image` must draw the affordance for {}',
      ).not.toBeNull();
      cleanup();

      for (const type of ['file', 'video', 'audio'] as const) {
        const { container } = renderCell(type, {});
        expect(container.innerHTML, `${type} must render as \`image\` renders for {}`).toBe(controlHtml);
        cleanup();
      }
    });

    it('THE RULE — an object carrying a display NAME prints that name, in every moved family', async () => {
      const named = { name: 'Ada Lovelace' };
      for (const type of ['email', 'url', 'phone', 'color', 'select', 'tags'] as const) {
        const { container } = renderCell(type, named);
        await settle();
        expect(textOf(container), `${type}: an object with a name prints its name`).toBe('Ada Lovelace');
        expect(affordance(container), `${type}: a named object is not "No value"`).toBeNull();
        cleanup();
      }
      // `user` names a person, so the named object is a POPULATED reference and
      // keeps its avatar — the boundary this change deliberately does not cross.
      const user = renderCell('user', named);
      // The avatar's initials sit in the same cell, so the cell's text is
      // `AL` + the name — asserted as the whole face rather than a substring.
      expect(textOf(user.container), 'user: a named reference still draws its name').toBe(
        'ALAda Lovelace',
      );
      expect(
        user.container.querySelector('.rounded-full'),
        'user: a named reference still draws its avatar',
      ).not.toBeNull();
    });
  });

  describe('POPULATED — these refuse an EMPTY-for-everything implementation', () => {
    it('POPULATED — a real value in every registered type NEVER draws the "No value" affordance', async () => {
      assertCensusComplete(POPULATED_CENSUS, REGISTERED_TYPE_COUNT, 'populated census');
      let measured = 0;
      for (const [type, value] of POPULATED_CENSUS) {
        const { container } = renderCell(type, value, { options: [{ value: 'active', label: 'Active' }] });
        await settle();
        expect(
          affordance(container),
          `${type} holding a real value: a populated cell must NOT draw the affordance`,
        ).toBeNull();
        expect(
          container.innerHTML,
          `${type} holding a real value: a populated cell must draw something`,
        ).not.toBe('');
        measured += 1;
        cleanup();
      }
      expect(measured, 'the populated census must have rendered every registered type').toBe(
        REGISTERED_TYPE_COUNT,
      );
    });

    it('POPULATED — a real email still links and still offers its copy button', () => {
      const { container } = renderCell('email', 'ada@example.com');
      const anchor = container.querySelector('a[href]');
      expect(anchor?.getAttribute('href'), 'a real address still links').toBe('mailto:ada@example.com');
      expect(textOf(container), 'a real address still prints').toBe('ada@example.com');
      expect(
        container.querySelector('button[aria-label="Copy email"]'),
        'a real address still offers its copy button',
      ).not.toBeNull();
    });

    it('POPULATED — a real URL and a real phone number still link', () => {
      const url = renderCell('url', 'https://objectstack.ai');
      const urlAnchor = url.container.querySelector('a[href]');
      expect(urlAnchor?.getAttribute('href'), 'a real URL still links').toBe('https://objectstack.ai');
      expect(urlAnchor?.getAttribute('target'), 'a real URL still opens in a new tab').toBe('_blank');
      cleanup();

      const phone = renderCell('phone', '+15551234567');
      expect(
        phone.container.querySelector('a[href]')?.getAttribute('href'),
        'a real number still dials',
      ).toBe('tel:+15551234567');
    });

    it('POPULATED — a one-entry ARRAY still coerces and still links (the objectui#8490 ruling)', () => {
      // Refuses an over-correction spelled "an object-ish value" rather than
      // "a plain object": `['ada@example.com']` is a value, and it formats and
      // links exactly as the scalar does.
      const { container } = renderCell('email', ['ada@example.com']);
      expect(
        container.querySelector('a[href]')?.getAttribute('href'),
        'a one-entry array still links',
      ).toBe('mailto:ada@example.com');
      expect(affordance(container), 'a one-entry array is not "No value"').toBeNull();
    });

    it('POPULATED — a real colour still draws its swatch, with the declared colour', () => {
      const { container } = renderCell('color', '#ff0000');
      const swatch = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
      expect(swatch, 'a real colour still draws its swatch').not.toBeNull();
      // happy-dom keeps the declaration verbatim rather than normalising it to
      // `rgb()`, so the hex is the byte to pin here.
      expect(swatch?.style.backgroundColor, 'the swatch still paints the declared colour').toBe(
        '#ff0000',
      );
      expect(textOf(container), 'a real colour still prints its value').toBe('#ff0000');
    });

    it('POPULATED — a real option still resolves to its declared label, and an unknown code is still humanized', () => {
      const declared = renderCell('select', 'active', {
        options: [{ value: 'active', label: 'Active' }],
      });
      expect(textOf(declared.container), 'a declared option still shows its label').toBe('Active');
      cleanup();

      // The code path `humanizeLabel` exists for: a stored code with no
      // declared option. Untouched by this change.
      const undeclared = renderCell('status', 'in_progress');
      expect(textOf(undeclared.container), 'an undeclared code is still humanized').toBe('In Progress');
    });

    it('POPULATED — a real user still draws an avatar with real initials', () => {
      const { container } = renderCell('user', { name: 'Ada Lovelace' });
      expect(textOf(container), 'a real user still prints their name').toBe('ALAda Lovelace');
      expect(
        container.querySelector('.rounded-full')?.textContent,
        'a real user still draws initials taken from their name',
      ).toBe('AL');
    });

    it('POPULATED — a real file still shows its name, and a real file ARRAY reaches each file', () => {
      const single = renderCell('file', { url: 'https://cdn.example.com/c.pdf', name: 'contract.pdf' });
      expect(textOf(single.container), 'a real attachment still shows its name').toBe('contract.pdf');
      expect(affordance(single.container), 'a real attachment is not "No value"').toBeNull();
      cleanup();

      // ⚠️ UPDATED by objectui#9161, and the update is the finding: this array
      // used to render `2 files` and nothing else — the count WAS the whole
      // rendering, so a successfully uploaded attachment could not be opened
      // from the PC Console. Each entry now renders its own name and href.
      // `{ url: 'a' }` carries no name, so `readFileValue` names it from the
      // URL's last segment. ⭐ The count is not gone: it answers the arm where
      // it is the whole truth, and THE BOUNDARY below still pins `[]` →
      // `0 files` for `file` / `video` / `audio`.
      const many = renderCell('file', [{ url: 'a' }, { url: 'b' }]);
      expect(textOf(many.container), 'each entry now names itself').toBe('ab');
      expect(
        Array.from(many.container.querySelectorAll('a')).map((a) => a.getAttribute('href')),
        'and each entry carries its own href — the affordance the count replaced',
      ).toEqual(['a', 'b']);
    });
  });

  describe('THE BOUNDARY — what this change deliberately does and does not sweep', () => {
    it("THE BOUNDARY — [], '' and null are unchanged in every moved family", () => {
      const moved = [
        'email', 'url', 'phone', 'color', 'user',
        'select', 'status', 'multiselect', 'radio', 'checkboxes', 'tags',
      ] as const;
      for (const type of moved) {
        for (const [label, value] of [['[]', []], ["''", ''], ['null', null]] as const) {
          const { container } = renderCell(type, value);
          expectAffordance(container, `${type} holding ${label}`);
          cleanup();
        }
      }

      // The media family answers `[]` with its own count sentence rather than
      // the affordance. That is the `[]` column, which objectui#8490 /
      // objectui#8580 closed and this card does not reopen: pinned as MEASURED
      // so the `{}` fix above cannot be read as having moved it.
      for (const type of ['file', 'video', 'audio'] as const) {
        const empty = renderCell(type, []);
        expect(textOf(empty.container), `${type} holding []: unchanged, still its count`).toBe('0 files');
        cleanup();
        for (const [label, value] of [["''", ''], ['null', null]] as const) {
          const { container } = renderCell(type, value);
          expectAffordance(container, `${type} holding ${label}`);
          cleanup();
        }
      }
    });

    it('THE BOUNDARY — an object with any member is NOT swept in: real data is never hidden', () => {
      // `AddressCellRenderer`'s rule, applied unchanged: `{}` reads as empty
      // while `{ foo: 1 }` keeps what it holds.
      const file = renderCell('file', { size: 12 });
      expect(
        affordance(file.container),
        'file: an object carrying a member is not "No value"',
      ).toBeNull();
      cleanup();

      const user = renderCell('user', { id: 'u_1' });
      expect(
        user.container.querySelector('.rounded-full'),
        'user: a reference carrying an id still draws its avatar (unchanged)',
      ).not.toBeNull();
    });

    it('THE BOUNDARY — a NUMBER in an email or phone cell still links (only objects moved)', () => {
      // A stored number is not an object; a phone column holding `13800138000`
      // still dials. Sweeping it in would be a second ruling this change does
      // not make.
      const phone = renderCell('phone', 13800138000);
      expect(
        phone.container.querySelector('a[href]')?.getAttribute('href'),
        'phone: a stored number still dials',
      ).toBe('tel:13800138000');
    });

    it('THE BOUNDARY — `date` now draws the shared affordance: objectui#8581 landed on its own subject', () => {
      // This assertion is INVERTED from what it was while objectui#8581 was
      // open, and the inversion is the point: this file predicted that a fix
      // there would have to move a pin here rather than pass silently, and it
      // did. `{}` coerces to `[Object]`, which `new Date` rejects, so the
      // `date` cell takes objectui#8581's unparsable branch — the same
      // affordance `datetime` has always drawn for the same input. The reason
      // `{}` is not a date is unchanged; only who draws the answer moved.
      const { container } = renderCell('date', {});
      expect(textOf(container), 'date: the glyph is still an em-dash').toBe('—');
      expect(
        affordance(container),
        'date: the dash is now the shared affordance, not `formatDate`\'s bare one (objectui#8581)',
      ).not.toBeNull();
      expect(
        affordance(container)?.getAttribute('aria-label'),
        'date: and it carries its accessible name',
      ).toBe('No value');
    });

    it("THE BOUNDARY — objectui#8481's json-literal fence is not reopened", () => {
      for (const type of ['location', 'geolocation', 'json', 'object', 'composite', 'record'] as const) {
        const { container } = renderCell(type, {});
        expect(textOf(container), `${type}: the {} literal stays behind the declared fence`).toBe('{}');
        cleanup();
      }
    });
  });
});
