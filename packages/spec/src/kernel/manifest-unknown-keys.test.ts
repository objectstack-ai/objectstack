// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ManifestSchema` refuses unknown keys — the #8687 door one level down.
 *
 * ## The measurement this file inverts
 *
 * Measured on `origin/main` (17.2.0, from `src` and through the built `dist`,
 * identical): an unknown key inside `manifest:` parsed green and was silently
 * DROPPED at every door that reaches this schema — the stack `manifest:`
 * member (`defineStack` / `os validate` / `os compile`), `devPlugins[]`, the
 * artifact `packages[]` entry (authoring and assembled), `os plugin build`,
 * the `InstalledPackage` row schema and the package request shapes that embed
 * it. A transposed `namesapce` therefore left `manifest.namespace`
 * `undefined` with exit 0, and that key decides every object's table name,
 * REST path and the install-time namespace gate. One level further down the
 * same held for `contributes.kind` (for `kinds`), `contributes.kinds[].glob`
 * and `engines.protocl` (for `protocol`, which switched the load-time
 * protocol handshake off in silence).
 *
 * ## Rejection-pin convention (the standing minimum)
 *
 * Each rejection asserts the Zod issue's **`code` and `path`** and the
 * offending key via `keys`. `status` is the publish door's uniform wrap — the
 * ADR-0112 envelope is applied where a parse failure crosses the HTTP
 * boundary, not minted per-schema — so at this layer it is the family
 * convention rather than an assertion (the `stack-top-level-strict.test.ts`
 * precedent).
 *
 * ## What is deliberately NOT here
 *
 * The retired keys' prescriptions are pinned by their own retirement files
 * (`manifest.test.ts`, `plugin-loading-retirement.test.ts`); this file pins
 * only that closing the surface did not change them — a tombstone still
 * answers with its prescription, and a typo is never pointed at one.
 */

import { describe, it, expect } from 'vitest';

import { ManifestSchema, PluginEnginesSchema } from './manifest.zod';
import { ArtifactPackageSchema, ObjectStackDefinitionSchema } from '../stack.zod';

/** A legal manifest, the shape every scaffold and example stamps. */
const legal = () => ({
  id: 'com.example.probe',
  namespace: 'probe',
  version: '1.0.0',
  type: 'app' as const,
  name: 'Probe',
  description: 'A legal manifest',
  engines: { protocol: '^17' },
});

const unrecognized = (result: ReturnType<typeof ManifestSchema.safeParse>) => {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.code === 'unrecognized_keys') as
    | (typeof result.error.issues[number] & { keys: string[] })
    | undefined;
};

describe("#14192 — unknown keys inside `manifest:` are refused at parse (the card's measurement, inverted)", () => {
  it('a transposed `namesapce` is a named refusal carrying the rename — not an undefined namespace', () => {
    // The card's own measurement: parse success, key dropped, namespace undefined.
    const { namespace: _omitted, ...withoutNamespace } = legal();
    const result = ManifestSchema.safeParse({ ...withoutNamespace, namesapce: 'probe' });

    expect(result.success, 'the typo must refuse at parse').toBe(false);
    const issue = unrecognized(result);
    expect(issue, 'the refusal is an unrecognized_keys issue').toBeDefined();
    expect(issue!.code).toBe('unrecognized_keys');
    // Raised at the manifest root — the block the author wrote.
    expect(issue!.path).toEqual([]);
    expect(issue!.keys).toEqual(['namesapce']);
    expect(issue!.message).toContain('Unrecognized key(s) on this package manifest: `namesapce`');
    // The near-miss guidance rides the refusal itself (the #8687 shape).
    expect(issue!.message).toContain('Did you mean `namesapce` → `namespace`?');
  });

  it('an arbitrary unknown key is refused, naming the surface and where the legal keys live', () => {
    const result = ManifestSchema.safeParse({ ...legal(), zzzBogusManifestKey: 1 });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.path).toEqual([]);
    expect(issue.keys).toEqual(['zzzBogusManifestKey']);
    expect(issue.message).toContain('this package manifest');
    expect(issue.message).toContain('ManifestSchema');
    // Nothing within edit distance — no invented rename.
    expect(issue.message).not.toContain('Did you mean');
  });

  it('positive control: the same manifest without the stray key parses green, byte-for-byte on the declared keys', () => {
    const result = ManifestSchema.safeParse(legal());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject(legal());
  });

  it('answers the retired CLI advisory axis `specVersion` with the wrong-layer pointer, not a rename', () => {
    // `os doctor` / `os lint` used to read `manifest.specVersion`; the axis is
    // `engines.protocol` now and the key was dropped in silence until this close.
    const result = ManifestSchema.safeParse({ ...legal(), specVersion: '^12.0.0' });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.keys).toEqual(['specVersion']);
    expect(issue.message).toContain('engines.protocol');
    expect(issue.message).not.toContain('Did you mean');
  });
});

