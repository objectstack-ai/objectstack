/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8978 — `AlertDialogSchema.actionVariant` MOVES THE CONFIRM BUTTON'S
 * CLASS. Measured here, through the real `SchemaRenderer` and the real
 * registry, by reading the `class` attribute off the rendered confirm button.
 *
 * ## Why this file exists at all, and why it reads the DOM
 *
 * The key this one replaces, `confirmVariant`, survived DECLARED AND DEAD for
 * months. Nothing ever asserted that it moved anything: it was declared, it
 * parsed green under `.passthrough()`, it rode the renderer's rest-spread into
 * the Radix root — and died there, because that root renders a context
 * provider rather than an element. Every reading that would have caught it is a
 * DOM reading, and there was none. (Its post-mortem is
 * `alert-dialog-footer-keys-liveness-7963.test.tsx`, kept standing next to this
 * file; that one asserts the retired key still moves NOTHING, this one asserts
 * the new key moves the one thing its name promises.)
 *
 * ⛔ So: no leg here asserts that a prop was passed, that a component received a
 * value, or that a source file contains a spelling. Every leg renders a dialog
 * and reads an attribute off a node.
 *
 * ## The oracle is READ, never typed in
 *
 * ⭐ `bg-destructive` is nowhere in this file as an expectation. The classes a
 * variant emits belong to `buttonVariants` (`../ui/button`), which is a synced
 * upstream file that can change under us, so the expected token set is computed
 * FROM `buttonVariants` at run time and diffed against the default's. If
 * upstream renames the token, this file follows it; if upstream ever makes the
 * two variants emit the same classes, `ORACLE` below reds rather than letting
 * every reading pass vacuously.
 *
 * ## The controls, and what each one buys
 *
 *  - `WIRED` — the fixture, the registry and the renderer draw both footer
 *    buttons at all, so a class reading has something to read.
 *  - `ORACLE` — the computed expectation is non-empty: `destructive` really
 *    does emit tokens `default` does not. Without it, "the button carries every
 *    destructive token" is satisfied by the empty set.
 *  - `INSTRUMENT` — inside ONE dialog the cancel button's class already differs
 *    from the confirm button's, so this reading demonstrably separates one
 *    button variant from another on this very DOM.
 *  - `UNTOUCHED` — a document that does NOT author the key renders a dialog
 *    BYTE-IDENTICAL to one that never could. This is the blast-radius reading:
 *    every `AlertDialogAction` call site in the tree passes no variant, and this
 *    says what they now get, rather than arguing it.
 *
 * ## The mechanism leg — why the union is two values and not six
 *
 * The renderer cannot pass a variant PROP: `packages/components/src/ui/**` is a
 * No-Touch zone (AGENTS.md Commandment #7) and `AlertDialogAction` bakes in
 * `cn(buttonVariants(), className)`. So the variant arrives as a className
 * OVERRIDE, and an override can only displace a baked-in class that shares its
 * tailwind-merge group. `MECHANISM` below measures that boundary live, over the
 * variants the union DOES admit and the ones it does NOT, so the narrowness of
 * the declared union is re-derived on every run instead of being a sentence in
 * a docblock that was true once.
 */

import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { AlertDialogSchema as AlertDialogMirror } from '@object-ui/types/zod';
import { buttonVariants } from '../ui/button';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ───────────────────────────────────────────────────────────────────────── */

/** Radix mints a fresh `useId()` per mount; normalise exactly that and nothing else. */
function normalise(html: string): string {
  return html
    .replace(/«[^«»]*»/g, '«ID»')
    .replace(/:r[0-9a-z]+:/g, ':ID:')
    .replace(/\bradix-[A-Za-z0-9_-]+/g, 'radix-ID');
}

const CANCEL = 'Keep it';
const CONFIRM = 'Delete';

interface Reading {
  dialogHtml: string | null;
  classOf: Record<string, string[] | null>;
}

/** Render one node through the REAL renderer and read the footer classes back. */
function probe(node: Record<string, unknown>): Reading {
  cleanup();
  render(<SchemaRenderer schema={node as never} />);
  // Radix portals the content to `document.body`, so the RTL container is empty.
  const dialog = document.body.querySelector('[role="alertdialog"]');
  const buttons = dialog ? Array.from(dialog.querySelectorAll('button')) : [];
  const classOf: Record<string, string[] | null> = {};
  for (const label of [CANCEL, CONFIRM]) {
    const hit = buttons.find((b) => (b.textContent ?? '').trim() === label);
    classOf[label] = hit ? tokens(hit.getAttribute('class') ?? '') : null;
  }
  const reading: Reading = { dialogHtml: dialog ? normalise(dialog.outerHTML) : null, classOf };
  cleanup();
  return reading;
}

const tokens = (value: string): string[] => value.split(/\s+/).filter(Boolean);

/** A complete alert-dialog in the dialect the renderer reads, forced open. */
function baseNode(): Record<string, unknown> {
  return {
    type: 'alert-dialog',
    title: 'Delete this account?',
    description: 'This action cannot be undone.',
    trigger: { type: 'button', label: 'Delete account' },
    cancelText: CANCEL,
    actionText: CONFIRM,
    defaultOpen: true,
  };
}

/**
 * The tokens `variant` emits that `default` does not, read off `buttonVariants`
 * itself. ⛔ Never typed in — see this file's header.
 */
type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';

function distinguishing(variant: Variant): string[] {
  const base = new Set(tokens(buttonVariants()));
  return tokens(buttonVariants({ variant })).filter((token) => !base.has(token));
}

/**
 * The tokens `default` emits that `variant` does not — what an override must
 * DISPLACE. Empty for `default` itself, which is the honest reading: the
 * primitive already bakes that variant in, so there is nothing to displace.
 */
function displaced(variant: Variant): string[] {
  const other = new Set(tokens(buttonVariants({ variant })));
  return tokens(buttonVariants()).filter((token) => !other.has(token));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Controls — every reading below is void if one of these reds
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8978 — controls: this harness can see the confirm button and its class', () => {
  it('WIRED: the base fixture draws both footer buttons', () => {
    const reading = probe(baseNode());

    expect(reading.dialogHtml).not.toBeNull();
    expect(reading.classOf[CANCEL]).not.toBeNull();
    expect(reading.classOf[CONFIRM]).not.toBeNull();
  });

  it('ORACLE: `destructive` really does emit tokens `default` does not, so the expectation is not the empty set', () => {
    // Without this leg, `toEqual(expect.arrayContaining([]))` below is a
    // tautology and every reading in this file passes against a renderer that
    // changed nothing at all.
    expect(distinguishing('destructive').length).toBeGreaterThan(0);
    expect(distinguishing('default')).toEqual([]);
  });

  it('INSTRUMENT: the class reading separates two button variants on this very DOM', () => {
    // `AlertDialogCancel` ships `buttonVariants({ variant: 'outline' })` and
    // `AlertDialogAction` ships `buttonVariants()`, so a null reading below
    // cannot be blamed on class strings being invisible here.
    const { classOf } = probe(baseNode());

    expect(classOf[CANCEL]).not.toEqual(classOf[CONFIRM]);
  });

  it('UNTOUCHED: omitting the key renders a BYTE-IDENTICAL dialog — the blast radius, read rather than argued', () => {
    // Every `AlertDialogAction` call site in this tree passes no variant. The
    // renderer passes `undefined` for an unauthored key, so `cn()` composes
    // exactly what it composed before this card.
    const withoutKey = probe(baseNode());
    const explicitUndefined = probe({ ...baseNode(), actionVariant: undefined });

    expect(withoutKey.dialogHtml).not.toBeNull();
    expect(explicitUndefined.dialogHtml).toEqual(withoutKey.dialogHtml);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The two legs — a probe reading the wrong node cannot read "clean"
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8978 — `actionVariant` moves the confirm button class', () => {
  it('LEG 1: the DESTRUCTIVE dialog\'s confirm button carries every token the destructive variant emits', () => {
    const { classOf } = probe({ ...baseNode(), actionVariant: 'destructive' });

    expect(classOf[CONFIRM]).toEqual(expect.arrayContaining(distinguishing('destructive')));
  });

  it('LEG 1b: and the default look it displaces is GONE — an override that only adds would leave both', () => {
    // The reading that separates "the red class is present" from "the button is
    // red". Both sets are computed from `buttonVariants`, never typed in.
    const { classOf } = probe({ ...baseNode(), actionVariant: 'destructive' });

    expect(displaced('destructive').length).toBeGreaterThan(0);
    for (const token of displaced('destructive')) expect(classOf[CONFIRM]).not.toContain(token);
  });

  it('LEG 2: the DEFAULT dialog\'s confirm button does NOT carry them, and still carries what it carries today', () => {
    const authoredDefault = probe({ ...baseNode(), actionVariant: 'default' });
    const unauthored = probe(baseNode());

    for (const token of distinguishing('destructive')) {
      expect(unauthored.classOf[CONFIRM], token).not.toContain(token);
      expect(authoredDefault.classOf[CONFIRM], token).not.toContain(token);
    }
    // `default` is the value the primitive already bakes in, so authoring it
    // explicitly must be a no-op on the DOM rather than a second styling path.
    expect(authoredDefault.dialogHtml).toEqual(unauthored.dialogHtml);
  });

  it('LEG 3: the CANCEL button is untouched by the confirm button\'s variant', () => {
    const plain = probe(baseNode());
    const red = probe({ ...baseNode(), actionVariant: 'destructive' });

    expect(red.classOf[CANCEL]).toEqual(plain.classOf[CANCEL]);
    expect(red.classOf[CONFIRM]).not.toEqual(plain.classOf[CONFIRM]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The mechanism that sets the union's width — re-derived, not recorded
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8978 — the override channel is why the union is two values wide', () => {
  it.each(['default', 'destructive'] as const)(
    'MECHANISM+: `%s` is DECLARED, and the override lands clean — nothing it replaces survives on the node',
    (variant) => {
      const { classOf } = probe({ ...baseNode(), actionVariant: variant });
      const leftovers = displaced(variant).filter((token) => classOf[CONFIRM]?.includes(token));

      expect(leftovers).toEqual([]);
    },
  );

  it.each(['outline', 'ghost', 'link'] as const)(
    'MECHANISM-: `%s` is NOT declared, and this DOM reading is why — the default shows through',
    (variant) => {
      // ⭐ The declared union is narrow because the channel is LOSSY, ⛔ not
      // because a ruling said two. Forced past the type into the renderer, these
      // three set no background and/or no text colour, so the primitive's
      // baked-in tokens have nothing in their own tailwind-merge group to
      // displace them and are still on the node afterwards. That is what
      // "declared but cannot be rendered" looks like, and it is the shape this
      // whole card exists to not repeat.
      const { classOf } = probe({ ...baseNode(), actionVariant: variant });

      // ⭐ ARRIVAL FIRST. Without this half the leg passes when the renderer
      // applies NOTHING at all — "the default's tokens are still there" is
      // trivially true of an unwired renderer, so the leg would read green
      // through the very ablation that proves this card's wiring works, and
      // would be certifying a claim it cannot fail. Measured: it does exactly
      // that until this line is here.
      expect(classOf[CONFIRM]).toEqual(expect.arrayContaining(distinguishing(variant)));
      // THEN the loss: the override arrived, and the default still shows through.
      const leftovers = displaced(variant).filter((token) => classOf[CONFIRM]?.includes(token));
      expect(leftovers.length).toBeGreaterThan(0);
      // And the mirror refuses the value by name, so no AUTHOR can reach it.
      expect(AlertDialogMirror.safeParse({ ...baseNode(), actionVariant: variant }).success).toBe(false);
    },
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 * Closure against the authoring face
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8978 — the authoring face admits exactly what the renderer draws', () => {
  it.each(['default', 'destructive'] as const)('the mirror accepts `%s`, and the value SURVIVES the parse', (value) => {
    const result = AlertDialogMirror.safeParse({ ...baseNode(), actionVariant: value });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.actionVariant).toBe(value);
  });

  it('CONTROL: the same document without the key parses green — the key is optional', () => {
    expect(AlertDialogMirror.safeParse(baseNode()).success).toBe(true);
  });

  it('the retired spelling is still refused, and its message now names this key as the remedy', () => {
    // ⛔ The retired key was NOT revived to carry this capability. It still reds,
    // with the same code it has always reported; only the remedy it names moved.
    const result = AlertDialogMirror.safeParse({ ...baseNode(), confirmVariant: 'destructive' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((candidate) => candidate.path.join('.') === 'confirmVariant');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('actionVariant');
    expect(issue?.message).toContain('RETIRED');
  });
});
