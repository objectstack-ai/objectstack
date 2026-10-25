/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7963 step 3 — does `AlertDialogSchema`'s `cancelLabel` /
 * `confirmLabel` / `confirmVariant` move the rendered DOM? MEASURED here,
 * through the real `SchemaRenderer` and the real registry, one key varied per
 * fixture, reading the DOM. Nothing in this file is inferred from a grep.
 *
 * ## Why a grep could not answer it
 *
 * The card inferred "nothing reads them" from the absence of a `schema.KEY`
 * read in `packages/components/src/renderers/overlay/alert-dialog.tsx`. That
 * inference is UNSOUND for this renderer, and the repo has falsified the same
 * shape of zero twice:
 *
 *  - objectui#8236 — `CollapsibleSchema.open` was called unread and turned out
 *    to control expansion, override `defaultOpen` and freeze the trigger.
 *  - objectui#8318 — 16 keys called unread, 9 measured live.
 *
 * The unsoundness has a mechanism, and both halves of it are re-derived on this
 * branch rather than inherited (the line numbers move):
 *
 *  1. `SchemaRenderer` strips schema METADATA before spreading the rest of the
 *     node as React props (`packages/react/src/SchemaRenderer.tsx`, the
 *     `const { … , ...componentProps } = evaluatedSchema` destructure). The
 *     three keys are NOT on that strip list, so they survive into
 *     `componentProps` and are spread onto the registered component.
 *  2. The `alert-dialog` renderer destructures `({ schema, className,
 *     ...props })` and forwards `{...props}` straight onto the `AlertDialog`
 *     primitive. So all three keys DO reach a primitive without any
 *     `schema.KEY` read — the same shape as `disclosure/collapsible.tsx`, where
 *     that channel turned out to be live.
 *
 * ⇒ neither "it forwards, so it is live" nor "no `schema.KEY`, so it is dead"
 * is a verdict. objectui#8318 settled that in both directions at once: its nine
 * live readers were direct named reads the sweep never opened, while
 * `CardSchema.variant`, which DID reach its primitive through the spread, had
 * no reader at all. Only the DOM reading below is a verdict.
 *
 * ## The controls, and what each one buys
 *
 * A null result ("the DOM did not move") is worthless without evidence that the
 * harness COULD have seen a move. Four controls, each closing a different way
 * this file could be green while measuring nothing:
 *
 *  - `IDEMPOTENT` — the same node rendered twice reads IDENTICAL. Radix mints
 *    fresh `useId()` values per mount, so without the normaliser below every
 *    comparison would differ and every reading would read "live". This control
 *    is what makes an equality assertion meaningful.
 *  - `SENSITIVE` — a `className` difference DOES move the normalised dialog
 *    HTML. This is the other side of `IDEMPOTENT`: it proves the normaliser is
 *    not so blunt that it erases real attribute changes inside the dialog.
 *  - `CHANNEL` — `open`, which the renderer never reads as `schema.open`,
 *    reaches the `AlertDialog` primitive through THE SAME rest-spread and moves
 *    the DOM (no dialog -> dialog mounted). This is the positive control the
 *    three readings need: it proves the spread channel is live end to end
 *    (`SchemaRenderer` -> `componentProps` -> the renderer's `...props` ->
 *    the primitive), so a null reading is about the KEY, not about the channel.
 *    It is a valid control precisely because it is the objectui#8236 key: an
 *    unstripped, never-`schema.`-read key that the primitive itself consumes.
 *  - `WIRED` — `cancelText` / `actionText` (the sibling half, read at the
 *    renderer's `schema.cancelText` / `schema.actionText` lines) draw the two
 *    footer buttons. This proves the fixture, the registry and the renderer are
 *    wired at all, and that this file can see a footer button when one exists.
 *  - `VARIANT_INSTRUMENT` — inside ONE dialog, the cancel button's class
 *    already differs from the action button's class (`buttonVariants({ variant:
 *    'outline' })` vs `buttonVariants()`). So the class reading used for the
 *    `confirmVariant` row demonstrably distinguishes one button variant from
 *    another on this very DOM.
 *
 * ⛔ This file measures. It does not teach the renderer a new key and it does not
 * animate `confirmVariant`.
 *
 * ## The ruling this reading fed, and why this file is KEPT
 *
 * ⭐ RE-POINTED, ⛔ not deleted. The maintainer ruled on 2026-09-10: retire all
 * three from `AlertDialogSchema`, both faces, ADR-0049 enforce-or-remove, with
 * `cancelText` / `actionText` as the surviving spellings and NO survivor for
 * `confirmVariant`. This file is the measurement that ruling was taken on — a
 * retirement does not retire its own evidence, so every reading below stays,
 * and every one of them must go on reading the same after the change as before.
 *
 * ⚠️ Read what did and did not move, because it is easy to get backwards:
 *
 *  - the RENDERER is untouched. It never read the three keys and still does not,
 *    so the DOM readings below are unchanged BY CONSTRUCTION. If one of them
 *    ever flips, something taught the renderer a retired key.
 *  - the SCHEMA changed, and this package does not validate. `SchemaRenderer`
 *    renders a node; it does not `safeParse` one. So the "renders an EMPTY
 *    footer" reading at the bottom is STILL TRUE of a raw node handed straight
 *    to the renderer — what the retirement moved is the gate one step earlier,
 *    where an author is now refused BY NAME instead of silently drawing nothing.
 *    That is asserted at the bottom of this file against the mirror, so the two
 *    halves of the card are tied together in one place; its full contract lives
 *    in `packages/types/src/__tests__/alert-dialog-footer-keys-refusal-7963.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
