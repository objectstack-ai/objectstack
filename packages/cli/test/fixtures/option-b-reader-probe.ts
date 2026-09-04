// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The measuring instrument behind the option-B acceptance pin (#15004).
 *
 * One function — {@link measureShape} — takes a project in ONE of the two
 * shapes `option-b-collection-zoo.ts` produces and reports, per row, what each
 * subsystem actually SAW. The pin beside it compares the two reports.
 *
 * ## Every row calls a real reader. None re-implements one.
 *
 * That distinction is the whole value of this file, so it is stated as a rule
 * rather than left to inspection: a row either
 *
 *   - invokes a reader this repo SHIPS (`collectBundleActions`,
 *     `resolveStandaloneDatabase`, `createStandaloneStack`,
 *     `appSecurityPluginOptions`, `devI18nPluginOptions`, …) and reports its
 *     return value, or
 *   - boots a real kernel carrying the real `AppPlugin` and reports what that
 *     plugin HANDED to a subsystem (a job scheduled, a datasource connected, a
 *     mapping set, an i18n service registered, a seed dataset merged).
 *
 * ⛔ No row reads `bundle.<collection>` and calls that a measurement. A row
 * shaped like that is a second copy of the very read the reader program is
 * about to change: it would stay red forever after the reader beside it was
 * fixed, which is the failure mode that makes a gate get deleted.
 *
 * ## Why a booted kernel for the `AppPlugin` half
 *
 * `AppPlugin` reads `jobs` / `data` / `translations` / `datasources` /
 * `datasourceMapping` / `objects` inline inside a 950-line `start()`. There is
 * no exported reader to call, and the fold that card 2/4 lands could be at the
 * constructor, at each read, or anywhere between — so any probe written against
 * `AppPlugin`'s INTERNALS is a bet on an implementation that does not exist yet.
 * What cannot move is the far side: the plugin has to hand the collection to a
 * subsystem, and the subsystems are ordinary kernel services. The recorder below
 * IS those services, so these rows measure the contract rather than the code.
 *
 * ## The controls, and why they are here rather than in the pin
 *
 * `registryItems()` reports what the SchemaRegistry holds after the same boot.
 * The registry is one of the readers that ALREADY resolves `packages[]`
 * (`resolveArtifactPackageOrder`), so it must see the same items in both shapes
 * — and measured, it does. That is this file's anti-vacuity control: it proves
 * the option-B fixture really carries every definition under `packages[]`, so a
 * row that reports zero is a READER losing a collection and never a fixture
 * that shipped an empty package.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AppPlugin,
  collectBundleActions,
  collectBundleFunctionEntries,
  collectBundleHooks,
  createStandaloneStack,
  loadArtifactBundle,
  readSeedDatasets,
  resolveStandaloneDatabase,
} from '@objectstack/runtime';
import { appSecurityPluginOptions } from '@objectstack/plugin-security';
import { devI18nPluginOptions } from '@objectstack/plugin-dev';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

// The lowering itself, not a copy of it — reached as SOURCE, by relative path,
// because this module lives INSIDE `@objectstack/cli`. It is the same function
// `compile.ts` runs, so the artifact written below is the artifact `os build`
// would write (minus `docs`, which is filesystem input rather than stack input).
import { lowerCallables } from '../../src/utils/lower-callables.js';
// [#15006] The CLI's OWN reads of a package-owned collection. Until that card
// these were inline expressions inside oclif command bodies — no exported
// reader, nothing a probe could call — which is why the four rows they carry
// below did not exist when this file was written. They are the seam now, so the
// rows CALL the decision each command makes rather than re-deriving it.
import {
  artifactObjectNames,
  authoringRuleUnionStack,
  bundleDeclaresTranslations,
  shouldAutoRegisterObjectQL,
  shouldAutoRegisterStorageDriver,
  stackDeclaresMetadata,
} from '../../src/utils/stack-collections.js';

import {
  PACKAGE_OWNED_COLLECTION_KEYS,
  PROBE_DEFAULT_PERMISSION_SET,
  PROBE_FUNCTION,
  PROBE_FUNCTION_EFFECT,
} from './option-b-collection-zoo.js';

type Bag = Record<string, unknown>;

/** One row of the probe: what a named subsystem saw, at a named boundary. */
export interface ProbeRow {
  /** Stable id — `<boundary> · <subsystem> · <collection>`. Ledger key. */
  id: string;
  /** Rendered observation, for the failure text. */
  observed: string;
  /** True when the subsystem saw NOTHING of the collection it reads. */
  lost: boolean;
}

