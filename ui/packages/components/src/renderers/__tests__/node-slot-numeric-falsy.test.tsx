/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every `SchemaNode` slot in `@object-ui/components` refuses a numeric-falsy
 * authored value instead of painting it into the DOM (objectui#9162).
 *
 * ## The defect, and why these values are authorable
 *
 * A slot guarded by a bare `&&` does not evaluate to `false` when the slot is
 * falsy — it evaluates to the slot's own value, and React RENDERS numbers. The
 * published zod face for a node slot carries a `z.number()` arm
 * (`nodeUnionOptions`, `packages/types/src/zod/base.zod.ts`), so `children: 0`
 * is legal authored input. `theValidatorAcceptsZero` asserts that from the
 * published validator rather than in prose: every row below is worthless if the
 * value cannot be authored.
 *
 * objectui#8908 repaired `toRenderableSchema`, and `renderChildren`'s own first
 * leg is `if (!children) return null`. ⛔ NEITHER reaches these sites while the
 * `&&` is there: `&&` short-circuits, so the chain produced the raw `0` before
 * any renderer ran. That is why the repair is the guard SHAPE, not the bridge.
 *
 * ## The instrument, and the two ways it can lie
 *
 * 1. **Radix portals out of the render container.** `dialog`, `sheet` and
 *    `drawer` mount their content on `document.body`, not inside the container
 *    RTL returns — objectui#9162's own first probe read those three rows as
 *    "clean" for exactly that reason. So every read here is
 *    `document.body.textContent`, ⛔ never the container's.
 * 2. **A row can go green because nothing rendered at all.** Each row therefore
 *    carries its own LIT CONTROL: the SAME slot fed `42`, which must reach the
 *    text. A leak row whose lit control does not fire is NOT MEASURED, not
 *    clean — `it.each` runs the lit control as its own named row so a blind
 *    instrument fails loudly instead of passing quietly.
 *
 * ## Which values discriminate
 *
 * Only the falsy NUMBERS. React ignores `false` and `''` contributes no
 * characters, so those two rows were green before the repair and are green
 * after it; they live in `rowsThatCannotDiscriminate` so a later reader does
 * not mistake them for evidence. `0` and `-0` paint one character; `NaN` paints
 * three.
 *
 * ## ⛔ Not a licence to narrow the declaration
 *
 * objectui#7105 ruled that node slots RELAX THE RENDERER rather than narrow the
 * declaration. `anAuthoredNodeStillRenders` is the live control for that on
 * every row: the repair must not have turned these into primitives-only or
 * objects-only slots.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registered at module scope, NOT in a `beforeAll`: there the cold transform is
// billed to `hookTimeout`, which is narrower than the timeout it replaces
// (objectui#3010 / #3021, and `object-ui/no-dynamic-import-in-test-hook`).
import '../../renderers';
import { SidebarProvider } from '../../ui';
import {
  CardSchema as CardSchemaZod,
  ContainerSchema as ContainerSchemaZod,
  DialogSchema as DialogSchemaZod,
} from '@object-ui/types/zod';

afterEach(() => cleanup());

/** A sentinel distinct from every authorable value, including `undefined`. */
const OMIT = Symbol('omit');

interface Site {
  /** Row label: `<registry key> <slot>`. */
  readonly name: string;
  /** Registry type. */
  readonly type: string;
  /** Registry namespace — `card` is registered twice (`ui:card`, `page:card`). */
  readonly namespace: string;
  /** The slot under test. */
  readonly slot: string;
  /** Sibling keys the renderer needs before it will mount its chrome at all. */
  readonly base?: Record<string, unknown>;
}

/**
 * The eleven leaking sites objectui#9162 measured, plus the three the same
 * instrument reaches once the class is being closed rather than the instances:
 * `ui:card` `children` (clean on `main` only by the accident of `||` operand
 * order — see `uiCardChildrenNoLongerDependsOnOperandOrder`), and `page:card`'s
 * `body` / `footer`, which the card's TypeScript census could not see because
 * that renderer's `schema` is `any`.
 *
 * ⚠️ `ui:card body` LEFT this table, and that is a slot that ceased to exist,
 * not a leak that was fixed: objectui#6771 retired the `body` child-list
 * spelling, so `ui:card` reads `renderNodeSlot(schema.children, …)` and there is
 * no `body` slot left for a numeric-falsy value to leak through. `page:card`'s
 * `body` STAYS — that key is `PageCardProps.body`, a read-only back-compat path
 * for stored documents under a different retirement (objectstack#5775, ADR-0087
 * D2), and it is still a live node slot.
 *
 * ⚠️ `drawer footer` LEFT this table the same way: objectui#11347 retired the
 * drawer's `footer` read, so the slot ceased to exist rather than stopped
 * leaking.
 */
const SITES: readonly Site[] = [
  { name: 'container children', type: 'container', namespace: 'ui', slot: 'children' },
  { name: 'flex children', type: 'flex', namespace: 'ui', slot: 'children' },
  { name: 'grid children', type: 'grid', namespace: 'ui', slot: 'children' },
  { name: 'stack children', type: 'stack', namespace: 'ui', slot: 'children' },
  { name: 'ui:card header', type: 'card', namespace: 'ui', slot: 'header' },
  { name: 'ui:card children', type: 'card', namespace: 'ui', slot: 'children' },
  { name: 'ui:card footer', type: 'card', namespace: 'ui', slot: 'footer' },
  { name: 'page:card body', type: 'card', namespace: 'page', slot: 'body' },
  { name: 'page:card footer', type: 'card', namespace: 'page', slot: 'footer' },
  { name: 'dialog footer', type: 'dialog', namespace: 'ui', slot: 'footer', base: { defaultOpen: true } },
  { name: 'sheet footer', type: 'sheet', namespace: 'ui', slot: 'footer', base: { defaultOpen: true } },
  {
    name: 'table footer',
    type: 'table',
    namespace: 'ui',
    slot: 'footer',
    // Without a column the footer cell's `colSpan` is `undefined` and the row
    // still mounts, but a header column makes the baseline text non-empty,
    // which is what proves the table itself rendered.
    base: { columns: [{ header: 'H', accessorKey: 'a' }], data: [] },
  },
];

/**
 * Render one site and read the WHOLE document's text.
 *
 * ⛔ Not the RTL container: Radix overlays portal to `document.body`, and
 * reading the container alone reported three of these rows as clean when they
 * were leaking (objectui#9162).
 */
function renderSite(site: Site, value: unknown): string {
  const C = ComponentRegistry.get(site.type, site.namespace) as React.ComponentType<any>;
  if (!C) throw new Error(`no renderer registered for ${site.namespace}:${site.type}`);
  const schema: Record<string, unknown> = { type: site.type, ...(site.base ?? {}) };
  if (value !== OMIT) schema[site.slot] = value;
  render(<C schema={schema} />);
  return document.body.textContent ?? '';
}

describe('SchemaNode slots refuse numeric-falsy authored values (objectui#9162)', () => {
  describe('authorability — the leaked value is legal input, not a hypothetical', () => {
    it('theValidatorAcceptsZero — the published zod face admits a number in a node slot', () => {
      // If these go red the slots stopped admitting numbers and every row below
      // stopped being about anything. ⛔ That is a declaration change, not a
      // licence to delete the rows (objectui#7105: node slots relax the
      // RENDERER, they do not narrow the declaration).
      expect(ContainerSchemaZod.safeParse({ type: 'container', children: 0 }).success).toBe(true);
      expect(CardSchemaZod.safeParse({ type: 'card', footer: 0 }).success).toBe(true);
      expect(CardSchemaZod.safeParse({ type: 'card', header: 0 }).success).toBe(true);
      expect(CardSchemaZod.safeParse({ type: 'card', children: 0 }).success).toBe(true);
      expect(DialogSchemaZod.safeParse({ type: 'dialog', footer: 0 }).success).toBe(true);
    });
  });

  describe.each(SITES)('$name', (site) => {
    it('LIT CONTROL — the instrument sees this slot: 42 reaches the text', () => {
      // Green in BOTH worlds by design. Without it a slot that rendered nothing
      // at all — or a `document.body.textContent` read that stopped reaching
      // the portal — would make the leak rows below green while measuring
      // nothing at all. A leak row whose lit control is red is NOT MEASURED.
      const baseline = renderSite(site, OMIT);
      cleanup();
      const lit = renderSite(site, 42);
      expect(lit).not.toBe(baseline);
      expect(lit).toContain('42');
    });

    it('0 does not leak', () => {
      // RED before the repair at eleven of these rows: the `&&` chain produced
      // the raw `0` and React painted the character.
      const baseline = renderSite(site, OMIT);
      cleanup();
      expect(renderSite(site, 0)).toBe(baseline);
    });

    it('-0 does not leak — React prints it as the single character "0"', () => {
      const baseline = renderSite(site, OMIT);
      cleanup();
      expect(renderSite(site, -0)).toBe(baseline);
    });

    it('NaN does not leak — the loudest row, three characters not one', () => {
      const baseline = renderSite(site, OMIT);
      cleanup();
      const withNaN = renderSite(site, NaN);
      expect(withNaN).toBe(baseline);
      expect(withNaN).not.toContain('NaN');
    });

    it('anAuthoredNodeStillRenders — LIVE CONTROL: the slot is still a node slot', () => {
      // The repair must not have narrowed the slot. `''`/`0` render nothing;
      // an authored NODE must still render its content.
      expect(renderSite(site, { type: 'text', content: 'liveNode' })).toContain('liveNode');
    });

    it('anAuthoredStringStillRenders — LIVE CONTROL: primitives are still admitted', () => {
      expect(renderSite(site, 'liveText')).toContain('liveText');
    });

    describe('rowsThatCannotDiscriminate — ⛔ green before the repair too', () => {
      it("false was ALREADY correct — React ignores `false` as a child", () => {
        const baseline = renderSite(site, OMIT);
        cleanup();
        expect(renderSite(site, false)).toBe(baseline);
      });

      it("'' was ALREADY correct — an empty string contributes no characters", () => {
        const baseline = renderSite(site, OMIT);
        cleanup();
        expect(renderSite(site, '')).toBe(baseline);
      });
    });
  });

  describe('the one row that was clean on `main`, and why that was not protection', () => {
    it('uiCardChildrenNoLongerDependsOnOperandOrder — the `||` chain that made it accidental is gone', () => {
      // `ui:card` read `(schema.children || schema.body)`, and `0 || undefined`
      // is `undefined` — so `children: 0` was converted away by accident of
      // OPERAND ORDER, not by any guard. The proof used to be the sibling key:
      // with `children` absent, `undefined || 0` is `0`, and THAT row leaked.
      //
      // objectui#6771 retired the `body` spelling, so the chain is one operand
      // long: `renderNodeSlot(schema.children, …)`. The accident cannot recur,
      // and `children: 0` is clean because the guard says so. ⛔ The assertion
      // is on the SOURCE, not on the render: a render reading is green under
      // both spellings of the reader and would not see the chain come back.
      // Rooted at THIS FILE, the spelling `check-test-path-roots.mjs` teaches:
      // the cwd is the package directory under one invocation and the repo root
      // under the form CI runs, so a cwd-relative literal reaches two verdicts
      // (objectui#7799). ⛔ And ⛔ not `readFileSync(new URL(…))` either — in the
      // `dom` project `import.meta.url` is not a `file:` URL and that throws;
      // reading its `pathname` is scheme-independent.
      const SELF_DEPTH_BELOW_REPO_ROOT = 6; // packages/components/src/renderers/__tests__/<this file>
      const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
        .split('/')
        .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
        .join('/');
      const CARD_SRC = `${REPO_ROOT}/packages/components/src/renderers/layout/card.tsx`;
      expect(existsSync(CARD_SRC), `depth is wrong — ${CARD_SRC} not found`).toBe(true);
      const src = readFileSync(CARD_SRC, 'utf8');
      expect(src).toContain('renderNodeSlot(schema.children,');
      expect(src).not.toContain('schema.children || schema.body');

      // And the row it used to lean on is still clean, through the guard.
      const site = SITES.find((s) => s.name === 'ui:card children')!;
      const baseline = renderSite(site, OMIT);
      cleanup();
      expect(renderSite(site, 0)).toBe(baseline);
    });
  });

  describe('the control that was ALREADY fixed — it must not move (objectui#9033)', () => {
    // `ui:header-bar`'s `rightContent` took the ternary in objectui#9033 and is
    // the negative control for this whole census: the instrument that finds the
    // leaking sites above must find this one clean, and must still SEE it. Its
    // own dedicated coverage is
    // `__tests__/header-bar-right-content-numeric-falsy.test.tsx`; this pair
    // exists so a run of THIS file cannot report a clean sweep while the
    // control silently regressed, and reads through the same
    // `document.body.textContent` instrument the rows above use.
    //
    // `header-bar` renders `SidebarTrigger`, which calls `useSidebar()` and
    // THROWS without a provider — caught-throw markup would read as a clean
    // pass — so the lit control below is what proves the real header mounted.
    function renderHeaderBar(value: unknown): string {
      const C = ComponentRegistry.get('header-bar', 'ui') as React.ComponentType<any>;
      if (!C) throw new Error('no renderer registered for ui:header-bar');
      const schema: Record<string, unknown> = { type: 'header-bar' };
      if (value !== OMIT) schema.rightContent = value;
      render(
        <SidebarProvider>
          <C schema={schema} />
        </SidebarProvider>,
      );
      return document.body.textContent ?? '';
    }

    it('LIT CONTROL — the same instrument still sees header-bar rightContent', () => {
      const baseline = renderHeaderBar(OMIT);
      cleanup();
      const lit = renderHeaderBar(42);
      expect(lit).not.toBe(baseline);
      expect(lit).toContain('42');
    });

    it('headerBarRightContentStaysClean — GREEN BEFORE AND AFTER this change', () => {
      // ⛔ This row must not move. It was already green on `main`; if this
      // change had turned it red, the repair would have broken the one site
      // that was already correct.
      const baseline = renderHeaderBar(OMIT);
      cleanup();
      expect(renderHeaderBar(0)).toBe(baseline);
      cleanup();
      expect(renderHeaderBar(NaN)).toBe(baseline);
    });
  });
});
