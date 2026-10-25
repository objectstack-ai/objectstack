/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One `SchemaNode` (objectui#4580).
 *
 * This package used to hand-declare `interface SchemaNode { type: string; …
 * [key: string]: any }` here, while `@object-ui/types` exported
 * `type SchemaNode = BaseSchema | string | number | boolean | null | undefined`
 * — two different types under one name, from two packages the same consumers
 * import together. Which declaration a call site got depended on which package
 * it happened to import from, and #4548's option-A canary measured **19 of 35**
 * errors as exactly that collision:
 *
 * ```
 * Type 'import(".../packages/types/dist/base").SchemaNode' is not assignable to
 * type 'import(".../packages/core/dist/types/index").SchemaNode'
 * ```
 *
 * PR #4578 sidestepped it — `SchemaRenderer` states its own component-level
 * union rather than picking a side — and left the reconciliation to this card.
 *
 * **`@object-ui/types`' union wins**, per #4580's ruling 1: it is the spec of
 * record (its own doc comment names `'Plain string'` a valid node), and it is
 * the side the measured collisions resolve toward. The declaration is RE-EXPORTED
 * rather than restated, so there is exactly one declaration left to disagree
 * with — a structural copy would reproduce the defect the moment either side
 * moved. This package already depends on `@object-ui/types`, so the edge exists
 * and adds no cycle.
 *
 * ## The entry-surface sentence that used to close this block is WITHDRAWN
 *
 * It read: *core's own entry surface is unchanged (`dist/index.d.ts` is
 * byte-identical across the change — measured, both rounds)*. The reading was
 * real, and it certified nothing (objectui#5673).
 *
 * `core/dist/index.d.ts` is emitted from a barrel that only FORWARDS this
 * symbol, and forwarding never restates a shape — not `export *`, and not the
 * `export type { SchemaNode, … } from './types/index.js'` line that names it.
 * Only the module that DECLARES the symbol can move. So that file is
 * byte-identical under any change to a re-exported declaration's shape, naming
 * the symbol or not, and a gauge that cannot fail for the change class it is
 * quoted against has discharged nothing.
 *
 * ## The gauge that can fail — and how to prove it can, before believing it
 *
 * 1. Watch the emitted `.d.ts` of the module that DECLARES the symbol. For
 *    `SchemaNode` that is `@object-ui/types`' `dist/base.d.ts`, in another
 *    package — not core's entry, and not core's own `dist/types/index.d.ts`
 *    either, which forwards exactly as the entry does. For the shape claim
 *    itself, resolve the symbol through the TypeScript CHECKER from
 *    `core/dist/index.d.ts`.
 * 2. Build both legs from a cleared `dist/` AND a cleared
 *    `tsconfig.tsbuildinfo` — the build info lives outside `dist/`, so
 *    composite `tsc` skips emit if it survives and two stale trees compare
 *    equal for free.
 * 3. CALIBRATE: inject a probe key into the declaring module, rebuild, and
 *    require the hash you are watching to MOVE; drop the probe, rebuild, and
 *    require it to come back to its original value. A probe that leaves your
 *    hash unmoved means the gauge is not wired to this symbol — that is what
 *    failure looks like here, and no "byte-identical" sentence may be written
 *    from a gauge that just failed it.
 *
 * Run against this file's own claim — probe: one additive optional key on
 * `BaseSchema`, the shape `SchemaNode` publishes — `@object-ui/types`'
 * `dist/base.d.ts` moved and came back, while `core/dist/index.d.ts` and
 * `core/dist/types/index.d.ts` held one hash across all three legs. The
 * withdrawn sentence was watching the two files that cannot move.
 *
 * The collision is only observable from a package that resolves BOTH through
 * `node_modules`; the pin therefore lives in `@object-ui/react`
 * (`src/__tests__/SchemaNode.reconciliation.test.ts`), not here.
 */
export type { SchemaNode } from '@object-ui/types';

/**
 * One `ComponentRendererProps` (objectui#4594).
 *
 * This package used to hand-declare `interface ComponentRendererProps
 * { schema: SchemaNode; [key: string]: any }` here — two lines below `SchemaNode`
 * and against `@object-ui/types`' generic
 * `ComponentRendererProps< TSchema extends BaseSchema = BaseSchema >`. Same name,
 * two packages the same consumers import together: the second such pair in this
 * one file, and the third across this fault line after `SchemaNode` (#4580) and
 * `ComponentInput` (#4972).
 *
 * **`@object-ui/types`' generic declaration wins**, and is RE-EXPORTED rather
 * than restated, so there is exactly one declaration left to disagree with — a
 * structural copy would reproduce the defect the moment either side moved.
 *
 * Reconciled now, at **zero consumers** — re-verified on the merged ref rather
 * than inherited from the card: repo-wide, `ComponentRendererProps` occurred only
 * at the two declarations, each package's own entry re-export, and one line of
 * `packages/components/CHANGELOG.md` recording that nothing used it. Zero
 * consumers is why this is cheap today and would not stay cheap: the day someone
 * imports it, which declaration they get decides whether a primitive node is
 * admissible.
 *
 * ## What the re-export moves, and how that was measured
 *
 * It is NOT surface-neutral, and the gauge that would have said so is vacuous.
 * `core/dist/index.d.ts` is emitted from a barrel that only FORWARDS this
 * symbol — its `export type { … }` line names it, and naming is not restating
 * — so that file is byte-identical under ANY change to a re-exported
 * declaration's shape and cannot fail for this change class (objectui#5673,
 * where the `SchemaNode` block above withdraws the same reading and carries the
 * probe calibration that tells a live gauge from this one).
 *
 * Measured instead by resolving the symbol through the TypeScript CHECKER from
 * `core/dist/index.d.ts`, over a `dist/` + `tsconfig.tsbuildinfo` clean rebuild
 * on both legs (the build info lives outside `dist/`, so composite `tsc` skips
 * emit if it survives and two stale trees compare equal for free):
 *
 * ```
 * before   ComponentRendererProps            schema: BaseSchema | string | number | boolean | null | undefined
 * after    ComponentRendererProps<TSchema>   schema: TSchema  (TSchema extends BaseSchema = BaseSchema)
 * ```
 *
 * So `schema` NARROWS back to the object form — core's copy had silently widened
 * when #4608 made `SchemaNode` a re-export of types' union, which is the interim
 * state this card closes — and the type gains a parameter. Nothing downstream
 * can observe either move, because nothing imports it.
 *
 * The collision is only observable from a package that resolves BOTH through
 * `node_modules`; the pin therefore lives in `@object-ui/react`
 * (`src/__tests__/ComponentRendererProps.reconciliation.test.ts`), not here —
 * same position, same reason, as `SchemaNode`'s pin above.
 */
export type { ComponentRendererProps } from '@object-ui/types';
