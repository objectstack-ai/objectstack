// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 · #14242 road **B** — the ASSEMBLED package body has its own
 * declaration, and the artifact's `packages[]` refers to it.
 *
 * ## The defect this closes, stated as the measurement that found it
 *
 * `ArtifactPackageEntrySchema` wraps its body as `manifest: ManifestSchema`,
 * whose `objects` is `z.array(z.string())` — GLOB PATTERNS, the authoring-time
 * shape. What the ADR-0130 load path registers is an ASSEMBLED payload whose
 * `objects` are object DEFINITIONS. So a full parse of a real artifact entry
 * was refused:
 *
 *     ArtifactPackageEntrySchema.safeParse({ manifest: assembledBody })
 *       → success: false
 *       → manifest.objects.0: Invalid input: expected string, received object
 *
 * One schema was being asked to describe two lifecycle stages of one noun, and
 * the load path could only gate the wrapper as a result. The maintainer settled
 * it on 2026-09-02 (road B): declare the assembled stage as well. ⛔ Road C —
 * widening `ManifestSchema.objects` into a union of both spellings — was
 * rejected by name, because a union that accepts both stages makes NEITHER
 * stage checkable.
 *
 * ## What this file pins, and why each half is load-bearing
 *
 * 1. **The key set is DERIVED, not transcribed.** The assembled body carries
 *    every metadata collection the stack schema declares. Asserting a hand-
 *    written list here would be a second transcription of the very thing the
 *    implementation refuses to transcribe; instead the DIFFERENCE between the
 *    two schemas is pinned against the artifact-envelope keys, so a new stack
 *    collection is either on the body or fails this file.
 * 2. **Both stages still refuse the other's spelling** — the whole point of
 *    declaring two schemas rather than one tolerant one.
 * 3. **Composition is where assembly happens**, because it is the last moment
 *    per-package attribution exists: the composed stack flattens every
 *    collection to the top level, and a flattened array cannot say which
 *    package each item came from.
 * 4. **`plugins` / `devPlugins` are envelope keys** (#15219, maintainer ruling
 *    A for both keys, 2026-09-04): runtime assembly instructions, not metadata.
 *    They stay `concat` for in-memory composition and stay at the top level,
 *    and a body that carries one is REFUSED at the manifest's strict close —
 *    a plugin inside `packages[i].manifest` is inert JSON no loader could
 *    construct, so the alternative to refusal was a reader registering garbage.
 */

import { describe, it, expect } from 'vitest';

import {
  ArtifactPackageEntrySchema,
  ArtifactPackageSchema,
  AssembledPackageBodySchema,
  ObjectStackDefinitionSchema,
  composeStacks,
  defineStack,
  type ObjectStackDefinition,
} from './stack.zod';
import { ManifestSchema } from './kernel/manifest.zod';

/**
 * The keys that belong to the ARTIFACT or the DEPLOYMENT, never to one package
 * inside the artifact — the only stack keys the assembled body may lack.
 *
 * Spelled out here on purpose: this list is the reviewable half of the
 * derivation. The implementation derives the body's key set mechanically, so
 * what a reader cannot see there is which keys were deliberately left OUT —
 * and this test is where a newly added stack key has to be classified.
 */
const ARTIFACT_ENVELOPE_KEYS = [
  'manifest',      // the artifact's own identity (ADR-0130 D6 — one artifact, one version)
  'packages',      // the artifact carries packages; a package does not carry packages
  'api',           // deployment configuration read by `objectstack serve`/`dev`
  'server',        // deployment configuration
  'i18n',          // one artifact, one supported-locale declaration
  'runtimeModule', // written by the compiler, per ARTIFACT
  'onEnable',      // one bundle, one lifecycle hook (AppPlugin invokes a single one)
  'plugins',       // runtime assembly instructions a host hands to `kernel.use()` — not metadata (#15219 ruling A)
  'devPlugins',    // the `os dev` load list — the same class as `plugins` (#15219 ruling A)
].sort();

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();

// ─── Fixtures ───────────────────────────────────────────────────────

const coreManifest = {
  id: 'com.example.multi.core',
  name: 'core',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'crm',
};

const ordersManifest = {
  id: 'com.example.multi.orders',
  name: 'orders',
  version: '1.0.0',
  type: 'module' as const,
  namespace: 'crm',
  dependencies: { 'com.example.multi.core': '^1.0.0' },
};

