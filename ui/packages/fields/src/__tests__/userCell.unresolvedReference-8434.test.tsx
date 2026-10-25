/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8434 — a `user` reference that resolved to nothing was rendered as a
 * person.
 *
 * ── What was measured, before anything was changed ────────────────────────
 * The card was written from source reading only ("NOT executed — no rig, no
 * browser") and the edit-form half was INFERRED. All three readings were taken
 * on the merged tree at `da5e4f69e` before the fix:
 *
 *   1. record detail, unresolvable value — `UserCellRenderer` printed
 *      `<span class="block max-w-full truncate" title="Ada Lovelace">Ada
 *      Lovelace</span>`: bare text, no avatar, no marker of any kind, and
 *      BYTE-IDENTICAL to what a `text` cell prints for the same string.
 *   2. edit form — `UserField` → `LookupField` showed `Select…`, the original
 *      string appeared NOWHERE in the DOM, and submitting the untouched form
 *      sent `"Ada Lovelace"` — the invisible original value. Confirmed with a
 *      control whose `findOne` DOES resolve: that leg renders a chip reading
 *      `Ada Lovelace` and submits `"u_1"`. (The edit form is objectui#8434's
 *      third surface and is deliberately NOT changed here — this card is
 *      display-only. The reading is recorded because the card had never had
 *      it.)
 *   3. positive control — an expanded reference object rendered avatar +
 *      name, in the same mounted tree. Without it, (1) could not be told from
 *      "this field is broken in general".
 *
 * ── The grading sentence, which this file encodes ─────────────────────────
 * The missing avatar was the only difference, and that is a SUBTRACTIVE signal
 * (something absent), not an ADDITIVE one (a stated warning). A user who has
 * never seen the avatar has no reason to read absence as failure. So the pin
 * that matters most is `ADDITIVE, NOT SUBTRACTIVE` below: it asserts that the
 * `user` cell is no longer byte-identical to the `text` cell for the same
 * value. On the unfixed tree those two were the same string of DOM, which is
 * exactly why nothing anywhere said the reference was invalid.
 *
 * ── ⭐ The branch has TWO populations, and that is a finding ──────────────
 * The plausible wrong fix is "treat every primitive as unresolved", which
 * would also mark the legitimate case the old comment described. Whether such
 * a population exists was ESTABLISHED rather than assumed, and it does:
 *
 *   1. an UNEXPANDED `sys_user` id — the legitimate stored form.
 *      `packages/core/src/utils/expand-fields.ts` names it in those words:
 *      "a `user` column that is NOT requested for expansion comes back as a
 *      raw user id" (objectui#2032). The record exists.
 *   2. a string that is no resolvable reference at all — a person's name
 *      written into the column (cloud#2074), refused on save with
 *      `reference_not_found`.
 *
 * Measured: `'Ada Lovelace'`, `'u_1'` and an opaque ULID rendered
 * byte-identically, so this renderer cannot tell them apart — it has no
 * resolver at all, unlike `LookupCellRenderer` (`useLookupName` +
 * `isLikelyOpaqueId`). ⇒ marking BOTH is correct, and the sentence must be
 * EPISTEMIC ("this screen did not resolve it"), never ontological ("not
 * found" / "invalid"), which would be false for population (1) — the same
 * class of defect this card repairs, aimed the other way. `THE SENTENCE`
 * below pins that, and it is the assertion a careless escalation trips over.
 *
 * ── ⛔ What this file must NOT let pass ───────────────────────────────────
 * The caricature is the mutation that makes the code answer the same thing
 * for everything, and it was run in BOTH directions on the READ SITE (the
 * branch condition in `UserCellRenderer`), never on a pin:
 *
 *   - `if (true)`  — everything is unresolved. `POSITIVE CONTROL` fails: an
 *     expanded record stops drawing its avatar.
 *   - `if (false)` — nothing is. `THE DEFECT` and `ADDITIVE, NOT SUBTRACTIVE`
 *     fail: the raw string goes back to being indistinguishable from text.
 *
 * Per-test verdicts for both legs are recorded in the PR from vitest's JSON
 * reporter.
 *
 * ⚠️ Counting is done at the SEAM (`querySelectorAll`), never with
 * `queryByText`, which throws on multiple matches as well as none — and the
 * avatar seam is `.rounded-full`, the same one objectui#8596's census uses for
 * this renderer.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { en } from '@object-ui/i18n';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** The unresolved-reference affordance, counted at its own seam. */
const marks = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>('[data-slot="unresolved-reference"]');

/**
 * The avatar seam.
 *
 * ⚠️ Measured, not guessed: `.rounded-full` alone matches TWO nodes per avatar
 * — Radix's `Avatar.Root` AND the `AvatarFallback` inside it both carry it. The
 * objectui#8596 census navigates by `querySelector('.rounded-full')`, which
 * takes the FIRST match and so never had to notice; counting does. Every
 * positive-control leg here failed on `expected 1, got 2` with the bare class
 * before this was narrowed to the Root, which is the only one that is also
 * `overflow-hidden`. `avatarSeamCount` below pins the arithmetic so a future
 * reader does not have to re-derive it.
 */
const avatars = (root: HTMLElement) =>
  root.querySelectorAll('.rounded-full.overflow-hidden');

const textOf = (root: HTMLElement) => (root.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The three primitives that reach this branch. Both populations are here on
 * purpose — the renderer cannot tell them apart, so it must answer all three
 * the same way, and the SENTENCE (not the treatment) is what stays honest.
 */
const UNRESOLVED_INPUTS: ReadonlyArray<readonly [label: string, value: unknown]> = [
  ['a person name written into the column (cloud#2074 dirty row)', 'Ada Lovelace'],
  ['an unexpanded sys_user id (objectui#2032, the legitimate stored form)', 'u_1'],
  ['an opaque ULID-shaped id, unexpanded', '01HQZX9K2M4N6P8R'],
];

describe('objectui#8434 — THE DEFECT: an unresolved `user` reference must say so', () => {
  it.each(UNRESOLVED_INPUTS)('%s', (label, value) => {
    const { container } = renderCell('user', value);

    // Absence of the false claim FIRST, so an unfixed tree and a harness that
    // lost its navigation target fail on different sentences.
    expect(
      avatars(container),
      `${label}: an avatar asserts a resolved person — nothing resolved here`,
    ).toHaveLength(0);

    expect(
      marks(container),
      `${label}: the cell must carry exactly one unresolved-reference affordance`,
    ).toHaveLength(1);

    // ⛔ The raw value stays VISIBLE. It is the only clue for diagnosing an
    // existing dirty row, and the strong arm's cost was destroying it.
    expect(
      textOf(container),
      `${label}: the raw value must remain readable on screen`,
    ).toBe(String(value));

    // The signal is STATED, not merely styled: a sentence a person can read.
    const stated = marks(container)[0]!.getAttribute('title') ?? '';
    expect(stated.length, `${label}: the affordance must state something`).toBeGreaterThan(0);
    expect(stated, `${label}: the sentence must name the value it is about`).toContain(String(value));
  });
});

describe('objectui#8434 — POSITIVE CONTROL: the resolvable case is untouched', () => {
  // Without this the readings above cannot be told from "this field is broken
  // in general", and the `if (true)` caricature would pass everything else.
  it.each([
    ['an expanded record with an image', { id: 'u_1', name: 'Ada Lovelace', image: 'https://x/a.png' }],
    ['an expanded record without one (initials fallback)', { id: 'u_1', name: 'Ada Lovelace' }],
  ] as const)('%s still renders avatar + name', (label, value) => {
    const { container } = renderCell('user', value);

    expect(marks(container), `${label}: a resolved person is not unresolved`).toHaveLength(0);
    expect(avatars(container), `${label}: a resolved reference still draws its avatar`).toHaveLength(1);
    expect(avatars(container)[0]!.textContent, `${label}: initials`).toBe('AL');
    expect(textOf(container), `${label}: avatar initials + the resolved name`).toBe('ALAda Lovelace');
  });

  it('the avatar seam counts one node per avatar (the instrument, checked)', () => {
    const { container } = renderCell('user', { id: 'u_1', name: 'Ada Lovelace' });
    expect(
      container.querySelectorAll('.rounded-full'),
      'the bare class matches Avatar.Root AND AvatarFallback — do not count with it',
    ).toHaveLength(2);
    expect(avatars(container), 'the narrowed seam matches the Root alone').toHaveLength(1);
  });

  it('a reference carrying only an id still draws its avatar — objectui#8596 boundary, unmoved', () => {
    const { container } = renderCell('user', { id: 'u_1' });
    expect(marks(container)).toHaveLength(0);
    expect(avatars(container), 'a populated reference object is not this card`s subject').toHaveLength(1);
  });

  it('`{}` still prints the coerced text — objectui#8596`s ruling, unmoved', () => {
    const { container } = renderCell('user', {});
    expect(marks(container), 'an object literal is objectui#8596`s subject, not this one').toHaveLength(0);
    expect(textOf(container)).toBe('[Object]');
  });
});

describe('objectui#8434 — THE SENTENCE: honest about WHICH population it cannot name', () => {
  // The renderer has no resolver, so it cannot know whether the record exists.
  // A "not found" claim would be FALSE for the unexpanded-id population — the
  // same class of defect this card repairs, in the other direction.
  it.each(UNRESOLVED_INPUTS)('%s — states unresolved, never non-existence', (label, value) => {
    const { container } = renderCell('user', value);
    const stated = marks(container)[0]!.getAttribute('title') ?? '';
    expect(
      stated,
      `${label}: this renderer cannot know the record is absent — it only knows it did not resolve it`,
    ).not.toMatch(/not found|does not exist|no such|invalid|missing/i);
    expect(stated, `${label}: it must say what it DOES know`).toMatch(/unresolved/i);
  });

  // The English fallback lives in code (the provider-less path) and the `en`
  // pack serves the same sentence. `check:i18n-keys` compares an inline
  // `defaultValue` against the pack, but this call site's fallback is not that
  // shape, so the gate cannot see it — this pin is the comparison instead.
  it('the provider-less sentence is byte-equal to the `en` pack value', () => {
    const { container } = renderCell('user', 'Ada Lovelace');
    const stated = marks(container)[0]!.getAttribute('title');
    const packed = (en as any).detail.unresolvedReference.replace('{{value}}', 'Ada Lovelace');
    expect(stated, 'the code fallback and the en pack must not drift apart').toBe(packed);
  });
});

describe('objectui#8434 — ADDITIVE, NOT SUBTRACTIVE: the sentence that graded this card', () => {
  // On the unfixed tree these two produced the SAME string of DOM, and that
  // identity is the whole defect: the only thing separating "we resolved a
  // person" from "we resolved nothing" was the ABSENCE of an avatar.
  it.each(UNRESOLVED_INPUTS)('%s no longer renders identically to a `text` cell', (label, value) => {
    const asUser = renderCell('user', value).container.innerHTML;
    cleanup();
    const asText = renderCell('text', value).container.innerHTML;

    expect(asText, 'control: a text cell prints the bare string, unchanged by this card').toBe(
      `<span class="block max-w-full truncate" title="${String(value)}">${String(value)}</span>`,
    );
    expect(
      asUser,
      `${label}: a user cell that is byte-identical to a text cell states nothing`,
    ).not.toBe(asText);
  });

  it('the multi-value shape is not left silent while the scalar one speaks', () => {
    // One unresolved entry and one resolved entry in ONE cell: the resolved
    // half is this render's own positive control.
    const { container } = renderCell('user', ['Ada Lovelace', { id: 'u_2', name: 'Grace Hopper' }]);
    expect(marks(container), 'the unresolved entry says so').toHaveLength(1);
    expect(avatars(container), 'the resolved entry still draws its avatar').toHaveLength(1);
    expect(marks(container)[0]!.textContent, 'and keeps its raw value').toBe('Ada Lovelace');
  });
});