describe('#14192 — the refusal reaches every door the measurement listed', () => {
  const typo = () => {
    const { namespace: _omitted, ...rest } = legal();
    return { ...rest, namesapce: 'probe' };
  };

  it('through the stack `manifest:` member (`defineStack` / `os validate` / `os compile`)', () => {
    const result = ObjectStackDefinitionSchema.safeParse({ manifest: typo() });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys') as
      | { path: (string | number)[]; keys: string[] }
      | undefined;
    expect(issue).toBeDefined();
    expect(issue!.path).toEqual(['manifest']);
    expect(issue!.keys).toEqual(['namesapce']);
  });

  it('through the assembled artifact `packages[]` entry — the load gate inherits the door via `.extend()`', () => {
    const body = {
      ...typo(),
      objects: [{ name: 'probe_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }],
    };
    const result = ArtifactPackageSchema.safeParse({ manifest: body });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys') as
      | { path: (string | number)[]; keys: string[] }
      | undefined;
    expect(issue).toBeDefined();
    expect(issue!.path).toEqual(['manifest']);
    expect(issue!.keys).toEqual(['namesapce']);
  });

  it('through `devPlugins[]` — refused, with the refusal nested inside the union issue', () => {
    // `devPlugins` is `z.union([ManifestSchema, z.string()])`: a manifest object
    // carrying an unknown key now fails BOTH branches, so the top-level issue is
    // `invalid_union` and the named refusal sits in its nested `errors`. Stated
    // here because it is what an author sees at this door: loud, but one level
    // deeper than the other doors (the state-machine row's known flattening
    // limitation, not a silent strip).
    const result = ObjectStackDefinitionSchema.safeParse({ manifest: legal(), devPlugins: [typo()] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const union = result.error.issues.find((i) => i.code === 'invalid_union') as
      | { path: (string | number)[]; errors: Array<Array<{ code: string; keys?: string[] }>> }
      | undefined;
    expect(union).toBeDefined();
    expect(union!.path).toEqual(['devPlugins', 0]);
    const nested = union!.errors.flat().find((i) => i.code === 'unrecognized_keys');
    expect(nested, 'the named refusal is carried inside the union issue').toBeDefined();
    expect(nested!.keys).toEqual(['namesapce']);
  });
});

describe('#14192 — the nested blocks inside `manifest:` are closed under the same measurement', () => {
  it('`contributes.kind` (for `kinds`) is refused at the block, with the rename', () => {
    const result = ManifestSchema.safeParse({ ...legal(), contributes: { kind: [{ id: 'sys.bi.report' }] } });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.path).toEqual(['contributes']);
    expect(issue.keys).toEqual(['kind']);
    expect(issue.message).toContain('Did you mean `kind` → `kinds`?');
  });

  it('`contributes.kinds[].glob` is refused at the entry — and is NOT pointed at the retired `globs` tombstone', () => {
    const result = ManifestSchema.safeParse({
      ...legal(),
      contributes: { kinds: [{ id: 'sys.bi.report', glob: ['**/*.report.ts'] }] },
    });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.path).toEqual(['contributes', 'kinds', 0]);
    expect(issue.keys).toEqual(['glob']);
    // `acceptsNothing`: a tombstone stays in the shape (writing it raises its
    // prescription) but never becomes a rename target — otherwise the fix
    // would signpost the author into a second rejection. (`glob` is one edit
    // from `globs`, so a rename channel that still saw the tombstone WOULD
    // offer it; the block's `history` sentence names `globs` only to say it is
    // retired.)
    expect(issue.message).not.toContain('Did you mean');
  });

  it('`engines.protocl` (for `protocol`) is refused at the block — the handshake range can no longer vanish in silence', () => {
    const result = ManifestSchema.safeParse({ ...legal(), engines: { protocl: '^17' } });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.path).toEqual(['engines']);
    expect(issue.keys).toEqual(['protocl']);
    expect(issue.message).toContain('Did you mean `protocl` → `protocol`?');
    // The exported block schema is the same door.
    expect(PluginEnginesSchema.safeParse({ protocl: '^17' }).success).toBe(false);
  });

  it('the legacy `engine.objectstak` is refused at the block', () => {
    const result = ManifestSchema.safeParse({ ...legal(), engine: { objectstack: '>=17.0.0', objectstak: '>=1.0.0' } });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.path).toEqual(['engine']);
    expect(issue.keys).toEqual(['objectstak']);
  });

  it('positive control: the live nested members still parse and are kept', () => {
    const parsed = ManifestSchema.parse({
      ...legal(),
      contributes: { kinds: [{ id: 'sys.bi.report', description: 'BI report kind' }] },
      engine: { objectstack: '>=17.0.0' },
      engines: { platform: '>=17.0.0 <18', protocol: '^17' },
    });
    expect(parsed.contributes?.kinds).toEqual([{ id: 'sys.bi.report', description: 'BI report kind' }]);
    expect(parsed.engine).toEqual({ objectstack: '>=17.0.0' });
    expect(parsed.engines).toEqual({ platform: '>=17.0.0 <18', protocol: '^17' });
  });
});

