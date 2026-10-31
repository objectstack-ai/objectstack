// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { MANIFEST_ID_PATTERN, ManifestSchema } from './manifest.zod';
import type { MetadataType } from './metadata-plugin.zod';
import { CUSTOMIZATION_PACKAGE_SUFFIX } from './override-declaration.zod';
import { SEMVER_2_0_0_VERSION_PATTERN } from './version-grammar';

/**
 * # The paired customization package (ADR-0146 D2, D3, D6)
 *
 * Every installed base gets one paired writable package, `<base>.custom`, that
 * holds the customer's changes to it. This module is the ONE spelling of the
 * pair's identity rules — the id, the namespace, the dependency range — and of
 * the closed list of metadata types a declared override applies to. The doors
 * of ADR-0146's Rollout read it: the ensure door creates the pair from
 * {@link customizationPackageId}, {@link customizationNamespace} and
 * {@link customizationDependencyRange}; the write gate asks
 * {@link isCustomizationPairOf} and {@link OVERRIDE_TYPE_CLASSIFICATION}; the
 * uninstall door asks {@link customizationBasePackageId}. ⛔ None of them
 * re-derives any of it: a second spelling is a declaration the first one cannot
 * be checked against.
 *
 * Pure functions over strings, no I/O, no registry read: whether a pair is
 * INSTALLED is the door's question, never this module's.
 *
 * Every derivation answers a discriminated result, never a throw and never a
 * guess: `{ ok: true, value }`, or `{ ok: false, reason }` naming why the input
 * has no answer, so a door refuses with a sentence instead of inventing a
 * value (no truncation, no hashing).
 */

// ─────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────

/** A derivation that produced its value. */
export interface CustomizationDerived {
  ok: true;
  value: string;
}

/**
 * Why a base has no paired package id:
 * - `base_id_missing` — the base id is empty or not a string;
 * - `base_is_customization_package` — the base is itself a `.custom` package,
 *   and a pair is never paired again;
 * - `base_id_invalid` — `<base>.custom` would not be a valid package id
 *   (`MANIFEST_ID_PATTERN`: lowercase dot-separated segments).
 */
export type CustomizationPackageIdRefusal =
  | 'base_id_missing'
  | 'base_is_customization_package'
  | 'base_id_invalid';

/**
 * Why a base namespace has no pair namespace:
 * - `base_namespace_missing` — empty or not a string;
 * - `base_namespace_too_long` — longer than
 *   {@link MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH}, so `<base_ns>_custom`
 *   exceeds the manifest namespace grammar's 20 characters;
 * - `base_namespace_invalid` — `<base_ns>_custom` fails the manifest namespace
 *   grammar for any other reason (an uppercase letter, a leading digit).
 */
export type CustomizationNamespaceRefusal =
  | 'base_namespace_missing'
  | 'base_namespace_too_long'
  | 'base_namespace_invalid';

/** Why a base version yields no dependency range: it is not a SemVer 2.0.0 version. */
export type CustomizationDependencyRangeRefusal = 'base_version_not_semver';

/** A derivation that has no value, and the named reason. */
export interface CustomizationRefused<R extends string> {
  ok: false;
  reason: R;
}

export type CustomizationDerivation<R extends string> = CustomizationDerived | CustomizationRefused<R>;

// ─────────────────────────────────────────────────────────────────────
// The pair's package id (ADR-0146 D3)
// ─────────────────────────────────────────────────────────────────────

/**
 * The paired customization package id of a base: `<base>.custom`.
 *
 * | base | answer |
 * |:--|:--|
 * | `hotcrm` | `hotcrm.custom` |
 * | `com.example.showcase` | `com.example.showcase.custom` |
 * | `hotcrm.custom` | refused — `base_is_customization_package` |
 * | `Com.Acme`, `@acme/crm` | refused — `base_id_invalid` |
 */
export function customizationPackageId(
  baseId: unknown,
): CustomizationDerivation<CustomizationPackageIdRefusal> {
  if (typeof baseId !== 'string' || baseId.length === 0) return { ok: false, reason: 'base_id_missing' };
  if (baseId.endsWith(CUSTOMIZATION_PACKAGE_SUFFIX)) return { ok: false, reason: 'base_is_customization_package' };
  const pair = `${baseId}${CUSTOMIZATION_PACKAGE_SUFFIX}`;
  if (!MANIFEST_ID_PATTERN.test(pair)) return { ok: false, reason: 'base_id_invalid' };
  return { ok: true, value: pair };
}

