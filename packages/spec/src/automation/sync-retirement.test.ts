// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

// ─── [#4738] L1 "Simple Sync" is gone; `ConflictResolution` has ONE owner ───
//
// Dual-source ledger #4535, clusters C13+C15 (one implementation unit — the
// two clusters shared their source files). Before this change:
//
//   `DataSyncConfig(Schema)`    — ./automation ≠ ./integration (two disjoint
//     encodings of "sync with an external system": push/pull vs
//     import/export/bidirectional, batchSize default 100 vs 1000, …)
//   `ConflictResolution(Schema)` — ./automation ≠ ./integration ≠ ./ui (THREE
//     declarations, three vocabularies: destination_wins+merge vs target_wins
//     vs client_wins/server_wins/last_write_wins)
//
// Which type a consumer got depended on the import path — the #4411 trap.
// Resolution (maintainer-ruled, #4738):
//
//   - automation/sync.zod.ts was REMOVED whole (the "L1 Simple Sync" layer:
//     DataSyncConfig, its ConflictResolution enum, SyncDirection/SyncMode,
//     DataSource/DataDestinationConfig, SyncExecutionStatus/Result, `Sync`).
//     It was narrative-only: zero importers in objectstack / cloud / objectui,
//     no engine ever parsed a DataSyncConfig, defs unreachable from the
//     metadata-type roots (#4650 gate).
//   - integration's enum was RENAMED `ConnectorConflictResolution(Schema)`
//     (ADR-0112 D9a prefixing, RENAMED_DEFS carry). `DataSyncConfig` stays
//     integration-owned under its bare name — it is on the live parse path
//     (`ConnectorSchema.syncConfig`).
//   - ui keeps the bare `ConflictResolution(Schema)` UNTOUCHED: a distinct
//     concept (offline client/server sync) and the only side with cross-repo
//     consumers (objectui useOffline.ts + types re-export + a parity ratchet
//     that pins "must stay a spec export"). Renaming the ui side would replay
//     the objectui#3235 downstream breakage — that "tidy-up" is the wrong-case
//     this pin exists to catch.
//   - `@objectstack/spec/api`'s `ConflictResolutionStrategy` (route conflicts)
//     is a FOURTH relative under a different name; it is outside the baseline
//     and must not be touched by any of this.
//
// #4642 established that a compile-time conditional-type pin in this package
// is a no-op (tsconfig excludes `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (re-adding an automation
// export, re-introducing a bare-name re-export on ./integration, and renaming
// the ui side each turn it red).
describe('[#4738] sync/conflict dual-source retirement', () => {
  it('resolves the export surface: one owner per name, across every public entry', async () => {
    const ts = (await import('typescript')).default;
    const { resolve, relative } = await import('node:path');
    const { dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { readFileSync } = await import('node:fs');

    const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    // Every public entry point, read from package.json's exports map so a
    // future entry cannot silently escape the uniqueness pins below.
    const pkg = JSON.parse(readFileSync(resolve(specDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const entries: Record<string, string> = {};
    for (const sub of Object.keys(pkg.exports)) {
      if (sub === '.') entries[sub] = resolve(specDir, 'src/index.ts');
      else if (/^\.\/[a-z-]+$/.test(sub)) entries[sub] = resolve(specDir, `src/${sub.slice(2)}/index.ts`);
      // './openapi.json' / './package.json' are not TypeScript entry points.
    }
    // Anti-vacuity: the enumeration must have found the real surface.
    for (const needed of ['./automation', './integration', './ui', './api']) {
      expect(Object.keys(entries), `exports map must include ${needed}`).toContain(needed);
    }
    expect(Object.keys(entries).length).toBeGreaterThan(10);

    const program = ts.createProgram(Object.values(entries), {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const unalias = (s: import('typescript').Symbol) =>
      s.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    const exportsOf = (sub: string) => {
      const sf = program.getSourceFile(entries[sub]);
      const moduleSym = sf && checker.getSymbolAtLocation(sf);
      // Without this guard a resolution failure would make every assertion
      // below pass vacuously — the exact way a gate goes dormant (#4642).
      expect(moduleSym, `${sub} module symbol must resolve`).toBeTruthy();
      return checker.getExportsOfModule(moduleSym!);
    };

    const originOf = (sym: import('typescript').Symbol, label: string) => {
      const decl = unalias(sym).declarations?.[0];
      expect(decl, `${label} must have a declaration`).toBeTruthy();
      const declFile = decl!.getSourceFile();
      return `${relative(specDir, declFile.fileName)}:${
        declFile.getLineAndCharacterOfPosition(decl!.getStart()).line + 1
      }`;
    };

    /** Every entry that exports `name`, with each occurrence's declaration origin. */
    const holdersOf = (name: string) => {
      const out: Array<{ sub: string; origin: string }> = [];
      for (const sub of Object.keys(entries)) {
        for (const sym of exportsOf(sub).filter((e) => e.getName() === name)) {
          out.push({ sub, origin: originOf(sym, `${sub} ${name}`) });
        }
      }
      return out;
    };

    // 1. The removed side: `./automation` still has a non-trivial surface —
    //    so the `not.toContain` cannot pass by resolving nothing — and names
    //    NOTHING from the retired L1 file, while surviving neighbours stand.
    const automationNames = exportsOf('./automation').map((e) => e.getName());
    expect(automationNames.length, './automation must export a non-trivial surface').toBeGreaterThan(50);
    for (const retired of [
      'DataSyncConfig', 'DataSyncConfigSchema',
      'ConflictResolution', 'ConflictResolutionSchema',
      'SyncDirection', 'SyncDirectionSchema',
      'SyncMode', 'SyncModeSchema',
      'DataSourceConfig', 'DataSourceConfigSchema',
      'DataDestinationConfig', 'DataDestinationConfigSchema',
      'SyncExecutionStatus', 'SyncExecutionStatusSchema',
      'SyncExecutionResult', 'SyncExecutionResultSchema',
      'Sync',
    ]) {
      expect(automationNames, `./automation must not export ${retired}`).not.toContain(retired);
    }
    expect(automationNames).toContain('ETLPipelineSchema');
    expect(automationNames).toContain('StateMachineSchema');

    // 2. The renamed side: `ConnectorConflictResolution(Schema)` originates in
    //    integration/connector.zod.ts and is exported by ./integration alone
    //    (plus nothing else — the rename must not fan out).
    for (const name of ['ConnectorConflictResolution', 'ConnectorConflictResolutionSchema']) {
      const holders = holdersOf(name);
      expect(holders.length, `${name} must be exported (by ./integration)`).toBeGreaterThan(0);
      for (const h of holders) {
        expect(h.sub, `${name} must only be exported by ./integration`).toBe('./integration');
        expect(h.origin).toMatch(/^src\/integration\/connector\.zod\.ts:\d+$/);
      }
    }

    // 3. The bare `ConflictResolution(Schema)` now has exactly ONE owner: ./ui,
    //    declared in ui/offline.zod.ts. Not just "same declaration everywhere"
    //    — NO other entry may export the bare name at all. A re-export from
    //    ./integration or ./automation would share the declaration (green to
    //    the dual-source gate) while telling connector authors the offline
    //    client/server vocabulary is a connector sync strategy — the C14
    //    lesson: a re-export can lie about the domain even when the symbol is
    //    honest.
    for (const name of ['ConflictResolution', 'ConflictResolutionSchema']) {
      const holders = holdersOf(name);
      expect(holders.map((h) => h.sub), `${name} must be owned by ./ui alone`).toEqual(['./ui']);
      expect(holders[0].origin).toMatch(/^src\/ui\/offline\.zod\.ts:\d+$/);
    }

    // 4. `DataSyncConfig(Schema)` likewise: ./integration alone, declared in
    //    integration/connector.zod.ts — it kept its bare name because it is on
    //    the live `ConnectorSchema.syncConfig` parse path.
    for (const name of ['DataSyncConfig', 'DataSyncConfigSchema']) {
      const holders = holdersOf(name);
      expect(holders.map((h) => h.sub), `${name} must be owned by ./integration alone`).toEqual(['./integration']);
      expect(holders[0].origin).toMatch(/^src\/integration\/connector\.zod\.ts:\d+$/);
    }

    // 5. The fourth relative is untouched: `ConflictResolutionStrategy` (route
    //    conflict handling) still exists on ./api under its own distinct name,
    //    and is a DIFFERENT declaration from ui's ConflictResolution. objectui's
    //    parity ratchet (offline-nav-performance-spec-parity.test.ts) pins the
    //    same pair from the consumer side.
    const strategyHolders = holdersOf('ConflictResolutionStrategy');
    expect(strategyHolders.length, './api must still export ConflictResolutionStrategy').toBeGreaterThan(0);
    expect(strategyHolders.map((h) => h.sub)).toContain('./api');
    const uiOrigin = holdersOf('ConflictResolution')[0].origin;
    for (const h of strategyHolders) {
      expect(h.origin, 'ConflictResolutionStrategy must not collapse into the ui declaration').not.toBe(uiOrigin);
    }
  });

  it('keeps the runtime namespaces consistent with the compiler view', async () => {
    const automation = await import('./index');
    const integration = await import('../integration/index');
    const ui = await import('../ui/index');

    // Removed side — gone at runtime too.
    for (const retired of ['DataSyncConfigSchema', 'ConflictResolutionSchema', 'Sync', 'SyncDirectionSchema']) {
      expect(retired in automation, `automation must not export ${retired}`).toBe(false);
    }
    // Anti-vacuity: the namespace we just probed is real and non-trivial.
    expect('FlowSchema' in automation).toBe(true);

    // Renamed side — the connector vocabulary, byte-for-byte unchanged.
    expect('ConflictResolutionSchema' in integration).toBe(false);
    expect('ConnectorConflictResolutionSchema' in integration).toBe(true);
    expect(() => integration.ConnectorConflictResolutionSchema.parse('target_wins')).not.toThrow();
    expect(() => integration.ConnectorConflictResolutionSchema.parse('latest_wins')).not.toThrow();
    // The retired automation-side vocabulary was disjoint precisely here:
    expect(() => integration.ConnectorConflictResolutionSchema.parse('destination_wins')).toThrow();
    expect(() => integration.ConnectorConflictResolutionSchema.parse('merge')).toThrow();

    // ui side — untouched, and still the offline client/server vocabulary.
    expect('ConflictResolutionSchema' in ui).toBe(true);
    expect(() => ui.ConflictResolutionSchema.parse('client_wins')).not.toThrow();
    expect(() => ui.ConflictResolutionSchema.parse('last_write_wins')).not.toThrow();
    expect(() => ui.ConflictResolutionSchema.parse('target_wins')).toThrow();
    expect(() => ui.ConflictResolutionSchema.parse('source_wins')).toThrow();
  });

  it('still parses authored connector syncConfig through the renamed enum — the live path', async () => {
    const { ConnectorSchema } = await import('../integration/connector.zod');
    const connectorWith = (conflictResolution: string) => ({
      name: 'sap_erp',
      label: 'SAP ERP',
      type: 'saas',
      syncConfig: {
        strategy: 'incremental',
        direction: 'bidirectional',
        conflictResolution,
        batchSize: 500,
      },
    });
    const parsed = ConnectorSchema.parse(connectorWith('target_wins'));
    expect(parsed.syncConfig?.conflictResolution).toBe('target_wins');
    // The authored VALUE domain did not move an inch with the TS rename; the
    // SAME document differing only in this one value stays illegal (so this
    // negative cannot pass for an unrelated reason):
    expect(() => ConnectorSchema.parse(connectorWith('destination_wins'))).toThrow();
  });
});
