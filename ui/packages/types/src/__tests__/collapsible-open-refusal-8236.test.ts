/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `open` is RETIRED on the `collapsible` node, on both faces (objectui#8236,
 * ADR-0049 enforce-or-remove; maintainer ruling 2026-09-17 「9593 A,其他同意」,
 * step 2 of two). `defaultOpen` is the surviving spelling for the INITIAL
 * state — and it is deliberately NOT offered as an equivalent, because it is
 * not one: `defaultOpen` seeds the state and hands control back to the user,
 * while `open` claimed to hold it.
 *
 * ## Why a REFUSAL and not a bare deletion
 *
 * `BaseSchemaCore` ends `.passthrough()` (and the TS `BaseSchema` closed with an
 * index signature until objectui#8347), so a dropped MEMBER key is KEPT, not
 * refused, on the zod face. Deleting the
 * two declarations would have left the silent accept exactly as it was and
 * thrown the diagnostic away with it. `retirementTombstone()` keeps the key
 * DECLARED and unwritable, which is what makes the refusal loud — and it keeps
 * the mirror's key set equal to the declaration's, so the pair does not drift in
 * `zod-mirror-parity.test.ts`.
 *
 * ## ⚠️ The refusal is NOT what stops the takeover
 *
 * This card's whole shape turns on that. An authored `open` was LIVE: it rode
 * `SchemaRenderer`'s non-metadata spread into the collapsible renderer's
 * trailing `{...props}` and made the Radix primitive controlled, freezing the
 * trigger. objectui#9585 measured the render path NOT GATED — no `safeParse`
 * runs there — so retiring the declaration ALONE would have deleted the
 * author's only warning while the takeover kept running. The renderer-side
 * named exclusion is step 1 and landed FIRST, in the same change; the DOM
 * reading that settles it lives where a DOM exists
 * (`packages/components/src/__tests__/collapsible-open-intercept-8236.test.tsx`),
 * which also re-measures the NOT-GATED half on this very node.
 *
 * ## ⛔ Deliberately NOT a sweep
 *
 * `dialog` / `sheet` / `popover` declare `open` too, and there it is a REAL live
 * prop their primitives consume. The ruling bars a sibling sweep, and the last
 * describe block below is that scope kept as a live assertion rather than as
 * prose.
 */

import { describe, expect, it } from 'vitest';

import type { CollapsibleSchema } from '../disclosure';
import { CollapsibleSchema as CollapsibleZod } from '../zod/disclosure.zod.js';
import { DialogSchema as DialogZod, PopoverSchema as PopoverZod, SheetSchema as SheetZod } from '../zod/overlay.zod.js';

/** A complete collapsible in the dialect the renderer reads. */
const BASE_DOC = {
  type: 'collapsible',
  trigger: { type: 'button', label: 'Toggle' },
  content: { type: 'text', content: 'Body' },
} as const;

/** The document an author wrote against the retired declaration. */
const RETIRED_DOC = { ...BASE_DOC, open: true } as const;

/** The same intent in the surviving spelling — the INITIAL state, not control. */
const REMEDY_DOC = { ...BASE_DOC, defaultOpen: true } as const;

const issueFor = (doc: unknown, key: string) => {
  const result = CollapsibleZod.safeParse(doc);
  return (result.success ? [] : result.error.issues).find((issue) => issue.path.join('.') === key);
};

/* ────────────────────────────────────────────────────────────────────────────
 * The contract
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — the `collapsible` node REFUSES `open`', () => {
  it('`open` is still DECLARED, which is what makes the refusal loud rather than a strip', () => {
    // Under `.passthrough()` an UNDECLARED key is kept in silence — and on this
    // node "kept" meant "spread onto the primitive", which is the defect. A
    // refusal has to be declared, so a bare deletion was never the shape here.
    expect(Object.keys(CollapsibleZod.shape)).toContain('open');
  });

  it('refuses the retired document at parse, at its own path', () => {
    const result = CollapsibleZod.safeParse(RETIRED_DOC);

    expect(result.success).toBe(false);
    const paths = (result.success ? [] : result.error.issues).map((issue) => issue.path.join('.'));
    expect(paths).toContain('open');
  });

  it('`open` reports `invalid_type` — the tombstone code, not a custom arm', () => {
    // `retirementTombstone` is a `z.never` arm: CODE and PATH are what a bare
    // `z.never()` reports and only the MESSAGE is customised. Its sibling
    // `handlerKeyRefusal` reports `custom` instead — and this very schema
    // carries one of those (`onOpenChange`, asserted below), so the two really
    // are adjacent here and asserting the code is what keeps them apart.
    expect(issueFor(RETIRED_DOC, 'open')?.code).toBe('invalid_type');
  });

  it("the message is the ruling's sentence — the key, the reason, and the surviving spelling", () => {
    // Pinned as the ruling wrote it, because the ruling wrote it: it names why
    // controlled state cannot be authored at all, and points at `defaultOpen`
    // for the INITIAL state only. ⛔ It deliberately does NOT say "author
    // `defaultOpen` instead" as an equivalent — that leg was measured and
    // refused.
    const message = issueFor(RETIRED_DOC, 'open')?.message ?? '';

    expect(message).toBe(
      '`open` is not authorable in SDUI: controlled state needs a handler the schema cannot carry '
      + '(objectui#6124); use `defaultOpen` for the initial state',
    );
    // Zod's own default for a `never` arm says none of this.
    expect(message).not.toBe('Invalid input: expected never, received boolean');
  });

  it('the same string reaches the docs surface — one guidance, two channels', () => {
    // `retirementTombstone` feeds `.describe()` and the parse-time message from
    // ONE argument, so the text an author reads and the text generated docs
    // publish cannot drift apart.
    expect(CollapsibleZod.shape.open.description).toBe(issueFor(RETIRED_DOC, 'open')?.message);
  });

  it('the remedy the message names actually parses, and survives the parse', () => {
    const result = CollapsibleZod.safeParse(REMEDY_DOC);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.defaultOpen).toBe(true);
  });

  it('POSITIVE CONTROL — the same document without `open` parses green', () => {
    // Without this leg, a schema that refused EVERY collapsible document would
    // satisfy every assertion above.
    expect(CollapsibleZod.safeParse(BASE_DOC).success).toBe(true);
  });

  it('the refusal is TARGETED, not a strict node', () => {
    // The cheap way to refuse a key is `.strict()`. It is the wrong shape: this
    // node's `BaseSchema` is `.passthrough()` by design and other pins read that
    // openness. One key, by name.
    const result = CollapsibleZod.safeParse({ ...BASE_DOC, someRendererProp: 42 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as Record<string, unknown>).someRendererProp).toBe(42);
  });

  it('`onOpenChange` is UNTOUCHED — still declared, still a named handler refusal (`custom`)', () => {
    // The other half of controlled state, and the reason `open` could never
    // work: objectui#6124's policy is not relaxed or duplicated by this card.
    expect(Object.keys(CollapsibleZod.shape)).toContain('onOpenChange');
    expect(issueFor({ ...BASE_DOC, onOpenChange: () => {} }, 'onOpenChange')?.code).toBe('custom');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The TypeScript face — the twin that makes `tsc` refuse it before anything runs
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — the TypeScript twin refuses `open` at the authoring site', () => {
  it('authoring `open` does not type-check, while `defaultOpen` does', () => {
    // `tsc` is the reader of this leg (this package type-checks its tests), and
    // the `@ts-expect-error` is the assertion: it REDS if the key ever becomes
    // writable again. The control below is what keeps it honest — without a
    // neighbouring line that DOES compile, a declaration nobody can satisfy at
    // all would satisfy the expectation just as well.
    // @ts-expect-error objectui#8236 — `open` is a `?: never` tombstone
    const refused: CollapsibleSchema = { ...BASE_DOC, open: true };
    const accepted: CollapsibleSchema = { ...BASE_DOC, defaultOpen: true };

    expect(accepted.defaultOpen).toBe(true);
    expect(refused.type).toBe('collapsible');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Scope — ⛔ the siblings are NOT swept
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#8236 — `open` stays LIVE on the overlay siblings', () => {
  it.each([
    ['dialog', DialogZod, { type: 'dialog' }],
    ['sheet', SheetZod, { type: 'sheet' }],
    ['popover', PopoverZod, { type: 'popover', trigger: BASE_DOC.trigger, content: BASE_DOC.content }],
  ] as const)('`%s` still ACCEPTS an authored `open`', (_name, mirror, doc) => {
    // This is why the fix is a named exclusion in ONE registration and ⛔ not a
    // new entry on `SchemaRenderer`'s global metadata strip list: on these three
    // the key is a real prop their primitives consume, and a global strip would
    // have taken it away from all of them at once.
    const result = mirror.safeParse({ ...doc, open: true });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.open).toBe(true);
  });
});
