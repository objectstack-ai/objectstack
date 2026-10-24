/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8236 step 1 — an authored `open` no longer reaches the Radix
 * `Collapsible` root, so the block runs on its own published `inputs`
 * (`defaultOpen` / `disabled` / `trigger` / `content` / `className`).
 * MEASURED here through the real `SchemaRenderer` and the real registry,
 * reading the DOM; nothing in this file is inferred from a grep.
 *
 * ## What was there before, measured on the same instrument
 *
 * `open` was never WRITTEN in the collapsible renderer — which is why a
 * `schema.open` grep read zero and this card was filed as "declared but inert",
 * the exact inverse of the truth. It arrived inside the trailing `{...props}`
 * that renderer spread onto the primitive, and because the spread is written
 * LAST it beat the `defaultOpen` written above it and made the primitive
 * CONTROLLED. Its other half, `onOpenChange`, is refused by name on the zod
 * face (objectui#6124), so a JSON author could not supply the handler a
 * controlled primitive needs.
 *
 * The pre-change readings, taken with this file's fixtures and controls on the
 * branch point, both polarities:
 *
 *   | node                              | initial | after a trigger click |
 *   | --------------------------------- | ------- | --------------------- |
 *   | bare                              | closed  | open                  |
 *   | `defaultOpen: true`               | open    | closed                |
 *   | `open: true`                      | open    | **open** (frozen)     |
 *   | `open: false` + `defaultOpen:true`| closed  | **closed** (frozen)   |
 *
 * The two bottom rows are the defect: the trigger stopped responding, and
 * `open: false` overrode an explicit `defaultOpen: true`. Both rows are
 * asserted below in their post-change form, so a regression reds here rather
 * than reaching an author as a component that silently stops working.
 *
 * ## Controls — a null reading ("`open` moved nothing") is worthless without them
 *
 *  - `TOGGLES` — a bare collapsible starts closed and the trigger opens it.
 *    Without it every "the state did not move" reading below would also pass on
 *    a component that never opens at all.
 *  - `DEFAULT_OPEN` — `defaultOpen: true` starts OPEN and still toggles shut.
 *    This is the key the block publishes, in both directions.
 *  - `SPREAD_STILL_LIVE` — an unrelated authored key still rides the very same
 *    rest-spread onto the root element. This is the control that makes the
 *    exclusion TARGETED rather than a blanket strip: the channel is alive, and
 *    exactly one key was taken out of it.
 *  - `ABSENT_TOKEN` — a key nothing declares does not move the state, so the
 *    readings below are about `open` and not about "any extra key".
 *
 * ⛔ This file does not teach the renderer a new key, and ⛔ it does not touch
 * the global metadata strip list in `SchemaRenderer` — `open` is a REAL live
 * prop on `dialog` / `sheet` / `popover`, which reach their primitives through
 * that same channel (the `CHANNEL` control of
 * `alert-dialog-footer-keys-liveness-7963.test.tsx` is that fact, asserted).
 */

import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
// The schema half of this card (objectui#8236 step 2). Imported for the
// NOT-GATED leg at the bottom only — nothing above validates, and that
// asymmetry is the whole reason step 1 had to land with step 2.
import { CollapsibleSchema as CollapsibleMirror } from '@object-ui/types/zod';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ───────────────────────────────────────────────────────────────────────── */

const BODY = 'Body copy';

/** A complete collapsible in the dialect the renderer reads. */
function base(): Record<string, unknown> {
  return {
    type: 'collapsible',
    trigger: [{ type: 'button', label: 'Toggle' }],
    content: [{ type: 'text', content: BODY }],
  };
}

/**
 * Radix derives the content element's `id` from React's `useId()`, which mints
 * a fresh value on every mount, so two renders of the very same node differ
 * byte-for-byte. Normalise exactly that noise and nothing else — the
 * `IDEMPOTENT` and `SPREAD_STILL_LIVE` controls hold this function honest from
 * both sides.
 */
function normalise(html: string): string {
  return html
    .replace(/«[^«»]*»/g, '«ID»')
    .replace(/:r[0-9a-z]+:/g, ':ID:')
    .replace(/\bradix-[A-Za-z0-9_-]+/g, 'radix-ID');
}

interface Reading {
  /** Radix stamps `data-state` on the `Collapsible` root: `'open'` / `'closed'`. */
  state: string | null;
  /** Whether the content text is in the tree — the user-visible half of the same fact. */
  bodyVisible: boolean;
  /** The root element's `outerHTML`, `useId()` noise normalised — for the spread control and the equality reading. */
  rootHtml: string;
}

/** Render one node through the REAL renderer, read the DOM, click the trigger, read again. */
function probe(node: Record<string, unknown>): { before: Reading; afterClick: Reading } {
  cleanup();
  const { container } = render(<SchemaRenderer schema={node as never} />);
  const read = (): Reading => {
    const root = container.querySelector('[data-state]');
    return {
      state: root ? root.getAttribute('data-state') : null,
      bodyVisible: (container.textContent ?? '').includes(BODY),
      rootHtml: root ? normalise(root.outerHTML) : '',
    };
  };
  const before = read();
  const trigger = container.querySelector('button');
  expect(trigger, 'the fixture must render a trigger button').not.toBeNull();
  fireEvent.click(trigger as HTMLButtonElement);
  const afterClick = read();
  cleanup();
  return { before, afterClick };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Controls — every reading below is void if one of these reds
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — controls: this harness can see the state move', () => {
  it('TOGGLES: a bare collapsible starts closed and the trigger OPENS it', () => {
    const { before, afterClick } = probe(base());

    expect(before.state).toBe('closed');
    expect(before.bodyVisible).toBe(false);
    expect(afterClick.state).toBe('open');
    expect(afterClick.bodyVisible).toBe(true);
  });

  it('DEFAULT_OPEN: the published key starts it OPEN and the trigger still closes it', () => {
    const { before, afterClick } = probe({ ...base(), defaultOpen: true });

    expect(before.state).toBe('open');
    expect(before.bodyVisible).toBe(true);
    expect(afterClick.state).toBe('closed');
  });

  it('SPREAD_STILL_LIVE: an unrelated authored key still rides the rest-spread onto the root', () => {
    // The exclusion is ONE key by name, not a blanket strip: this proves the
    // channel `open` used is still open for everything else on this very node.
    const { before } = probe({ ...base(), 'data-os-8236-channel': 'live' });

    expect(before.rootHtml).toContain('data-os-8236-channel="live"');
  });

  it('IDEMPOTENT: the same node rendered twice reads identical', () => {
    // Without the `useId()` normaliser this reds, and with it red every
    // equality reading below would report "the DOM moved" for every key.
    expect(probe(base()).before.rootHtml).toBe(probe(base()).before.rootHtml);
  });

  it('ABSENT_TOKEN: a key nothing declares does not move the state', () => {
    const { before, afterClick } = probe({ ...base(), zzzNotAKey: true });

    expect(before.state).toBe('closed');
    expect(afterClick.state).toBe('open');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The pins — the two halves of the takeover, in both polarities
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — an authored `open` no longer reaches the primitive', () => {
  it('`open: true` no longer FREEZES the trigger — it opens, and closes again', () => {
    // Before the fix this read `open` / `open`: the primitive was controlled
    // with no handler, so the click did nothing at all.
    const { before, afterClick } = probe({ ...base(), open: true });

    expect(before.state).toBe('closed');
    expect(afterClick.state).toBe('open');
    expect(afterClick.bodyVisible).toBe(true);
  });

  it('`open: false` no longer BEATS `defaultOpen: true`', () => {
    // Before the fix this read `closed` / `closed`: the authored `open` won
    // because the spread that carried it was written after `defaultOpen`.
    const { before, afterClick } = probe({ ...base(), defaultOpen: true, open: false });

    expect(before.state).toBe('open');
    expect(before.bodyVisible).toBe(true);
    expect(afterClick.state).toBe('closed');
  });

  it('`open` moves NOTHING — the rendered root is identical with and without it', () => {
    // The sharpest form of the same statement, and the one that stays true
    // whatever the block's default state becomes later.
    const withOpen = probe({ ...base(), open: true }).before;
    const without = probe(base()).before;

    expect(withOpen.rootHtml).toBe(without.rootHtml);
  });

  it('the trigger stays live across a FULL cycle under `open: true`', () => {
    // A single click cannot tell "the click was honoured" from "the state
    // happened to start where the click would have put it".
    cleanup();
    const { container } = render(
      <SchemaRenderer schema={{ ...base(), open: true } as never} />,
    );
    const state = () => container.querySelector('[data-state]')?.getAttribute('data-state');
    const trigger = container.querySelector('button') as HTMLButtonElement;

    expect(state()).toBe('closed');
    fireEvent.click(trigger);
    expect(state()).toBe('open');
    fireEvent.click(trigger);
    expect(state()).toBe('closed');
    cleanup();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Why step 1 exists at all — the schema refusal does NOT gate the render path
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — the mirror refuses `open`, and that is NOT what stops it', () => {
  it('the mirror REFUSES an authored `open` (step 2), at its own path', () => {
    const result = CollapsibleMirror.safeParse({ ...base(), open: true });

    expect(result.success).toBe(false);
    const paths = (result.success ? [] : result.error.issues).map((i) => i.path.join('.'));
    expect(paths).toContain('open');
  });

  it('NOT GATED: the renderer paints the very node the mirror refuses, without parsing it', () => {
    // objectui#9585 measured this on 3 refs / 14 legs and this leg re-measures
    // it on the node this card is about: `SchemaRenderer` renders, it does not
    // `safeParse`. ⇒ retiring the declaration ALONE would have left the takeover
    // running and removed the author's only warning, which is why the ruling
    // fixed the order (intercept first, retire second). ⛔ Do not read the pins
    // above as "the schema refusal stops it".
    const refused = { ...base(), open: true };
    expect(CollapsibleMirror.safeParse(refused).success).toBe(false);

    const { before, afterClick } = probe(refused);

    // It renders. It does not throw, and no validation error replaces the DOM.
    expect(before.state).toBe('closed');
    expect(afterClick.state).toBe('open');
  });

  it('CONTROL — the same document without `open` parses green', () => {
    // Without this leg, a mirror that refused EVERY collapsible document would
    // satisfy the refusal leg above.
    expect(CollapsibleMirror.safeParse(base()).success).toBe(true);
  });
});