describe('#14192 — the accept side does not move, and `main` is declared', () => {
  it('every live key parses and survives — the whole declared vocabulary in one manifest', () => {
    const full = {
      ...legal(),
      defaultDatasource: 'memory',
      scope: 'project' as const,
      permissions: { services: ['object'], hooks: ['record.beforeInsert'] },
      objects: ['./src/objects/*.object.ts'],
      datasources: ['./src/datasources/*.datasource.yml'],
      dependencies: { '@objectstack/plugin-auth': '^2.0.0' },
      contributes: { kinds: [{ id: 'sys.bi.report' }] },
      data: [],
      navigationContributions: [
        { app: 'setup', items: [{ id: 'nav_x', type: 'url' as const, label: 'X', url: '/x' }] },
      ],
      engine: { objectstack: '>=17.0.0' },
      runtime: 'sandbox' as const,
      packaging: 'bundled' as const,
      main: 'src/index.ts',
      integrity: { 'dist/index.mjs': 'sha256-x' },
    };
    const result = ManifestSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const key of Object.keys(full)) {
      expect(result.data, `${key} must survive the parse`).toHaveProperty(key);
    }
  });

  it('`main` is accepted in both shapes the `os plugin build` door produces — the source manifest and the compiled one', () => {
    // Source: the author names the entry. Compiled: the build rewrites it to
    // the bundle and adds `integrity`. Both went through this schema
    // undeclared before the close; a naked `strictObject` would have refused
    // every plugin that names its entry.
    const source = ManifestSchema.safeParse({ ...legal(), type: 'plugin', main: 'src/index.ts' });
    expect(source.success).toBe(true);
    if (source.success) expect(source.data.main).toBe('src/index.ts');

    const compiled = ManifestSchema.safeParse({
      ...legal(),
      type: 'plugin',
      main: 'dist/index.mjs',
      integrity: { 'dist/index.mjs': 'sha256-x' },
    });
    expect(compiled.success).toBe(true);
    if (compiled.success) expect(compiled.data.main).toBe('dist/index.mjs');
  });

  it('a retired key still answers with its tombstone prescription — closing the surface did not replace it with a bare refusal', () => {
    for (const [key, value] of [
      ['loading', { strategy: 'lazy' }],
      ['capabilities', { implements: [] }],
      ['configuration', { title: 'Cfg' }],
      ['extensions', { a: 1 }],
    ] as const) {
      const result = ManifestSchema.safeParse({ ...legal(), [key]: value });
      expect(result.success, `${key} must refuse`).toBe(false);
      if (result.success) continue;
      // The tombstone's own issue, at the key, carrying the removal record —
      // and NO unrecognized_keys issue: the key is declared (as `never`), not unknown.
      const tombstone = result.error.issues.find((i) => i.path[0] === key);
      expect(tombstone, `${key} answers at its own path`).toBeDefined();
      expect(tombstone!.message).toMatch(new RegExp(`manifest\\.${key}.*removed in @objectstack/spec 17`, 's'));
      expect(unrecognized(result), `${key} is a tombstone, not an unknown key`).toBeUndefined();
    }
  });

  it('a near miss of a retired key is refused WITHOUT being pointed at the tombstone', () => {
    // `capabilitis` is one keystroke from the retired `capabilities`. The rename
    // channel must not send the author there — the second rejection would tell
    // them to delete what they were just told to write.
    const result = ManifestSchema.safeParse({ ...legal(), capabilitis: {} });
    expect(result.success).toBe(false);
    const issue = unrecognized(result)!;
    expect(issue.keys).toEqual(['capabilitis']);
    expect(issue.message).not.toContain('`capabilities`');
  });
});
