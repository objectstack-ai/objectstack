// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `packaging: 'manifest-deps'` is RETIRED — `bundled` is a plugin manifest's
 * one packaging strategy (ADR-0025 v2 §3.3, maintainer decision Q6; ADR-0049
 * enforce-or-remove; ADR-0087 conversion `manifest-packaging-manifest-deps-removed`,
 * D3 entry `manifest-packaging-manifest-deps-retired`).
 *
 * The strategy existed on the build side only: `os plugin build` left the
 * `package.json` dependencies out of the bundle and packed `package.json` +
 * `pnpm-lock.yaml` "for install-time resolution", and nothing ever installed
 * them — `os plugin install` and the boot-time loader unpack and import
 * `dist/index.mjs` as it is. The build forks are gone, so the value is too.
 *
 * What this file holds, in the order an upgrading author meets it:
 *
 *   1. `PluginPackagingSchema` is exactly `['bundled']`, and the parse refuses
 *      `manifest-deps` BY NAME with its prescription (`enumWithRetiredValues`)
 *      on every carrier of `ManifestSchema` — the manifest itself, a stack's
 *      `manifest`, an artifact's `packages[].manifest`;
 *   2. TypeScript refuses it at the authoring site;
 *   3. `bundled` and an absent key still parse, and the key takes no default;
 *   4. the D2 conversion strips the retired value from a stack's manifest and
 *      each `packages[].manifest`, is idempotent, and is NOT replayed on the
 *      authoring funnel; its D3 entry names it;
 *   5. tree-scoped absence: nothing inside the spec package's declared radius
 *      still authors the retired value.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the
 * doors), so each schema refusal is pinned by the issue `code`, the `path` and
 * the prescription's first sentence; the `defineStack` door adds the envelope's
 * `code` + `status`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import { applyConversions } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';
import { normalizeStackInput } from '../shared/metadata-collection.zod';
import { ArtifactPackageEntrySchema, defineStack } from '../stack.zod';
import { ManifestSchema, PluginPackagingSchema, type ObjectStackManifest } from './manifest.zod';

const CONVERSION_ID = 'manifest-packaging-manifest-deps-removed';
const D3_ID = 'manifest-packaging-manifest-deps-retired';

const FIRST_SENTENCE =
  "`packaging: 'manifest-deps'` was removed in @objectstack/spec 18.3.0 (ADR-0025 v2 §3.3, ADR-0049 "
  + 'enforce-or-remove) — nothing ever installed the dependencies it left out of the bundle, so a plugin '
  + 'built with it could not load them.';