const accountObject = {
  name: 'crm_account',
  label: 'Account',
  sharingModel: 'private' as const,
  fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } },
};

const orderObject = {
  name: 'crm_order',
  label: 'Order',
  sharingModel: 'private' as const,
  fields: { name: { name: 'name', type: 'text' as const, label: 'Number' } },
};

const coreStack = () => defineStack({ manifest: coreManifest, objects: [accountObject] });
const ordersStack = () => defineStack({ manifest: ordersManifest, objects: [orderObject] });

// ─── 1. The key set is derived ──────────────────────────────────────

describe('#14242 B — the assembled body carries the stack schema\'s collections, derived', () => {
  it('lacks exactly the artifact-envelope keys, and nothing else', () => {
    const stackKeys = shapeKeys(ObjectStackDefinitionSchema);
    const bodyKeys = shapeKeys(AssembledPackageBodySchema);

    // A positive first: the instruments see real key sets, so the set
    // difference below is a measurement rather than two empties agreeing.
    expect(stackKeys.length).toBeGreaterThan(30);
    expect(bodyKeys.length).toBeGreaterThan(30);

    expect(stackKeys.filter((k) => !bodyKeys.includes(k))).toEqual(ARTIFACT_ENVELOPE_KEYS);
  });

  it('carries every manifest field too, minus the three the assembled stage overrides', () => {
    const bodyKeys = shapeKeys(AssembledPackageBodySchema);
    const manifestKeys = shapeKeys(ManifestSchema);

    // Nothing from the manifest half is dropped: the assembled body is the
    // manifest PLUS collections, and an identity field that vanished here would
    // be a package the registry could not name.
    expect(manifestKeys.filter((k) => !bodyKeys.includes(k))).toEqual([]);

    // …and where the two halves declare the same key, the collection wins —
    // which is `AppPlugin`'s flatten order (`{ ...manifest, ...bundle }`)
    // stated as a declaration rather than re-derived at three seams.
    for (const overridden of ['objects', 'datasources', 'permissions']) {
      expect(manifestKeys, `${overridden} is a manifest key`).toContain(overridden);
      expect(bodyKeys, `${overridden} is on the assembled body`).toContain(overridden);
    }
  });
});

// ─── 2. Each stage refuses the other's spelling ─────────────────────

describe('#14242 B — two stages, two declarations, neither tolerant of the other', () => {
  const assembledBody = { ...coreManifest, objects: [accountObject] };
  const globBody = { ...coreManifest, objects: ['./src/objects/*.object.ts'] };

  it('the ASSEMBLED entry accepts a body whose `objects` are definitions', () => {
    const verdict = ArtifactPackageSchema.safeParse({ manifest: assembledBody });
    expect(verdict.success).toBe(true);
  });

  it('the AUTHORING entry still refuses that same body — the mismatch #14242 measured', () => {
    // Kept as a live measurement rather than prose: it is the reason two
    // declarations exist, and a widened authoring schema (road C) would turn
    // this green without anyone noticing the stages had merged.
    const verdict = ArtifactPackageEntrySchema.safeParse({ manifest: assembledBody });
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    expect(verdict.error.issues.map((i) => i.path.join('.'))).toContain('manifest.objects.0');
  });

  it('the ASSEMBLED entry refuses authoring GLOBS where definitions belong', () => {
    // The refusal the load gate exists for: a compiled artifact has no files
    // left to glob, so a glob here names nothing and would register an empty
    // package in silence.
    const verdict = ArtifactPackageSchema.safeParse({ manifest: globBody });
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    expect(verdict.error.issues.map((i) => i.path.join('.'))).toContain('manifest.objects.0');
  });

  it('a manifest-only entry is a valid assembled body — a package with no collections', () => {
    // What a hand-written entry is, and why one `packages` key can serve the
    // authoring and artifact stages without a union: the authoring form is an
    // INSTANCE of the assembled form, not a second branch of it.
    expect(ArtifactPackageSchema.safeParse({ manifest: coreManifest }).success).toBe(true);
    expect(ArtifactPackageEntrySchema.safeParse({ manifest: coreManifest }).success).toBe(true);
  });

  it('still refuses an inlined body — the wrapper position D4 reserves is intact', () => {
    expect(ArtifactPackageSchema.safeParse(assembledBody).success).toBe(false);
  });

  it('the body schema inherits the manifest door: an undeclared key on an assembled body is refused', () => {
    // This pin used to assert the opposite — "not strict, `ManifestSchema` has
    // never had that door" — and was true while the manifest was open.
    // `ManifestSchema` is closed now (`strictObject`), and `.extend()` carries
    // the closed posture and the error map onto the assembled body, so the
    // refusal is inherited rather than declared twice: a key that is neither a
    // manifest field nor a stack collection is refused at the load gate,
    // naming the key.
    const verdict = AssembledPackageBodySchema.safeParse({ ...coreManifest, somethingUndeclared: 1 });
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    const issue = verdict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect((issue as unknown as { keys: string[] }).keys).toEqual(['somethingUndeclared']);
  });
});

