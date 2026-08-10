// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holderOriginsOf,
  originFile,
} from '../../scripts/lib/export-origins-testkit';
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
//   - ui kept the bare `ConflictResolution(Schema)` UNTOUCHED at #4738: a
//     distinct concept (offline client/server sync) and the only side with
//     cross-repo consumers. Renaming the ui side would have replayed the
//     objectui#3235 downstream breakage — that "tidy-up" is the wrong-case this
//     pin exists to catch.
//
//     ⚠️ #4988 SUPERSEDED that half. `ui/offline.zod.ts` was retired whole
//     under ADR-0049 enforce-or-remove — it had no carrier key in the protocol,
//     no `.parse()` in any of the three repos, and objectui's references were
//     type re-exports and parity ratchets rather than runtime consumers. So the
//     bare name is now published by NOBODY, and sections 3 and 5 below were
//     rewritten to pin that instead. The #4738 rename stands: freeing a word is
//     not a reason to rename the connector vocabulary back.
//   - `@objectstack/spec/api`'s `ConflictResolutionStrategy` (route conflicts)
//     is a FOURTH relative under a different name; it is outside the baseline
//     and must not be touched by any of this.
//
// #4642 established that a compile-time conditional-type pin in this package
// was a no-op until #5286 (tsconfig excluded `**/*.test.ts`; vitest never enables
// `typecheck`), so the load-bearing pin is the compiler-API test below, with
// anti-vacuity guards; sabotage-verified in the PR (re-adding an automation
// export, re-introducing a bare-name re-export on ./integration, and renaming
// the ui side each turn it red).
describe('[#4738] sync/conflict dual-source retirement', () => {
  it('resolves the export surface: one owner per name, across every public entry', () => {
    // Anti-vacuity: the baseline must cover the real surface. (This used to
    // enumerate package.json's exports map and build its own `ts.createProgram`
    // right here; `export-origins/` IS that resolution, computed once at build
    // time and checked in — #4796.)
    for (const needed of ['./automation', './integration', './ui', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(EXPORT_ENTRY_POINTS.length).toBeGreaterThan(10);

    // 1. The removed side: `./automation` still has a non-trivial surface —
    //    so the `not.toContain` cannot pass by resolving nothing — and names
    //    NOTHING from the retired L1 file, while surviving neighbours stand.
    const automationNames = exportNamesOf('./automation');
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
    // ⚠️ The L2 anchor that stood here — `expect(automationNames).toContain(
    // 'ETLPipelineSchema')` — was DELETED, not re-spelled, at #6414. It was
    // written to prove the L1 retirement stopped at L1, and it did that job for
    // four months; then L2 was retired on the same narrative-only reading, so
    // keeping it would have asserted the survival of a layer this repo
    // deliberately removed. Re-pointing it at another `automation/` export
    // would have preserved the line and lost the meaning. What survives as the
    // "did not over-reach" witness is `StateMachineSchema` plus the >50 export
    // floor above — and, one layer out, the surviving sync surfaces are
    // asserted by name in section 4 below.
    expect(automationNames).toContain('StateMachineSchema');
    for (const alsoRetired of [
      'ETLPipeline', 'ETLPipelineSchema', 'ETLPipelineRun', 'ETLPipelineRunSchema',
      'ETLSource', 'ETLSourceSchema', 'ETLDestination', 'ETLDestinationSchema',
      'ETLTransformation', 'ETLTransformationSchema', 'ETLEndpointTypeSchema',
      'ETLTransformationTypeSchema', 'ETLSyncModeSchema', 'ETLRunStatusSchema',
      'ETL',
    ]) {
      expect(
        automationNames,
        `./automation must not export ${alsoRetired} (#6414, L2 retired on L1's reading)`,
      ).not.toContain(alsoRetired);
    }

    // 2. The renamed side: `ConnectorConflictResolution(Schema)` originates in
    //    integration/connector.zod.ts and is exported by ./integration alone
    //    (plus nothing else — the rename must not fan out).
    for (const name of ['ConnectorConflictResolution', 'ConnectorConflictResolutionSchema']) {
      const holders = holderOriginsOf(name);
      expect(holders.length, `${name} must be exported (by ./integration)`).toBeGreaterThan(0);
      for (const h of holders) {
        expect(h.sub, `${name} must only be exported by ./integration`).toBe('./integration');
        expect(originFile(h.origin)).toBe('src/integration/connector.zod.ts');
      }
    }

    // 3. The bare `ConflictResolution(Schema)` is now published by NOBODY.
    //
    //    ⚠️ REWRITTEN AT #4988, and the direction of this assertion INVERTED.
    //    When this file was written the bare name had exactly one owner —
    //    `./ui`, declared in `ui/offline.zod.ts` — and that ownership is why
    //    #4738 renamed the connector side instead of the ui side. #4988 then
    //    retired `ui/offline.zod.ts` whole (ADR-0049 enforce-or-remove: no
    //    carrier key, no parse, in any of the three repos), so the word is
    //    FREE rather than re-homed.
    //
    //    Left as it was, this assertion would have gone red for the right
    //    reason and been "fixed" the wrong way — by pointing it at whichever
    //    entry still had a `ConflictResolution` — which is exactly the domain
    //    lie the C14 lesson names. The invariant that actually survives its
    //    owner is: no domain may quietly adopt a freed bare name. #4738's
    //    rename is NOT undone by the retirement (`ConnectorConflictResolution`
    //    is the connector vocabulary's real name now, pinned in 2 above; giving
    //    it back the bare word would be a second breaking change to gain
    //    nothing), and nothing else may claim it either.
    for (const name of ['ConflictResolution', 'ConflictResolutionSchema']) {
      const holders = holderOriginsOf(name);
      expect(
        holders.map((h) => `${h.sub} (${h.origin})`),
        `${name} was retired with ui/offline.zod.ts at #4988 — no entry may re-adopt the bare name`,
      ).toEqual([]);
    }

    // 4. `DataSyncConfig(Schema)` likewise: ./integration alone, declared in
    //    integration/connector.zod.ts — it kept its bare name because it is on
    //    the live `ConnectorSchema.syncConfig` parse path.
    for (const name of ['DataSyncConfig', 'DataSyncConfigSchema']) {
      const holders = holderOriginsOf(name);
      expect(holders.map((h) => h.sub), `${name} must be owned by ./integration alone`).toEqual(['./integration']);
      expect(originFile(holders[0].origin)).toBe('src/integration/connector.zod.ts');
    }

    // 5. The fourth relative is untouched: `ConflictResolutionStrategy` (route
    //    conflict handling) still exists on ./api under its own distinct name.
    //
    //    ⚠️ Also rewritten at #4988. The old form proved distinctness by
    //    comparing this declaration's origin against ui's `ConflictResolution`
    //    origin — and with that owner retired, `holderOriginsOf(…)[0]` throws before
    //    any assertion runs. The surviving, stronger statement is that this
    //    relative kept its OWN name and stayed in `api/`: the retirement freed
    //    a word, and the nearest neighbour is the most likely shape to drift
    //    into it.
    const strategyHolders = holderOriginsOf('ConflictResolutionStrategy');
    expect(strategyHolders.length, './api must still export ConflictResolutionStrategy').toBeGreaterThan(0);
    expect(strategyHolders.map((h) => h.sub)).toContain('./api');
    for (const h of strategyHolders) {
      expect(originFile(h.origin), 'ConflictResolutionStrategy must stay declared under src/api/').toMatch(/^src\/api\//);
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

    // ui side — RETIRED at #4988 with `ui/offline.zod.ts`. The runtime half of
    // section 3: the bare name is absent from all three namespaces rather than
    // having moved to one of them.
    for (const [label, ns] of [['ui', ui], ['integration', integration], ['automation', automation]] as const) {
      expect('ConflictResolutionSchema' in ns, `${label} must not export ConflictResolutionSchema`).toBe(false);
    }
    // Anti-vacuity: the ui namespace we just probed is real and non-trivial —
    // otherwise a broken import would satisfy the three absences above.
    expect('ThemeSchema' in ui).toBe(true);
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
