// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one spelling of "which object is this page the default record page of" —
 * a pure module that imports nothing.
 *
 * ## The rule it serves
 *
 * At most one `isDefault: true` record page may exist for an object in a
 * deployment (`PageSchema.isDefault`). The renderer opens an object's record
 * view on that page and on nothing else, with no tie-break between two
 * defaults: registration order, package order and declaration order decide
 * nothing. A second default record page for the same object is therefore
 * refused, naming both pages, at each door that can add one:
 *
 *  - **one stack** — `defineStack`'s cross-reference pass (and so `os validate`,
 *    `os build` and a source boot, which all load the stack through it), and
 *    `composeStacks` over the pages its inputs bring together;
 *  - **package registration** — `@objectstack/objectql`'s `SchemaRegistry`, at
 *    the package door (`installPackage`) and at the item seam
 *    (`registerItem`), against every other holder in the registry;
 *  - **metadata save** — `@objectstack/metadata-protocol`'s `saveMetaItem`,
 *    against the stored pages and the pages packages ship.
 *
 * Replacing an existing default by saving a page under ITS name (an ADR-0005
 * overlay by name) is the same page, not a second default, and every door lets
 * it through. (Maintainer ruling A on objectstack#23015, record 6134056653.)
 *
 * ## Why it lives in the spec
 *
 * The three doors live in three packages, and the stack contract cannot import
 * either runtime package. A door that read "default record page" its own way
 * could refuse a page another door accepts, or accept the pair another door
 * refuses — `os validate` passing a stack the boot then refuses is the shape
 * one judge read by every door exists to prevent. So the reading is here, once,
 * and every door calls it.
 */

/**
 * The page type a page carries when it declares none. `PageSchema` declares
 * its `type` key with this default (`page.zod.ts` reads this constant for it),
 * so a page authored without `type` IS a record page, and an unparsed body —
 * a registry item, a stored row — that leaves the key out is judged as one.
 * One constant, so the schema's default and this reading cannot part.
 */
export const PAGE_TYPE_DEFAULT = 'record' as const;

/**
 * The object `page` is the default record page of, or `undefined` when it is
 * not a default record page of any object.
 *
 * A page is the default record page of object `X` when all three hold:
 *
 *  - `isDefault` is `true` (exactly the boolean — the key's declared type);
 *  - its `type` is `'record'`, or absent ({@link PAGE_TYPE_DEFAULT});
 *  - its `object` names `X` (a non-empty string).
 *
 * A page that is `isDefault: true` but is not a record page (a `home`, `app`,
 * `utility` or `list` page), or a record page bound to no object, is outside
 * the rule and answers `undefined`. Only declared keys are read: an undeclared
 * spelling (`default`, `objectName`, `pageType`) is refused by the page schema
 * itself and decides nothing here.
 *
 * Reads a parsed page and an unparsed one alike, so a door can ask it of a
 * registry item or a stored row without parsing first.
 */
export function defaultRecordPageObject(page: unknown): string | undefined {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return undefined;
  const p = page as Record<string, unknown>;
  if (p.isDefault !== true) return undefined;
  const type = p.type === undefined ? PAGE_TYPE_DEFAULT : p.type;
  if (type !== 'record') return undefined;
  return typeof p.object === 'string' && p.object !== '' ? p.object : undefined;
}