// ─── 3. Composition assembles, and the artifact schema takes it ─────

describe("ADR-0130 D4 — `manifest: 'preserve'` assembles each input stack", () => {
  const composed = (): ObjectStackDefinition =>
    composeStacks([ordersStack(), coreStack()], { manifest: 'preserve' });

  it('carries each package\'s OWN collections, not the flattened union', () => {
    const entries = (composed() as { packages?: { manifest: Record<string, unknown> }[] }).packages ?? [];
    expect(entries).toHaveLength(2);

    const byId = new Map(entries.map((e) => [e.manifest.id as string, e.manifest]));
    expect((byId.get('com.example.multi.core')?.objects as { name: string }[]).map((o) => o.name))
      .toEqual(['crm_account']);
    expect((byId.get('com.example.multi.orders')?.objects as { name: string }[]).map((o) => o.name))
      .toEqual(['crm_order']);

    // The flattened top level still carries BOTH — preserve is additive, and
    // the metadata service's artifact door reads exactly that top level.
    expect((composed().objects ?? []).map((o) => o.name).sort()).toEqual(['crm_account', 'crm_order']);
  });

  it('SEAM 1 — `defineStack` accepts the composed project', () => {
    // The authoring door full-parses `packages[]` through
    // `ObjectStackDefinitionSchema`. Before the assembled declaration this
    // refused a two-package config with `packages.0.manifest.objects.0:
    // Expected string but received object` — measured on `bd0ee2fb` by an
    // `os dev` boot — which is why the seam is pinned and not assumed.
    expect(() => defineStack(composed() as never)).not.toThrow();
  });

  it('SEAM 2/3 — the artifact schema parses it, and no collection is STRIPPED', () => {
    // `os compile` (`ObjectStackDefinitionSchema.safeParse`) and the metadata
    // service's artifact door (`_parseAndRegisterArtifact` →
    // `ObjectStackDefinitionSchema.parse`) are the same parse. Survival is
    // asserted, not just success: an undeclared key parses green and is
    // SILENTLY DROPPED, so "it parsed" says nothing about what came out.
    const result = ObjectStackDefinitionSchema.safeParse(composed());
    expect(result.success).toBe(true);
    if (!result.success) return;

    const parsed = result.data.packages ?? [];
    expect(parsed.map((p) => p.manifest.id)).toEqual([
      'com.example.multi.orders',
      'com.example.multi.core',
    ]);
    // An assembled body is `Record<string, unknown>` at the TYPE level (see the
    // note above `AssembledPackageBodySchema` — a named or element-precise
    // static type there leaked the whole stack declaration into every
    // consumer of `@objectstack/spec/system` and OOM'd their type-checks);
    // narrow at the point of use, as every reader of an assembled body does.
    const objectNames = (objects: unknown): string[] | undefined =>
      (objects as Array<{ name: string }> | undefined)?.map((o) => o.name);
    expect(objectNames(parsed[1].manifest.objects)).toEqual(['crm_account']);
    expect(objectNames(parsed[0].manifest.objects)).toEqual(['crm_order']);
  });
});

// ─── 4. `plugins` / `devPlugins` are envelope keys (#15219) ──────────