/**
 * The base of a paired customization package id, or `null` when `id` is not
 * one: `com.example.showcase.custom` → `com.example.showcase`. Exactly the
 * inverse of {@link customizationPackageId}: an id is a pair iff some base
 * derives it, so `a.custom.custom` (whose would-be base is itself a pair) and
 * the bare `.custom` have no base.
 */
export function customizationBasePackageId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.endsWith(CUSTOMIZATION_PACKAGE_SUFFIX)) return null;
  const base = id.slice(0, -CUSTOMIZATION_PACKAGE_SUFFIX.length);
  const derived = customizationPackageId(base);
  return derived.ok && derived.value === id ? base : null;
}

/** Whether `id` is a paired customization package id (some base derives it). */
export function isCustomizationPackage(id: unknown): boolean {
  return customizationBasePackageId(id) !== null;
}

/**
 * Whether `pairId` is THE paired customization package of `baseId` — the
 * predicate the write gate reads for an override declaration: only the paired
 * `<base>.custom` declares an override of `<base>`'s items (the ruling recorded
 * on ADR-0146's amendment card, ruling A).
 */
export function isCustomizationPairOf(pairId: unknown, baseId: unknown): boolean {
  const derived = customizationPackageId(baseId);
  return derived.ok && derived.value === pairId;
}

// ─────────────────────────────────────────────────────────────────────
// The pair's namespace (ADR-0146 D3, Q4)
// ─────────────────────────────────────────────────────────────────────

/** The suffix the pair's namespace adds to the base's: `crm` → `crm_custom`. */
export const CUSTOMIZATION_NAMESPACE_SUFFIX = '_custom';

/**
 * The longest base namespace that has a pair namespace: the manifest namespace
 * grammar admits 20 characters, and {@link CUSTOMIZATION_NAMESPACE_SUFFIX}
 * takes 7. `customization-package.test.ts` pins this number against the
 * grammar itself (`ManifestSchema.shape.namespace`), so the two cannot drift.
 */
export const MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH = 13;

/**
 * The pair's namespace: `<base_ns>_custom`, set explicitly by the ensure door
 * and never derived from the pair's id (ADR-0146 D3:
 * `deriveNamespaceFromPackageId('hotcrm.custom')` answers `custom`, which is
 * never written).
 *
 * A base namespace longer than {@link MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH}
 * gets NO pair namespace — `base_namespace_too_long`, and the ensure door
 * refuses that base with a sentence. ⛔ No truncation and no hashing: either is
 * a second spelling of the pair's namespace that the declaration cannot be
 * checked against. (ADR-0146 is silent on this edge; it was decided by the
 * spec card and listed for the maintainer.)
 *
 * The answer is judged against the manifest's own namespace grammar
 * (`ManifestSchema.shape.namespace`), so a value this returns is always one a
 * manifest accepts.
 */
export function customizationNamespace(
  baseNamespace: unknown,
): CustomizationDerivation<CustomizationNamespaceRefusal> {
  if (typeof baseNamespace !== 'string' || baseNamespace.length === 0) {
    return { ok: false, reason: 'base_namespace_missing' };
  }
  if (baseNamespace.length > MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH) {
    return { ok: false, reason: 'base_namespace_too_long' };
  }
  const pair = `${baseNamespace}${CUSTOMIZATION_NAMESPACE_SUFFIX}`;
  if (!ManifestSchema.shape.namespace.safeParse(pair).success) {
    return { ok: false, reason: 'base_namespace_invalid' };
  }
  return { ok: true, value: pair };
}

// ─────────────────────────────────────────────────────────────────────
// The pair's dependency range (ADR-0146 D3, "Decided here" item 1)
// ─────────────────────────────────────────────────────────────────────

/**
 * The range the pair declares on its base in `manifest.dependencies`:
 * `^<major>` of the base's `manifest.version` at creation (ADR-0146 D3 and
 * "Decided here" item 1) — it admits the base's later minor and patch versions
 * at a re-install and refuses a different major.
 *
 * | base version | answer |
 * |:--|:--|
 * | `3.2.1` | `^3` |
 * | `0.4.0` | `^0` (every `0.x`) |
 * | `2.0.0-beta.1`, `1.4.0+build.7` | `^2`, `^1` — the major of the numeric core |
 * | `v1.0.0`, `1.0`, `latest` | refused — `base_version_not_semver` |
 *
 * A prerelease or build-metadata base answers the major of its numeric core,
 * the ADR's words read literally. Note what that range then admits: the
 * ADR-0141 D2 install check reads an installed version without a prerelease
 * tag only, so a pair whose base is installed at a prerelease is re-installable
 * once the base is at a release of that major.
 */
