/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { SchemaRenderer } from "@object-ui/react"
import React from "react"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The ONE emptiness predicate for a `SchemaNode` slot (objectui#9162).
 *
 * A node slot's published zod face carries a `z.number()` arm
 * (`nodeUnionOptions`, `packages/types/src/zod/base.zod.ts`), so `children: 0`
 * is legal authored input — and React RENDERS numbers. Truthiness is therefore
 * the rule a node slot states: every falsy value (`0`, `-0`, `NaN`, `''`,
 * `false`, `null`, `undefined`) means "this slot has no content", plus the
 * empty array, which has no content either.
 *
 * ⛔ Not a nullish test. `0` is not "absent"; it is present and renders
 * nothing, which is the distinction objectui#8331 kept deliberately and
 * objectui#9033 kept again: truthiness makes the slot's answer independent of
 * `toRenderableSchema`, and that independence is what kept the sibling slot out
 * of the defect while the bridge was wrong.
 *
 * ⛔ Not a `typeof === 'object'` test either. objectui#7105 ruled that node
 * slots RELAX the renderer rather than narrow the declaration — a bare string
 * is a legal node and renders as its own text.
 */
export function isEmptyNodeSlot(slot: unknown): boolean {
  if (!slot) return true;
  return Array.isArray(slot) && slot.length === 0;
}

/**
 * Render a `SchemaNode` slot that lives inside chrome which must disappear
 * along with it — `<CardFooter>`, `<DialogFooter>`, a wrapping `<div>`.
 *
 * This exists because the obvious spelling is a trap:
 *
 * ```tsx
 * {schema.footer && <CardFooter>{renderChildren(schema.footer)}</CardFooter>}
 * ```
 *
 * `&&` does not evaluate to `false` when the slot is falsy — it evaluates to
 * the SLOT, and React paints `0`. Worse, `&&` short-circuits, so
 * `renderChildren`'s own `if (isEmptyNodeSlot) return null` first leg is never
 * reached and the bridge repair of objectui#8908 cannot help either. The class
 * was patched one instance at a time three times (objectui#8331 →
 * objectui#9033 → the eleven of objectui#9162) before it was closed here.
 *
 * `render` receives the slot itself, not a pre-rendered node, because some
 * call sites render it with extra context (`<SchemaRenderer schema={…}
 * data={data} />` in `plugin-detail`). It is invoked ONLY when the slot has
 * content, so the chrome and the content appear and disappear together.
 *
 * A slot with NO chrome does not need this — call `renderChildren(slot)`
 * directly, which is the same guard with nothing wrapped around it. The rule
 * `object-ui/no-bare-node-slot-guard` refuses the `&&` spelling so that these
 * two remain the only two.
 */
export function renderNodeSlot<T>(
  slot: T,
  render: (slot: NonNullable<T>) => React.ReactNode,
): React.ReactNode {
  if (isEmptyNodeSlot(slot)) return null;
  return render(slot as NonNullable<T>);
}

export function renderChildren(children: any): React.ReactNode {
  // The guard — reachable now that no caller short-circuits ahead of it
  // (objectui#9162). `0`, `-0`, `NaN`, `''`, `false` and `[]` all mean
  // "no content", and none of them may reach the DOM.
  if (isEmptyNodeSlot(children)) return null;
  if (typeof children === 'string' || typeof children === 'number') {
    return children;
  }
  if (Array.isArray(children)) {
    // Unwrap single child to support Radix UI 'asChild' pattern which expects a single ReactElement, not an array
    if (children.length === 1) {
      return <SchemaRenderer schema={children[0]} />; 
    }
    return children.map((child, index) => (
      <SchemaRenderer key={child.id || index} schema={child} />
    ));
  }
  return <SchemaRenderer schema={children} />;
}

/**
 * Render a Radix primitive's `*Trigger` around an authored node slot — or
 * render NOTHING when that slot is empty (objectui#9710; the same defect was
 * repaired one instance at a time on objectui#9701).
 *
 * Two rules live here together, because a call site that reaches for one and
 * forgets the other reintroduces a defect this seam exists to close.
 *
 * ## 1. The trigger is chrome, and chrome disappears with its slot
 *
 * `trigger` is `.optional()` on most of these keys, so a document that omits it
 * is LEGAL. The primitive must then render nothing at all: a `*Trigger` with no
 * content still paints its own element, and an empty `button` is an unlabeled
 * tab stop that a keyboard user lands on with nothing to read. That is
 * {@link renderNodeSlot}'s contract — chrome that appears and disappears with
 * its content — and it is why the emptiness guard is INSIDE this seam rather
 * than at each call site.
 *
 * ⚠️ Radix's `Slot` never objected to the empty case: read from the
 * lockfile-pinned `@radix-ui/react-slot`, the branch that throws is guarded by
 * `if (children || children === 0)`, so a `null` child is returned as-is. The
 * empty arm was never broken by the defect below, and must not be broken by its
 * repair.
 *
 * ## 2. `asChild` asks Radix's structural question, not a `typeof` question
 *
 * `asChild` resolves the primitive to that same `Slot`, which merges its props
 * onto a SINGLE React element and throws on anything else it is actually given.
 * A node slot admits far more: the published `SchemaNode` union names `string`,
 * `number`, `boolean`, `null` and `undefined` beside `BaseSchema`, and the
 * trigger keys add an ARRAY of nodes on top. So an unconditional `asChild`
 * asserted a precondition neither published face ever promised, and the values
 * that missed it THREW: `trigger: 'Open it'` — the most natural thing to write
 * for something called a trigger — validated on both faces and then landed the
 * whole node in `SchemaRenderer`'s error boundary, with no diagnostic naming
 * the key. A multi-node array threw the same way, for the same reason.
 *
 * Where `Slot` cannot serve, the primitive renders its OWN element around the
 * content, so a bare string paints as the trigger's text and stays a real
 * trigger; where it CAN serve, the merge is unchanged.
 *
 * ⛔ Widens no published face. `packages/types` states the accept set and is
 * untouched; the implementation is catching up to a declaration that already
 * said yes — the direction objectui#7105 ruled for node slots, which RELAX the
 * renderer rather than narrow the declaration.
 *
 * ```tsx
 * {renderTriggerSlot(DialogTrigger, schema.trigger)}
 * ```
 *
 * ⚠️ A helper is only reached by an author who calls it, so it is not what
 * keeps the next overlay key out of either defect. That is
 * `overlay-trigger-bare-string-9710.test.tsx`, which enumerates the REGISTRY
 * for blocks declaring a `trigger` slot rather than naming files, and reads the
 * zod faces for which of them may legally omit one — so a ninth key is covered
 * on the day it registers, whatever spelling it reached for. ⚠️ That pin is
 * also the ONLY live instrument for this class: a repaired call site carries no
 * `asChild` attribute and no `*Trigger` tag, so a source grep can no longer
 * tell a repaired renderer from a deleted one.
 */
export function renderTriggerSlot(
  Trigger: React.ComponentType<{ asChild?: boolean; children?: React.ReactNode }>,
  slot: unknown,
): React.ReactNode {
  return renderNodeSlot(slot, (present) => {
    const children = renderChildren(present);
    return <Trigger asChild={React.isValidElement(children)}>{children}</Trigger>;
  });
}

