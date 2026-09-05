// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two-package COLLECTION ZOO the option-B acceptance probe boots
 * (#15004, reader program 1/4 of the ADR-0130 D4 option-B ruling on #14512).
 *
 * Two ordinary `defineStack` packages — an App and a module that depends on it
 * — carrying one member of every collection family a package can own, split
 * across BOTH packages so no reader can pass by looking at one of them. The
 * project is composed with `manifest: 'preserve'`, which is the only
 * composition that produces `packages[]` (see
 * `examples/app-multi-package/objectstack.config.ts`).
 *
 * ## The two shapes, and why the second one is DERIVED
 *
 * `additiveProject()` is what the platform emits today: every collection
 * flattened to the top level, PLUS `packages[]` carrying the same definitions
 * a second time.
 *
 * `optionBProject()` is what the ruled emitter half will emit: the flattened
 * top level GONE, `packages[]` carrying everything exactly once.
 *
 * The key set that separates them is **derived from the two schemas**, never
 * transcribed here — `ObjectStackDefinitionSchema` ∩ `AssembledPackageBodySchema`
 * is precisely "the collections a package owns", and the complement is the
 * nine artifact-envelope keys `packages/spec/src/assembled-package-body.test.ts`
 * classifies. A hand-written list would be a third transcription of a set the
 * implementation already refuses to transcribe, and — the half that matters
 * here — a collection family added to the stack schema next month would join
 * this probe automatically instead of silently sitting outside it. (#14877 is
 * to publish that key set as an export; when it lands this module should read
 * it instead of deriving it, and nothing else here changes.)
 *
 * ## What this fixture is NOT
 *
 * It is not a claim about what `composeStacks` emits. `optionBProject()` builds
 * the option-B shape by STRIPPING the composed stack, in the fixture, precisely
 * so the probe can measure readers against that shape while the producer stays
 * additive — which is the ruled order (readers first, emitter last) and the
 * reason this card touches zero production files.
 */

import {
  AssembledPackageBodySchema,
  ObjectStackDefinitionSchema,
  composeStacks,
  defineStack,
  type ObjectStackDefinition,
} from '@objectstack/spec';

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape);

/**
 * Every top-level key that is a PACKAGE-OWNED collection — i.e. every key the
 * assembled package body also declares. Derived, per the module header.
 *
 * The complement (the artifact-envelope keys `manifest`, `packages`, `api`,
 * `server`, `i18n`, `runtimeModule`, `onEnable`) is what an option-B artifact
 * keeps at the top level.
 */
export const PACKAGE_OWNED_COLLECTION_KEYS: readonly string[] = (() => {
  const bodyKeys = new Set(shapeKeys(AssembledPackageBodySchema));
  return shapeKeys(ObjectStackDefinitionSchema).filter((k) => bodyKeys.has(k)).sort();
})();

/** The nine keys an option-B artifact still carries at its top level. */
export const ARTIFACT_ENVELOPE_KEYS: readonly string[] = (() => {
  const owned = new Set(PACKAGE_OWNED_COLLECTION_KEYS);
  return shapeKeys(ObjectStackDefinitionSchema).filter((k) => !owned.has(k)).sort();
})();

// ─── The named things every probe row asserts on ────────────────────────────

export const CORE_PACKAGE_ID = 'com.example.probe.core';
export const ORDERS_PACKAGE_ID = 'com.example.probe.orders';

/** The datasource `datasourceMapping` routes the project's objects to. */
export const PROBE_DATASOURCE = 'probe_primary';
/** Relative to the project root — `resolve-project-database` anchors it there. */
export const PROBE_DATASOURCE_FILE = '.objectstack/data/probe-primary.db';
/**
 * A FEDERATED datasource (ADR-0015), write gate OPEN.
 *
 * It is here for one reader: `deriveCrudCases` builds a datasource-by-name map
 * and consults it for exactly ONE decision — whether a federated object's probe
 * insert is allowed through the double write gate — so the only way to watch
 * that map is to carry an external object whose gate depends on it. Declared in
 * the App package while the object it gates lives in the module package, so the
 * row watching it measures a CROSS-PACKAGE resolution and not a within-body
 * read.
 *
 * ⚠️ The lean probe kernel builds no live driver for it, so every boot in this
 * fixture's probe logs one `federated (external) object(s) are NOT bound to
 * their remote table` ERROR. That is the truthful verdict for a federated
 * object with no remote behind it; it touches no row here (nothing in this
 * probe reads the object's data) and is expected output, not a fixture defect.
 */
