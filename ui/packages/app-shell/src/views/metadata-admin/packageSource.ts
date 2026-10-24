// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an installed package came from — the Packages page's Source column
 * and its Source filter (objectui#12675, objectui#12790; ruling B on
 * objectstack#23892).
 *
 * Setup's Packages is the ONE list of what is installed, so each row says
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

export type PackageSourceRefusalCode =
  /** The row's served `source` is absent, or outside {@link PACKAGE_SOURCES}. */
  | 'PACKAGE_SOURCE_UNKNOWN'
  /** `?source=` names a value outside {@link PACKAGE_SOURCES}. */
  | 'PACKAGE_SOURCE_FILTER_UNKNOWN'
  /** `?source=` appears more than once. */
  | 'PACKAGE_SOURCE_FILTER_REPEATED';

/** A refusal at the Source boundary, naming what it refused. */
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

/** The Packages route, optionally filtered to one Source. */
export function packagesHref(basePath: string, source?: PackageSource): string {
  const path = `${basePath}/component/developer/packages`;
  return source ? `${path}?${PACKAGES_SOURCE_PARAM}=${source}` : path;
}
