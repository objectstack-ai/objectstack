// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One default record page per object per deployment — the registry's half of
 * the rule, and the vocabulary {@link SchemaRegistry}'s refusal of a second
 * default is written in.
 *
 * ## The rule
 *
 * At most one `isDefault: true` record page may exist for an object in a
 * deployment (`PageSchema.isDefault`; maintainer ruling A on objectstack#23015,
 * record 6134056653). The renderer opens an object's record view on its
 * default record page and honours `isDefault` with no tie-break, so two
 * defaults for one object would leave the page to registration order — which
 * plugin initialised first — an accident no author wrote. A second default is
 * therefore refused at registration, naming both pages, the way ADR-0048's
 * 2026-10-08 addendum refuses a second holder of a position, permission-set or
 * capability name.
 *
 * "The default record page of object X" is `@objectstack/spec/ui`'s
 * `defaultRecordPageObject` — the one reading `defineStack` (and so
 * `os validate`) and the metadata save door ask as well, so the three doors
 * cannot disagree about what a default record page is.
 *
 * ## The holders
 *
 * A holder is a PAGE — named, and for a packaged page, by its package too:
 *
 *  - **a package's page** — a page a package registered under its own id
 *    (the registry's composite `PACKAGE:NAME` slot), or one it declared at
 *    install (its claim, recorded by `installPackage`, so a package installed
 *    without its items registered still holds what it declared);
 *  - **an environment's page** — a page authored in this environment rather
 *    than shipped by a package: the registry's bare slot.
 *
 * Two packages' pages under one name are two pages (ADR-0048 §3.4 keeps them
 * apart, and both are served), so they are two holders.
 *
 * ## What is not a second default
 *
 *  - **An overlay by name** (ADR-0005). An environment item under a page's own
 *    name stands in for that page — every by-name read takes the bare slot
 *    first — so it IS that page, whatever it changed. Its own body decides
 *    whether the page is a default; the slots it shadows decide nothing. A
 *    package registering a page under the name an environment item already
 *    holds is registering the page that item overlays.
 *  - **The same package again** — an idempotent reload, a re-install, a hot
 *    reload, an upgrade that moves the default from one of its pages to
 *    another. A package's own pages are judged at the authoring door
 *    (`defineStack`) and, within one manifest, at the package door below; a
 *    page an earlier registration of the same package left in the item store
 *    is that package's own residue, not another holder.
 *  - **A page that is not a default record page** — `isDefault` on a `home`,
 *    `app`, `utility` or `list` page, or on a record page bound to no object.
 *    It holds nothing; it is refused on its own account instead
 *    ({@link misplacedDefaultPages}; maintainer ruling A on objectstack#23610,
 *    record 6190536588), at the package door and the item seam alike.
 *
 * ## What it deliberately does not judge
 *
 *  - ⛔ A registration with no package — the bare slot every `sys_metadata`
 *    hydration and write-through performs. The metadata save door refuses a
 *    second default before it is stored; a stored row is not refused again
 *    when it hydrates. One consequence is stated rather than left implicit: at
 *    a cold boot every package registers BEFORE the environment's stored pages
 *    hydrate, so a stored default saved while no package held that object's
 *    default, and a package that adds one later, both reach the registry
 *    unrefused when the deployment restarts. A hot install of that package is
 *    refused (the stored page is already in the registry then).
 *  - ⛔ A downgrade. `OS_METADATA_COLLISION=warn` softens the ADR-0048 Phase 1
 *    namespace gate only. *
 * ## The app-scoped record page
 *
 * A record page may name the apps whose routes open it for its object
 * (`PageSchema.apps`; maintainer ruling A on objectstack#28979, record
 * 6573557633). The rule above holds one level down, per app: at most one
 * record page per object per app, refused here by the same holders, claims
 * and overlay rules, keyed by the SLOT ({@link RecordPageSlot}) instead of by
 * the object alone. The deployment's default is the slot with no app; it and
 * an app's slot never meet. "The record page of object X inside app A" is
 * `@objectstack/spec/ui`'s `defaultRecordPageObject(page, A)`, the reading
 * `defineStack` and the metadata save door ask too.
 */

import { defaultRecordPageObject, misplacedDefaultPageRefusal } from '@objectstack/spec/ui';

/** Who holds the default record page of an object: a page, and where it comes from. */
export type DefaultRecordPageHolder =
  | { readonly kind: 'package'; readonly packageId: string; readonly page: string }
  | { readonly kind: 'environment'; readonly page: string };

/**
 * One record-page slot: an object's deployment default (`app` absent), or the
 * record page an app's routes open for an object (`app` set).
 */