// The schema half of this card. Imported for the closure leg at the bottom
// only — nothing above validates, and that asymmetry is the point of the note
// in this file's header.
import { AlertDialogSchema as AlertDialogMirror } from '@object-ui/types/zod';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Radix derives `contentId` / `titleId` / `descriptionId` from React's
 * `useId()`, which mints a fresh value on every mount. Two renders of the very
 * same node therefore differ byte-for-byte in `id` and every `aria-*` that
 * points at one. Normalise exactly that noise and nothing else — the
 * `IDEMPOTENT` and `SENSITIVE` controls below hold this function honest from
 * both sides.
 */
function normalise(html: string): string {
  return html
    .replace(/«[^«»]*»/g, '«ID»')
    .replace(/:r[0-9a-z]+:/g, ':ID:')
    .replace(/\bradix-[A-Za-z0-9_-]+/g, 'radix-ID');
}

interface Reading {
  /** The dialog element's `outerHTML`, id noise normalised; `null` when the dialog is not mounted. */
  dialogHtml: string | null;
  /** The WHOLE document body — the content is portalled out, the trigger half is not. */
  bodyHtml: string;
  /** Text of every button inside the dialog content. An `alert-dialog` has no close affordance of its own, so these ARE the footer buttons. */
  footerLabels: string[];
  /** `class` of the button whose text matches, or `null` when it is not drawn. */
  classOf: Record<string, string | null>;
}

/** Render one node through the REAL renderer and read the DOM back. */
function probe(node: Record<string, unknown>, classesFor: readonly string[] = []): Reading {
  cleanup();
  render(<SchemaRenderer schema={node as never} />);
  // Radix portals the content to `document.body`, so the RTL container is empty
  // by construction — query the dialog itself.
  const dialog = document.body.querySelector('[role="alertdialog"]');
  const buttons = dialog ? Array.from(dialog.querySelectorAll('button')) : [];
  const classOf: Record<string, string | null> = {};
  for (const label of classesFor) {
    const hit = buttons.find((b) => (b.textContent ?? '').trim() === label);
    classOf[label] = hit ? hit.getAttribute('class') : null;
  }
  const reading: Reading = {
    dialogHtml: dialog ? normalise(dialog.outerHTML) : null,
    bodyHtml: document.body.innerHTML,
    footerLabels: buttons.map((b) => (b.textContent ?? '').trim()),
    classOf,
  };
  cleanup();
  return reading;
}

const CANCEL = 'Keep it';
const CONFIRM = 'Delete';

/**
 * The fixture every reading varies ONE key against: a complete alert-dialog in
 * the dialect the renderer reads, forced open so the footer exists to measure.
 */
function baseNode(): Record<string, unknown> {
  return {
    type: 'alert-dialog',
    title: 'Delete this account?',
    description: 'This action cannot be undone.',
    trigger: { type: 'button', label: 'Delete account' },
    content: [{ type: 'text', content: 'Everything under the account goes with it.' }],
    cancelText: CANCEL,
    actionText: CONFIRM,
    defaultOpen: true,
  };
}