describe('#15219 A — `plugins` / `devPlugins` are envelope keys: top level only, never inside `packages[]`', () => {
  /** What a host hands to `kernel.use()` — a live instance, not metadata. */
  const livePlugin = { name: 'plugin.example', init: () => undefined };

  /** The unrecognized-keys issue a strict close raises, or undefined. */
  const unrecognizedKeys = (verdict: ReturnType<typeof AssembledPackageBodySchema.safeParse>) => {
    if (verdict.success) return undefined;
    const issue = verdict.error.issues.find((i) => i.code === 'unrecognized_keys');
    return issue
      ? { path: issue.path.map(String), keys: (issue as unknown as { keys: string[] }).keys }
      : undefined;
  };

  it('both keys are absent from the body key set while the stack schema still declares both', () => {
    const stackKeys = shapeKeys(ObjectStackDefinitionSchema);
    const bodyKeys = shapeKeys(AssembledPackageBodySchema);

    // The stack half first: an exclusion is only an exclusion if the key is
    // still there to be excluded — a key that vanished from the stack schema
    // would satisfy the body assertions below for the wrong reason.
    expect(stackKeys).toContain('plugins');
    expect(stackKeys).toContain('devPlugins');

    expect(bodyKeys).not.toContain('plugins');
    expect(bodyKeys).not.toContain('devPlugins');
  });

  it('a body carrying `plugins` is refused at the strict close, naming the key', () => {
    // Issue code + path + the key, never "it threw": the door is
    // `ManifestSchema`'s strict close carried through `.extend()`, and this is
    // the same instrument the `somethingUndeclared` pin above reads.
    const verdict = AssembledPackageBodySchema.safeParse({ ...coreManifest, plugins: [livePlugin] });
    expect(verdict.success).toBe(false);
    expect(unrecognizedKeys(verdict)).toEqual({ path: [], keys: ['plugins'] });
  });

  it('a body carrying `devPlugins` is refused the same way — serialisable or not, it is a load instruction', () => {
    const verdict = AssembledPackageBodySchema.safeParse({ ...coreManifest, devPlugins: ['@example/dev-tools'] });
    expect(verdict.success).toBe(false);
    expect(unrecognizedKeys(verdict)).toEqual({ path: [], keys: ['devPlugins'] });
  });

  it("through the artifact wrapper the refusal is located at `manifest` — the load gate's seam", () => {
    // `artifact-packages.ts` parses every `packages[]` entry with
    // `ArtifactPackageSchema`; this is the path its refusal message quotes.
    const verdict = ArtifactPackageSchema.safeParse({ manifest: { ...coreManifest, plugins: [livePlugin] } });
    expect(verdict.success).toBe(false);
    expect(unrecognizedKeys(verdict)).toEqual({ path: ['manifest'], keys: ['plugins'] });
  });

  it('composition keeps both at the top level (concat, in stack order) and out of every package body', () => {
    const core = defineStack({
      manifest: coreManifest,
      objects: [accountObject],
      plugins: [livePlugin],
      devPlugins: ['@example/dev-core'],
    });
    const orders = defineStack({
      manifest: ordersManifest,
      objects: [orderObject],
      plugins: [{ name: 'plugin.orders' }],
      devPlugins: ['@example/dev-orders'],
    });

    const composed = composeStacks([core, orders], { manifest: 'preserve' });

    // Live stacks still concatenate their plugins to the top level — the
    // `concat` disposition is untouched by the envelope exclusion.
    expect((composed.plugins as { name: string }[]).map((p) => p.name)).toEqual(['plugin.example', 'plugin.orders']);
    expect(composed.devPlugins).toEqual(['@example/dev-core', '@example/dev-orders']);

    // …and no package body carries either: the assembler reads the derived
    // body shape, so the exclusion reaches composition without a second list.
    const entries = (composed as { packages?: { manifest: Record<string, unknown> }[] }).packages ?? [];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.manifest, `${entry.manifest.id} carries plugins`).not.toHaveProperty('plugins');
      expect(entry.manifest, `${entry.manifest.id} carries devPlugins`).not.toHaveProperty('devPlugins');
    }

    // SEAM 2/3 for a plugin-carrying host: the composed artifact parses, and
    // the top-level plugins survive the parse.
    const parsed = ObjectStackDefinitionSchema.safeParse(composed);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.plugins).toHaveLength(2);
    expect(parsed.data.devPlugins).toEqual(['@example/dev-core', '@example/dev-orders']);
  });
});
