/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:header-bar`'s `rightContent` slot no longer leaks a stray `"0"`
 * (objectui#9033) — the numeric-falsy JSX trap objectui#8331 measured and
 * closed one slot over on `DataTableSchema.emptyAction`.
 *
 * ## The mechanism, and why it is not objectui#8908
 *
 * `HeaderBarSchema.rightContent` is declared `SchemaNode` on BOTH published
 * faces — the interface in `@object-ui/types`, and its zod mirror, whose node
 * union carries a `z.number()` arm — so `0` is an authorable value for it.
 * `theValidatorAcceptsZero` below asserts that from the published validator
 * rather than asserting it in prose, because every row here is worthless if
 * the value is unreachable.
 *
 * The renderer guarded the slot with an `&&` chain whose left operand is the
 * raw slot value. With `rightContent: 0` that chain evaluates to the NUMBER
 * `0`, and React renders numbers — so the header painted a stray `"0"`.
 *
 * objectui#8908 repaired `toRenderableSchema` so a falsy primitive becomes
 * nothing rather than its `String` form. That repair does ⛔ NOT reach this
 * line and never could: `&&` short-circuits, so the bridge is not called at
 * all for a falsy value — the chain has already produced the raw `0` before
 * any bridge runs. Same symptom from the user's seat, different mechanism,
 * different fix. `theBridgeIsNotWhatFixesThis` pins that distinction directly
 * so a future reader cannot conclude the bridge covers this slot.
 *
 * ## Why `false` and `''` are present but are ⛔ NOT evidence
 *
 * React ignores `false` as a child, and `''` contributes no characters. Both
 * rows were GREEN before the repair and are green after it, so neither can
 * discriminate the two worlds. They sit in `rowsThatCannotDiscriminate` under
 * that name, kept only so a later reader does not "extend coverage" by adding
 * them as if they proved something.
 *
 * The rows that DO discriminate are the falsy NUMBERS, and only they:
 * `0` and `-0` (both of which React prints as the single character `0`) and
 * `NaN` (which prints the three characters `NaN`).
 *
 * ## Why the assertions read whole text rather than query for a node
 *
 * The leak is a bare text node with no element of its own — there is nothing
 * to `querySelector`. The instrument is therefore the header's entire
 * `textContent`, compared against the baseline the same harness produces for
 * `rightContent: undefined`. `theInstrumentSeesSlotText` is the lit control on
 * that instrument: with `rightContent: 42` the text MUST grow by `42`, so a
 * "no stray characters" row cannot pass because the instrument went blind.
 *
 * ## The `SidebarProvider` host
 *
 * `header-bar` renders `SidebarTrigger`, which calls `useSidebar()` and THROWS
 * without a provider. A caught throw renders markup that reads as a clean pass
 * for every row below, so `theHarnessRendersTheRealHeader` asserts the real
 * header is mounted rather than assuming it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registered at module scope, NOT in a `beforeAll`: there the cold transform is
// billed to `hookTimeout`, which is narrower than the timeout it replaces
// (objectui#3010 / #3021, and `object-ui/no-dynamic-import-in-test-hook`).
import '../renderers';
import { SidebarProvider } from '../ui';
import { toRenderableSchema } from '@object-ui/react';
import { HeaderBarSchema as HeaderBarSchemaZod } from '@object-ui/types/zod';

afterEach(() => cleanup());

/** The header's own chrome text, contributed by `SidebarTrigger`'s sr-only label. */
const CHROME = 'Toggle Sidebar';

function renderRightContent(rightContent: unknown) {
  const C = ComponentRegistry.get('header-bar') as React.ComponentType<any>;
  const { container } = render(
    <SidebarProvider>
      <C schema={{ type: 'header-bar', rightContent }} />
    </SidebarProvider>,
  );
  const header = container.querySelector('header');
  if (!header) throw new Error('no <header> — the harness did not mount the real renderer');
  return header.textContent ?? '';
}

/** `rightContent` omitted entirely: the chrome, and nothing else. */
function renderBaseline() {
  const C = ComponentRegistry.get('header-bar') as React.ComponentType<any>;
  const { container } = render(
    <SidebarProvider>
      <C schema={{ type: 'header-bar' }} />
    </SidebarProvider>,
  );
  const header = container.querySelector('header');
  if (!header) throw new Error('no <header> — the harness did not mount the real renderer');
  return header.textContent ?? '';
}

describe('ui:header-bar rightContent numeric-falsy leak (objectui#9033)', () => {
  describe('harness controls', () => {
    it('theHarnessRendersTheRealHeader — a real <header>, not error-boundary markup', () => {
      // `useSidebar()` throws without `SidebarProvider`, and the caught throw is
      // clean markup that would make every "no stray characters" row below pass
      // for entirely the wrong reason.
      expect(renderBaseline()).toContain(CHROME);
    });

    it('theBaselineIsTheChromeAlone', () => {
      expect(renderBaseline()).toBe(CHROME);
    });

    it('theInstrumentSeesSlotText — LIT CONTROL: a truthy number DOES reach the text', () => {
      // Green in both worlds BY DESIGN. Without it, a slot that rendered
      // nothing at all — or a `textContent` read that stopped working — would
      // make every leak row below green while measuring nothing.
      expect(renderRightContent(42)).toBe(`${CHROME}42`);
    });

    it('theValidatorAcceptsZero — the leaked value is AUTHORABLE, not hypothetical', () => {
      // The published zod face for this slot is `SchemaNodeSchema.optional()`,
      // and that union carries a `z.number()` arm. If this row ever goes red the
      // slot stopped admitting numbers and the rows below stopped being about
      // anything — ⛔ that is a declaration change, not a licence to delete them
      // (objectui#7105: node slots relax the RENDERER).
      const parsed = HeaderBarSchemaZod.safeParse({ type: 'header-bar', rightContent: 0 });
      expect(parsed.success).toBe(true);
    });
  });

  describe('the falsy NUMBERS — the only rows that discriminate', () => {
    it('rightContent: 0 renders the chrome and no stray "0"', () => {
      // RED before the repair: `"Toggle Sidebar0"`.
      expect(renderRightContent(0)).toBe(CHROME);
    });

    it('rightContent: -0 renders the chrome and no stray "0"', () => {
      // React prints `-0` as the single character `0`, same as `0`.
      expect(renderRightContent(-0)).toBe(CHROME);
    });

    it('rightContent: NaN renders the chrome and no stray "NaN"', () => {
      // The loudest row of the three: `NaN` paints three characters, not one.
      expect(renderRightContent(NaN)).toBe(CHROME);
      expect(renderRightContent(NaN)).not.toContain('NaN');
    });
  });

  describe('live controls — unchanged by the repair, asserted in the SAME run', () => {
    it('rightContent: 42 still renders 42', () => {
      expect(renderRightContent(42)).toBe(`${CHROME}42`);
    });

    it("rightContent: 'txt' still renders txt", () => {
      expect(renderRightContent('txt')).toBe(`${CHROME}txt`);
    });

    it('rightContent: undefined renders the baseline chrome only', () => {
      expect(renderRightContent(undefined)).toBe(CHROME);
    });

    it('an authored NODE still renders — the slot is still a node slot', () => {
      // The repair must not have narrowed the slot to primitives-only.
      expect(renderRightContent({ type: 'text', content: 'node' })).toContain('node');
    });
  });

  describe('rowsThatCannotDiscriminate — ⛔ green before the repair too, kept only to say so', () => {
    it('rightContent: false was ALREADY correct — React ignores `false` as a child', () => {
      expect(renderRightContent(false)).toBe(CHROME);
    });

    it("rightContent: '' was ALREADY correct — an empty string contributes no characters", () => {
      expect(renderRightContent('')).toBe(CHROME);
    });
  });

  describe('the mechanism, pinned so it is not confused with objectui#8908', () => {
    it('theBridgeIsNotWhatFixesThis — `toRenderableSchema` already mapped 0 onto nothing', () => {
      // The bridge has been behaviour-preserving for falsy primitives since
      // objectui#8908. It was ALREADY correct while this slot leaked, because
      // `&&` short-circuits and never calls it for a falsy value. So a reader
      // who finds the bridge correct must ⛔ not conclude this slot is covered:
      // the guard shape is what covers it.
      expect(toRenderableSchema(0)).toBeUndefined();
      expect(toRenderableSchema(NaN)).toBeUndefined();
      expect(toRenderableSchema(42)).toBe('42');
    });
  });
});