const row = (id: string, observed: unknown, lost: boolean): ProbeRow => ({
  id,
  observed: observed === undefined || observed === null ? 'none' : String(observed),
  lost,
});

const countRow = (id: string, n: number): ProbeRow => row(id, n, n === 0);

// ─── The compiled artifact, written the way `os build` writes it ────────────

/**
 * Lower, validate and write `stack` to `<dir>/dist/objectstack.json`, plus the
 * sibling ESM runtime module the build emits beside it when the stack carries
 * callables.
 *
 * The sibling module is not decoration. `loadArtifactBundle` merges its
 * `functions` map onto the bundle, which is the one thing on the compiled path
 * that re-supplies a collection the flattened top level no longer carries — and
 * measuring that required emitting it. See the `functions` row's note.
 */
export function writeCompiledArtifact(dir: string, stack: unknown): string {
  const normalized = normalizeStackInput(stack as never);
  const lowered = lowerCallables(normalized as never);
  const parsed = ObjectStackDefinitionSchema.safeParse(lowered.lowered);
  if (!parsed.success) {
    throw new Error(
      `option-b probe: the lowered fixture does not satisfy ObjectStackDefinitionSchema, so ` +
        `\`os build\` would refuse to write it:\n` +
        parsed.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  const artifact = JSON.parse(JSON.stringify(parsed.data)) as Bag;
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });

  const refs = Object.keys(lowered.functions);
  if (refs.length > 0) {
    artifact.runtimeModule = './objectstack-runtime.mjs';
    writeFileSync(
      join(distDir, 'objectstack-runtime.mjs'),
      `export const functions = {${refs.map((r) => `${JSON.stringify(r)}: () => undefined`).join(', ')}};\n`,
    );
  }

  const artifactPath = join(distDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

// ─── The recorder: the subsystems `AppPlugin` hands collections to ──────────

interface Recording {
  scheduledJobs: string[];
  connectedDatasources: string[];
  objectsAtConnect: string[];
  datasourceMappingRules: number;
  i18nService: boolean;
  seedDatasets: number;
  registryObjects: string[];
}

/**
 * A plugin that IS the subsystems: it registers the `job` and
 * `datasource-connection` services `AppPlugin` looks up, wraps the engine's
 * `setDatasourceMapping`, and — after the boot — reads back the i18n service
 * and the shared seed-dataset registry (`readSeedDatasets`, the runtime's own
 * exported accessor for the #3453 register-once-then-mutate list).
 *
 * Registered BEFORE `AppPlugin`, but that is not what makes the ordering work:
 * the kernel completes every `init()` before any `start()`, and every read this
 * records happens in `AppPlugin.start()`.
 */
function makeRecorder(rec: Recording) {
  let ctxRef: Bag | undefined;
  return {
    name: 'com.objectstack.probe.option-b-recorder',
    type: 'service' as const,
    version: '1.0.0',
    init: async (ctx: Bag) => {
      ctxRef = ctx;
      const register = ctx.registerService as (name: string, svc: unknown) => void;
      register('job', {
        schedule: async (name: string) => {
          rec.scheduledJobs.push(name);
          return { id: name };
        },
        cancel: async () => undefined,
        list: async () => [],
      });
      register('datasource-connection', {
        connectDeclared: async (input: {
          datasources?: Array<{ name?: string }>;
          objects?: Array<{ name?: string }>;
        }) => {
          for (const d of input?.datasources ?? []) rec.connectedDatasources.push(String(d?.name));
          for (const o of input?.objects ?? []) rec.objectsAtConnect.push(String(o?.name));
          return (input?.datasources ?? []).map((d) => ({ name: String(d?.name), status: 'connected' }));
        },
      });
      const getService = ctx.getService as (name: string) => Bag;
      const ql = getService('objectql');
      const original = ql.setDatasourceMapping as ((rules: unknown[]) => unknown) | undefined;
      ql.setDatasourceMapping = (rules: unknown[]) => {
        rec.datasourceMappingRules += Array.isArray(rules) ? rules.length : 0;
        return original?.call(ql, rules);
      };
    },
    /** Read back everything that is observable only AFTER the boot completed. */
    collect: () => {
      const ctx = ctxRef;
      if (!ctx) return;
      const getService = ctx.getService as (name: string) => unknown;
      try {
        rec.i18nService = !!getService('i18n');
      } catch {
        rec.i18nService = false;
      }
      rec.seedDatasets = (readSeedDatasets(ctx) ?? []).length;
      try {
        const ql = getService('objectql') as { registry?: { getAllObjects?: () => Array<{ name?: string }> } };
        rec.registryObjects = (ql.registry?.getAllObjects?.() ?? [])
          .map((o) => String(o?.name))
          .filter((n) => n.startsWith('probe_'))
          .sort();
      } catch {
        rec.registryObjects = [];
      }
    },
  };
}

/**
 * Boot `bundle` on a lean real kernel through the real `AppPlugin` and report
 * what each subsystem received.
 *
 * `skipSeedData: true` — the seed LOADER needs a driver this kernel has none
 * of, and what this probe measures is whether the datasets reached the shared
 * registry at all, which happens either way.
 */
async function bootAndRecord(bundle: unknown): Promise<Recording> {
  const rec: Recording = {
    scheduledJobs: [],
    connectedDatasources: [],
    objectsAtConnect: [],
    datasourceMappingRules: 0,
    i18nService: false,
    seedDatasets: 0,
    registryObjects: [],
  };
  const recorder = makeRecorder(rec);
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(new ObjectQLPlugin({}) as never);
  kernel.use(recorder as never);
  kernel.use(new AppPlugin(bundle, undefined, { skipSeedData: true }) as never);
  await kernel.bootstrap();
  recorder.collect();
  await kernel.shutdown();
  return rec;
}

// ─── The measurement ────────────────────────────────────────────────────────

export interface ShapeMeasurement {
  rows: ProbeRow[];
  /** Anti-vacuity control — the registry already reads `packages[]`. */
  registryObjectsFromArtifact: string[];
  registryObjectsFromSource: string[];
}

/**
 * Run every row over one shape.
 *
 * `projectRoot` must be an empty temp directory: `resolve-project-database`
 * anchors a declared sqlite filename on it, and `createStandaloneStack` writes
 * its state dir under it.
 */
export async function measureShape(project: unknown, projectRoot: string): Promise<ShapeMeasurement> {
  const artifactPath = writeCompiledArtifact(projectRoot, project);
  const bundle = (await loadArtifactBundle(artifactPath, { unwrapEnvelope: true })) as Bag;
  if (!bundle) throw new Error('option-b probe: loadArtifactBundle returned null for a file it just wrote');

  const rows: ProbeRow[] = [];

  // ── B1 · the compiled-artifact load, and the runtime readers it feeds ─────

  rows.push(countRow(
    'B1 · runtime collectBundleActions (action dispatch registration) · actions + objects[].actions',
    collectBundleActions(bundle).length,
  ));
  rows.push(countRow(
    'B1 · runtime collectBundleHooks (declarative hook binding) · hooks',
    collectBundleHooks(bundle).length,
  ));

  // The `functions` row is about the DECLARATION, not the callable, and it is a
  // measured correction to the enumeration in #14512 comment 5523603341 —
  // twice over.
  //
  // First: `mergeRuntimeModule` writes the sibling ESM module's handler map
  // onto `bundle.functions` unconditionally, so on the compiled path the
  // CALLABLES survive an option-B artifact. A row counting entries here would
  // report 1 -> 1 and read as coverage it does not have.
  //
  // Second, and sharper: what the top level carried was `{ handler, effect }`,
  // and the module supplies a BARE callable — which `normalizeFlowFunctionEntry`
  // then defaults to `effect: 'pure'`. So the loss is not an absence a
  // presence-check could see. A declared WRITER comes back through this reader
  // as a pure function, which is #4396's silent un-declaring in a third
  // spelling: the function still registers, still runs, and its writes are
  // still counted as none. The row therefore asserts the VALUE.
  const fnEntries = collectBundleFunctionEntries(bundle) as Record<string, { effect?: unknown }>;
  const declaredEffect = fnEntries[PROBE_FUNCTION]?.effect;
  rows.push(row(
    'B1 · runtime collectBundleFunctionEntries (declared function effect) · functions',
    declaredEffect,
    declaredEffect !== PROBE_FUNCTION_EFFECT,
  ));

  // ── B5 · resolve-project-database, upstream of every candidate fold ───────

  const db = resolveStandaloneDatabase({ projectRoot, artifactPath } as never) as {
    source: string;
    datasourceName?: string;
  };
  rows.push(row(
    'B5 · resolve-project-database readConfigDeclaredDefault (project database tier) · datasourceMapping + datasources',
    `${db.source}${db.datasourceName ? `:${db.datasourceName}` : ''}`,
    db.source !== 'config-datasource',
  ));

  // ── B1 · createStandaloneStack's surfaced keys ────────────────────────────

  const standalone = (await createStandaloneStack({ projectRoot, artifactPath } as never)) as {
    objects?: unknown[];
    permissions?: unknown[];
    positions?: unknown[];
  };
  rows.push(countRow(
    'B1 · createStandaloneStack surfaced objects (CLI tier resolution + engine/driver auto-registration) · objects',
    standalone.objects?.length ?? 0,
  ));
  rows.push(countRow(
    'B1 · createStandaloneStack surfaced permissions (ADR-0056 D7) · permissions',
    standalone.permissions?.length ?? 0,
  ));
  rows.push(countRow(
    'B1 · createStandaloneStack surfaced positions · positions',
    standalone.positions?.length ?? 0,
  ));
  const artifactSideProfile = appSecurityPluginOptions(standalone)?.fallbackPermissionSet;
  rows.push(row(
    'B1 · plugin-security appSecurityPluginOptions over the artifact-serve config (default permission set) · permissions',
    artifactSideProfile,
    artifactSideProfile !== PROBE_DEFAULT_PERMISSION_SET,
  ));

  // ── B2/B3/B4 · the from-source config, as the CLI's config-module load
  //    boundaries hand it on. All three call sites load an ordinary module and
  //    pass its export through untouched, so the collection loss is not IN the
  //    loader — it is in the readers each of them then drives, which is what
  //    these rows are.

  // `DevPlugin` takes its stack from a CALLER-SUPPLIED object
  // (`new DevPlugin({ stack: config })`, the documented construction), so there
  // is no load boundary between the composed config and this reader — the same
  // object `os dev` boots from source is handed straight to the plugin. The row
  // calls the SHIPPED decision (`devI18nPluginOptions`), which is what the
  // plugin itself calls to decide whether to register `I18nServicePlugin`; a
  // row that re-read `stack.translations` here would be a second copy of the
  // read the reader program changes and would stay red after it was fixed.
  const devI18n = devI18nPluginOptions(project);
  rows.push(row(
    'B2 · plugin-dev I18nServicePlugin auto-detect over the caller-supplied stack · translations',
    devI18n ? `I18nServicePlugin(fallbackLocale=${devI18n.fallbackLocale})` : undefined,
    devI18n === undefined,
  ));

  const fromSourceProfile = appSecurityPluginOptions(project)?.fallbackPermissionSet;
  rows.push(row(
    'B2 · plugin-security appSecurityPluginOptions over the from-source config (default permission set) · permissions',
    fromSourceProfile,
    fromSourceProfile !== PROBE_DEFAULT_PERMISSION_SET,
  ));
  rows.push(countRow(
    'B2 · runtime collectBundleActions over the from-source config · actions + objects[].actions',
    collectBundleActions(project as never).length,
  ));
  rows.push(countRow(
    'B2 · runtime collectBundleHooks over the from-source config · hooks',
    collectBundleHooks(project as never).length,
  ));
  rows.push(countRow(
    'B2 · runtime collectBundleFunctionEntries over the from-source config · functions',
    Object.keys(collectBundleFunctionEntries(project as never)).length,
  ));

  // ── B2/B3/B4 · the CLI's OWN reads, through the #15006 seam ──────────────
  //
  // Four of the six rows below are the ones this file's "Boundaries" note used
  // to say a probe could not reach. They were not unreachable because of the
  // artifact — they were unreachable because the reads were EXPRESSIONS inside
  // oclif command bodies. #15006 made each of them a callable, and a callable is
  // what a row can attach to. The other two are the reads that sit beside them
  // on the same boundaries: the `AppPlugin` wrap gate (which, MEASURED, does not
  // lose — `manifest` is an envelope key) and the i18n auto-registration gate
  // (which does).
  //
  // ⛔ Note what these rows deliberately are NOT: an assertion that
  // `config.objects` is non-empty on an option-B config. That row would be a
  // second copy of the very read it watches — it would stay red after the read
  // beside it was fixed, and a gate that cannot go green gets deleted. Each row
  // below calls the DECISION the command now makes, with the real (empty)
  // plugin list, so a green row means the boot really would register the thing.

  const objectQLDecision = shouldAutoRegisterObjectQL(project, []);
  rows.push(row(
    'B2 · cli serve ObjectQL engine auto-registration gate (from source) · objects',
    objectQLDecision ? 'engine auto-registered' : 'NO QUERY ENGINE registered',
    !objectQLDecision,
  ));

  const driverDecision = shouldAutoRegisterStorageDriver(project, []);
  rows.push(row(
    'B2 · cli serve storage-driver auto-registration gate (from source) · objects',
    driverDecision ? 'storage driver auto-registered' : 'NO STORAGE DRIVER registered',
    !driverDecision,
  ));

  // The master gate for the whole B2 `AppPlugin` family — if it went false,
  // every collection those rows measure would go silent at once. Shared with
  // `os migrate`'s own second `loadConfig` (B4), which is the only reader that
  // boundary has of its own.
  const wrapDecision = stackDeclaresMetadata(project);
  rows.push(row(
    'B2/B4 · cli AppPlugin wrap gate (configHasMetadata — serve and migrate) · manifest + objects + apps + flows + apis',
    wrapDecision ? 'AppPlugin wrap composed' : 'app metadata NOT served',
    !wrapDecision,
  ));

  const i18nDecision = bundleDeclaresTranslations(project);
  rows.push(row(
    'B2 · cli serve i18n service auto-registration gate (from source) · translations',
    i18nDecision ? 'i18n plugin auto-registered' : 'NO i18n plugin — REST i18n routes absent',
    !i18nDecision,
  ));

  // `os dev`'s own `readFileSync` + `JSON.parse` of the artifact, kept as its
  // own boundary because it never passes through `loadArtifactBundle`.
  const devInventory = artifactObjectNames(JSON.parse(readFileSync(artifactPath, 'utf8')));
  rows.push(countRow(
    'B1 · cli dev artifact object inventory (readArtifactObjects recompile diff) · objects',
    devInventory.length,
  ));

  // `os build`'s UNION author-time rule run. What the rules can SEE is the
  // measurement — an empty input reports no findings and publishes green, which
  // is the failure this row exists for. Counted over the seam's OUTPUT, so the
  // row reports a reader's return value rather than re-deriving the read.
  const unionStack = authoringRuleUnionStack(
    JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>,
  );
  const unionItems = PACKAGE_OWNED_COLLECTION_KEYS.reduce((n, key) => {
    const value = (unionStack as Bag)[key];
    if (Array.isArray(value)) return n + value.length;
    if (value && typeof value === 'object') return n + Object.keys(value as Bag).length;
    return n;
  }, 0);
  rows.push(countRow(
    'B3 · cli build union author-time rule input (os build) · every package-owned collection',
    unionItems,
  ));

  // ── The booted AppPlugin, on BOTH entry paths ────────────────────────────

  const bootedFromArtifact = await bootAndRecord(bundle);
  const bootedFromSource = await bootAndRecord(project);

  const bootRows = (label: 'B1' | 'B2', what: string, r: Recording): void => {
    rows.push(countRow(`${label} · AppPlugin job scheduling (${what}) · jobs`, r.scheduledJobs.length));
    rows.push(countRow(
      `${label} · AppPlugin declared-datasource auto-connect (${what}) · datasources`,
      r.connectedDatasources.length,
    ));
    rows.push(countRow(
      `${label} · AppPlugin objects handed to datasource connect (${what}) · objects`,
      r.objectsAtConnect.length,
    ));
    rows.push(countRow(
      `${label} · AppPlugin ql.setDatasourceMapping (object routing) (${what}) · datasourceMapping`,
      r.datasourceMappingRules,
    ));
    rows.push(row(
      `${label} · AppPlugin translation loading into the i18n service (${what}) · translations`,
      r.i18nService ? 'i18n service registered' : 'no i18n service',
      !r.i18nService,
    ));
    rows.push(countRow(`${label} · AppPlugin seed datasets merged (${what}) · data`, r.seedDatasets));
  };
  bootRows('B1', 'compiled artifact', bootedFromArtifact);
  bootRows('B2', 'from source', bootedFromSource);

  return {
    rows,
    registryObjectsFromArtifact: bootedFromArtifact.registryObjects,
    registryObjectsFromSource: bootedFromSource.registryObjects,
  };
}
