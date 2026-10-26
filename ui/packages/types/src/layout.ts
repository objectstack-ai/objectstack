/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Layout Component Schemas
 * 
 * Type definitions for layout and container components.
 * These components organize and structure other components.
 * 
 * @module layout
 * @packageDocumentation
 */

import type { I18nLabel, Page as SpecPage, PageType as SpecPageType } from '@objectstack/spec/ui';
import type { BaseSchema, SchemaNode } from './base.js';
import type { PAGE_SPEC_EXCLUDED } from './zod/layout.zod.js';
import type { BreakpointName } from './mobile.js';
// objectui#10872 batch 9 — the per-breakpoint style maps `FlexSchema.responsiveStyles`
// declares, by reference. Type-only.
import type { ResponsiveStyles as SpecResponsiveStyles } from '@objectstack/spec/ui';

/**
 * Basic HTML div container
 */
export interface DivSchema extends BaseSchema {
  type: 'div';
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
}

/**
 * Neutral block container — the class-transparent box (objectui#3965).
 *
 * Minted by the 2026-08-29 maintainer ruling (方案 A) as the JSON surface's
 * replacement for the deprecated `div`: the vocabulary had no neutral block
 * box, which is why `div` could never actually retire — every candidate the
 * deprecation notice names (`card` / `flex` / `container` / `stack` / `grid`)
 * injects layout of its own, so none is a drop-in for a bare styled wrapper.
 *
 * The contract, per the ruling: renders `children`, emits the authored
 * `className` verbatim, injects ZERO classes of its own. Unlike `div`, this
 * type reads `children` only — never `body` (the `div` renderer's
 * `children || body` fallback is exactly what made a mechanical swap unsafe;
 * see `examples/schema-catalog/test/deprecated-component-types.test.ts`).
 * The renderer contract is pinned in
 * `packages/components/src/renderers/__tests__/box-neutral-container.test.tsx`.
 */
export interface BoxSchema extends BaseSchema {
  type: 'box';
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `box` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/layout/box.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `box` reads — author `children`.
   */
  body?: never;
}

/**
 * Text span component for inline text
 */
export interface TextSpanSchema extends BaseSchema {
  type: 'span';
  /**
   * Text content
   */
  value?: string;
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `span` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/basic/span.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `span` reads — author `children`.
   */
  body?: never;
}

/**
 * Text display component
 */