export function customizationDependencyRange(
  baseVersion: unknown,
): CustomizationDerivation<CustomizationDependencyRangeRefusal> {
  if (typeof baseVersion !== 'string') return { ok: false, reason: 'base_version_not_semver' };
  const match = SEMVER_2_0_0_VERSION_PATTERN.exec(baseVersion);
  if (!match) return { ok: false, reason: 'base_version_not_semver' };
  return { ok: true, value: `^${match[1]}` };
}

// ─────────────────────────────────────────────────────────────────────
// The overridable-type list (ADR-0146 D2, D6, D9, D10)
// ─────────────────────────────────────────────────────────────────────

/**
 * What a declared override may do to a type's base item:
 * - `overridable` — a `.custom` item of the base item's name, carrying
 *   `overrides`, replaces it whole (subject to `conditions`);
 * - `extend_only` — the base item is extended, never replaced (`object`,
 *   ADR-0146 D10);
 * - `excluded` — no override channel.
 */
export type OverrideDisposition = 'overridable' | 'extend_only' | 'excluded';

/**
 * A condition ADR-0146 D9 sets before an override door for a behavioural type
 * opens. Carried as data so the write gate reads it and never re-derives it:
 * - `served_over_code_package` — D9.1: the declared item is armed over the
 *   loader's body for the name;
 * - `rebound_in_one_reload` — D9.2: the trigger is moved from the base's
 *   definition to the override's in one reload step;
 * - `ledger_identity_inherited` — D9.3: one `sys_metadata_activation` row
 *   switches whichever definition is armed for the name;
 * - `version_pinning` — D9.4: a suspended run resumes on the version it started
 *   on (flow only);
 * - `action_ledger_switch` — D9's `action` paragraph: the action ledger switch
 *   lands first (outside ADR-0146's epic).
 */
export type OverrideCondition =
  | 'served_over_code_package'
  | 'rebound_in_one_reload'
  | 'ledger_identity_inherited'
  | 'version_pinning'
  | 'action_ledger_switch';

/**
 * Where a classification comes from:
 * - `adr_0146_d2_listed` — named in D2's "Which types" list;
 * - `adr_0146_d6_security_catalog` — D6: one name per deployment (permission
 *   sets, positions, capabilities);
 * - `adr_0146_d10_extended` — D10: objects are extended, never replaced;
 * - `adr_0126_code_only` — D2 and D6: the types ADR-0126 §3 places outside the
 *   regimes as code gain no override channel;
 * - `not_package_shipped` — D2's first sentence fails: packages never ship the
 *   type as a standalone document;
 * - `not_runtime_creatable` — D2's first sentence fails: neither Studio nor the
 *   metadata API can author the type (`allowRuntimeCreate: false`);
 * - `adr_0126_one_shot` — ADR-0126 §3 places the type outside as one-shot: it
 *   is applied once at install or publish and holds nothing durable to
 *   override; a customization adds its own item under a new name instead
 *   (`seed`);
 * - `setup_owned_connection` — ADR-0146 D1 gives the type to Setup, not to the
 *   metadata a package carries, and ADR-0126 §3 makes it origin-gated: one
 *   physical connection is environment configuration that must not travel in
 *   an exported `.custom` package (`datasource`);
 * - `behavioural_switch_first` — a behavioural type takes `action`'s path
 *   (ADR-0146 D9): its ledger switch lands first and an override door opens
 *   later, under D9-style conditions written for it then (`tool`, `skill`;
 *   ADR-0126 §3 pre-charts both for disable + clone).
 *
 * The maintainer ruled the last three on #28404 (「同意」, 2026-10-31): no row
 * is left undecided, and a type added later is classified with a decided basis
 * in the same change.
 */
export type OverrideClassificationBasis =
  | 'adr_0146_d2_listed'
  | 'adr_0146_d6_security_catalog'
  | 'adr_0146_d10_extended'
  | 'adr_0126_code_only'
  | 'not_package_shipped'
  | 'not_runtime_creatable'
  | 'adr_0126_one_shot'
  | 'setup_owned_connection'
  | 'behavioural_switch_first';

/** One type's override classification. */
export interface OverrideTypeClassification {
  readonly disposition: OverrideDisposition;
  readonly basis: OverrideClassificationBasis;
  /** D9 conditions an override door for this type waits for (behavioural types only). */
  readonly conditions?: readonly OverrideCondition[];
}

