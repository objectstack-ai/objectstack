// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] What an `unmanaged` install can copy — the ONE classification
 * of a package body's non-collection keys, read at both ends of the mode:
 *
 *  - at AUTHORING, by `defineStack` (`stack.zod.ts`), which refuses a package
 *    that permits `unmanaged` while it carries what the copy cannot write;
 *  - at INSTALL, by `importUnmanagedPackage`'s planner
 *    (`@objectstack/metadata-protocol`, `package-unmanaged-install.ts`), which
 *    refuses the same body before the new base exists.
 *
 * One table, so the two refusals cannot disagree about a key: a package that
 * passes `os validate` with `installModes: ['managed', 'unmanaged']` is not
 * refused at the install door for a key the author was never told about.
 * Collections (`PLURAL_TO_SINGULAR`) are not in it — each one is judged by its
 * metadata type's own `allowRuntimeCreate` flag in
 * `DEFAULT_METADATA_TYPE_REGISTRY`, the flag the save door reads.
 *
 * `unmanaged-install.test.ts` holds the table TOTAL against both schemas a
 * package body is read with — `ManifestSchema` and `ObjectStackDefinitionSchema`
 * — so a key either schema gains reddens a spec test on the PR that adds it,
 * instead of being refused at an install door with no reason on record.
 */

/**
 * How an unmanaged install treats one top-level key of a package body that is
 * NOT a metadata collection.
 *
 *  - `identity`   — describes the package; carried onto the new base's manifest.
 *  - `base`       — read to mint the base and never carried as written: `id` is
 *                   replaced by the target id, `namespace` is kept, `scope` is
 *                   stripped because the base is a WRITABLE package.
 *  - `converted`  — copied as items of a metadata type after a mechanical
 *                   conversion: each locale of a `translations` bundle becomes
 *                   one `translation` item, so the bundles live in the
 *                   environment ledger beside the rest of the copy, editable,
 *                   and reload at every boot the way environment translations do.
 *  - `code`       — refused: code, or a descriptor of a code-bearing artifact.
 *  - `uncopyable` — refused: package content the environment ledger has no row for.
 *  - `envelope`   — refused: it describes an artifact, not one package.
 *  - `door`       — not the copy's: read or applied by the install door, and
 *                   never written onto the base.
 *  - `deployment` — not the copy's: deployment configuration no install applies.
 */
export type UnmanagedInstallKeyDisposition =
  | 'identity'
  | 'base'
  | 'converted'
  | 'code'
  | 'uncopyable'
  | 'envelope'
  | 'door'
  | 'deployment';

/**
 * The dispositions that REFUSE an unmanaged install — the copy cannot reproduce
 * the key as environment rows, so the package is refused whole (no partial copy).
 */
export const UNMANAGED_INSTALL_REFUSING_DISPOSITIONS: ReadonlySet<UnmanagedInstallKeyDisposition> =
  new Set<UnmanagedInstallKeyDisposition>(['code', 'uncopyable', 'envelope']);

/**
 * Every non-collection key a package body may carry — the union of
 * `ManifestSchema`'s live keys and the stack definition's non-collection keys —
 * classified for an unmanaged install.
 */
export const UNMANAGED_INSTALL_KEY_DISPOSITIONS: Readonly<Record<string, UnmanagedInstallKeyDisposition>> = {
  // ── The package's identity ──
  id: 'base',
  namespace: 'base',
  scope: 'base',
  name: 'identity',
  version: 'identity',
  type: 'identity',
  description: 'identity',
  // An object with no `datasource` routes to its package's default, so a
  // base that dropped this would move every such object to `default`.
  defaultDatasource: 'identity',
  dependencies: 'identity',
  engines: 'identity',
  engine: 'identity',

  // ── Code, and the descriptors of a code-bearing plugin artifact ──
  functions: 'code',
  onEnable: 'code',
  plugins: 'code',
  devPlugins: 'code',
  runtimeModule: 'code',
  main: 'code',
  runtime: 'code',
  packaging: 'code',
  integrity: 'code',

  // ── Content the environment ledger has no row for ──
  objectExtensions: 'uncopyable',
  picklistExtensions: 'uncopyable',
  navigationContributions: 'uncopyable',
  contributes: 'uncopyable',

  // ── The artifact, not one package ──
  packages: 'envelope',
  manifest: 'envelope',

  // ── Copied after conversion ──
  translations: 'converted',

  // ── The install door's ──
  // Seed datasets are data, never metadata items, so a copy of the metadata
  // cannot carry them; the door states what it did with them.
  data: 'door',
  // Read by the door to judge the requested mode; the base is the
  // environment's own package and makes no promise about how it installs.
  installModes: 'door',

  // ── Deployment configuration: read by a stack's boot, by no install ──
  i18n: 'deployment',
  datasourceMapping: 'deployment',
  api: 'deployment',
  server: 'deployment',
  appName: 'deployment',
  email: 'deployment',
  sms: 'deployment',
  requires: 'deployment',
  tiers: 'deployment',
  devHint: 'deployment',
  devLogins: 'deployment',
};

/**
 * Whether a key's value carries anything for an unmanaged install to judge.
 * An empty container — `functions: {}`, `plugins: []` — carries no code, so it
 * refuses nothing; a refusal names content, never the mere spelling of a key.
 */
export function unmanagedInstallValueCarries(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}