export interface TextSchema extends BaseSchema {
  type: 'text';
  /**
   * Text content to display — the ONE content spelling `text` reads.
   *
   * READ SITE: `packages/components/src/renderers/basic/text.tsx:162` (the
   * wrapped element arm, taken when the node carries a designer id, a
   * typography class or a className) and `:167` (the bare fragment arm), both
   * as `{schema.content}`.
   *
   * Declared by objectui#6150 (undeclared-but-consumed census). Before that
   * card the renderer read this key through `BaseSchema`'s
   * `[key: string]: any` (objectui#5155) and no shipped type mentioned it —
   * the docs page was the only record of a capability that works. #6150
   * declared it next to a `value` fallback spelling and recorded that choosing
   * between the two was an ADR-0049 question it did not decide; maintainer
   * ruling A1 (2026-09-04, `5ad86ddee`) decided it: `content` is the one
   * spelling, and {@link TextSchema.value} is the tombstone below.
   */
  content?: string;
  /**
   * RETIRED (`5ad86ddee` / objectui#7016, ADR-0049 enforce-or-remove) — the
   * second spelling of the one content slot, read only as the fallback limb of
   * `schema.content || schema.value`. Maintainer ruling A1 (2026-09-04): retire
   * `value`, keep `content`, immediately and with no deprecation window
   * (「项目在创业阶段,用户也很少,短期不考虑渐进。」). Measured before the
   * retirement, on the four roots the ruling named (`examples/`, `apps/`, the
   * `examples/` directories under `packages/`, `content/docs/**`): 776 `content`-only `text`
   * nodes, 25 `value`-only, none authoring both — so the retired limb was the
   * minority spelling by thirty to one.
   *
   * The renderer no longer reads it (`text.tsx` renders `{schema.content}` at
   * both arms), so an authored `value` would be a silent blank; the tombstone
   * turns it into a `tsc` error here and a named refusal on the Zod mirror
   * (`../zod/layout.zod.ts`) instead. Write `content`; the string is unchanged.
   * @deprecated Not part of this contract — write `content`.
   */
  value?: never;
  /**
   * Text variant/style.
   *
   * NO `@default`, deliberately (objectui#7735). `text.tsx` reads this as
   * `schema.variant ? VARIANT_CLASS[schema.variant] : undefined`, so a node
   * that omits the key gets NO typography class and no wrapping tag — absence
   * is not `body`, which is the whole point of `57f9b077b` and is spelled out
   * at that read site. The retired `@default 'body'` described the zod mirror's
   * `.default('body')`, which substituted the value into a PARSED document and
   * which objectui#7735 removed; no renderer ever applied it.
   */
  variant?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'body' | 'caption' | 'overline';
  /**
   * Text alignment
   */
  align?: 'left' | 'center' | 'right' | 'justify';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `text` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `align`, `className`, `content`, `variant` (in `packages/components/src/renderers/basic/text.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "text" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:text`
   * as the SOLE claimant of the bare key, because `element:text` and `field:text` pass
   * `skipFallback: true` and never write it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `text` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `text` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `align`, `className`, `content`, `variant` (in `packages/components/src/renderers/basic/text.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "text" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:text`
   * as the SOLE claimant of the bare key, because `element:text` and `field:text` pass
   * `skipFallback: true` and never write it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `text` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Image component
 */
export interface ImageSchema extends BaseSchema {
  type: 'image';
  /**
   * Image source URL
   */
  src: string;
  /**
   * Alt text for accessibility
   */
  alt?: string;
  /**
   * Image width
   */
  width?: string | number;
  /**
   * Image height
   */
  height?: string | number;
  /**
   * Object fit property
   */
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `image` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `alt`, `src` (in `packages/components/src/renderers/basic/image.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "image" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:image`
   * as the SOLE claimant of the bare key, because `element:image` and `field:image` pass
   * `skipFallback: true` and never write it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `image` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `image` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `alt`, `src` (in `packages/components/src/renderers/basic/image.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "image" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:image`
   * as the SOLE claimant of the bare key, because `element:image` and `field:image` pass
   * `skipFallback: true` and never write it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `image` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Icon component
 */
export interface IconSchema extends BaseSchema {
  type: 'icon';
  /**
   * The lucide-react glyph to render, kebab-case (`check`, `arrow-right`).
   *
   * ## Why this key is `icon` and not `name` (objectui#5631)
   *
   * It used to be `name`, and `name` is not this node's private prop — it is
   * the SDUI IDENTITY key every authored node carries from
   * {@link BaseSchema.name}, alongside `id`. So an ordinary authored node like
   * `{ type: 'icon', id: 'save_icon', name: 'save_icon' }` asked lucide for a
   * glyph called `SaveIcon`, missed, and rendered NOTHING — silent at runtime
   * and clean-looking to a DOM gate, because a renderer that renders nothing
   * spreads no attributes to find.
   *
   * The maintainer ruled the contract question twice: 2026-08-22 (option A —
   * "`icon` is the icon key; `name` is identity, always") and again 2026-08-24
   * ("5631 A′，按一次正经的契约迁移立项。") at the full measured price,
   * once it was established that the renderer alone could not carry it: the
   * published mirror REQUIRED `name`, so the ruled shape was refused by the
   * contract while the renderer read a key the contract never declared.
   *
   * `action:*` already reads `icon`, so this is the vocabulary's existing
   * answer rather than a new one — and it leaves no node type on which the
   * identity key is unavailable.
   *
   * ⚠️ REQUIRED, exactly as `name` was required before it. A stored node that
   * still names its glyph with `name` is REFUSED by the zod mirror with a
   * message that names the migration, and renders the visible placeholder from
   * PR #5959 if it reaches the renderer unvalidated. Both are loud on purpose;
   * ⛔ there is no tolerant `icon ?? name` read anywhere — that shape was ruled
   * out explicitly, and it would make `name` mean two things depending on
   * whether a lookup happened to hit. To convert stored metadata, see
   * `migrateIconNodeKeys` in `./icon-key-migration.ts` — an explicit one-shot
   * conversion, never a read-path fallback.
   */
  icon: string;
  /**
   * Icon size in pixels
   * @default 24
   */
  size?: number;
  /**
   * Icon color
   */
  color?: string;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `icon` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `className`, `color`, `icon`, `name`, `size` (in `packages/components/src/renderers/basic/icon.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "icon" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:icon`
   * as the SOLE claimant of the bare key, because `action:icon` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `icon` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `icon` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `className`, `color`, `icon`, `name`, `size` (in `packages/components/src/renderers/basic/icon.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "icon" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:icon`
   * as the SOLE claimant of the bare key, because `action:icon` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `icon` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Separator/Divider component
 */
export interface SeparatorSchema extends BaseSchema {
  type: 'separator';
  /**
   * Orientation of the separator
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Whether to add decorative content
   */
  decorative?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `separator` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `orientation` (in `packages/components/src/renderers/basic/separator.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `separator` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `separator` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `orientation` (in `packages/components/src/renderers/basic/separator.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `separator` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Generic container component
 */
export interface ContainerSchema extends BaseSchema {
  type: 'container';
  /**
   * Max width constraint.
   *
   * `container.tsx` applies this as `schema.maxWidth ?? 'xl'`, so a
   * `container` that omits the key renders `max-w-xl` — the tag said
   * `'lg'` and no renderer ever applied it (objectui#7361).
   * @default 'xl'
   */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full' | 'screen' | false;
  /**
   * Center the container
   * @default true
   */
  centered?: boolean;
  /**
   * Padding step on the container's spacing scale; `0` means none.
   *
   * The steps are the ones `container.tsx` maps to a padding class, and only
   * those (objectui#11424): it reads `schema.padding ?? 4` and tests it against
   * one branch per step, so any other number matched no branch and drew no
   * padding class at all — not even the default. This was `number`, which let
   * `9` and `20` through; the zod mirror (`zod/layout.zod.ts`) refuses them
   * with the set named.
   * @default 4
   */
  padding?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16;
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `container` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/layout/container.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `container` reads — author `children`.
   */
  body?: never;
}

/**
 * The flex/stack layout members, declared ONCE and free of `BaseSchema`.
 *
 * This interface exists so that `StackSchema` can be "everything `FlexSchema`
 * has, with a different `type`" WITHOUT crossing an `Omit` over a type that
 * carries an index signature (objectui#6151).
 *
 * `StackSchema` used to be spelled `extends Omit<FlexSchema, 'type'>`. That
 * erased every named member from the SHIPPED declaration, silently:
 * `Omit<T, K>` is `Pick<T, Exclude<keyof T, K>>`, and `keyof T` on a type
 * carrying a string index signature is `string | number` — the literal member
 * names are absorbed. `FlexSchema` inherited `BaseSchema`'s `[key: string]: any`
 * (objectui#5155) until objectui#8347, so `Exclude<string | number, 'type'>` is still
 * `string | number`, and the `Pick` reconstructed a type with the index
 * signature and NONE of the named members. Measured against the emitted
 * `dist/layout.d.ts`: `FlexSchema` declared 25 properties, `StackSchema`
 * declared 1 (`type`) — `gap`, `children`, `align`, `justify`, `direction` and
 * `wrap` were all absent, along with all 19 of `BaseSchema`'s other named
 * members.
 *
 * Nothing errored, which is why it survived: the index signature made every
 * absent key still assignable and still readable as `any`. What it cost was
 * every tool that reads the declaration — editor completion on a `stack` node
 * offered `type` and nothing else, and a docs-vs-type sweep read `stack.mdx` as
 * documenting keys that do not exist (objectui#6143 flagged `gap`, `children`
 * and `className` as divergences; the docs were right and the type was wrong).
 *
 * Extending FlexSchema directly instead is not available: an interface may
 * narrow an inherited property only to a subtype, and `'stack'` is not a
 * subtype of `FlexSchema`'s `type: 'flex'` — measured, TS2430
 * (`Interface 'StackSchema' incorrectly extends interface 'FlexSchema'.
 * Types of property 'type' are incompatible.`). Lifting the shared members out
 * of the inheritance path is what keeps them nameable from both sides.
 *
 * A member here carries an `@default` tag only when BOTH consumers apply the
 * same value — the criterion is a DIVERGENT shared member, not a shared one:
 * `align` and `direction` diverge and state their per-type values in prose
 * instead, while `justify` keeps its `@default 'start'` because `flex.tsx` and
 * `stack.tsx` both read `|| 'start'`.
 *
 * Pinned by `__tests__/stack-schema-emitted-members.test.ts`, which asserts
 * against the EMITTED declaration rather than this source — a source-level
 * assertion passes while the emitted declaration is empty, and that gap is
 * exactly the defect.
 */
export interface FlexLayoutProps {
  /**
   * Flex direction.
   *
   * Deliberately carries NO `@default` tag. The member is declared once here
   * (see this interface's docblock and objectui#6151), but the two component
   * types that consume it diverge on the value they apply when it is omitted:
   * `flex.tsx` reads `schema.direction || 'row'`, `stack.tsx` reads
   * `schema.direction || 'col'` ("Default to column for Stack"). One tag on a
   * shared member cannot be right for both — it would publish a single default
   * that only one consumer applies, which is the defect objectui#7734 records
   * (the tag here used to read `'row'`, which `flex` applies and `stack`
   * deliberately does not — a column is what the `stack` type is FOR). The
   * per-type values are stated in prose so no parser reads a value that is only
   * conditionally true.
   */
  direction?: 'row' | 'col' | 'row-reverse' | 'col-reverse';
  /**
   * Justify content alignment
   * @default 'start'
   */
  justify?: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly';
  /**
   * Align items.
   *
   * Deliberately carries NO `@default` tag. The member is declared once here
   * (see this interface's docblock and objectui#6151), but the two component
   * types that consume it diverge on the value they apply when it is omitted:
   * `flex.tsx` reads `schema.align || 'start'`, `stack.tsx` reads
   * `schema.align || 'stretch'` ("Stack items usually stretch"). One tag on a
   * shared member cannot be right for both — it would publish a single default
   * that only one consumer applies, which is the defect objectui#7361 records
   * (the tag here used to read `'center'`, which NEITHER renderer applies).
   * The per-type values are stated in prose so no parser reads a value that is
   * only conditionally true.
   */
  align?: 'start' | 'end' | 'center' | 'baseline' | 'stretch';
  /**
   * Gap step between items; `0` means none.
   *
   * The steps are the ones `flex.tsx` maps to a gap class, and only those
   * (objectui#11474): it reads `schema.gap ?? 2` and tests it against one
   * branch per step, so any other number matched no branch and drew no gap
   * class at all — not even the default. This was `number`, which let `9`
   * through; the zod mirror (`zod/layout.zod.ts`) refuses it with the set
   * named. {@link StackSchema} maps a different set and declares its own.
   * @default 2
   */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * Allow items to wrap
   * @default false
   */
  wrap?: boolean;
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
}

/**
 * Flexbox layout component — the node as the `flex` renderer reads it.
 *
 * ⚠️ That is the node AFTER `SchemaRenderer` hoists the `properties` bag, and
 * the node as code composes it. An AUTHORED `flex` node takes the
 * {@link FlexLayoutProps} members — the child list included — in its
 * `properties` bag (objectui#11276, the maintainer's ruling A on
 * objectui#11300): `{ type: 'flex', properties: { direction: 'col', gap: 4,
 * children: [ … ] } }`. `objectui validate` refuses them written flat on the
 * node, by name (the zod `FlexBlockSchema`), as `@objectstack/spec`'s page
 * component does. A typed authored node checks its bag with
 * `satisfies FlexLayoutProps`. A stored flat node keeps rendering: the hoist
 * reads both spellings.
 */
export interface FlexSchema extends BaseSchema, FlexLayoutProps {
  type: 'flex';
  /**
   * Per-breakpoint scoped style maps (ADR-0065): `@objectstack/spec`'s
   * `ResponsiveStyles`, the type `PageComponentSchema.responsiveStyles`
   * declares, by reference (objectui#10872 batch 9). `SchemaRenderer` compiles
   * it to CSS scoped to this node: `large` is the unconditional base, and
   * `medium` / `small` / `xsmall` are max-width overrides.
   *
   * Declared here, and not on {@link FlexLayoutProps}, because `flex` is the
   * layout arm a producer writes the key on (the objectstack showcase; the
   * reading is recorded on objectui#10872 and nothing here re-derives it).
   * `stack` shares those props and has no measured producer, so it does not
   * declare the key. The zod mirror spreads the same member from the
   * public blocks' fragment (`NODE_ENVELOPE`).
   */
  responsiveStyles?: SpecResponsiveStyles;
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `flex` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/layout/flex.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `flex` reads — author `children`.
   */
  body?: never;
}

/**
 * Stack layout component (Vertical Flex shortcut)
 *
 * Declares the same members as {@link FlexSchema} — see {@link FlexLayoutProps}
 * for why they are shared through a third interface rather than derived with an
 * `Omit` (objectui#6151) — except `responsiveStyles`, which `FlexSchema`
 * declares on its own (objectui#10872 batch 9).
 *
 * `gap` is the one shared member `stack` declares itself: its renderer maps a
 * different set of steps (objectui#11474). The `Omit` here crosses
 * {@link FlexLayoutProps}, which carries no index signature, so it keeps every
 * other member's name; the objectui#6151 hazard is an `Omit` over a type that
 * carries a string index signature, as every `BaseSchema` extender did until
 * objectui#8347. `__tests__/stack-schema-emitted-members.test.ts`
 * measures the emitted declaration and holds the two member sets equal.
 */
export interface StackSchema extends BaseSchema, Omit<FlexLayoutProps, 'gap'> {
  type: 'stack';
  /**
   * Gap step between items; `0` means none.
   *
   * The steps are the ones `stack.tsx` maps to a gap class, and only those
   * (objectui#11474): it reads `schema.gap ?? 2` and tests it against one
   * branch per step, so any other number matched no branch and drew no gap
   * class at all — not even the default. Unlike `flex`, `stack` has no branch
   * for `7` and has one for `10`. This was `number`, which let `7` and `9`
   * through; the zod mirror (`zod/layout.zod.ts`) refuses them with the set
   * named.
   * @default 2
   */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10;
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `stack` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/layout/stack.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `stack` reads — author `children`.
   */
  body?: never;
}

/**
 * The column counts the `grid` renderer maps to a column class
 * (objectui#11491): {@link GridSchema.columns} takes one, as the bare number
 * and at every breakpoint. Module-local: the member is the published face.
 */
type GridColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * CSS Grid layout component
 */
export interface GridSchema extends BaseSchema {
  type: 'grid';
  /**
   * Number of columns (responsive): a count from 1 to 12, or an object of such
   * counts keyed by breakpoint: { xs: 1, sm: 2, md: 3, lg: 4 }
   *
   * The counts are the ones `grid.tsx` maps to a column class, and only those
   * (objectui#11491): it spells `grid-cols-1` to `grid-cols-12` once per
   * breakpoint and nothing else, so any other count drew no column class where
   * it was authored. This was `number`, at the bare number and at every
   * breakpoint; the zod mirror (`zod/layout.zod.ts`) refuses the rest with the
   * set named.
   *
   * `grid.tsx` opens with `let baseCols = 2` and only overwrites it from an
   * authored `columns`, so a `grid` that omits the key renders `grid-cols-2`.
   * The tag said `3` — the value the zod mirror used to substitute, which no
   * renderer applied (objectui#7735, the same defect objectui#7361 fixed on
   * `maxWidth`).
   * @default 2
   */
  columns?: GridColumnCount | Partial<Record<BreakpointName, GridColumnCount>>;
  /**
   * RETIRED (objectui#11505, ADR-0049) — a second spelling of the `sm` member
   * of `columns`. Write the count in the breakpoint object, `columns: { sm: N }`;
   * a bare `columns: C` beside it becomes the object's `xs: C`, and with no
   * `columns` at all add `xs: 2` to keep the two columns the grid drew below `sm`.
   * @deprecated The renderer no longer reads it; the zod mirror refuses it by name.
   */
  smColumns?: never;
  /**
   * RETIRED (objectui#11505, ADR-0049) — a second spelling of the `md` member
   * of `columns`. Write `columns: { md: N }`, as {@link GridSchema.smColumns}
   * describes for `sm`.
   * @deprecated The renderer no longer reads it; the zod mirror refuses it by name.
   */
  mdColumns?: never;
  /**
   * RETIRED (objectui#11505, ADR-0049) — a second spelling of the `lg` member
   * of `columns`. Write `columns: { lg: N }`, as {@link GridSchema.smColumns}
   * describes for `sm`.
   * @deprecated The renderer no longer reads it; the zod mirror refuses it by name.
   */
  lgColumns?: never;
  /**
   * RETIRED (objectui#11505, ADR-0049) — a second spelling of the `xl` member
   * of `columns`. Write `columns: { xl: N }`, as {@link GridSchema.smColumns}
   * describes for `sm`.
   * @deprecated The renderer no longer reads it; the zod mirror refuses it by name.
   */
  xlColumns?: never;
  /**
   * Gap step between items; `0` means none.
   *
   * The steps are the ones `grid.tsx` maps to a gap class, and only those
   * (objectui#11474): it looks `schema.gap ?? 4` up in its `GAPS` map and,
   * for any other number, builds an arbitrary-value class at runtime that no
   * compiled stylesheet defines, so the grid drew no gap at all. This was
   * `number`; the zod mirror (`zod/layout.zod.ts`) refuses the rest with the
   * set named.
   * @default 4
   */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `grid` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/layout/grid.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `grid` reads — author `children`.
   */
  body?: never;
}

/**
 * Card component
 */
export interface CardSchema extends BaseSchema {
  type: 'card';
  /**
   * Card title
   */
  title?: string;
  /**
   * Card description
   */
  description?: string;
  /**
   * Card header content
   */
  header?: SchemaNode | SchemaNode[];
  /**
   * RETIRED (objectui#6771, maintainer ruling 2026-09-01) — the `body`
   * child-list spelling. Author {@link CardSchema.children}.
   *
   * This key was already labelled "Legacy, use children" and the renderer
   * read `renderNodeSlot(schema.children || schema.body, …)`, so `card` was
   * one of the fallback readers whose `body` arm the ruling drops in the
   * same change as the `body`-only registrations converge.
   *
   * Refused by name rather than deleted: the zod twin ends `.passthrough()`
   * (and `BaseSchema` carried `[key: string]: any` until objectui#8347; a
   * widened value still skips the excess-property check), so a deleted member
   * is ACCEPTED silently and rendered by nothing. The
   * `?: never` is what makes `tsc` answer at the authoring site, and the
   * mirror's `aliasKeyRefusal` names `children` at parse time.
   *
   * @deprecated Retired spelling of `children` — author `children`.
   */
  body?: never;
  /**
   * Card content — the card's child list, and since objectui#6771 its only
   * spelling. READ SITE: `renderNodeSlot(schema.children, …)` in
   * `packages/components/src/renderers/layout/card.tsx`.
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * Card footer content
   */
  footer?: SchemaNode | SchemaNode[];
  /**
   * Variant style.
   *
   * NO `@default`, deliberately (objectui#8318), and for a different reason
   * from the keys whose node type has no registration at all: `card` IS
   * registered, twice, and neither registration reads this key, so nothing
   * applies the `'default'` the tag used to publish.
   * `renderers/layout/card.tsx:64` (`namespace: 'ui'`) forwards the node's
   * remaining keys onto `<Card>` through `{...cardProps}` (`:32`, `:46`), and
   * the primitive `ui/card.tsx` destructures only `className` and spreads the
   * rest onto a `div`: `variant` occurs 0 times in that file, exit 1, with
   * `ui/alert.tsx` as the firing control (5 occurrences, where the primitive
   * really does consume it through `cva`). The second registration,
   * `renderers/layout/containers.tsx:842` (`namespace: 'page'`,
   * `skipFallback: true`), forwards only `{...designer}`, so on that route the
   * key does not reach the element at all. Its siblings `clickable` and
   * `hoverable` ARE read (`card.tsx:35-36`), which is what makes this a reading
   * rather than a search that missed. Whether the key should exist is the
   * ADR-0049 liveness worklist's question (objectui#4631, objectui#7963), not
   * this card's.
   */
  variant?: 'default' | 'outline' | 'ghost';
  /**
   * Whether the card is hoverable
   * @default false
   */
  hoverable?: boolean;
  /**
   * Whether the card is clickable
   * @default false
   */
  clickable?: boolean;
  /**
   * Click handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the `<Card>` element by the renderer's `{...cardProps}` (it
   * also drives `isClickable`).
   */
  onClick?: () => void;
}

/**
 * Tabs component
 */
export interface TabsSchema extends BaseSchema {
  type: 'tabs';
  /**
   * Default active tab value
   */
  defaultValue?: string;
  /**
   * Controlled active tab value
   */
  value?: string;
  /**
   * Tabs orientation
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Tab items configuration
   */
  items: TabItem[];
  /**
   * Change handler
   *
   * RUNTIME SLOT (objectui#6124) — a host-supplied function, NOT authorable
   * metadata: JSON has no function value, so the zod twin refuses this key by
   * name and points at the node-type spelling. Kept callable here because it is
   * spread onto the Radix `Tabs` root by the renderer's `{...tabsProps}`, after
   * its own `onValueChange`.
   */
  onValueChange?: (value: string) => void;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `tabs` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `defaultValue`, `items`, `orientation`, `value` (in `packages/components/src/renderers/layout/tabs.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "tabs" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:tabs`
   * as the SOLE claimant of the bare key, because `page:tabs` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `tabs` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `tabs` reads NEITHER content
   * channel: no renderer read consumes `body` or `children` for this node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, over one
   * program per workspace package plus the apps and the examples, on a BUILT
   * tree reporting zero unresolved-module diagnostics — an unbuilt tree answers
   * `any`, and `any` reads as NEITHER. A docblock mention is not an AST node,
   * and `schema.bodyExtra` in
   * `packages/components/src/renderers/action/action-button.tsx` is the kind of
   * prefix hit grep scores. Every read is filed under the TYPE of the object it
   * is read from; this declaration carries none. What the renderer DOES read
   * off this node: `defaultValue`, `items`, `orientation`, `value` (in `packages/components/src/renderers/layout/tabs.tsx`).
   *
   * ⭐ WHY THIS NAME WAS HELD OUT OF objectui#9261, AND WHAT CHANGED.
   * `ComponentRegistry.register` writes the bare-name fallback last-one-wins,
   * so which declaration governs an authored `{ "type": "tabs" }` node was
   * unmeasured and narrowing it would have been a guess. It is measured now:
   * `pnpm check:registry-bare-names --table` (objectui#9264) reports `ui:tabs`
   * as the SOLE claimant of the bare key, because `page:tabs` passes
   * `skipFallback: true` and never writes it. Re-derive from that instrument
   * rather than from this sentence.
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `tabs` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Individual tab item
 */
export interface TabItem {
  /**
   * Unique tab identifier
   */
  value: string;
  /**
   * Tab label
   */
  label: string;
  /**
   * Tab icon
   */
  icon?: string;
  /**
   * Whether tab is disabled
   */
  disabled?: boolean;
  /**
   * Tab content — THE tab item's content key.
   */
  content: SchemaNode | SchemaNode[];
  /**
   * RETIRED (objectui#9590) — author `content`.
   *
   * The `tabs` renderer used to fall back to an item-level `body` through an
   * `any` cast when `content` was missing. This face never declared `body`.
   * The fallback is gone and the key is refused by name: `tsc` here, and
   * `TabItemSchema`'s alias refusal naming `content` at parse.
   *
   * @deprecated Retired item-level spelling of `content` — author `content`.
   */
  body?: never;
}

/**
 * Scroll area component
 */
export interface ScrollAreaSchema extends BaseSchema {
  type: 'scroll-area';
  /**
   * Height of the scroll container
   */
  height?: string | number;
  /**
   * Width of the scroll container
   */
  width?: string | number;
  /**
   * Scrollbar orientation
   * @default 'vertical'
   */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /**
   * Child components
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * REFUSED BY NAME (objectui#8284, ADR-0049) — `scroll-area` reads `children`, and no
   * renderer read consumes `body`.
   *
   * READ SITE, measured with the TypeScript TYPE CHECKER and not with grep (a
   * docblock mention is not a read; the `BoxSchema` docblock in
   * `renderers/layout/box.tsx` SAID `schema.body` in prose and grep counted it,
   * until objectui#6771 rewrote that docblock — the example is spent, the
   * hazard is not, which is why the measurement is a type-checker sweep and
   * never a grep): the `schema.children` read in
   * `packages/components/src/renderers/complex/scroll-area.tsx`. The same sweep finds zero `body` reads
   * for this node type.
   *
   * Before objectui#8284 tombstoned it here, `body` was inherited-and-optional
   * from {@link BaseSchema} — so authoring it here type-checked, parsed green
   * through `.passthrough()`, and rendered an EMPTY element with no render-time
   * error or warning; only the parser tier's `unknown-prop` warning noticed it.
   * Per component, the channel a renderer does not read is now
   * tombstoned on both published faces (maintainer ruling, summon #17 decision
   * batch #2, 2026-09-07), and objectui#6771 has since retired `body` on
   * `BaseSchema` itself.
   *
   * @deprecated Not a channel `scroll-area` reads — author `children`.
   */
  body?: never;
}

/**
 * Resizable panels component
 */
export interface ResizableSchema extends BaseSchema {
  type: 'resizable';
  /**
   * Direction of resizable panels
   * @default 'horizontal'
   */
  direction?: 'horizontal' | 'vertical';
  /**
   * Minimum Height
   */
  minHeight?: string | number;
  /**
   * Show resize handle.
   *
   * NO `@default`, deliberately (objectui#7735). `resizable.tsx` forwards the
   * key BARE — `withHandle={schema.withHandle}` — and `ui/resizable.tsx`
   * renders the grip under `{withHandle && …}`, so an omitted key reaches the
   * handle as `undefined` and NO grip is drawn. The tag said `true`, which is
   * the opposite of what happens; it described the zod mirror's
   * `.default(true)`, removed by objectui#7735.
   */
  withHandle?: boolean;
  /**
   * Resizable panels
   */
  panels: ResizablePanel[];
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `resizable` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `direction`, `minHeight`, `panels`, `withHandle` (in
   * `packages/components/src/renderers/complex/resizable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `resizable` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `resizable` reads NEITHER
   * content channel: no renderer read consumes `body` or `children` for this
   * node.
   *
   * MEASURED with the TypeScript TYPE CHECKER and not with grep, across all 24
   * packages that register components plus the generic traversers — a docblock
   * mention is not a read, and `body: schema.requestBody` in
   * `packages/plugin-chatbot/src/renderer.tsx` is the kind of prefix hit grep
   * scores. Every read is filed under the TYPE of the object it is read from;
   * this declaration carries none. What the renderer DOES read off this node:
   * `direction`, `minHeight`, `panels`, `withHandle` (in
   * `packages/components/src/renderers/complex/resizable.tsx`).
   *
   * Before objectui#9256 tombstoned them here, `body` and `children` were both
   * inherited-and-optional from {@link BaseSchema} — so authoring either here
   * type-checked, parsed green through `.passthrough()`, and rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it. objectui#6771 has since retired `body` on
   * `BaseSchema` itself; `BaseSchema` still declares `children`, so this node's
   * own tombstone is what refuses it here. `SchemaRenderer` strips both keys
   * out of the props bag it spreads, so neither reaches the component by
   * another route either.
   *
   * @deprecated Not a channel `resizable` reads — nothing renders it.
   */
  children?: never;
}

/**
 * Individual resizable panel
 */
export interface ResizablePanel {
  /**
   * Unique panel identifier
   */
  id: string;
  /**
   * Default size (percentage 0-100)
   */
  defaultSize?: number;
  /**
   * Minimum size (percentage 0-100)
   */
  minSize?: number;
  /**
   * Maximum size (percentage 0-100)
   */
  maxSize?: number;
  /**
   * Panel content
   */
  content: SchemaNode | SchemaNode[];
}

/**
 * Aspect ratio component
 */
export interface AspectRatioSchema extends BaseSchema {
  type: 'aspect-ratio';
  /**
   * Aspect ratio (width / height)
   * @default 16/9
   */
  ratio?: number;
  /**
   * Image URL to display
   */
  image?: string;
  /**
   * Image alt text
   */
  alt?: string;
  /**
   * RETIRED (objectui#6771, maintainer ruling 2026-09-01) — the `body`
   * child-list spelling. Author {@link AspectRatioSchema.children}.
   *
   * `aspect-ratio` read `renderChildren(schema.children || schema.body)`
   * whenever no `image` was set, so it is one of the fallback readers whose
   * `body` arm drops in the same change.
   *
   * Refused by name rather than deleted: the zod twin ends `.passthrough()`
   * (and `BaseSchema` carried `[key: string]: any` until objectui#8347; a
   * widened value still skips the excess-property check), so a deleted member
   * is ACCEPTED silently and rendered by nothing. The
   * `?: never` is what makes `tsc` answer at the authoring site, and the
   * mirror's `aliasKeyRefusal` names `children` at parse time.
   *
   * @deprecated Retired spelling of `children` — author `children`.
   */
  body?: never;
  /**
   * Child components rendered inside the ratio box when no `image` is set —
   * the one child-list spelling (objectui#6771).
   */
  children?: SchemaNode | SchemaNode[];
}

/**
 * List visualization names that are still accepted in the `pageType` slot.
 *
 * These are **not** page kinds. `@objectstack/spec` `ui/page.zod.ts` states it
 * outright: they are visualizations of a `list` page, selected via
 * `interfaceConfig.appearance.allowedVisualizations`. They are retained here as
 * a **named, sanctioned local extension** (issue #2231's prescription) pending
 * the "visualizations are not page types" cleanup, so that the spec-owned half
 * of `PageType` can be derived while the objectui-only half stays visible
 * instead of hiding inside a hand-written union.
 *
 * Narrowing this to `never` is the cleanup; it is a breaking type change for
 * anyone assigning `pageType: 'kanban'`, so it is a separate decision.
 */
export type PageVisualizationAlias =
  | 'grid'
  | 'gallery'
  | 'kanban'
  | 'calendar'
  | 'timeline';

/**
 * Page Type
 * Determines page behavior and default layout template.
 *
 * The spec-owned half is `@objectstack/spec`'s `PageType` **by reference**
 * (issue #2231/#2901; formerly a hand-written union). That mirror had drifted in
 * BOTH directions at once — it carried the five visualization names above, which
 * the spec explicitly repudiates, while the sibling zod `PageTypeSchema` in
 * `zod/layout.zod.ts` was missing `list`. Three disagreeing definitions of one
 * vocabulary lived in this package.
 */
export type PageType = SpecPageType | PageVisualizationAlias;

/**
 * Page Variable — local page state that components and expressions read and
 * write. Re-exported from `@objectstack/spec/ui` rather than restated
 * (objectstack#4115); the hand-written interface it replaces was
 * member-for-member identical, so the only thing it added was a second place
 * to drift from.
 */
import type { PageVariable } from '@objectstack/spec/ui';
export type { PageVariable };

/**
 * Page Region Size
 * Aligned with @objectstack/spec PageRegionSchema.width
 */
export type PageRegionWidth = 'small' | 'medium' | 'large' | 'full';

/**
 * Page Region (Header, Sidebar, Main, etc) — a region of the objectui page
 * NODE, holding renderer components.
 *
 * Renamed off the spec's `PageRegion` name (objectstack#4115), following the
 * same layer split that gave {@link PageNodeSchema} its name (objectui#3074):
 * the spec's `PageRegion` holds `PageComponent[]` — authored SDUI components
 * (`{ type: PageComponentType, properties }`) — while this holds
 * {@link SchemaNode}[], objectui's renderer node union. It also adds a semantic
 * `type` (the spec expresses region roles as component types instead:
 * `page:header`, `page:sidebar`) and a `className`, and widens `width` to any
 * string. Two layers of one idea, so they get two names.
 *
 * The `PageRegionWidth` alias below keeps its name: it is not a spec export,
 * and its members are exactly the spec's `width` enum.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts`.
 */
export interface PageNodeRegion {
  /**
   * Region name/id (e.g. "sidebar", "main", "header")
   */
  name: string;
  /**
   * Region type — semantic role for layout rendering
   */
  type?: 'header' | 'sidebar' | 'main' | 'footer' | 'aside';
  /**
   * Region width (spec-aligned enum)
   */
  width?: PageRegionWidth | string;
  /**
   * Components in this region
   */
  components: SchemaNode[];
  /**
   * CSS class overrides
   */
  className?: string;
}

/**
 * Page layout component
 * Top-level container for a page route.
 * Aligned with @objectstack/spec PageSchema
 *
 * ## The spec half is taken BY REFERENCE (objectui#9736)
 *
 * The zod mirror (`zod/layout.zod.ts` `PageNodeSchema`) is
 * `BaseSchema.extend(SpecPageFields.shape).extend({…})`, so every key the
 * spec's `PageSchema` declares reaches the published validator by reference.
 * This interface used to restate only the members the renderers read, leaving
 * the validator admitting keys the type never declared — the package-lock
 * envelope (`_lock*` / `_package*` / `_provenance`, written by the packaging
 * pipeline), `source`, `interfaceConfig`, `requires`. It now extends
 * `Omit< Page, … >` over `PAGE_SPEC_EXCLUDED`, the one `as const` array the
 * mirror's `specFieldsExcept` call also reads, so both faces project the same
 * spec surface and move together on a pin bump.
 *
 * ONE key is omitted from the spec projection beyond the shared list, on the
 * TypeScript face only:
 *  - `slots` — the member below types each slot as objectui's `SchemaNode`
 *    (which admits primitives and `null`), not the spec's page-component
 *    shape, so it is not assignable to the spec's member and cannot sit beside
 *    it. That divergence is already ledgered as `KnownDrift` and
 *    `WiderThanDeclared` for this pair in `__tests__/zod-mirror-parity.test.ts`;
 *    ⛔ not changed here. The mirror keeps validating the spec's `slots` — the
 *    omission is type-side only, so it is spelled beside the shared list, not
 *    inside it.
 *
 * `assignedProfiles` is RETIRED (objectui#9409) and is no longer omitted.
 * @objectstack/spec 17.5.0 made the spec's member a `retiredKey()` tombstone
 * (ADR-0090 D2 deleted the Profile concept it was named after; ADR-0049
 * enforce-or-remove), so this interface now takes it BY REFERENCE, like App
 * `version` and Dashboard `refreshInterval`: its type is the spec's, which
 * admits no value, and authoring one is a `tsc` error. The zod mirror refuses
 * the same value at parse with the spec's own message. The hand-written
 * `string[]` member, described as "Profiles that can access this page", is
 * gone: nothing in this repository ever enforced it, so it read as access
 * control while gating nothing. Page audience is the permission set's.
 *
 * The other members this interface writes itself (`icon`, `object`,
 * `template`, `variables`, `isDefault`, `aria`, `kind`)
 * are each assignable to the spec's, so they override it without an omission.
 * Pinned by `__tests__/twins-spec-by-reference-9736.test.ts`.
 *
 * This is the SDUI NODE, not the authored page DOCUMENT — the spec's `Page`
 * is that, and the two are deliberately different types (same layer split as
 * {@link PageNodeRegion}).
 *
 * Tripwire: `__tests__/page-node-type-contract.test.ts`, which pins
 * `type` to exactly `'page'` — the `ComponentRegistry` key
 * `@object-ui/components` registers `PageRenderer` under, i.e. the wire key
 * authored metadata carries. Nothing else in the repo pins it.
 */
export interface PageNodeSchema extends BaseSchema, Omit<SpecPage, (typeof PAGE_SPEC_EXCLUDED)[number] | 'slots'> {
  type: 'page';
  /**
   * ⛔ REFUSED BY NAME — `actions` is not a member of this node and never was
   * (`12b599219`, maintainer ruling 2026-09-09, decision batch #107 item 2).
   *
   * `PageRenderer` has no read point for it: a `page` node carrying
   * `actions: [{type:'button',label:'Add Product'}, …]` drew 0 buttons through
   * the real `SchemaRenderer`, while the SAME two buttons in {@link PageNodeSchema.children} drew
   * 2. `BaseSchema` is `.passthrough()`, so the array was not dropped — it was
   * kept, and before objectui#7933 it reached the DOM as
   * `actions="[object Object],[object Object]"`.
   *
   * The remedy is a NODE, not a key: put a `button` (or an `action:button` with
   * a declared `actionType`) in {@link PageNodeSchema.children}; on a record page declare them on a
   * `page:header` block, whose own `actions` are ACTION IDS resolved from the
   * object's metadata (objectui#7182) rather than nodes.
   *
   * `?: never` is the twin of `layout.zod.ts`'s `retirementTombstone` arm — the
   * pair is what `__tests__/zod-mirror-parity.test.ts` compares, and it is what
   * makes `tsc` refuse the key at the authoring site before anything runs.
   * ⛔ Do not "restore" it as a reader: that is option B, and it was refused.
   */
  actions?: never;
  /**
   * ⛔ REFUSED BY NAME — `breadcrumbs` is not a member of this node and never
   * was (objectui#8871, ADR-0049 enforce-or-remove).
   *
   * `12b599219` measured this key on this node and deliberately LEFT it
   * parsing, so that retiring it would be a decision rather than an accident;
   * this is that decision. Its ruling is not borrowed — it covers `actions`
   * only — what reaches this key is the standing enforce-or-remove discipline,
   * which this package already applies to this face (see
   * `zod/tombstone.zod.ts`'s `retirementTombstone`).
   *
   * Nothing ever read it, and the frame that number belongs to is stated so
   * this docblock and `zod/layout.zod.ts`'s twin cannot drift apart on it. On
   * this branch's BASE (`93127bd6f`) a point-access probe (`\.breadcrumbs`)
   * scores 0 across the tree (exit 1), against 12 files tree-wide — 10 of them
   * under `packages/` — for `\.breadcrumb\b` as the lit control. At HEAD those
   * rise to 16 and 13 and `\.breadcrumbs` turns exit 0 over 4 files, every one
   * of them a file of THIS branch quoting the probe string (the changeset, the
   * refusal pin, this file and `zod/layout.zod.ts`); the tree-scoped pin's own
   * exclusions take HEAD back to exit 1.
   * ⛔ A bare-word probe is worthless here — the word also names Sentry's own
   * unrelated concept and appears in two comments listing UI surfaces, so a
   * bare grep reports readers that do not exist. `BaseSchema` is
   * `.passthrough()`, so the authored array was never refused, only KEPT.
   *
   * The remedy is a NODE that already ships: put
   * `{ "type": "breadcrumb", "items": [{ "label": "Home", "href": "/" }] }` in
   * {@link PageNodeSchema.children}. `breadcrumb` is a registered renderer taking that exact item
   * shape, plus `separator`, `maxItems` and a per-item `icon`.
   * ⛔ Not the `page:header` block's `breadcrumb`: that one is SINGULAR and a
   * BOOLEAN display toggle, not a list of links.
   *
   * `?: never` is the twin of `layout.zod.ts`'s `retirementTombstone` arm — the
   * pair is what `__tests__/zod-mirror-parity.test.ts` compares, and it is what
   * makes `tsc` refuse the key at the authoring site before anything runs.
   */
  breadcrumbs?: never;
  /**
   * ⛔ REFUSED BY NAME — `maxWidth` is not a member of this node and never was
   * (objectui#11318, ADR-0049 enforce-or-remove). It is a member of
   * {@link ContainerSchema}.
   *
   * `PageRenderer` takes its max-width class from {@link PageNodeSchema.pageType}
   * through `getPageMaxWidth` and has no read for this key: through the real
   * `SchemaRenderer` a page carrying `maxWidth: 'lg'` drew the same inner class
   * as the same page without it. `BaseSchema` is `.passthrough()`, so the value
   * was never refused, only KEPT.
   *
   * The remedy is the two doors that already ship: {@link PageNodeSchema.pageType}
   * sets the page's cap, and a narrower column is a `container` node in
   * {@link PageNodeSchema.children} with its own `maxWidth`.
   *
   * `?: never` is the twin of `layout.zod.ts`'s `retirementTombstone` arm — the
   * pair is what `__tests__/zod-mirror-parity.test.ts` compares, and it is what
   * makes `tsc` refuse the key at the authoring site before anything runs.
   */
  maxWidth?: never;
  /**
   * ⛔ REFUSED BY NAME — `padding` is not a member of this node and never was
   * (objectui#11318, ADR-0049 enforce-or-remove). It is a member of
   * {@link ContainerSchema}.
   *
   * The page wrapper's inset is fixed and `PageRenderer` has no read for this
   * key: through the real `SchemaRenderer` a page carrying `padding: false`
   * kept the same wrapper padding classes as the same page without it.
   *
   * The remedy is a `container` node in {@link PageNodeSchema.children}, whose
   * `padding` is a declared, rendered number (`0` for none).
   *
   * `?: never` is the twin of `layout.zod.ts`'s `retirementTombstone` arm, as
   * for `maxWidth` above.
   */
  padding?: never;
  /**
   * Page title
   */
  title?: string;
  /**
   * Page icon (Lucide icon name)
   */
  icon?: string;
  /**
   * Page description
   */
  description?: string;
  /**
   * Page type — determines default layout and behavior
   * @default 'record'
   */
  pageType?: PageType;
  /**
   * Bound object name (for record pages)
   * Provides record context to components in regions
   */
  object?: string;
  /**
   * Layout template name (e.g. "default", "header-sidebar-main").
   *
   * NO `@default`, deliberately (objectui#7735). `page.tsx`'s `resolveTemplate`
   * opens `if (!schema.template) return null;`, and a null template falls
   * through to the `pageType` switch — so an omitted key does NOT lay out as
   * `'default'`; it lays out as whatever `pageType` selects. The tag said
   * `'default'`, and because `TEMPLATE_REGISTRY` really does map that name to
   * `DefaultTemplate`, the zod mirror's `.default('default')` made a PARSED
   * page take the template branch and skip the `pageType` dispatch entirely —
   * one authored page, two layouts. objectui#7735 removed the substitution.
   *
   * Typed by reference to the spec's member, so the closed set of layout
   * names the spec declares is the set this node accepts — a re-declared
   * `string` widens the inherited member, which TypeScript refuses once the
   * spec closes it.
   */
  template?: SpecPage['template'];
  /**
   * Local page state variables
   * Initialized on mount and available to all components via context
   */
  variables?: PageVariable[];
  /**
   * Page layout regions
   * (Aligned with @objectstack/spec Page.regions)
   */
  regions?: PageNodeRegion[];
  // blankLayout removed — the `blank` page type has no renderer and was dropped
  // from @objectstack/spec PageTypeSchema (framework#2265, enforce-or-remove).
  /**
   * RETIRED (objectui#6771, maintainer ruling 2026-09-01) — the `body`
   * child-list spelling. Author {@link PageNodeSchema.children}.
   *
   * `PageRenderer`'s `FlatContent` read `schema.body || schema.children`, and
   * the registration published `body` as the flat content list on all five
   * page kinds. Both moved to `children` in the retirement; the ARITY ruling
   * this key carried (objectui#8310 — one node OR a list) moved with it and
   * is restated on `children` below, because that is now the key it governs.
   *
   * Refused by name rather than deleted: the zod twin ends `.passthrough()`
   * (and `BaseSchema` carried `[key: string]: any` until objectui#8347; a
   * widened value still skips the excess-property check), so a deleted member
   * is ACCEPTED silently and rendered by nothing.
   *
   * @deprecated Retired spelling of `children` — author `children`.
   */
  body?: never;
  /**
   * Main content when a page declares no regions — ONE node, or a list of
   * them.
   *
   * The union is the declaration catching up to its reader, not a widening for
   * convenience (objectui#8310, maintainer ruling 2026-09-07). The ruling was
   * made about the `body` spelling this interface used to declare; objectui#6771
   * retired that spelling, so the union lives here, on the key the same reader
   * now takes. `CardSchema.children` and `AspectRatioSchema.children` spell the
   * same union, and so does `BaseSchema.children`.
   * `PageRenderer`'s `FlatContent` fallback
   * (`packages/components/src/renderers/layout/page.tsx`) has always accepted a
   * bare node, normalizing it into a one-element list; under the narrowing that
   * branch was unreachable through the renderer's own declared props and stood
   * only behind a `content as SchemaNode` cast, which the same ruling deletes.
   *
   * The refused value was authored on this project's own landing page: the root
   * `README.md` "Basic Usage" example gives this key a single `grid` node (it
   * spelled the key `body` until objectui#6771 moved the corpus). It
   * type-checked only because that snippet is annotated `BaseSchema` — the
   * WIDER parent — so nothing on the authoring path ever asked this key about
   * its arity. Pinned by `__tests__/page-body-arity-8310.test.ts`.
   *
   * ⚠️ Bounded when written, and the bound was measured: `BaseSchema` carried
   * `[key: string]: any`, so annotating an authored page caught a value of the
   * WRONG TYPE (TS2322) and never a MISSPELLED key (an undeclared key was
   * absorbed by the index signature, zero diagnostics). This union repairs the
   * first case only; objectui#8347 removed the signature, which closed the
   * second on a fresh literal.
   */
  children?: SchemaNode | SchemaNode[];
  /**
   * Whether this is the default page for the object/app.
   *
   * NO `@default`, deliberately (objectui#8318). `page` IS registered
   * (`renderers/layout/page.tsx:692`), so the reason nothing applies the
   * `false` this tag used to publish is neither a missing registration nor a
   * primitive that ignores the prop: `PageRenderer` neither reads the key nor
   * forwards it. `schema.isDefault` has zero hits repo-wide, exit 1, with
   * `schema.pageType` as the firing control (it resolves inside the same
   * renderer, `page.tsx:291`); and the wrapper element receives
   * `toDomProps(props)` (`page.tsx:521`), an ALLOW-LIST --
   * `SDUI_DOM_PASS_THROUGH_KEYS` in `core/src/utils/dom-props.ts`, plus the
   * `aria-*` / `data-*` prefixes -- which does not contain `isDefault` (0
   * occurrences in that file, exit 1; firing control `className`, 5). The
   * rest-spread this renderer used to close by enumeration was replaced by that
   * whitelist in objectui#4425 / objectui#7933. The `.isDefault` reads that do
   * exist elsewhere in the tree are on APPS, saved views, flow edges and
   * permission drafts -- other declarations, not this one. Whether the key
   * should exist is the ADR-0049 liveness worklist's question (objectui#4631,
   * objectui#7963), not this card's.
   */
  isDefault?: boolean;
  /**
   * ARIA accessibility attributes.
   * Aligned with @objectstack/spec AriaPropsSchema.
   *
   * `ariaLabel` is `string | I18nLabel` — the spec's INLINE locale map. This is
   * the spec's OWN spelling for this slot: `AriaPropsSchema.ariaLabel` is
   * `z.union([z.string(), InlineLocaleMapSchema])`, and the spec's `PageSchema`
   * carries that object as its own top-level `aria`, so the mirror
   * (`zod/layout.zod.ts`'s `PageNodeSchema`) receives it BY REFERENCE through
   * `SpecPageFields`. The restatement here stated the string arm alone until
   * objectui#9092, so an authored locale map parsed green and `tsc` refused it.
   *
   * ⚠️ This is the NESTED slot, and its vocabulary is the INLINE one — the same
   * split objectui#5134 measured on `ListView`, where the read now goes through
   * `resolveI18nLabel` against the display locale. The FLAT
   * {@link BaseSchema.ariaLabel} is the OTHER vocabulary (KEYED
   * `{ key, defaultValue?, params? }`, resolved by `resolveKeyedI18nLabel` in
   * `SchemaRenderer`), and objectui#4580 Q2-B withdrew the `I18nLabel` spelling
   * THERE for exactly that reason. Two spellings one level apart; neither
   * resolver accepts the other's shape.
   */
  aria?: {
    ariaLabel?: string | I18nLabel;
    ariaDescribedBy?: string;
    role?: string;
  };
  /**
   * How the page's body is authored. Mirrors `@objectstack/spec`'s page
   * `kind` enum.
   *
   * Schema-authored (the `regions[].components[]` tree):
   * - `"full"` (default): the schema fully describes the page; the
   *   default-page synthesizer is bypassed entirely.
   * - `"slotted"`: the schema only provides overrides for one or more
   *   named slots (see `slots`). The default-page synthesizer fills in
   *   every slot the author did NOT override. Use this when you want
   *   to customize just the header / actions / one tab without
   *   re-authoring the rest of the page. Only meaningful when
   *   `pageType === 'record'`; ignored for other page types.
   *
   * Source-authored (`source` carries the body; `regions` is unused) —
   * ADR-0080, see `content/docs/guide/react-pages.md`:
   * - `"html"`: constrained JSX, PARSED into a SchemaNode tree and
   *   rendered. Never executed — safe for untrusted authors. Styled with
   *   the blocks' own structured props (`<flex direction gap>`,
   *   `<grid columns>`) plus a JSON `style` object. Its former alias
   *   `"jsx"` was retired in `@objectstack/spec` 18 and is refused here.
   * - `"react"`: real React, transpiled and EVALUATED in the main tree.
   *   No sandbox; gated behind the `react-pages` host capability. Styled
   *   with inline `style` objects.
   *
   * Colors on both tiers come from the theme as `hsl(var(--token))`.
   *
   * Do NOT author Tailwind utility classes in page `source`, on either
   * tier. `source` is *runtime metadata*: the console's Tailwind is
   * compiled at build time by scanning the console's own `src`, and there
   * is no safelist, so it never sees your page — an authored utility class
   * produces CSS only by coincidence (when objectui already ships that
   * exact class) and otherwise produces nothing, with no error anywhere.
   * `os validate` reports it as `page-source-className-tailwind`.
   * (ADR-0065; ADR-0080's 2026-06-30 amendment.)
   *
   * @default 'full'
   */
  kind?: 'full' | 'slotted' | 'html' | 'react';
  /**
   * Slotted override map. Each slot accepts a single SchemaNode or an
   * array (arrays are flattened into the slot position). Slots not
   * provided fall through to the synthesized default.
   *
   * Slot menu (v1):
   * - `header` — replaces the `page:header` node.
   * - `actions` — replaces the `record:quick_actions` action bar.
   * - `highlights` — replaces the highlight strip (chips + chevron
   *   path).
   * - `details` — replaces the body of the Details tab (a.k.a. the
   *   `record:details` sections). Use this to customize the Details
   *   layout while keeping Related / Activity / History tabs as
   *   synthesized.
   * - `tabs` — replaces the entire `page:tabs` node. Use this when
   *   you need to add custom tabs or reorder them; you own the full
   *   tab system. Wins over `details` when both are present.
   * - `discussion` — replaces the inline `record:discussion` footer.
   *
   * Each slot is a **full replacement** at the slot boundary — no
   * deep merge, no patch operations. To compose default + custom,
   * call the corresponding `buildDefault*` sub-builder from
   * `@object-ui/plugin-detail` and spread its output.
   *
   * Only honored when `kind === 'slotted'`.
   */
  slots?: PageSlotMap;
}

/**
 * Named-slot override map for slotted record pages.
 *
 * Each slot accepts a single SchemaNode or an array. The synthesizer
 * inlines the provided value verbatim at the slot's position in the
 * canonical Page schema; slots that are omitted fall through to the
 * synthesized default.
 *
 * See `PageSchema.slots` for the per-slot semantics.
 */
export interface PageSlotMap {
  header?: SchemaNode | SchemaNode[];
  actions?: SchemaNode | SchemaNode[];
  highlights?: SchemaNode | SchemaNode[];
  details?: SchemaNode | SchemaNode[];
  tabs?: SchemaNode | SchemaNode[];
  discussion?: SchemaNode | SchemaNode[];
}

/**
 * The seven HTML sectioning tags `packages/components/src/renderers/layout/semantic.tsx`
 * registers (objectui#8499).
 *
 * They are registered, live renderers carrying nine catalog fixtures under
 * `examples/schema-catalog/src/schemas/components-layout-semantic/`, and until
 * objectui#8499 no arm of `AnyComponentSchema` named any of them — so a document
 * that rendered correctly in the browser was refused by `objectui validate`.
 *
 * The renderer is one factory over all seven tags: it renders
 * `renderChildren(schema.children)` inside the tag and declares exactly one
 * authoring input, `className` (a {@link BaseSchema} member). It read
 * `schema.children || schema.body` until objectui#6771 retired the second
 * spelling. The
 * mirror is `zod/layout.zod.ts#SemanticElementSchema`, and
 * `__tests__/node-slot-registered-arms-8499.test.ts` compares the tag list below
 * against `semantic.tsx`'s own `tags` array.
 */
export interface SemanticElementSchema extends BaseSchema {
  type: 'aside' | 'main' | 'header' | 'nav' | 'footer' | 'section' | 'article';
  /**
   * Child components. The factory read `schema.children || schema.body` until
   * objectui#6771 retired the second spelling; it reads `schema.children`.
   */
  children?: SchemaNode | SchemaNode[];
}

/**
 * The safe flow/inline HTML passthrough set
 * `packages/components/src/renderers/basic/html-elements.tsx` registers
 * (objectui#8499).
 *
 * A `kind:'html'` page is PARSED (never executed) into the SDUI tree, so — in
 * that module's own words — "the everyday HTML tags an author reaches for …
 * must each resolve to a renderer". They resolved in the renderer registry and
 * in no arm of `AnyComponentSchema`; `content/docs/utilities/runner.mdx` teaches
 * a document carrying `h1`, and that document rendered and was refused.
 *
 * ⚠️ The per-tag keys below are declared on the WHOLE set, not per tag, so
 * `{ type: 'p', href: '…' }` type-checks. {@link BaseSchema} carried an index
 * signature when this was declared, so it type-checked before this declaration
 * existed too — this narrowed nothing and gained the author a named surface. `width` / `height` are
 * `string | number` rather than the registration's `number`, because the
 * renderer forwards them verbatim to the DOM attribute, which takes both.
 */
export interface HtmlElementSchema extends BaseSchema {
  type:
    | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    | 'p' | 'a' | 'blockquote' | 'pre' | 'code'
    | 'strong' | 'em' | 'b' | 'i' | 'u' | 'small' | 'mark' | 'sub' | 'sup' | 'del' | 'ins' | 'abbr'
    | 'ul' | 'ol' | 'li' | 'dl' | 'dt' | 'dd'
    | 'figure' | 'figcaption' | 'img' | 'hr' | 'br' | 'time' | 'address' | 'cite' | 'q';
  /**
   * Child components; ignored for the void tags `img` / `hr` / `br`. The factory
   * read `schema.children ?? schema.body` until objectui#6771 retired the second
   * spelling.
   */
  children?: SchemaNode | SchemaNode[];
  /** `a` link target; scheme-sanitised (`javascript:` / `data:` / `vbscript:` are dropped). */
  href?: string;
  /** `a` browsing context. */
  target?: string;
  /** `a` link relationship. */
  rel?: string;
  /** Advisory title — declared for `a`, `img` and `abbr`. */
  title?: string;
  /** `img` source URL. */
  src?: string;
  /** `img` alternative text. */
  alt?: string;
  /** `img` width — forwarded verbatim to the DOM attribute. */
  width?: string | number;
  /** `img` height — forwarded verbatim to the DOM attribute. */
  height?: string | number;
  /** `time` machine-readable datetime. */
  dateTime?: string;
  /** `q` / `blockquote` source URL. */
  cite?: string;
}

/**
 * Union type of all layout schemas
 */
export type LayoutSchema =
  | DivSchema
  | BoxSchema
  | TextSpanSchema
  | TextSchema
  | ImageSchema
  | IconSchema
  | SeparatorSchema
  | ContainerSchema
  | FlexSchema
  | StackSchema
  | GridSchema
  | CardSchema
  | TabsSchema
  | ScrollAreaSchema
  | ResizableSchema
  | AspectRatioSchema
  | PageNodeSchema
  | SemanticElementSchema
  | HtmlElementSchema;