const listed: OverrideTypeClassification = { disposition: 'overridable', basis: 'adr_0146_d2_listed' };
const securityCatalog: OverrideTypeClassification = { disposition: 'excluded', basis: 'adr_0146_d6_security_catalog' };
const codeOnly: OverrideTypeClassification = { disposition: 'excluded', basis: 'adr_0126_code_only' };
const notRuntimeCreatable: OverrideTypeClassification = { disposition: 'excluded', basis: 'not_runtime_creatable' };
const behaviouralSwitchFirst: OverrideTypeClassification = { disposition: 'excluded', basis: 'behavioural_switch_first' };

/**
 * The CLOSED override classification of every metadata type — the constant the
 * write gate reads, never a judgement it makes (ADR-0146 D2: "the closed list
 * is a constant the write gate reads").
 *
 * Total over `MetadataType` at compile time and pinned to
 * `DEFAULT_METADATA_TYPE_REGISTRY` by `customization-package.test.ts`, which
 * fails when a registry type is added without a row here, when a row names no
 * registry type, and when an `overridable` row is not runtime-creatable.
 *
 * Four runtime-creatable types ADR-0146 does not name (`seed`, `datasource`,
 * `tool`, `skill`) are `excluded` with the basis the maintainer ruled on
 * #28404 (「同意」, 2026-10-31).
 */
export const OVERRIDE_TYPE_CLASSIFICATION = {
  // ── D2's list ──────────────────────────────────────────────────────
  view: listed,
  dashboard: listed,
  report: listed,
  translation: listed,
  email_template: listed,
  page: listed,
  app: listed,
  dataset: listed,
  doc: listed,
  book: listed,
  mapping: listed,
  flow: {
    disposition: 'overridable',
    basis: 'adr_0146_d2_listed',
    conditions: ['served_over_code_package', 'rebound_in_one_reload', 'ledger_identity_inherited', 'version_pinning'],
  },
  action: {
    disposition: 'overridable',
    basis: 'adr_0146_d2_listed',
    conditions: ['action_ledger_switch', 'served_over_code_package', 'rebound_in_one_reload', 'ledger_identity_inherited'],
  },
  // ── D10: extended, never replaced ──────────────────────────────────
  object: { disposition: 'extend_only', basis: 'adr_0146_d10_extended' },
  // ── D6: the security catalog's one-name-per-deployment types ──────
  permission: securityCatalog,
  position: securityCatalog,
  capability: securityCatalog,
  // ── D2 / D6: code-only types stay outside ──────────────────────────
  field: codeOnly,
  hook: codeOnly,
  job: codeOnly,
  api: codeOnly,
  agent: codeOnly,
  // ── D2's first sentence: not a package-shipped, runtime-authorable document
  external_catalog: { disposition: 'excluded', basis: 'not_package_shipped' },
  picklist: notRuntimeCreatable,
  sharing_rule: notRuntimeCreatable,
  queue: notRuntimeCreatable,
  assignment_rule: notRuntimeCreatable,
  // ── Not named by ADR-0146 — ruled by the maintainer on #28404 ──────
  seed: { disposition: 'excluded', basis: 'adr_0126_one_shot' },
  datasource: { disposition: 'excluded', basis: 'setup_owned_connection' },
  tool: behaviouralSwitchFirst,
  skill: behaviouralSwitchFirst,
} as const satisfies Record<MetadataType, OverrideTypeClassification>;

/** The metadata types a declared override applies to (`disposition: 'overridable'`). */
export const OVERRIDABLE_METADATA_TYPES: readonly MetadataType[] = Object.freeze(
  (Object.keys(OVERRIDE_TYPE_CLASSIFICATION) as MetadataType[]).filter(
    (type) => OVERRIDE_TYPE_CLASSIFICATION[type].disposition === 'overridable',
  ),
);

/** The classification of `type`, or `undefined` for a name that is no metadata type. */
export function getOverrideTypeClassification(type: unknown): OverrideTypeClassification | undefined {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(OVERRIDE_TYPE_CLASSIFICATION, type)
    ? OVERRIDE_TYPE_CLASSIFICATION[type as MetadataType]
    : undefined;
}

/** Whether a declared override applies to `type` (its disposition is `overridable`). */
export function isOverridableMetadataType(type: unknown): boolean {
  return getOverrideTypeClassification(type)?.disposition === 'overridable';
}
