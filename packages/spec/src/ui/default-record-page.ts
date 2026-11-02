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
 * ## The app-scoped record page
 *
 * A record page may also name the apps whose routes open it for its object
 * (`PageSchema.apps`; maintainer ruling A on objectstack#28979, record
 * 6573557633). Inside one of those apps (`/apps/<app>/<object>/record/<id>`)
 * that page opens; everywhere else, Setup included, the deployment's one
 * default record page still opens. The rule is the default's, one level down:
 * at most one record page per object PER APP, refused at the same doors with
 * the same mechanism, naming both pages. The default and an app's page are two
 * different slots and coexist; no precedence ladder joins them. The one reading
 * is {@link defaultRecordPageObject} with the app passed: "the object this page
 * is the record page of, inside that app".
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
 * With `app` passed, the question is the app's slot instead (ruling A on
 * objectstack#28979): the object `page` is the record page of INSIDE that
 * app — a record page bound to an object whose `apps` lists `app` (a string
 * entry equal to it). `isDefault` is not read then: the deployment's default
 * and an app's page are two slots, and one page may hold both. A door that
 * judges every slot a page holds asks once with no app and once per string
 * entry of the page's `apps`.
 *
 * Reads a parsed page and an unparsed one alike, so a door can ask it of a
 * registry item or a stored row without parsing first.
 */
export function defaultRecordPageObject(page: unknown, app?: string): string | undefined {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return undefined;
  const p = page as Record<string, unknown>;
  if (app === undefined ? p.isDefault !== true : !(Array.isArray(p.apps) && p.apps.includes(app))) return undefined;
  const type = p.type === undefined ? PAGE_TYPE_DEFAULT : p.type;
  if (type !== 'record') return undefined;
  return typeof p.object === 'string' && p.object !== '' ? p.object : undefined;
}

/**
 * The refusal of `isDefault: true` — or of an `apps` scope — on a page
 * {@link defaultRecordPageObject} does not place, or `undefined` when the page
 * may carry what it declares.
 *
 * `isDefault` has one meaning: the default record page of the object a record
 * page binds. On any other page nothing reads it — an app opens on its first
 * navigation item and the root landing follows the APP's `isDefault`, never a
 * page's — so the flag was accepted, stored and served while it decided
 * nothing (maintainer ruling A on objectstack#23610, record 6190536588). Every
 * door that admits a page asks this one function, so `os validate`, package
 * registration and the metadata save door refuse the same pages with the same
 * sentence: `PageSchema`'s parse (and so `defineStack` and the save door), and
 * `@objectstack/objectql`'s registry for the pages a package registers
 * without a parse.
 *
 * `apps` (ruling A on objectstack#28979) is placed exactly where `isDefault`
 * is — it chooses the record page an app's routes open for the page's object —
 * so it is refused on the same pages, by the same doors, through this one
 * function. The `isDefault` sentence comes first when a page carries both.
 *
 * Reads a parsed page and an unparsed one alike, by the same declared keys
 * {@link defaultRecordPageObject} reads. The `isDefault` sentence names the
 * release that first refused the flag (`@objectstack/spec 18`): the retired D2
 * entry `page-is-default-off-record-page-removed` converts data at rest, and
 * the removal-version pin holds every such prescription to the release its
 * `retiredAfter` derives. The `apps` sentence names no release: the key never
 * shipped without its placement rule.
 */
export function misplacedDefaultPageRefusal(page: unknown): string | undefined {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return undefined;
  const p = page as Record<string, unknown>;
  const type = p.type === undefined ? PAGE_TYPE_DEFAULT : p.type;
  const placed = type === 'record' && typeof p.object === 'string' && p.object !== '';
  if (placed) return undefined;
  if (p.isDefault === true) {
    if (type === 'record') {
      return '`isDefault: true` is refused on a record page bound to no `object` since @objectstack/spec 18: it makes a record page the '
        + 'default record page of the object it binds, the page that object\'s record view opens. Bind the '
        + 'page (`object: \'<object name>\'`), or delete `isDefault`.';
    }
    return `\`isDefault: true\` is refused on a \`type: '${String(type)}'\` page since @objectstack/spec 18: it marks the default record page `
      + 'of an object, and nothing reads it on any other page. A page does not choose where an app opens — an '
      + 'app\'s landing page is its first navigation item (by `order`), so to land on this page put its entry '
      + 'first in the app\'s `navigation`; the root landing follows the app\'s own `isDefault`. Delete '
      + '`isDefault` from this page.';
  }
  if (p.apps === undefined) return undefined;
  if (type === 'record') {
    return '`apps` is refused on a record page bound to no `object`: it names the apps whose routes open this page '
      + 'for the object it binds, and this page binds none. Bind the page (`object: \'<object name>\'`), or delete `apps`.';
  }
  return `\`apps\` is refused on a \`type: '${String(type)}'\` page: it names the apps whose routes open a record page `
    + 'for its object, and nothing reads it on any other page. To show this page in an app, give it an entry in '
    + 'that app\'s `navigation`. Delete `apps` from this page.';
}