const FIX = 'Delete the key: `bundled` is the default and the only strategy';
const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 17` to list the mechanical edits for the stack manifest case;';

const legal = () => ({
  id: 'com.example.probe',
  namespace: 'probe',
  version: '1.0.0',
  type: 'plugin' as const,
  name: 'Probe',
});

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; error?: { issues: Issue[] } };

/** Every carrier of `ManifestSchema`, with the issue path `packaging` sits at. */
const DOORS: ReadonlyArray<{ name: string; parse: (packaging: unknown) => Parse; at: PropertyKey[] }> = [
  { name: 'ManifestSchema', parse: (p) => ManifestSchema.safeParse({ ...legal(), packaging: p }) as Parse, at: ['packaging'] },
  {
    name: 'ArtifactPackageEntrySchema (packages[].manifest)',
    parse: (p) => ArtifactPackageEntrySchema.safeParse({ manifest: { ...legal(), packaging: p } }) as Parse,
    at: ['manifest', 'packaging'],
  },
];

const samePath = (a: PropertyKey[], b: PropertyKey[]) => a.length === b.length && a.every((seg, i) => seg === b[i]);

describe('manifest.packaging — `bundled` is the one strategy', () => {
  it('the vocabulary is exactly `bundled`', () => {
    expect(PluginPackagingSchema.options).toEqual(['bundled']);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses `manifest-deps` at `packaging`, with its prescription', (_, door) => {
    const r = door.parse('manifest-deps');
    expect(r.success).toBe(false);
    const issues = (r.error?.issues ?? []).filter((i) => samePath(i.path, door.at));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_value');
    expect(issues[0]!.message.startsWith(FIRST_SENTENCE), issues[0]!.message).toBe(true);
    expect(issues[0]!.message).toContain(FIX);
    expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
  });

  it('CONTROL: a misspelt value keeps zod\'s own message — "was removed" would misinform its author', () => {
    const r = ManifestSchema.safeParse({ ...legal(), packaging: 'bundle' }) as Parse;
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => samePath(i.path, ['packaging']));
    expect(issue!.code).toBe('invalid_value');
    expect(issue!.message).not.toContain('was removed');
  });

  it('`bundled` parses, and an absent key stays absent — no default is materialized', () => {
    expect(ManifestSchema.parse({ ...legal(), packaging: 'bundled' }).packaging).toBe('bundled');
    expect(ManifestSchema.parse({ ...legal() }).packaging).toBeUndefined();
  });

  it('defineStack refuses `manifest-deps` with the ADR-0112 envelope and the prescription', () => {
    let refusal: unknown;
    try {
      defineStack({ manifest: { ...legal(), packaging: 'manifest-deps' } } as never);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    const issues = (refusal as { issues: Issue[] }).issues;
    expect(issues.map((i) => i.path.join('.'))).toEqual(['manifest.packaging']);
    expect(issues[0]!.message.startsWith(FIRST_SENTENCE)).toBe(true);
    for (const manifest of [{ ...legal(), packaging: 'bundled' }, { ...legal() }]) {
      expect(() => defineStack({ manifest } as never)).not.toThrow();
    }
  });

  it('fails tsc at the authoring site: the retired value is not in the input type', () => {
    const manifest: ObjectStackManifest = {
      ...legal(),
      // @ts-expect-error — `manifest-deps` left `PluginPackagingSchema`; only `bundled` type-checks.
      packaging: 'manifest-deps',
    };
    const packaging: z.input<typeof PluginPackagingSchema> = 'bundled';
    expect(ManifestSchema.safeParse(manifest).success).toBe(false);
    expect(PluginPackagingSchema.safeParse(packaging).success).toBe(true);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

const replay = (stack: Record<string, unknown>) => {
  const notices: ConversionNotice[] = [];
  const out = applyConversions(stack, { includeRetired: true, onNotice: (n) => notices.push(n) });
  return { out, notices: notices.filter(ours) };
};

describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('strips the retired value from a stack\'s manifest and from each `packages[].manifest`, and only there', () => {
    const stack = {
      manifest: { id: 'com.acme.x', packaging: 'manifest-deps', runtime: 'node' },
      packages: [
        { manifest: { id: 'com.acme.a', packaging: 'manifest-deps' } },
        // The live value is the author's and rides through untouched.
        { manifest: { id: 'com.acme.b', packaging: 'bundled' } },
      ],
    };
    const { out, notices } = replay(structuredClone(stack));
    expect(out.manifest).toEqual({ id: 'com.acme.x', runtime: 'node' });
    expect(out.packages).toEqual([
      { manifest: { id: 'com.acme.a' } },
      { manifest: { id: 'com.acme.b', packaging: 'bundled' } },
    ]);
    expect(notices.map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'manifest.packaging', from: 'manifest-deps', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'packages[0].manifest.packaging', from: 'manifest-deps', to: '(removed)' },
    ]);
    // The converted manifests are ones the strict door accepts.
    expect(ManifestSchema.safeParse({ ...legal(), ...(out.manifest as object) }).success).toBe(true);
  });

  it('leaves a stack without the retired value as it is (copy-on-write: the same reference)', () => {
    const stack = { manifest: { id: 'com.acme.x', packaging: 'bundled' }, packages: [{ manifest: { id: 'com.acme.y' } }] };
    const { out, notices } = replay(stack);
    expect(notices).toEqual([]);
    expect(out.manifest).toBe(stack.manifest);
    expect(out.packages).toBe(stack.packages);
  });

  it('is idempotent — the converted stack replays to itself with nothing applied', () => {
    const once = replay({ manifest: { id: 'com.acme.x', packaging: 'manifest-deps' } }).out;
    const twice = replay(once);
    expect(twice.out).toBe(once);
    expect(twice.notices).toEqual([]);
  });

  it('⛔ is NOT replayed on the authoring funnel — an author meets the refusal, never a silent rewrite', () => {
    const notices: ConversionNotice[] = [];
    const authored = { manifest: { ...legal(), packaging: 'manifest-deps' } };
    const out = normalizeStackInput(structuredClone(authored), { onConversionNotice: (n) => notices.push(n) });
    expect((out.manifest as { packaging?: unknown }).packaging).toBe('manifest-deps');
    expect(notices.filter(ours)).toEqual([]);
  });

  it('is wired into the step-18 chain as a retired entry stamped after 18.2.0', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toBe('18.2.0');
  });

  it(`carries the D3 entry ${D3_ID}, naming its D2 conversion`, () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entries[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps the TYPED authoring sites; this walk covers every text file
// under the five repo roots `scripts/cross-package-test-inputs.mjs` declares
// for `@objectstack/spec#test` (mirrored in `turbo.json`), with the example
// apps' own `src/` trees. It judges the AUTHORING SHAPE: a `packaging` key
// (TS / JS / JSON, or a fenced block in Markdown) whose value is the retired
// one. The bound, stated: a value assembled by spread or a computed key, YAML,
// `docs/` (the ADR and the design note record the retirement and sit outside
// this radius) and the console under `ui/` are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors `manifest-deps`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const AUTHORING = /["']?packaging["']?\s*:\s*["']manifest-deps["']/;
  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): boolean => AUTHORING.test(stripInlineCode(text));

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired value.
   */
  const EXCLUDED = new Set([
    // This pin authors the value to assert its refusal and its conversion.
    THIS_FILE,
    // The removal-version pin parses the retired value to read its prescription.
    'packages/spec/src/shared/retired-key-removal-version.pin.test.ts',
    // The build door's own pin authors it to assert `os plugin build` refuses it.
    'packages/cli/test/plugin-build-bundled-only.test.ts',
    // The install door's own pin authors it to assert `os plugin install` refuses it before unpacking.
    'packages/cli/src/commands/plugin/install.integration.test.ts',
    // The publish door's own pin authors it to assert `os plugin publish` refuses it before any upload.
    'packages/cli/test/plugin-publish.test.ts',
    // The boot loader's own pin authors it to assert a pre-retirement install is refused by name.
    'packages/runtime/src/installed-plugin-loader.test.ts',
    // The `os serve` boot pin authors it to assert a pre-retirement install is refused at boot, not imported.
    'packages/cli/test/serve-installed-plugins.integration.test.ts',
    // The D3 entry's `surface` names the value it retires.
    'packages/spec/src/migrations/entries/semantic/18.manifest-packaging-manifest-deps-retired.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement manifests on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores its neighbours (anti-vacuity)', () => {
    expect(judge("manifest: { id: 'com.acme.x', packaging: 'manifest-deps' },")).toBe(true);
    expect(judge('{ "id": "com.acme.x", "packaging": "manifest-deps" }')).toBe(true);
    expect(judge("Prose.\n\n```json\n{ \"packaging\": \"manifest-deps\" }\n```\n")).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("manifest: { packaging: 'bundled' },")).toBe(false);
    expect(judge('the manifest-deps strategy was retired')).toBe(false);
    expect(judge("a manifest once wrote `packaging: 'manifest-deps'`.")).toBe(false);
  });

  it('no `packaging` key authoring the retired value survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let mentioning = 0;
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        const ext = path.extname(name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        if (/["']?packaging["']?\s*:\s*["']bundled["']/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author a
    // packaging value were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(3);
    expect(offenders, 'a manifest authoring `manifest-deps` means the retirement is being undone').toEqual([]);
  });
});
