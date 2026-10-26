/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Product-page blocks
 *
 * The TypeScript twin of `zod/product-blocks.zod.ts` (objectui#12197): the five
 * product-neutral blocks `@object-ui/app-shell` registers for pages a product
 * composes as metadata — `hero`, `stat`, `usage-bar`, `checklist` and
 * `tile-grid` (ADR-0060 rule 2: a generic block, named for what it draws).
 *
 * `@objectstack/spec` has no `ComponentPropsMap` row for these blocks, so
 * nothing is read by reference: every member below is a key the block's
 * renderer reads, and no other. The members' meanings and defaults are the
 * registrations' `inputs` descriptions (`console/blocks/productBlocks.tsx`).
 *
 * ## Copy is the page's
 *
 * Every authored string is a plain string or an inline translation map
 * (`I18nLabel`), resolved in the viewer's language. objectui's bundles carry
 * only a block's chrome (the copy affordance's accessible name).
 *
 * ## Bound values
 *
 * A block may carry the spec's API binding as its `dataSource`
 * (`ElementApiDataSource`). The value it selects is the `data` root of the
 * block's expression holes, so a member that may come from the response is
 * also accepted as a `${…}` hole: `used: '${data.storage.usedMb}'`. The zod
 * arms accept exactly one hole as the whole string there; this face states it
 * as `string`, which is as close as a type can say.
 *
 * The parity pairs are `product-blocks.zod.ts#…` in
 * `__tests__/zod-mirror-parity.test.ts`.
 *
 * @module product-blocks
 * @packageDocumentation
 */

import type { ElementApiDataSource, I18nLabel } from '@objectstack/spec/ui';
import type { BaseSchema, SchemaNode } from './base.js';

/** A whole-string `${…}` hole, evaluated against the block's bound `data`. */
export type ProductBlockExpressionHole = string;

/** `hero`'s props bag. */
export interface HeroBlockProps {
  title: I18nLabel;
  subtitle?: I18nLabel;
  meta?: string;
  status?: I18nLabel;
  statusTone?: 'neutral' | 'success' | 'warning' | 'danger';
  primary?: SchemaNode;
  secondary?: SchemaNode;
}

/** `hero` — the page-top card of a product page. */
export interface HeroBlockSchema extends BaseSchema {
  type: 'hero';
  properties: HeroBlockProps;
  dataSource?: ElementApiDataSource;
  body?: never;
  children?: never;
}

/** `stat`'s props bag. */
export interface StatBlockProps {
  label: I18nLabel;
  value: number | string;
  hint?: I18nLabel;
}

/** `stat` — one labelled figure. */
export interface StatBlockSchema extends BaseSchema {
  type: 'stat';
  properties: StatBlockProps;
  dataSource?: ElementApiDataSource;
  body?: never;
  children?: never;
}

/** `usage-bar`'s props bag. */
export interface UsageBarBlockProps {
  label: I18nLabel;
  used: number | ProductBlockExpressionHole;
  limit?: number | ProductBlockExpressionHole;
  unit?: I18nLabel;
}

/** `usage-bar` — how much of a limit is used, as a bar. */
export interface UsageBarBlockSchema extends BaseSchema {
  type: 'usage-bar';
  properties: UsageBarBlockProps;
  dataSource?: ElementApiDataSource;
  body?: never;
  children?: never;
}

/** One `checklist` item. */
export interface ChecklistBlockItem {
  label: I18nLabel;
  done: boolean | ProductBlockExpressionHole;
  action?: SchemaNode;
}

/** `checklist`'s props bag. */
export interface ChecklistBlockProps {
  items: ChecklistBlockItem[];
  collapsedWhenDone?: boolean;
}

/** `checklist` — steps that tick as they are done. */
export interface ChecklistBlockSchema extends BaseSchema {
  type: 'checklist';
  properties: ChecklistBlockProps;
  dataSource?: ElementApiDataSource;
  body?: never;
  children?: never;
}

/** One `tile-grid` tile. */
export interface TileGridBlockItem {
  label: I18nLabel;
  href: string;
  icon?: string;
  caption?: I18nLabel;
}

/** `tile-grid`'s trailing "add" tile. */
export interface TileGridBlockAddTile {
  label: I18nLabel;
  href: string;
}

/** `tile-grid`'s props bag. */
export interface TileGridBlockProps {
  items: TileGridBlockItem[] | ProductBlockExpressionHole;
  addTile?: TileGridBlockAddTile;
}

/** `tile-grid` — the console home's launcher tiles, as a block. */
export interface TileGridBlockSchema extends BaseSchema {
  type: 'tile-grid';
  properties: TileGridBlockProps;
  dataSource?: ElementApiDataSource;
  body?: never;
  children?: never;
}