/** `baseNode()` plus exactly one key. */
function withKey(key: string, value: unknown): Record<string, unknown> {
  return { ...baseNode(), [key]: value };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Controls — run these first; every reading below is void if one of them reds
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#7963 — controls: this harness can see a DOM move when there is one', () => {
  it('WIRED: the sibling half (`cancelText` / `actionText`) draws both footer buttons', () => {
    const reading = probe(baseNode(), [CANCEL, CONFIRM]);

    expect(reading.dialogHtml).not.toBeNull();
    // Renderer order: `AlertDialogCancel` then `AlertDialogAction`.
    expect(reading.footerLabels).toEqual([CANCEL, CONFIRM]);
  });

  it('IDEMPOTENT: the same node rendered twice reads identical', () => {
    // Without the id normaliser this fails, and with it failing every equality
    // assertion below would report "the DOM moved" for every key.
    expect(probe(baseNode()).dialogHtml).toEqual(probe(baseNode()).dialogHtml);
  });

  it('SENSITIVE: a `className` difference DOES move the normalised dialog HTML', () => {
    // The normaliser is not blunt: a real attribute change inside the dialog
    // survives it.
    const plain = probe(baseNode()).dialogHtml;
    const marked = probe(withKey('className', 'os-7963-probe-marker')).dialogHtml;

    expect(plain).not.toBeNull();
    expect(marked).toContain('os-7963-probe-marker');
    expect(marked).not.toEqual(plain);
  });

  it('CHANNEL: `open`, read by no `schema.open`, still moves the DOM through the SAME rest-spread', () => {
    // The objectui#8236 key. The renderer reads `schema.defaultOpen` and never
    // `schema.open`; `open` reaches the `AlertDialog` primitive ONLY by being
    // absent from `SchemaRenderer`'s strip list and riding the `{...props}`
    // spread this renderer forwards. It moves the DOM, so that channel is live
    // end to end and a null reading below is about the key.
    const closed = probe({ ...baseNode(), defaultOpen: undefined });
    const opened = probe({ ...baseNode(), defaultOpen: undefined, open: true }, [CANCEL, CONFIRM]);

    expect(closed.dialogHtml).toBeNull();
    expect(opened.dialogHtml).not.toBeNull();
    expect(opened.footerLabels).toEqual([CANCEL, CONFIRM]);
  });

  it('VARIANT_INSTRUMENT: the class reading distinguishes two button variants on this very DOM', () => {
    // `AlertDialogCancel` ships `buttonVariants({ variant: 'outline' })`,
    // `AlertDialogAction` ships `buttonVariants()`. If the `confirmVariant` row
    // below reads "class unchanged", it is not because class strings are
    // invisible to this harness.
    const { classOf } = probe(baseNode(), [CANCEL, CONFIRM]);

    expect(classOf[CANCEL]).toBeTruthy();
    expect(classOf[CONFIRM]).toBeTruthy();
    expect(classOf[CANCEL]).not.toEqual(classOf[CONFIRM]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The step-3 readings — one key varied per fixture, DOM diffed
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#7963 — the three declared footer keys, one varied per fixture', () => {
  it('`cancelLabel` does not move the DOM', () => {
    const without = probe(baseNode(), [CANCEL, CONFIRM]);
    const withIt = probe(withKey('cancelLabel', 'os-7963-cancelLabel'), [CANCEL, CONFIRM]);

    expect(withIt.dialogHtml).toEqual(without.dialogHtml);
    expect(withIt.dialogHtml).not.toContain('os-7963-cancelLabel');
    expect(withIt.footerLabels).toEqual([CANCEL, CONFIRM]);
  });

  it('`confirmLabel` does not move the DOM', () => {
    const without = probe(baseNode(), [CANCEL, CONFIRM]);
    const withIt = probe(withKey('confirmLabel', 'os-7963-confirmLabel'), [CANCEL, CONFIRM]);

    expect(withIt.dialogHtml).toEqual(without.dialogHtml);
    expect(withIt.dialogHtml).not.toContain('os-7963-confirmLabel');
    expect(withIt.footerLabels).toEqual([CANCEL, CONFIRM]);
  });

  it('`confirmVariant` does not move the DOM, and does not touch the confirm button class', () => {
    const without = probe(baseNode(), [CANCEL, CONFIRM]);
    const withIt = probe(withKey('confirmVariant', 'destructive'), [CANCEL, CONFIRM]);

    expect(withIt.dialogHtml).toEqual(without.dialogHtml);
    expect(withIt.dialogHtml).not.toContain('destructive');
    // The reading the key's NAME promises: the confirm button's variant.
    expect(withIt.classOf[CONFIRM]).toEqual(without.classOf[CONFIRM]);
  });

  it('none of the three lands on the DOM as an attribute either', () => {
    // The keys DO reach the `AlertDialog` primitive (step 2). This is where
    // they stop: that primitive's root renders a context provider, not an
    // element, so an unknown prop is dropped without reaching any node. Read
    // over the WHOLE body, not just the dialog, because the trigger half of the
    // tree lives in the RTL container while the content is portalled out.
    const reading = probe({
      ...baseNode(),
      cancelLabel: 'os-7963-cancelLabel',
      confirmLabel: 'os-7963-confirmLabel',
      confirmVariant: 'destructive',
    });

    // Live control on the SAME string: keys the renderer DOES read are present
    // in it, so the `not.toContain` rows below are not being asked of an empty
    // document.
    expect(reading.bodyHtml).toContain(CANCEL);
    expect(reading.bodyHtml).toContain(CONFIRM);

    expect(reading.bodyHtml).not.toContain('cancelLabel');
    expect(reading.bodyHtml).not.toContain('confirmLabel');
    expect(reading.bodyHtml).not.toContain('confirmVariant');
    expect(reading.bodyHtml).not.toContain('os-7963-');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The user-visible consequence the card reported — and where it is caught now
 * ───────────────────────────────────────────────────────────────────────── */

/** The footer an author used to write against the three keys the type declared. */
const RETIRED_ONLY = {
  type: 'alert-dialog',
  title: 'Delete this account?',
  trigger: { type: 'button', label: 'Delete account' },
  cancelLabel: 'Keep it',
  confirmLabel: 'Delete',
  confirmVariant: 'destructive',
  defaultOpen: true,
};

describe('objectui#7963 — a document written strictly against the three retired keys', () => {
  it('STILL renders an EMPTY footer — the renderer does not validate, and it did not change', () => {
    // The card's headline claim, measured rather than reasoned: an author who
    // wrote only what `AlertDialogSchema` used to declare for the footer got no
    // footer buttons at all. Paired with `WIRED` above, which is the same node in
    // the surviving dialect drawing two.
    //
    // ⚠️ This reading is UNCHANGED by the retirement, and that is the point.
    // `SchemaRenderer` renders a node, it never `safeParse`s one, so a raw node
    // reaching this renderer still draws nothing. The retirement did not repair
    // the render — it moved the failure one step earlier, to a place where the
    // author is told why (the leg below).
    const reading = probe(RETIRED_ONLY);

    expect(reading.dialogHtml).not.toBeNull(); // the dialog itself DID mount
    expect(reading.footerLabels).toEqual([]); // …with nothing in its footer
  });

  it('and is now REFUSED BY NAME at the schema, instead of being accepted in silence', () => {
    // The closure objectui#7963 landed, asserted here beside the reading that
    // justified it so the two halves cannot drift apart. Before the retirement
    // this document parsed GREEN — `BaseSchemaCore` ends `.passthrough()`, so an
    // authored value was KEPT, not refused, which is why a bare deletion of the
    // declarations would have changed nothing an author could see.
    const result = AlertDialogMirror.safeParse(RETIRED_ONLY);

    expect(result.success).toBe(false);
    const paths = (result.success ? [] : result.error.issues).map((issue) => issue.path.join('.'));
    for (const key of ['cancelLabel', 'confirmLabel', 'confirmVariant']) {
      expect(paths, key).toContain(key);
    }
  });

  it('CONTROL — the surviving dialect, the node `WIRED` draws two buttons from, parses green', () => {
    // Without this the leg above would pass just as well against a mirror that
    // refused every alert-dialog document, and the refusal would read as working
    // while it had in fact taken the whole node down.
    expect(AlertDialogMirror.safeParse(baseNode()).success).toBe(true);
  });
});
