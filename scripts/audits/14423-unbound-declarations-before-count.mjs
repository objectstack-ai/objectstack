#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 step 1 (census) — the `unboundDeclarations` BEFORE count the
 * maintainer ruling (comment 5528592646) asks step 2 to diff against.
 *
 * MEASUREMENT ONLY. Imports the real, already-built `@objectstack/objectql`
 * (`runActionGovernanceInventory`, `collectEngineActionDeclarations`,
 * `reconcileActionRegistrations` — all exported from its public entry) and
 * drives it exactly as `ObjectQLPlugin.runGovernanceInventory`
 * (`packages/objectql/src/plugin.ts#runGovernanceInventory`) does, over a controlled standalone
 * source that isolates the ONE population the identity fix can move:
 * standalone `action` declarations whose BODY carries no `name` (the C2/C6
 * shape) and are otherwise `type: 'script'` with no `body` and no bound
 * handler — the exact shape `unboundDeclarations` reports.
 *
 * Re-run: `node scripts/audits/14423-unbound-declarations-before-count.mjs`
 * (requires the objectql dependency closure built — this script does not
 * build). Exit 0 always; this is a measurement, not a gate.
 */

import {
  runActionGovernanceInventory,
  collectEngineActionDeclarations,
  reconcileActionRegistrations,
} from '../../packages/objectql/dist/index.js';

function silentLogger() {
  const warnings = [];
  return { warnings, logger: { warn: (m, meta) => warnings.push({ m, meta }), debug: () => {} } };
}

// ---------------------------------------------------------------------------
// The population the fix can move: N standalone `action` items whose body has
// NO `name` (the C2/C6 shape — identity lives only in the store's key, which
// this thunk, matching TODAY's wiring, never surfaces), type `script`, no
// `body`, and NO registered handler under any key — the exact
// `unboundDeclarations` shape (ADR-0078: "a button wired to nothing").
// ---------------------------------------------------------------------------
const NAMELESS_ORPHAN_COUNT = 5;
const namelessStandaloneOrphans = Array.from({ length: NAMELESS_ORPHAN_COUNT }, (_, i) => ({
  // Deliberately NO `name` field — the C2/C6 shape. `target`/`objectName` are
  // also absent: an orphan script action has nothing to be bound BY, which is
  // exactly why it would (if admitted) show up in `unboundDeclarations`.
  type: 'script',
  // `_storeKey` documents what identity this item WOULD have if the plane
  // were asked by key (listNames()/loadManyKeyed()) — never read by today's
  // collectEngineActionDeclarations, which is exactly the point being measured.
  _storeKey: `orphan_action_${i}`,
}));

// A SEPARATE control: a NAMED standalone orphan (today's code already admits
// this one) — establishes that the harness's zero count for the nameless
// batch is the identity gate, not "orphans never get admitted at all".
const namedStandaloneOrphan = { name: 'named_orphan_action', type: 'script' };

const loadStandaloneActions = async () => [...namelessStandaloneOrphans, namedStandaloneOrphan];

const { warnings, logger } = silentLogger();

// Exactly as ObjectQLPlugin.runGovernanceInventory calls it
// (`packages/objectql/src/plugin.ts#runGovernanceInventory`),
// with an empty registered-handler set and no object-embedded actions/registry
// rung, so the ENTIRE declaration set comes from `loadStandaloneActions`.
await runActionGovernanceInventory({
  registered: [],
  objects: [],
  loadStandaloneActions,
  lookupRegistryAction: () => undefined,
  logger,
});

const unboundWarning = warnings.find((w) => w.m.includes('declared script actions with NO handler'));
const before = {
  namelessOrphansSubmitted: NAMELESS_ORPHAN_COUNT,
  namedOrphanSubmitted: 1,
  unboundDeclarationsReported: unboundWarning ? unboundWarning.meta.count : 0,
  unboundDeclarationsList: unboundWarning ? unboundWarning.meta.actions : [],
};

// Direct, dependency-free confirmation of the SAME fact at the function level
// (bypasses the warn-log parsing above as a second, independent read):
const declarations = await collectEngineActionDeclarations([], loadStandaloneActions);
const reconciled = reconcileActionRegistrations([], declarations);

console.error('--- #14423 unboundDeclarations BEFORE count: human summary ---');
console.error(JSON.stringify({
  ...before,
  declarationsAdmitted: declarations.length,
  declarationsAdmittedNames: declarations.map((d) => d.action?.name ?? '<nameless — DROPPED upstream, never reaches here>'),
  reconciledUnboundDeclarations: reconciled.unboundDeclarations,
}, null, 2));
console.log(JSON.stringify({ before, declarationsAdmitted: declarations.length, reconciledUnboundDeclarations: reconciled.unboundDeclarations }));
