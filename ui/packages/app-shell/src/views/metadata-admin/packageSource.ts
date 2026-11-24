// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an installed package came from — the Packages page's Source column
 * and its Source filter (objectui#12675, objectui#12790; ruling B on
 * objectstack#23892).
 *
 * The Packages page is the ONE list of what is installed, so each row says
 * which of three origins it has. The set is CLOSED: `code` / `marketplace` /
 * `authored`, and nothing else is ever drawn.
 *
 * ## The origin is the server's statement: read, never derived
 *
 * Every `/api/v1/packages` row carries `source`, stamped by the door that
 * registered the package (objectstack#24010). The spec declares the closed set
 * as `InstalledPackageSourceSchema` in `@objectstack/spec/kernel`, and the
 * served row, `InstalledPackageAtEitherStage` in
 * `@objectstack/spec/api-assembled`, carries it as a required key. This module
 * reads that key and nothing else. A row whose `source` is absent or outside
 * the closed set is refused at this boundary by name
 * (`PACKAGE_SOURCE_UNKNOWN`): never derived, never drawn as an empty cell.
 *
 * ⛔ No other key stands in for it, and there is no fallback when it is
 * missing:
 *
 *  - `writable` is a separate statement — what the server lets an org do to
 *    the package, read by the Scope badge (objectui#12723). An authored
 *    install with a `system` or `cloud` scope is `authored` AND not writable.
 *  - The marketplace slice's installed list is not a Source signal either. The
 *    page reads it for the marketplace row actions and for the installs the
 *    runtime did not load, never to name a registry row's origin.
 *
 * The two-read join this module used to run (`writable` × that list) retired
 * with objectui#12790, and its `PACKAGE_SOURCE_CONFLICT` refusal with it: no
 * second signal is left to disagree with the first.
 */

import type { InstalledPackageAtEitherStage } from '@objectstack/spec/api-assembled';

/** A package's origin: the type of the `source` key on the served row. */
export type PackageSource = InstalledPackageAtEitherStage['source'];

/**
 * The closed set of origins, in the order the filter and the column list them.
 *
 * Written out here rather than read from the options of
 * `InstalledPackageSourceSchema` at runtime, because that schema first ships in
 * `@objectstack/spec` 18.0.0-next.3 while this package's declared floor is
 * lower: a runtime import would put a symbol in the published `dist/` that the
 * floor does not carry (`pnpm check:spec-floors`). The tuple is held to the
 * spec instead. The `satisfies` clause refuses a member the served row does not
 * declare, and `packageSource-12790.test.ts` pins the tuple equal to the
 * schema's options, so a member added or removed upstream turns that pin red.
 */
export const PACKAGE_SOURCES = ['code', 'marketplace', 'authored'] as const satisfies readonly PackageSource[];

/**
 * The Packages page's Source filter, spelled as ONE URL query param.
 *
 * `/apps/APP/component/developer/packages?source=marketplace` opens the list
 * filtered; a Setup nav item reaches the same URL by declaring
 * `{ type: 'component', componentRef: 'developer:packages', params: { source: 'marketplace' } }`,
 * because the sidebar forwards a component item's `params` as the query string.
 * Page-local, so it lives here and not in the console's reserved `urlParams`.
 */
export const PACKAGES_SOURCE_PARAM = 'source';

/**
 * The Packages page's face, spelled as ONE URL query param (objectstack#36834).
 *
 * `?face=admin` opens the ADMINISTRATION face: every package of every source,
 * a Source filter, enable / disable, delete and New Package (which lands in
 * Studio on the new package) — and none of the authoring actions. Setup's
 * "Packages" nav item reaches it by declaring
 * `{ type: 'component', componentRef: 'developer:packages', params: { face: 'admin' } }`.
 * With no `face` the page is the development surface Studio opens (the
 * landing's "All packages" link), every action on it.
 *
 * The one value is {@link PACKAGES_ADMIN_FACE}; anything else is refused by
 * name, as an unknown Source is. Page-local, like {@link PACKAGES_SOURCE_PARAM}.
 */
export const PACKAGES_FACE_PARAM = 'face';

/** The one value {@link PACKAGES_FACE_PARAM} takes. */
export const PACKAGES_ADMIN_FACE = 'admin';

/** Which face of the Packages page is drawn. */
export type PackagesFace = 'admin' | 'development';

export type PackageSourceRefusalCode =
  /** The row's served `source` is absent, or outside {@link PACKAGE_SOURCES}. */
  | 'PACKAGE_SOURCE_UNKNOWN'
  /** `?source=` names a value outside {@link PACKAGE_SOURCES}. */
  | 'PACKAGE_SOURCE_FILTER_UNKNOWN'
  /** `?source=` appears more than once. */
  | 'PACKAGE_SOURCE_FILTER_REPEATED'
  /** `?face=` names a value other than {@link PACKAGES_ADMIN_FACE}. */
  | 'PACKAGES_FACE_UNKNOWN'
  /** `?face=` appears more than once. */
  | 'PACKAGES_FACE_REPEATED';

/** A refusal at the page's URL boundary (its Source and its face), naming what it refused. */
export class PackageSourceRefusal extends Error {
  readonly code: PackageSourceRefusalCode;
  /** The package id, or the filter value(s), the refusal is about. */
  readonly subject: string;

  constructor(code: PackageSourceRefusalCode, subject: string) {
    super(`${code}: ${subject}`);
    this.name = 'PackageSourceRefusal';
    this.code = code;
    this.subject = subject;
  }
}

export function isPackageSource(value: unknown): value is PackageSource {
  return typeof value === 'string' && (PACKAGE_SOURCES as readonly string[]).includes(value);
}

/**
 * The origin of one `/api/v1/packages` row: its served `source`, read as is.
 * Throws {@link PackageSourceRefusal} (`PACKAGE_SOURCE_UNKNOWN`) when the key is
 * absent or names a value outside the closed set. Nothing else on the row, and
 * nothing outside it, is consulted.
 */
export function readServedSource(row: {
  readonly manifest: { readonly id: string };
  readonly source?: unknown;
}): PackageSource {
  if (!isPackageSource(row.source)) {
    throw new PackageSourceRefusal('PACKAGE_SOURCE_UNKNOWN', row.manifest.id);
  }
  return row.source;
}

/**
 * The Source filter the URL asks for: `null` when absent. Throws
 * {@link PackageSourceRefusal} for a value outside the closed set or a repeated
 * param — a filter that silently matched nothing (or everything) would read as
 * a served answer.
 *
 * @param values every occurrence of {@link PACKAGES_SOURCE_PARAM}
 *   (`URLSearchParams.getAll`).
 */
export function readSourceFilter(values: readonly string[]): PackageSource | null {
  if (values.length === 0) return null;
  if (values.length > 1) {
    throw new PackageSourceRefusal('PACKAGE_SOURCE_FILTER_REPEATED', values.join(', '));
  }
  const [value] = values;
  if (!isPackageSource(value)) {
    throw new PackageSourceRefusal('PACKAGE_SOURCE_FILTER_UNKNOWN', value);
  }
  return value;
}

/**
 * The face the URL asks for. Throws {@link PackageSourceRefusal} for a value
 * other than {@link PACKAGES_ADMIN_FACE} or a repeated param.
 *
 * With no `face`, a `?source=marketplace` URL is the administration face too:
 * that is the address Setup's retired "Installed Apps" entry opened, already
 * the administrator's view of this list, and bookmarks and the marketplace
 * page's "Installed" button still send it (objectstack#36834). Every other URL
 * without `face` is the development surface.
 *
 * @param faceValues every occurrence of {@link PACKAGES_FACE_PARAM}.
 * @param source the Source filter already read from the same URL.
 */
export function readPackagesFace(faceValues: readonly string[], source: PackageSource | null): PackagesFace {
  if (faceValues.length > 1) {
    throw new PackageSourceRefusal('PACKAGES_FACE_REPEATED', faceValues.join(', '));
  }
  if (faceValues.length === 1) {
    const [value] = faceValues;
    if (value !== PACKAGES_ADMIN_FACE) throw new PackageSourceRefusal('PACKAGES_FACE_UNKNOWN', value);
    return 'admin';
  }
  return source === 'marketplace' ? 'admin' : 'development';
}

/** The Packages route, optionally filtered to one Source. */
export function packagesHref(basePath: string, source?: PackageSource): string {
  const path = `${basePath}/component/developer/packages`;
  return source ? `${path}?${PACKAGES_SOURCE_PARAM}=${source}` : path;
}

/**
 * The administration face's new-package deep link, spelled as ONE URL query
 * param (objectstack#36908): `?new=package` opens New Package on arrival, read
 * once and dropped from the address, so a refresh or Back does not open it a
 * second time. Page-local, like {@link PACKAGES_SOURCE_PARAM}.
 */
export const PACKAGES_NEW_PARAM = 'new';

/** The one value {@link PACKAGES_NEW_PARAM} takes. */
export const PACKAGES_NEW_PACKAGE_VALUE = 'package';

/**
 * Setup → Packages (objectstack#36834): the package list's administration
 * face, hosted under the Setup app's address. Studio's entries that name no
 * package land here since the Studio home was removed (objectstack#36908,
 * epic decision 9): `/studio` with no remembered package, a package Studio
 * cannot find, and a retired Setup page whose URL names none.
 */
export const SETUP_PACKAGES_PATH = `${packagesHref('/apps/setup')}?${PACKAGES_FACE_PARAM}=${PACKAGES_ADMIN_FACE}`;

/**
 * Setup → Packages with New Package open (objectstack#36908): the console's
 * new-package doors (Home's and the `/ai` screen's 「New in Studio」, the
 * 「Add app」 menu). The create lands in Studio on the new package.
 */
export const SETUP_NEW_PACKAGE_PATH = `${SETUP_PACKAGES_PATH}&${PACKAGES_NEW_PARAM}=${PACKAGES_NEW_PACKAGE_VALUE}`;
