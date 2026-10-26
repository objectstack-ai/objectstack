/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `tooltip` + `context-menu` group — one of the eight the
 * card measured, dispatched as its own PR per the maintainer ruling recorded
 * 2026-09-02 (director seat, summon #8, decision batch #8).
 *
 * ## The defect
 *
 * Both mirrors in `@object-ui/types/zod` REQUIRED `children` — a key neither
 * renderer reads — and omitted keys both renderers do read. `AnyComponentSchema`
 * therefore refused two catalog entries that draw correctly:
 *
 *   - `tooltip` reads `schema.trigger` and `schema.content || schema.body`
 *     (`renderers/overlay/tooltip.tsx:28,31`); its registration's `inputs` list
 *     `trigger` / `content` / `body` and never `children`.
 *   - `context-menu` reads `schema.trigger` and `schema.items` (:95, :99), plus
 *     `triggerClassName` / `contentClassName` / `modal` (:87, :88, :91), none of
 *     which were declared.
 *
 * ## Why the render half is the discriminating half
 *
 * From objectui#6318's triage: a "correction" that renders identically proves
 * the SCHEMA was wrong, not the fixture. So a repair on the schema side has to
 * clear the mirror image of that bar — the validator's verdict must change and
 * the renderer's output must NOT. The numbers in `PRE_REPAIR` below were
 * measured on `origin/main` at `5ad0641e0`, BEFORE the mirrors were touched,
 * through this file's own harness. They are the "before" half of "byte-identical
 * before and after"; a repair that moved a pixel reddens here.
 *
 * ⛔ Do NOT "fix" a red `authors its trigger under 'trigger'` case by moving the
 * tooltip fixture back to `children`. It was already moved from `children` to
 * `trigger` once, on render evidence (objectui#4626 measured it as a blank
 * tile), and reverting it is a named regression — which is why the fixture
 * spelling is pinned here rather than left implicit.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { ContextMenuSchema, TooltipSchema, safeValidateSchema } from '@object-ui/types/zod';
import { getExample } from '../src/index.js';

const TOOLTIP_ID = 'components-overlay-tooltip/basic-tooltip';
const CONTEXT_MENU_ID = 'components-overlay-context-menu/basic-context-menu';

/**
 * The render measured on `origin/main` BEFORE the mirror repair. Element count
 * and text are what the ruling names; the tag census is carried alongside
 * because a count alone cannot tell a swapped element from an equal one.
 */
const PRE_REPAIR = {
  [TOOLTIP_ID]: { elements: 1, text: 'Hover me', tags: ['BUTTON'] },
  [CONTEXT_MENU_ID]: { elements: 3, text: 'Right-click here', tags: ['DIV', 'DIV', 'DIV'] },
} as const;

/** Render one entry the way the docs gallery does and measure what it drew. */
function measure(schema: unknown) {
  const { container } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  const nodes = Array.from(container.querySelectorAll('*'));
  return {
    elements: nodes.length,
    text: container.textContent ?? '',
    tags: nodes.map((el) => el.tagName),
  };
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('objectui#6939 — the two entries the mirror refused now validate', () => {
  it.each([TOOLTIP_ID, CONTEXT_MENU_ID])('%s validates under safeValidateSchema', (id) => {
    // Both reported `: Invalid input` (the union's own top-level issue) before
    // this card, for a key neither renderer reads.
    expect(reasons(getExample(id).schema)).toEqual([]);
  });
});

describe('objectui#6939 — and the repair moved the validator, not the renderer', () => {
  it.each([TOOLTIP_ID, CONTEXT_MENU_ID] as const)('%s renders exactly what it rendered before', (id) => {
    const after = measure(getExample(id).schema);
    const before = PRE_REPAIR[id];
    expect(after.elements).toBe(before.elements);
    expect(after.text).toBe(before.text);
    expect(after.tags).toEqual([...before.tags]);
  });

  it('anti-vacuity: both tiles drew something of their own', () => {
    // An entry that renders nothing satisfies "identical" trivially.
    for (const id of [TOOLTIP_ID, CONTEXT_MENU_ID]) {
      const m = measure(getExample(id).schema);
      expect(m.elements).toBeGreaterThan(0);
      expect(m.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('the context menu still paints its AUTHORED trigger, not the placeholder', () => {
    // The card's measurement for this row: "correcting" the fixture to
    // `children` loses the authored trigger and the renderer's hardcoded
    // fallback `Right click here` (no hyphen) takes its place.
    const text = measure(getExample(CONTEXT_MENU_ID).schema).text;
    expect(text).toBe('Right-click here');
    expect(text).not.toBe('Right click here');
  });
});

describe('objectui#6939 — `children` is no longer required on either member', () => {
  it('a tooltip with no children validates', () => {
    expect(reasons({ type: 'tooltip', trigger: { type: 'text', content: 'x' }, content: 'y' })).toEqual([]);
    expect(TooltipSchema.safeParse({ type: 'tooltip' }).success).toBe(true);
  });

  it('a context menu with no children validates', () => {
    expect(reasons({ type: 'context-menu', trigger: { type: 'text', content: 'x' }, items: [{ label: 'a' }] })).toEqual([]);
    expect(ContextMenuSchema.safeParse({ type: 'context-menu', items: [] }).success).toBe(true);
  });

  it('objectui#8284 and objectui#9256 SUPERSEDE the widen-only half — and objectui#6771 moved WHICH key it refuses', () => {
    // This case used to assert "the accept set only WIDENED — the `children`
    // spelling still parses", on objectui#6939's reasoning that `children`
    // survives as `BaseSchema`'s optional key. That half was overruled for
    // `tooltip` by the objectui#8284 ruling (summon #17, decision batch #2,
    // 2026-09-07): the channel a renderer does not read is tombstoned per
    // component, so authoring it is refused at validation instead of drawing
    // an empty tooltip.
    //
    // ⚠️ AND THE CHANNEL SWAPPED. objectui#6771 retired the `body` spelling and
    // `tooltip` converged on `children`, so the channel this renderer does not
    // read is `body` and that is what the tombstone names now. ⛔ The rule is
    // unchanged — only the key it points at moved, which is why this assertion
    // is inverted rather than dropped, and why it still demands objectui#8284
    // in the message.
    const refused = TooltipSchema.safeParse({
      type: 'tooltip',
      content: 'Helpful information',
      body: [{ type: 'button', label: 'Hover me' }],
    });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues.map((i) => i.path.join('.'))).toEqual(['body']);
      expect(refused.error.issues[0]!.message).toContain('objectui#8284');
    }

    // CONTROL — the key it DOES read parses, so the refusal above is about the
    // retired spelling rather than about the whole content slot.
    expect(TooltipSchema.safeParse({
      type: 'tooltip',
      content: 'Helpful information',
      children: [{ type: 'button', label: 'Hover me' }],
    }).success).toBe(true);

    // ⚠️ THE CONTROL THAT STOOD HERE IS SPENT, on its own terms. PR
    // objectui#9254 left `context-menu` parsing `children` deliberately, and
    // named the condition for that to change: "that verdict needs a
    // cross-package sweep before it can be acted on". objectui#9256 IS that
    // sweep — the read-site instrument extended across all 24 registering
    // packages and the generic traversers — and it measured `context-menu`
    // into FAMILY D: its renderer reads `items`, `trigger`, `modal` and the
    // two class-name keys, and NOTHING reads `children`. So the spelling that
    // used to parse here is refused BY NAME too, and the reading above is kept
    // about `tooltip` by the key-scoped control below instead.
    const menuRefused = ContextMenuSchema.safeParse({
      type: 'context-menu',
      items: [{ label: 'Copy' }],
      children: { type: 'text', content: 'Right-click here' },
    });
    expect(menuRefused.success).toBe(false);
    if (!menuRefused.success) {
      expect(menuRefused.error.issues.map((i) => i.path.join('.'))).toEqual(['children']);
      expect(menuRefused.error.issues[0]!.message).toContain('objectui#9256');
    }

    // CONTROL — the refusal is about the KEY, not about the mirror: the keys
    // both renderers DO read still parse, so the two readings above are not a
    // whole-schema regression.
    expect(ContextMenuSchema.safeParse({
      type: 'context-menu',
      items: [{ label: 'Copy' }],
      trigger: { type: 'text', content: 'Right-click here' },
    }).success).toBe(true);
    expect(TooltipSchema.safeParse({ type: 'tooltip', content: 'Helpful information' }).success).toBe(true);
  });
});

describe('objectui#6939 — the keys the renderers read are DECLARED, not passthrough holes', () => {
  // Counter-probes. Every key probed is one the mirror now declares; an unknown
  // key proves nothing, because `BaseSchema` is `.passthrough()`. Each of these
  // parsed GREEN before this card for exactly that reason.
  it('tooltip.trigger is a schema node, not anything at all', () => {
    expect(TooltipSchema.safeParse({ type: 'tooltip', trigger: { label: 'no type' } }).success).toBe(false);
    expect(TooltipSchema.safeParse({ type: 'tooltip', trigger: [{ label: 'no type' }] }).success).toBe(false);
    // …and the authored shape still passes, so the two above are not failing
    // for some unrelated reason.
    expect(TooltipSchema.safeParse({ type: 'tooltip', trigger: [{ type: 'button', label: 'Hover me' }] }).success).toBe(true);
  });

  it('tooltip declares BOTH halves of its content read', () => {
    const shape = (TooltipSchema as unknown as { shape: Record<string, unknown> }).shape;
    // `body` until objectui#6771 retired the spelling; the declaration is still
    // TWO halves, and the second half is now spelled `children`.
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['trigger', 'content', 'children']));
    expect(TooltipSchema.safeParse({ type: 'tooltip', content: 'text only' }).success).toBe(true);
    expect(TooltipSchema.safeParse({ type: 'tooltip', children: { type: 'text', content: 'rich only' } }).success).toBe(true);
  });

  it('context-menu declares triggerClassName / contentClassName / modal', () => {
    const ok = { type: 'context-menu', items: [{ label: 'Copy' }] };
    expect(ContextMenuSchema.safeParse({ ...ok, modal: 'yes' }).success).toBe(false);
    expect(ContextMenuSchema.safeParse({ ...ok, triggerClassName: 5 }).success).toBe(false);
    expect(ContextMenuSchema.safeParse({ ...ok, contentClassName: 5 }).success).toBe(false);
    expect(ContextMenuSchema.safeParse({
      ...ok, modal: true, triggerClassName: 'p-8', contentClassName: 'w-64',
    }).success).toBe(true);
  });
});

describe('objectui#6939 — the fixtures stay on the spelling their renderers read', () => {
  it('basic-tooltip authors its trigger under `trigger` (objectui#4626)', () => {
    const schema = getExample(TOOLTIP_ID).schema as Record<string, unknown>;
    expect(schema.trigger).toBeDefined();
    expect('children' in schema).toBe(false);
  });

  it('basic-context-menu authors its trigger under `trigger`', () => {
    const schema = getExample(CONTEXT_MENU_ID).schema as Record<string, unknown>;
    expect(schema.trigger).toBeDefined();
    expect('children' in schema).toBe(false);
  });
});