export const PROBE_FEDERATED_DATASOURCE = 'probe_federated';
/** Relative to the project root, same anchoring as the primary. */
export const PROBE_FEDERATED_FILE = '.objectstack/data/probe-federated.db';
/** The write-opted-in federated object the datasource gate above admits. */
export const PROBE_FEDERATED_OBJECT = 'probe_federated_order';
/** The `isDefault` permission set `appSecurityPluginOptions` must resolve. */
export const PROBE_DEFAULT_PERMISSION_SET = 'probe_default_profile';
export const PROBE_POSITION = 'probe_position';
export const PROBE_GLOBAL_ACTION = 'probe_global_action';
export const PROBE_OBJECT_ACTION = 'probe_object_action';
export const PROBE_FUNCTION = 'probeSweep';
/** What the one declared function says about itself — the half option B loses. */
export const PROBE_FUNCTION_EFFECT = 'writes';
export const PROBE_JOB = 'probe_nightly';
export const PROBE_HOOK_OBJECT = 'probe_order';
/** The object the one seed dataset targets — a dataset is named by its object. */
export const PROBE_SEED_DATASET = 'probe_account';
export const PROBE_LOCALE = 'en';

// ─── Package 1: the App ─────────────────────────────────────────────────────

const coreStack = (): ObjectStackDefinition =>
  defineStack({
    manifest: {
      id: CORE_PACKAGE_ID,
      name: 'Option-B Probe Core',
      namespace: 'probe',
      version: '1.0.0',
      type: 'app',
      description: 'The App half of the option-B acceptance probe fixture',
    },
    objects: [
      {
        name: 'probe_account',
        label: 'Probe Account',
        pluralLabel: 'Probe Accounts',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Name', required: true },
        },
        // An OBJECT-EMBEDDED action. `collectBundleActions` walks
        // `bundle.objects[i].actions` as well as the global list, so a reader
        // that loses the top-level `objects` loses these too — the enumeration
        // in #14512 comment 5523603341 measured exactly that widening.
        actions: [
          {
            name: PROBE_OBJECT_ACTION,
            label: 'Probe Object Action',
            objectName: 'probe_account',
            type: 'script',
            body: { language: 'js', source: 'return { ok: true };' },
          },
        ],
      },
    ],
    datasources: [
      {
        name: PROBE_DATASOURCE,
        label: 'Probe Primary',
        driver: 'sqlite',
        config: { filename: PROBE_DATASOURCE_FILE },
        active: true,
      },
      // The federated half — see `PROBE_FEDERATED_DATASOURCE`. `datasourceMapping`
      // does NOT route to it (the project default stays `probe_primary`), so the
      // only thing that reaches it is the object in the OTHER package binding to
      // it by name.
      {
        name: PROBE_FEDERATED_DATASOURCE,
        label: 'Probe Federated',
        driver: 'sqlite',
        config: { filename: PROBE_FEDERATED_FILE },
        schemaMode: 'external',
        external: { allowWrites: true },
        active: true,
      },
    ],
    datasourceMapping: [
      { datasource: PROBE_DATASOURCE, default: true },
    ],
    permissions: [
      {
        name: PROBE_DEFAULT_PERMISSION_SET,
        label: 'Probe Default Profile',
        isDefault: true,
        objects: {
          probe_account: { allowRead: true },
        },
      },
    ],
    positions: [
      {
        name: PROBE_POSITION,
        label: 'Probe Position',
      },
    ],
    translations: [
      {
        [PROBE_LOCALE]: {
          objects: {
            probe_account: { label: 'Probe Account (translated)' },
          },
        },
      },
    ],
    data: [
      {
        object: PROBE_SEED_DATASET,
        mode: 'upsert',
        externalId: 'name',
        records: [{ name: 'Seeded Probe Account' }],
      },
    ],
  });

