// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ENVIRONMENT_ARTIFACT_SCHEMA_VERSION,
  EnvironmentArtifactSchema,
  Sha256DigestSchema,
} from './environment-artifact.zod';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
  maybeOriginOf,
  originFileOf,
  originOf,
  originsOf,
} from '../../scripts/lib/export-origins-testkit';
// ─── [#4740] `EnvironmentArtifact(Schema)` has ONE declaration — ./system ───
//
// `./cloud` and `./system` both exported `EnvironmentArtifact` /
// `EnvironmentArtifactInput` (as it was then spelled) / `EnvironmentArtifactSchema` for two DIFFERENT
// declarations (the #4411 trap — which shape a consumer got depended only on
// the import path):
//
//   cloud/environment-artifact.zod.ts (pre-#4740) → the LIVE wire shape:
//     string SHA-256 `checksum`, `metadata` = ObjectStackDefinitionSchema.
//     The one runtime Zod parse of the envelope
//     (packages/metadata/src/plugin.ts `_parseAndRegisterArtifact`) and all
//     cloud-repo type imports used this side.
//   system/environment-artifact.zod.ts (pre-#4740) → a documented richer
//     "v0": `{ algorithm, value }` checksum object, category-bag `metadata`,
//     inlined `functions[]`, required `manifest`, reserved `payloadRef` —
//     NEVER implemented by any producer or consumer in any repo
//     (objectstack / cloud / objectui). The two sides could not parse each
//     other's artifacts.
//
// Maintainer ruling on #4740 (ledger #4535 C10): route A′ — converge on the
// live wire shape as the SINGLE declaration in ./system, with ./cloud
// re-exporting it (zero migration for the live consumers). Unlike C16
// (#4739), the re-export is the SANCTIONED route here: both entries must
// keep the name, but must resolve it to the ONE ./system declaration. A
// fresh declaration on ./cloud is the forbidden route (S2 sabotage below).
//
// #4642 established that a compile-time conditional-type pin in this package
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR.

/** Every export name of the retired, never-implemented v0 artifact family. */
const RETIRED_V0_FAMILY = [
  'EnvironmentArtifactChecksum', 'EnvironmentArtifactChecksumSchema',
  'EnvironmentArtifactFunction', 'EnvironmentArtifactFunctionSchema',
  'EnvironmentArtifactFunctionLanguage', 'EnvironmentArtifactFunctionLanguageEnum',
  'EnvironmentArtifactHashAlgorithm', 'EnvironmentArtifactHashAlgorithmEnum',
  'EnvironmentArtifactManifest', 'EnvironmentArtifactManifestSchema',
  'EnvironmentArtifactMetadata', 'EnvironmentArtifactMetadataSchema',
  'EnvironmentArtifactPayloadRef', 'EnvironmentArtifactPayloadRefSchema',
  'EnvironmentArtifactRequirement', 'EnvironmentArtifactRequirementSchema',
] as const;

