// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Holds `authz-probe-blind-spot.census.ts` equal to what the probe table's own
// source files actually say today.
//
// ⛔ This is NOT a second authorization gate and it classifies nothing. It is a
// MEASUREMENT PIN: it fails when the reach of `authz-conformance.test.ts`'s
// `discover()` changes in either direction — a probe added, a registrar added,
// a dispatcher handler added, a dead probe revived — so the census is re-read
// by whoever moved it instead of aging into a stale claim about a stale table.
//
// ⛔ It also refuses to let a zero pass unchallenged. Every row's controls are
// terms known present IN THAT ROW'S OWN FILE; if one goes to zero the file has
// moved, been renamed or been emptied, and every zero measured against it is
// instrument failure rather than a reading. A borrowed control — a term present
// in a different file — proves nothing about this one and is why the controls
// are per row rather than shared.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BLIND_SPOT_TOTAL_RUNTIME,
  BLIND_SPOT_TOTAL_STATIC,
  MATRIX_HEADER_PROBE_CLAIM,
  PROBE_FILE_CENSUS,
  PROBE_TABLE,
  deriveProbeFileCensus,
} from './authz-probe-blind-spot.census.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('authz probe blind-spot census (#13260)', () => {
  const derived = deriveProbeFileCensus();

  it('the census covers exactly the files the PROBES table names', () => {
    expect(PROBE_FILE_CENSUS.map((r) => r.file).sort()).toEqual([...derived.files.keys()].sort());
    expect(PROBE_FILE_CENSUS).toHaveLength(PROBE_TABLE.files);
  });

  it('the PROBES table still has the shape this census was measured against', () => {
    expect(derived.table).toEqual(PROBE_TABLE);
  });

  it('every classified key is accounted for — 15 `covers` keys, no more', () => {
    // The matrix's `covers` keys number 15 today: the 9 probe-minted keys this
    // census was first measured against, plus the 6 ledger family/domain keys
    // classified when the population moved (2026-08-31). If a probe starts
    // minting a key no row covers, the ratchet itself goes red as UNCLASSIFIED
    // — that is its job, and this pin does not duplicate it. What this asserts
    // is only that the census's key count is current.
    //
    // ⚠️ This is NOT the size of the population. The ledgers mint 40 keys; 6
    // are classified here and 34 are enumerated in the shrink-only baseline,
    // which `authz-conformance.test.ts` holds to its own four rules.
    expect(PROBE_TABLE.keys).toBe(15);
  });

  it.each(PROBE_FILE_CENSUS.map((r) => [r.file, r] as const))(
    '%s — population, reach and blind spot are unchanged',
    (_file, row) => {
      const d = derived.files.get(row.file);
      expect(d, `no derivation for ${row.file}`).toBeDefined();
      expect(d!.population).toBe(row.population);
      expect(d!.reachable).toBe(row.reachable);
      expect(row.blindSpot).toBe(row.population - row.reachable);
    },
  );

  it.each(PROBE_FILE_CENSUS.map((r) => [r.file, r] as const))(
    '%s — every positive control is still present in THAT file',
    (_file, row) => {
      const d = derived.files.get(row.file)!;
      for (const [term, recorded] of Object.entries(row.controls)) {
        // Non-zero first: a zero control means the reading is instrument failure.
        expect(d.controls[term], `control "${term}" vanished from ${row.file}`).toBeGreaterThan(0);
        expect(d.controls[term], `control "${term}" moved in ${row.file}`).toBe(recorded);
      }
    },
  );

  it('the repo-wide totals still add up from the rows', () => {
    const routeSurfaces = [
      'packages/rest/src/rest-server.ts',
      'packages/runtime/src/http-dispatcher.ts',
      'packages/runtime/src/domains/mcp.ts',
    ];
    const staticTotal = PROBE_FILE_CENSUS.filter((r) => routeSurfaces.includes(r.file)).reduce(
      (n, r) => n + r.blindSpot,
      0,
    );
    expect(staticTotal).toBe(BLIND_SPOT_TOTAL_STATIC);
    // The runtime reading differs only for rest-server.ts (85 mounts vs 80 call
    // sites — the approvals route factories and the capability-gated batch
    // routes; see the census header).
    expect(BLIND_SPOT_TOTAL_RUNTIME - BLIND_SPOT_TOTAL_STATIC).toBe(5);
  });

  it('the matrix header probe count EQUALS the table — the drift is closed, not recorded', () => {
    const matrix = readFileSync(join(HERE, 'authz-conformance.matrix.ts'), 'utf8');
    const m = /`discover\(\)`: (\d+) probes over (\d+) named source files/.exec(matrix);
    expect(m, 'the matrix header no longer states a probe count in the pinned shape').not.toBeNull();
    expect(Number(m![1])).toBe(MATRIX_HEADER_PROBE_CLAIM);
    expect(Number(m![2])).toBe(PROBE_TABLE.files);
    // ⭐ INVERTED. This assertion used to pin the drift (`not.toBe`): the prose
    // said 15 while the table held 16, and the measurement that found it left
    // the sentence alone on purpose so its no-repair fence stayed unambiguous.
    // The sentence is repaired, so the pin becomes the permanent invariant it
    // should always have been — a probe added without moving the prose is now
    // RED here instead of a discrepancy recorded in a third file.
    expect(MATRIX_HEADER_PROBE_CLAIM).toBe(PROBE_TABLE.entries);
    // …and the header's own text is what was read, not a hand-copied number.
    expect(Number(m![1])).toBe(PROBE_TABLE.entries);
  });

  it('every probe DECLARES its instrument kind, and the census records what it declares', () => {
    // The taxonomy used to live only as prose in the census. It is now data on
    // each probe, read back out of the companion test's source — so a probe
    // whose kind changes (a dead ROUTE_ENUMERATION honestly re-declared
    // TRIPWIRE, say) cannot leave this record describing the old table.
    for (const row of PROBE_FILE_CENSUS) {
      const derivedKinds = derived.kinds.get(row.file);
      expect(derivedKinds, `no kind declaration derived for ${row.file}`).toBeDefined();
      expect(derivedKinds).toEqual([...row.kinds].sort());
    }
  });

  it('every PROBES entry carries a kind — the pairing is complete, not short', () => {
    // Non-vacuity for the walk above: `kinds` is built by pairing `kind` and
    // `file` tokens in document order, so an entry missing its `kind` would
    // silently pair with the wrong file. The total is what catches that.
    const declared = [...derived.kinds.values()].flat().length;
    expect(declared).toBeGreaterThanOrEqual(new Set(PROBE_FILE_CENSUS.map((r) => r.file)).size);
    // All three instruments are still represented — a table that had lost one
    // would make the kind-specific readings below vacuous.
    const all = new Set([...derived.kinds.values()].flat());
    expect([...all].sort()).toEqual(['GATE_PIN', 'ROUTE_ENUMERATION', 'TRIPWIRE']);
  });
});
