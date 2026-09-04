#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 step 1 (census) — does a KEYED read (`listNames()` + by-name
 * `load`/`loadDiagnosed`) close C3 and C4 from
 * `packages/runtime/src/action-governance-scope-divergence.test.ts`?
 *
 * MEASUREMENT ONLY. This script changes nothing in any shipped package; it
 * imports the real, already-built `@objectstack/metadata` and
 * `@objectstack/core` from their `dist/` output and drives the SAME doubles
 * the pinned fixture uses (`readEngine` / `listDownEngine`), transcribed here
 * rather than imported because the fixture is a `.test.ts` file with no
 * public export surface — see that file's own header for what is real and
 * what is doubled.
 *
 * Re-run with: `node scripts/audits/14423-c3-c4-keyed-mechanism-probe.mjs`
 * (requires `pnpm --filter '@objectstack/objectql^...' build` — the
 * dependency closure that puts `@objectstack/metadata` / `@objectstack/core`
 * dist output on disk — to have been run first; this script does not build).
 *
 * Findings are printed as JSON on stdout; a human-readable summary goes to
 * stderr. Exit code is always 0 — this is a measurement, not a gate.
 */

import { MetadataManager } from '../../packages/metadata/dist/index.js';
import { DatabaseLoader } from '../../packages/metadata/dist/index.js';
import { ObjectKernel, ServiceLifecycle } from '../../packages/core/dist/index.js';

const ACTION = 'promote_lead';

/** Transcribed from action-governance-scope-divergence.test.ts — see its header. */
function readEngine(rows) {
  const matches = (r, w) =>
    Object.entries(w).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`readEngine: unsupported WHERE combinator '${k}'`);
      if (v !== null && typeof v === 'object') throw new Error(`readEngine: unsupported WHERE operator on '${k}'`);
      return r[k] === v;
    });
  return {
    async find(table, q) {
      void table;
      const hits = rows.filter((r) => matches(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
    },
    async findOne(_table, q) {
      return rows.find((r) => matches(r, q?.where ?? {})) ?? null;
    },
    async count(_table, q) {
      return rows.filter((r) => matches(r, q?.where ?? {})).length;
    },
  };
}

/** Transcribed from the same fixture: the LIST read down, findOne intact. */
function listDownEngine(rows) {
  return {
    ...readEngine(rows),
    async find() {
      throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
    },
  };
}

function row(name, body) {
  return {
    id: `md_${name}`,
    name,
    type: 'action',
    namespace: 'default',
    scope: 'platform',
    state: 'active',
    version: 1,
    metadata: JSON.stringify(body),
  };
}

function planeOver(rows, engine = readEngine(rows)) {
  const mgr = new MetadataManager({});
  mgr.registerLoader(new DatabaseLoader({
    engine,
    trackHistory: false,
    cache: { enabled: false },
  }));
  return mgr;
}

/** The audit's OWN swallow, transcribed from `collectEngineActionDeclarations`
 *  (`packages/objectql/src/action-governance.ts`) — the outer try/catch a
 *  throwing plural read falls into today. */
async function swallowedStandaloneRead(thunk) {
  try {
    return { standalone: (await thunk()) ?? [], threw: false };
  } catch (e) {
    return { standalone: [], threw: true, error: e instanceof Error ? e.message : String(e) };
  }
}

const results = { c3: {}, c4: {} };

// ---------------------------------------------------------------------------
// C3 — plural read (loadMany / listNames) fails, by-name read (load /
// loadDiagnosed) answers. Does swapping loadMany -> listNames CLOSE the
// audit's blindness, or just relocate where the same failure is swallowed?
// ---------------------------------------------------------------------------
{
  const rows = [row(ACTION, { name: ACTION, type: 'script', target: ACTION })];
  const meta = planeOver(rows, listDownEngine(rows));

  // Control, matches the pinned fixture: loadMany catches internally, never throws.
  const viaLoadMany = await swallowedStandaloneRead(() => meta.loadMany('action'));
  results.c3.loadMany = { threw: viaLoadMany.threw, standaloneLength: viaLoadMany.standalone.length };

  // Candidate: listNames() — does MetadataManager.listNames() have the same
  // per-loader try/catch loadMany()/list() have? (metadata-manager.ts's
  // `listNames` loop calls `loader.list(type)` with NO surrounding try/catch.)
  const viaListNames = await swallowedStandaloneRead(() => meta.listNames('action'));
  results.c3.listNames = {
    threwInsideListNames: viaListNames.threw,
    errorMessage: viaListNames.error,
    standaloneLengthAfterOuterSwallow: viaListNames.standalone.length,
  };

  // The by-name read DOES answer (findOne is untouched by listDownEngine) —
  // confirms the divergence is real: the store can answer "does X exist" while
  // it cannot answer "list everything".
  const byName = await meta.loadDiagnosed('action', ACTION);
  results.c3.byNameLoadDiagnosed = { dataPresent: byName.data != null, degraded: byName.degraded };

  // The MECHANISM the ruling asks the census to name if keying alone does not
  // close C3: skip enumeration entirely and probe BY THE ALREADY-KNOWN
  // REGISTERED HANDLER NAME, mirroring the router and `dropHandlersDeclaredInRegistry`'s
  // registry-rung probe. This is unaffected by list-path failures because it
  // never calls list()/loadMany() at all.
  const byRegisteredName = await meta.loadDiagnosed('action', ACTION);
  results.c3.perRegisteredHandlerProbe = {
    wouldCoverTheHandler: byRegisteredName.data != null,
    note: 'probes ONLY the names already in `registered` (the engine action map) — never enumerates',
  };
}

// ---------------------------------------------------------------------------
// C4 — env-scoped `metadata`: the audit's OWN service lookup throws before any
// read method runs. No choice of read method (loadMany / listNames / by-name)
// changes this — the failure is upstream of loadMany entirely.
// ---------------------------------------------------------------------------
{
  const kernel = new ObjectKernel({});
  const perEnv = new Map();
  kernel.registerServiceFactory(
    'metadata',
    (_ctx, scopeId) => {
      const key = scopeId ?? '<unscoped>';
      if (!perEnv.has(key)) {
        perEnv.set(key, planeOver(key === 'env_a'
          ? [row(ACTION, { name: ACTION, type: 'script', target: ACTION })]
          : []));
      }
      return perEnv.get(key);
    },
    ServiceLifecycle.SCOPED,
  );

  let auditLookupThrew = false;
  let auditLookupError;
  try {
    kernel.getService('metadata');
  } catch (e) {
    auditLookupThrew = true;
    auditLookupError = e instanceof Error ? e.message : String(e);
  }
  results.c4.auditServiceLookup = { threw: auditLookupThrew, error: auditLookupError };

  const routerMeta = await kernel.getServiceAsync('metadata', 'env_a');
  const routerByName = await routerMeta.loadDiagnosed('action', ACTION);
  results.c4.routerServiceLookup = {
    resolvedAnInstance: routerMeta != null,
    byNameAnswers: routerByName.data != null,
  };
  results.c4.conclusion =
    'the audit never reaches ANY read call — getService(unscoped) throws before loadMany, ' +
    'listNames, or load/loadDiagnosed is ever invoked, so swapping the READ METHOD cannot ' +
    'close C4. Only reaching the SCOPED instance (a different accessor, or iterating known ' +
    'scopeIds) would.';
}

console.error('--- #14423 C3/C4 keyed-mechanism probe: human summary ---');
console.error(JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