describe('[#4740] `EnvironmentArtifact(Schema)` resolves to the ./system declaration everywhere', () => {
  it('resolves the export surface: one declaration in ./system, ./cloud re-exports it, the v0 family is gone', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    expect(EXPORT_ENTRY_POINTS).toContain('./cloud');
    expect(EXPORT_ENTRY_POINTS).toContain('./system');
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. The surviving declaration: `./system` exports the envelope, declared
    //    in system/environment-artifact.zod.ts — and still exports a
    //    non-trivial surface, so the `not.toContain` checks below cannot pass
    //    by resolving nothing.
    const systemNames = exportNamesOf('./system');
    expect(systemNames.length, './system must export a non-trivial surface').toBeGreaterThan(100);
    // `EnvironmentArtifactInput` was retired by ADR-0122 phase 2 (#6083) — the
    // bare name IS the author state now, and the parsed state moved onto
    // `EnvironmentArtifactParsed`. The pin follows the surviving names: the
    // dual-source hazard is about WHICH DECLARATION a name resolves to, so it
    // must track the names that exist, not the ones that used to.
    const names = ['EnvironmentArtifact', 'EnvironmentArtifactParsed', 'EnvironmentArtifactSchema'] as const;
    const canonical: Record<string, string> = {};
    for (const name of names) {
      expect(maybeOriginOf('./system', name), `./system must export \`${name}\``).toBeDefined();
      expect(originFileOf('./system', name)).toBe('src/system/environment-artifact.zod.ts');
      canonical[name] = originOf('./system', name);
    }

    // 2. The re-exporting side: `./cloud` keeps every pre-#4740 name, but
    //    each resolves to the SAME ./system declaration — the sanctioned
    //    route A′. A fresh cloud-side declaration flips this red (S2).
    for (const name of names) {
      expect(maybeOriginOf('./cloud', name), `./cloud must keep exporting \`${name}\``).toBeDefined();
      expect(
        originOf('./cloud', name),
        `./cloud must resolve \`${name}\` to the ./system declaration`,
      ).toBe(canonical[name]);
    }
    // `Sha256Digest(Schema)` moved with the declaration; ./cloud keeps it by
    // re-export too.
    for (const name of ['Sha256Digest', 'Sha256DigestSchema']) {
      expect(maybeOriginOf('./system', name), `./system must export \`${name}\``).toBeDefined();
      expect(maybeOriginOf('./cloud', name), `./cloud must keep exporting \`${name}\``).toBeDefined();
      expect(originOf('./cloud', name)).toBe(originOf('./system', name));
      expect(originFileOf('./system', name)).toBe('src/system/environment-artifact.zod.ts');
    }

    // 3. Uniqueness — the dual-source pin proper: across EVERY public entry,
    //    an export named `EnvironmentArtifact(Parsed|Schema)` must resolve to
    //    the ONE ./system declaration. Re-adding a second declaration under
    //    any entry (S1/S2 sabotage) turns this red.
    for (const name of names) {
      expect(
        originsOf(name),
        `every entry must resolve \`${name}\` to the ./system declaration`,
      ).toEqual([canonical[name]]);
    }

    // 4. The retired v0 family exists in NO entry any more.
    for (const gone of RETIRED_V0_FAMILY) {
      expect(holdersOf(gone), `no entry may name ${gone}`).toEqual([]);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const cloud = await import('../cloud/index');
    const system = await import('./index');
    // Re-export means the very same binding, not a lookalike.
    expect(cloud.EnvironmentArtifactSchema).toBe(system.EnvironmentArtifactSchema);
    expect(cloud.Sha256DigestSchema).toBe(system.Sha256DigestSchema);
    for (const gone of RETIRED_V0_FAMILY) {
      expect(gone in cloud, `cloud must not export ${gone}`).toBe(false);
      expect(gone in system, `system must not export ${gone}`).toBe(false);
    }
  });
});

// ─── Wire-shape behavior ────────────────────────────────────────────────────

const WIRE_CHECKSUM = '0123456789abcdef'.repeat(4); // 64 lowercase hex chars

const wireMinimal = {
  schemaVersion: ENVIRONMENT_ARTIFACT_SCHEMA_VERSION,
  environmentId: 'proj_01HABCDE',
  commitId: 'commit_01HABCDE',
  checksum: WIRE_CHECKSUM,
  metadata: {
    objects: [{ name: 'account', label: 'Account', fields: {} }],
  },
};