// ─── Package 2: the module that depends on it ───────────────────────────────

const ordersStack = (): ObjectStackDefinition =>
  defineStack({
    manifest: {
      id: ORDERS_PACKAGE_ID,
      name: 'Option-B Probe Orders',
      namespace: 'probe',
      version: '1.0.0',
      type: 'module',
      description: 'The module half of the option-B acceptance probe fixture',
      dependencies: { [CORE_PACKAGE_ID]: '^1.0.0' },
    },
    objects: [
      {
        name: PROBE_HOOK_OBJECT,
        label: 'Probe Order',
        pluralLabel: 'Probe Orders',
        sharingModel: 'private',
        fields: {
          name: { name: 'name', type: 'text', label: 'Number', required: true },
        },
      },
      // The FEDERATED object, bound to the datasource the OTHER package
      // declares and write-opted-in on its own half of ADR-0015's double gate.
      // A reader that resolves objects but not datasources still gets this one
      // wrong — it reports the object `blocked` as read-only — which is what
      // makes the two collections separately observable through one function.
      {
        name: PROBE_FEDERATED_OBJECT,
        label: 'Probe Federated Order',
        pluralLabel: 'Probe Federated Orders',
        sharingModel: 'private',
        datasource: PROBE_FEDERATED_DATASOURCE,
        external: { remoteName: 'remote_orders', writable: true },
        fields: {
          name: { name: 'name', type: 'text', label: 'Number', required: true },
        },
      },
    ],
    actions: [
      {
        name: PROBE_GLOBAL_ACTION,
        label: 'Probe Global Action',
        type: 'script',
        body: { language: 'js', source: 'return { ok: true };' },
      },
    ],
    hooks: [
      {
        name: 'probe_before_insert',
        label: 'Probe Before Insert',
        object: PROBE_HOOK_OBJECT,
        events: ['beforeInsert'],
        body: { language: 'js', source: 'return;' },
      },
    ],
    // DECLARED, not bare: the entry carries what the function says about
    // itself (`effect`) beside its callable. That declaration is the half an
    // option-B artifact loses on the compiled path — `mergeRuntimeModule`
    // re-supplies the CALLABLE from the sibling ESM module either way — so a
    // bare `() => undefined` here would make the `functions` row report
    // 1 -> 1 and read as coverage it does not have.
    functions: {
      [PROBE_FUNCTION]: { handler: () => undefined, effect: PROBE_FUNCTION_EFFECT },
    },
    jobs: [
      {
        name: PROBE_JOB,
        label: 'Probe Nightly',
        schedule: { type: 'cron', expression: '0 3 * * *', timezone: 'UTC' },
        handler: PROBE_FUNCTION,
      },
    ],
  });

// ─── The two shapes ─────────────────────────────────────────────────────────

/** Today's emitted shape: flattened top level PLUS `packages[]`. */
export const additiveProject = (): ObjectStackDefinition =>
  composeStacks([ordersStack(), coreStack()], { manifest: 'preserve' });

/**
 * The ruled option-B shape: `packages[]` carries every definition once, and the
 * flattened top-level collections are gone.
 *
 * Built by stripping the composed project — see the module header for why the
 * fixture, and not `composeStacks`, is what strips.
 */
export const optionBProject = (): ObjectStackDefinition => {
  const composed = additiveProject() as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const owned = new Set(PACKAGE_OWNED_COLLECTION_KEYS);
  for (const [key, value] of Object.entries(composed)) {
    if (!owned.has(key)) out[key] = value;
  }
  return out as ObjectStackDefinition;
};
