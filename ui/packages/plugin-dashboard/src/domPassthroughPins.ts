/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Compile-time pins for the KPI components' DOM pass-through contract
 * (objectui#4426).
 *
 * ## Why these live in `src/` and not in a test file
 *
 * They go where this repo already puts load-bearing compile-time assertions: in
 * source, next to the contract, compiled by the package's own `tsc --noEmit`.
 * That is `widgets/toDomProps.ts`'s shape in `@object-ui/fields`, which binds its
 * DOM whitelist to its declaration in both directions the same way. Unlike that
 * file these are `type`-only, so they emit ZERO runtime bytes — which matters
 * here, because #4426 is a types-only change and must stay one.
 *
 * A PREFERENCE, not a constraint — though it was a constraint when this file was
 * written. Then, this package's tests were compiled by nothing, so a
 * provably-false `Assert<Equal<1, 2>>` in a test file passed `pnpm type-check` at
 * exit 0 (objectui#3181), and the narrow `tsconfig.typetests.json` rescue hatch
 * was no way round it (objectui#4291 retired the last six, and the ratchet in
 * `scripts/__tests__/check-type-check-coverage.test.ts` still turns red on one
 * reappearing anywhere — the gate permits the SHAPE, the ratchet forbids a new
 * USER). That debt is paid, and by neither of those routes: `tsconfig.test.json`
 * type-checks this package's tests and its `type-check` script chains it
 * (`tsc --noEmit && tsc -p tsconfig.test.json`), so an assertion in a test file
 * is checked now too. Nothing here argues against writing one — see the
 * directives in `__tests__/ObjectDataTable.emitBoundary-6373.test.tsx`, which
 * this package's `tsconfig.test.json` compiles.
 *
 * ## What each direction catches
 *
 * The defect being closed was invisible to every runtime test: `id` / `role` /
 * `aria-label` reached the card the whole time, so nothing vitest runs could
 * observe either the bug or its fix. The runtime half — that those attributes
 * really do land, and that `title` really does not — is
 * `__tests__/MetricWidget.domPassthrough.test.tsx`. This file is the other half.
 */

import type { MetricWidgetProps } from './MetricWidget';
import type { MetricCardProps } from './MetricCard';
import type { SchemaHostProps } from './schemaHostProps';

/* The repo idiom — see
 * `packages/app-shell/src/views/metadata-admin/previews/flow-designer-edge.types.test.ts`.
 */
type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * Guard against the pins lying: were either side `any`, every assertion below
 * would pass while proving nothing (objectstack#4171's failure mode, and the
 * reason `flow-designer-edge.types.test.ts` opens the same way).
 */
type _WidgetNotAny = Assert<Equal<IsAny<MetricWidgetProps>, false>>;
type _CardNotAny = Assert<Equal<IsAny<MetricCardProps>, false>>;

/**
 * POSITIVE — the declaration this issue exists for. These are the keys PR #4428
 * measured as still flowing through the spread after it stripped the seven
 * schema-shaped ones. Reverting either `extends` turns both of these red.
 */
type DomIdentity = 'id' | 'role' | 'aria-label' | 'aria-describedby' | 'tabIndex';
type _WidgetAcceptsDomIdentity = Assert<Extends<DomIdentity, keyof MetricWidgetProps>>;
type _CardAcceptsDomIdentity = Assert<Extends<DomIdentity, keyof MetricCardProps>>;

/**
 * NEGATIVE — the widening is not an open door. An `[key: string]: any` would
 * collapse `keyof` to `string | number` and flip both of these to `true`.
 *
 * Green on BOTH sides of #4426 by design: the bogus key was rejected before the
 * widening and must still be rejected after it. That is the assertion, and it is
 * the one a "just make the complaint go away" edit would break.
 */
type _WidgetRejectsBogus = Assert<Equal<Extends<'bogusProp', keyof MetricWidgetProps>, false>>;
type _CardRejectsBogus = Assert<Equal<Extends<'bogusProp', keyof MetricCardProps>, false>>;

/**
 * NEGATIVE — objectui#4357's half, restated from the type side.
 *
 * The schema-shaped keys `SchemaRenderer` injects are stripped, not passed
 * through. They stay in `SchemaHostProps` and are intersected in at each
 * component's own signature, so the renderer can still inject them — but they
 * must never reach the EXPORTED props interface, or this widening would
 * re-assert as public authoring surface exactly what PR #4428 removed from the
 * DOM. Written against `keyof SchemaHostProps` rather than a copied list, so a
 * key added there is covered here automatically.
 */
type RendererKeys = keyof SchemaHostProps;
type _WidgetKeepsRendererKeysPrivate =
  Assert<Equal<Extract<keyof MetricWidgetProps, RendererKeys>, never>>;
type _CardKeepsRendererKeysPrivate =
  Assert<Equal<Extract<keyof MetricCardProps, RendererKeys>, never>>;

/**
 * The two carve-outs, pinned so a future edit cannot quietly undo the reasoning.
 *
 * `MetricCard.title` stays the HEADING (`I18nLabel` — a string or an inline
 * per-locale map), not HTML's tooltip string. Dropping the `Omit` does not
 * merely change this type, it stops the interface compiling; this pin is here so
 * the next reader learns which `title` won and why.
 */
type _CardTitleTakesAnI18nMap =
  Assert<Extends<{ en: 'Revenue'; 'zh-CN': '收入' }, NonNullable<MetricCardProps['title']>>>;

/**
 * `MetricWidget.onClick` narrows the inherited `MouseEventHandler` to a zero-arg
 * handler, because the same handler is wired to Enter/Space where there is no
 * mouse event to hand over.
 */
type _WidgetOnClickIsZeroArg =
  Assert<Equal<NonNullable<MetricWidgetProps['onClick']>, () => void>>;

export {};