describe('EnvironmentArtifactSchema (wire shape)', () => {
  it('accepts a minimal control-plane artifact', () => {
    const parsed = EnvironmentArtifactSchema.parse(wireMinimal);
    expect(parsed.schemaVersion).toBe('0.1');
    expect(parsed.checksum).toBe(WIRE_CHECKSUM);
    expect(parsed.metadata.objects?.[0]?.name).toBe('account');
  });

  it('defaults schemaVersion and rejects unknown versions', () => {
    const { schemaVersion: _omit, ...rest } = wireMinimal;
    expect(EnvironmentArtifactSchema.parse(rest).schemaVersion).toBe('0.1');
    expect(EnvironmentArtifactSchema.safeParse({ ...wireMinimal, schemaVersion: '9.9' }).success).toBe(false);
  });

  it('accepts optional builtAt / builtWith provenance', () => {
    const parsed = EnvironmentArtifactSchema.parse({
      ...wireMinimal,
      builtAt: '2026-04-26T00:00:00Z',
      builtWith: 'objectstack-cli@0.4.0',
    });
    expect(parsed.builtAt).toBe('2026-04-26T00:00:00Z');
  });

  it('validates metadata as an ObjectStackDefinition, not an opaque bag', () => {
    expect(
      EnvironmentArtifactSchema.safeParse({ ...wireMinimal, metadata: { objects: 'not-an-array' } }).success,
    ).toBe(false);
    expect(EnvironmentArtifactSchema.safeParse({ ...wireMinimal, metadata: [] }).success).toBe(false);
  });

  // ⚠ #4666 pin — the checksum object→string convergence is a TYPE change
  // invisible to the key-level authorable-surface gates (`checksum` exists in
  // both shapes). These parses are the gate for it.
  describe('checksum is a 64-char hex STRING (#4666 pin)', () => {
    it('accepts a 64-char lowercase hex digest', () => {
      expect(Sha256DigestSchema.parse(WIRE_CHECKSUM)).toBe(WIRE_CHECKSUM);
    });

    it('rejects the retired `{ algorithm, value }` checksum object', () => {
      const result = EnvironmentArtifactSchema.safeParse({
        ...wireMinimal,
        checksum: { algorithm: 'sha256', value: WIRE_CHECKSUM },
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-64-char, uppercase and non-hex values', () => {
      for (const bad of ['abc123', WIRE_CHECKSUM.slice(0, 63), WIRE_CHECKSUM.toUpperCase(), 'not-hex']) {
        expect(Sha256DigestSchema.safeParse(bad).success, `must reject ${JSON.stringify(bad)}`).toBe(false);
      }
    });
  });

  // The v0 keys are tombstoned, not silently stripped: authoring one raises
  // the prescription itself (retiredKey, #3855), and `tsc` types the key
  // `never` at the authoring site.
  describe('retired v0 keys are tombstoned (#4740, ADR-0049)', () => {
    it('rejects `functions` with the prescription', () => {
      expect(() => EnvironmentArtifactSchema.parse({ ...wireMinimal, functions: [] }))
        .toThrow(/`environmentArtifact\.functions` was removed in @objectstack\/spec 17\.0\.0.*Delete the key/s);
    });

    it('rejects `manifest` with the prescription', () => {
      expect(() => EnvironmentArtifactSchema.parse({ ...wireMinimal, manifest: {} }))
        .toThrow(/`environmentArtifact\.manifest` was removed in @objectstack\/spec 17\.0\.0.*metadata\.manifest/s);
    });

    it('rejects `payloadRef` with the prescription', () => {
      expect(() => EnvironmentArtifactSchema.parse({ ...wireMinimal, payloadRef: { url: 'https://x' } }))
        .toThrow(/`environmentArtifact\.payloadRef` was removed in @objectstack\/spec 17\.0\.0.*Delete the key/s);
    });

    it('a full pre-#4740 v0 artifact is rejected loudly, not half-parsed', () => {
      const v0 = {
        schemaVersion: '0.1',
        environmentId: 'proj_01HABCDE',
        commitId: 'commit_01HABCDE',
        checksum: { algorithm: 'sha256', value: 'a1b2c3d4' },
        metadata: { objects: [{ name: 'account', label: 'Account' }] },
        functions: [{ name: 'on_account_create', code: 'export default async () => {}' }],
        manifest: { plugins: [{ id: '@objectstack/plugin-auth' }] },
      };
      expect(EnvironmentArtifactSchema.safeParse(v0).success).toBe(false);
    });

    it('absent tombstoned keys stay absent from the parse result', () => {
      const parsed = EnvironmentArtifactSchema.parse(wireMinimal);
      expect(parsed).not.toHaveProperty('functions');
      expect(parsed).not.toHaveProperty('payloadRef');
      // NB `manifest` may legitimately appear INSIDE metadata (the stack
      // manifest) — the tombstone governs the envelope level only.
      expect(Object.keys(parsed)).not.toContain('manifest');
    });
  });
});
