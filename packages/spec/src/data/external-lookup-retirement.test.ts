// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#8075] the external-lookup family is RETIRED ──────────────────────────
//
// ADR-0049 enforce-or-remove, fork (b) of the #8075 census (accepted
// 2026-08-12): `data/external-lookup.zod.ts` is deleted whole — 3 emitted defs
// (`data/ExternalDataSource`, `data/ExternalFieldMapping`,
// `data/ExternalLookup`), 8 exported names, reference docs with them.
//
// The measurement that decided it (issue #8075, report comment; spot-verified
// on the merged tree before this removal, control passing in the SAME run):
//
//   1. STATIC — zero imports of any export outside `packages/spec` repo-wide,
//      while the corpus-reach control (`DatasourceSchema` under identical
//      exclusions) returns hits. In-package, the only non-test consumer of
//      `ExternalDataSourceSchema` / `ExternalFieldMappingSchema` was
//      `ExternalLookupSchema` in the same module, itself consumed by nothing.
//   2. DOORS — no metadata-type binding (kernel/metadata-type-schemas.ts
//      imports neither module), no stack collection, no object/field
//      embedding: `object.external` binds `ObjectExternalBindingSchema`
//      (remoteName / remoteSchema / writable / columnMap — no authentication;
//      the ADR-0015/0062 federated path routes credentials through datasource
//      config). The #5552 conversion's docblock had already recorded that no
//      external-lookup document exists for the conversion walker to visit.
//   3. The security face: `ExternalDataSourceSchema.authentication.config`
//      was a `z.record(z.string(), z.unknown())` whose own docblock example
//      wrote `"clientSecret": "..."` inline — an invitation to author OAuth
//      secrets in cleartext metadata, with no consumer to ever read them.
//
// ## Why route 3, and why there is nothing to tombstone
//
// With no carrier key there is no shape on which a `retiredKey()` tombstone
// could sit, and no author document for an ADR-0087 D2 conversion to rewrite —
// a prescription nobody can receive is noise. The declared record is the D3
// `SemanticMigration` `external-lookup-message-queue-families-retired` plus
// the `RETIRED_DEFS_BY_MAJOR[17]` entries the manifest-deletion gate reads.
//
// The #5552 `data/ExternalFieldMapping:transform` tombstone (one of that
// retirement's three spellings) is SUBSUMED rather than deleted-in-isolation:
// it goes with the shape that carried it, which is strictly stronger, because
// there is no longer a mapping shape to author the key INTO. The base
// `shared/FieldMapping` tombstone and the `integration/ConnectorFieldMapping`
// spelling are untouched — `shared/mapping.test.ts` still pins those.
//
// Form follows #4988 / #5055: resolved symbol identity over every public entry
// via the build-time `export-origins/` artifact, plus the file-deletion probe
// in the #4988 direction (whole-file retirement, no surviving occupant).
describe('[#8075] data/ external-lookup family retirement', () => {
  /** The 8 names the three retired defs exported (3 schema consts + 5 types). */
  const RETIRED_NAMES = [
    'ExternalDataSourceSchema', 'ExternalDataSource',
    'ExternalFieldMappingSchema', 'ExternalFieldMapping', 'ExternalFieldMappingParsed',
    'ExternalLookupSchema', 'ExternalLookup', 'ExternalLookupParsed',
  ] as const;

  /**
   * Names that must SURVIVE on `./data`. The first three are the live
   * federated-external-data path the retirement's prescription points at; the
   * catalog trio lives one file over from the deleted module and is exactly
   * what a too-wide "finish everything external" sweep would take.
   */
  const MUST_SURVIVE_DATA = [
    'ObjectExternalBindingSchema',
    'DatasourceSchema',
    'ImportFieldMappingSchema',
    'ExternalCatalogSchema',
    'ExternalTableSchema',
    'ExternalColumnSchema',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './data', './shared', './system']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./data').length, './data must export a non-trivial surface').toBeGreaterThan(100);

    // ── ABSENCE (every entry, not just ./data) ────────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #8075`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const dataNames = exportNamesOf('./data');
    for (const name of MUST_SURVIVE_DATA) {
      expect(dataNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
    // The base the deleted `ExternalFieldMappingSchema` used to extend keeps
    // its bare name on ./shared — the retirement takes the extender, never
    // the base.
    expect(exportNamesOf('./shared')).toContain('FieldMappingSchema');
  });

  it('the module is gone from disk, and nothing imports it any more', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    for (const f of ['external-lookup.zod.ts', 'external-lookup.test.ts']) {
      expect(fs.existsSync(path.join(srcRoot, 'data', f)), `data/${f} must be deleted`).toBe(false);
    }
    // Anti-vacuity: the sibling that was measured live-adjacent and KEPT must
    // still be on disk, so "false" above cannot mean "wrong directory".
    expect(fs.existsSync(path.join(srcRoot, 'data', 'external-catalog.zod.ts'))).toBe(true);

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/(?:import|export)[^;]*['"][^'"]*\/external-lookup\.zod(?:\.js)?['"]/.test(src)) {
            importers.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    expect(importers, 'a resurrected import means the retirement is being undone — re-read #8075').toEqual([]);
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const data = await import('./index');
    for (const name of RETIRED_NAMES) {
      expect(name in data, `data must not export ${name}`).toBe(false);
    }
    for (const name of MUST_SURVIVE_DATA) {
      expect(name in data, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the live external path still carries NO inline credential face', async () => {
    // The retirement's argument in one assertion: the surviving federated
    // binding (`object.external`) exposes no `authentication` and no secret
    // slot — credentials belong to datasource config, not object metadata. If
    // someone re-adds an inline credential face here, this pin asks for the
    // #7990 / #8075 analysis to be re-run, not for a quiet green.
    const { ObjectExternalBindingSchema } = await import('./object.zod');
    const parsed = ObjectExternalBindingSchema.safeParse({
      datasource: 'warehouse',
      remoteName: 'accounts',
      authentication: { type: 'oauth2', config: { clientSecret: 'x' } },
    });
    // strictObject: an inline `authentication` block is REJECTED, not stored.
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.code === 'unrecognized_keys'
        && (i as { keys?: string[] }).keys?.includes('authentication'))).toBe(true);
    }
  });
});
