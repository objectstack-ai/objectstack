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
 *    namespace gate only.
 */

import { defaultRecordPageObject, misplacedDefaultPageRefusal } from '@objectstack/spec/ui';

/** Who holds the default record page of an object: a page, and where it comes from. */
export type DefaultRecordPageHolder =
  | { readonly kind: 'package'; readonly packageId: string; readonly page: string }
  | { readonly kind: 'environment'; readonly page: string };

/** One default record page a manifest declares. */
export interface DeclaredDefaultRecordPage {
  /** The object the page is the default record page of. */
  readonly object: string;
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
 * Every default record page a manifest declares, read from the SAME sources
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
      const object = defaultRecordPageObject(item);
      const page = pageName(item);
      if (object !== undefined && page !== undefined) out.push({ object, page });
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
