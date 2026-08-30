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

  it('every mintable key is classified by exactly the rows that exist — 9 keys, no more', () => {
    // The matrix's `covers` keys and the probes' minted keys are the same set of
    // 9 today. If a probe starts minting a key no row covers, the ratchet itself
    // goes red as UNCLASSIFIED — that is its job, and this pin does not duplicate
    // it. What this asserts is only that the census's key count is current.
    expect(PROBE_TABLE.keys).toBe(9);
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

  it('the matrix header probe count is still the one the census recorded as drifted', () => {
    const matrix = readFileSync(join(HERE, 'authz-conformance.matrix.ts'), 'utf8');
    const m = /`discover\(\)`: (\d+) probes over (\d+) named source files/.exec(matrix);
    expect(m, 'the matrix header no longer states a probe count in the pinned shape').not.toBeNull();
    expect(Number(m![1])).toBe(MATRIX_HEADER_PROBE_CLAIM);
    expect(Number(m![2])).toBe(PROBE_TABLE.files);
    // The drift itself, pinned: the prose says 15, the table holds 16. Repairing
    // the sentence is the follow-up card's, not this measurement's.
    expect(MATRIX_HEADER_PROBE_CLAIM).not.toBe(PROBE_TABLE.entries);
  });
});