export interface RecordPageSlot {
  /** The object whose record view the slot chooses the page of. */
  readonly object: string;
  /** The app the slot is scoped to; absent for the deployment's default. */
  readonly app?: string;
}

/** The registry's key for a slot — the object alone for the default, so the default's keys are unchanged. */
export function recordPageSlotKey(slot: RecordPageSlot): string {
  return slot.app === undefined ? slot.object : JSON.stringify([slot.object, slot.app]);
}

/**
 * Every slot `item` holds: its object's default when it is one, and one slot
 * per distinct string entry of its `apps` that `defaultRecordPageObject` places
 * (a record page bound to an object). Reads an unparsed body.
 */
export function recordPageSlotsOf(item: unknown): RecordPageSlot[] {
  const slots: RecordPageSlot[] = [];
  const object = defaultRecordPageObject(item);
  if (object !== undefined) slots.push({ object });
  const apps = (item as { apps?: unknown } | null | undefined)?.apps;
  if (Array.isArray(apps)) {
    for (const app of new Set(apps.filter((a): a is string => typeof a === 'string'))) {
      const scoped = defaultRecordPageObject(item, app);
      if (scoped !== undefined) slots.push({ object: scoped, app });
    }
  }
  return slots;
}

/** Whether `item` holds `slot`. */
export function holdsRecordPageSlot(item: unknown, slot: RecordPageSlot): boolean {
  return defaultRecordPageObject(item, slot.app) === slot.object;
}

/** One record-page slot a manifest declares a page for. */
export interface DeclaredDefaultRecordPage extends RecordPageSlot {
  /** The page's name. */
  readonly page: string;
}

/**
 * The name a page is registered under — the engine seam's own derivation
 * (`name`, else `id`). A page with neither is skipped there, so it declares
 * nothing here.
 */
function pageName(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const { name, id } = item as { name?: unknown; id?: unknown };
  if (typeof name === 'string' && name !== '') return name;
  if (typeof id === 'string' && id !== '') return id;
  return undefined;
}

/**
 * Every record-page slot a manifest declares a page for — each default record
 * page, and each app a scoped record page names — read from the SAME sources
 * the engine's registration seams read: the manifest's own `pages` and each
 * nested `plugins[]` entry's (a nested plugin contributes under its parent
 * package — `ObjectQL.registerPlugin`), one level deep, arrays only. In
 * declaration order; a page declared twice under one name is listed twice.
 */
export function declaredDefaultRecordPages(manifest: unknown): DeclaredDefaultRecordPage[] {
  const out: DeclaredDefaultRecordPage[] = [];
  const read = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    const pages = (source as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) return;
    for (const item of pages) {
      const page = pageName(item);
      if (page === undefined) continue;
      for (const slot of recordPageSlotsOf(item)) out.push({ ...slot, page });
    }
  };
  read(manifest);
  const plugins = (manifest as { plugins?: unknown } | null | undefined)?.plugins;
  if (Array.isArray(plugins)) for (const plugin of plugins) read(plugin);
  return out;
}

/** One page a manifest declares `isDefault: true` on that is not a record page bound to an object. */
export interface MisplacedDefaultPage {
  /** The page's name, or `undefined` for a page that carries none. */
  readonly page: string | undefined;
  /** `misplacedDefaultPageRefusal`'s sentence — the one the page parse prints. */
  readonly refusal: string;
}

/**
 * Every page a manifest declares `isDefault: true` on that
 * `defaultRecordPageObject` does not place, read from the same sources as
 * {@link declaredDefaultRecordPages}, in declaration order. A package's pages
 * reach the registry without a `PageSchema` parse, so this is the package
 * door's half of the refusal the parse makes at `os validate` and at save.
 */
export function misplacedDefaultPages(manifest: unknown): MisplacedDefaultPage[] {
  const out: MisplacedDefaultPage[] = [];
  const read = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    const pages = (source as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) return;
    for (const item of pages) {
      const refusal = misplacedDefaultPageRefusal(item);
      if (refusal !== undefined) out.push({ page: pageName(item), refusal });
    }
  };
  read(manifest);
  const plugins = (manifest as { plugins?: unknown } | null | undefined)?.plugins;
  if (Array.isArray(plugins)) for (const plugin of plugins) read(plugin);
  return out;
}

/** How a refusal names a holder. */
export function describeDefaultRecordPageHolder(holder: DefaultRecordPageHolder): string {
  return holder.kind === 'package'
    ? `page "${holder.page}" of package "${holder.packageId}"`
    : `page "${holder.page}", authored in this system`;
}

/** A stable identity for de-duplicating holders. */
export function defaultRecordPageHolderKey(holder: DefaultRecordPageHolder): string {
  return holder.kind === 'package' ? `package:${holder.packageId}:${holder.page}` : `environment:${holder.page}`;
}
