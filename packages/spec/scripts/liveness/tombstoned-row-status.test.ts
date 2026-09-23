// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Contract test against the REAL ledgers: a key the schema has TOMBSTONED is
// `dead` in the liveness ledger.
//
// WHY THIS EXISTS (#18304). `agent.tools` sat at `status: "live"` from the
// 2026-06 audit until 2026-09-18 on a key `ai/agent.zod.ts` had declared
// `retiredKey(...)` in protocol 17. Nothing could catch it:
//
//   - The FORWARD pass is satisfied — a `retiredKey()` tombstone keeps the key
//     in the walked shape, so the row exists and is classified. It just says
//     the wrong thing.
//   - The ORPHAN pass is satisfied for the same reason: the key is still there,
//     so the row has not outlived its property.
//   - The EVIDENCE checks never ran on it. Its citation was foreign in both of
//     its spellings — `packages/services/service-ai/...` matched
//     `FOREIGN_PATH_PREFIXES`, and the `cloud` realm marker that replaced it in
//     #13309 is attributed the same way — and an attributed path is counted,
//     never resolved. So no gate could fail on that row in either direction.
//   - `check-liveness.mts` reads `markerStatus()` for `[experimental` and
//     `[planned` markers and has no reading of `[REMOVED]` at all, so the
//     tombstone itself was invisible to the status resolution.
//
// What makes the verdict checkable is the thing the citation never was: LOCAL.
// `retiredKey()` types the key `never` and rejects it at parse, and the
// matching ADR-0087 conversion deletes it from stored rows and built artifacts
// at rehydration — so no author can put a value behind a tombstoned key and no
// consumer in any repo can read one. `live` is defined in the ledger README as
// "Has a runtime consumer"; a tombstoned key cannot satisfy that in any realm,
// which is why this is a class invariant and not a judgement call per row.
//
// Measured before it was pinned, over the 36 governed types the walk resolves:
// 40 top-level keys carry a `[REMOVED]` tombstone, all 40 never-typed, and 39
// already said `dead`. `agent.tools` was the single outlier. So this starts
// green on a population of 40 and only a NEW outlier can red it — the
// zero-census discipline the other liveness flips were switched on under.
//
// The walker helpers below are a deliberate COPY of `check-liveness.mts`'s.
// That file exports nothing and runs its whole gate at import time, so it
// cannot be imported from a test; the non-vacuity floor is what holds the copy
// honest — a helper that drifts until it stops seeing tombstones fails the
// floor instead of passing by asking nothing.
//
// SCOPE: top-level keys only, the granularity at which these rows live. Nested
// tombstones (`route_generation.overrides.*` and friends) are out of this
// population on purpose — widening it is its own measurement.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from '../../src/kernel/metadata-type-schemas';
import { WebhookSchema } from '../../src/automation/webhook.zod';
import { QuerySchema } from '../../src/data/query.zod';
import { ValidationRuleSchema } from '../../src/data/validation.zod';
import { TestSuiteSchema } from '../../src/qa/testing.zod';
import { ManifestSchema } from '../../src/kernel/manifest.zod';
import {
  BatchEndpointsConfigSchema,
  CrudEndpointsConfigSchema,
  MetadataEndpointsConfigSchema,
  RestApiConfigSchema,
  RouteGenerationConfigSchema,
} from '../../src/api/rest-server.zod';
import { SubscriptionSchema } from '../../src/api/realtime.zod';

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, '../..');
const ledgerRoot = join(specRoot, 'liveness');

/** Mirrors `SPEC_ONLY_SCHEMAS` in check-liveness.mts — types with no registry kind. */
const SPEC_ONLY_SCHEMAS: Record<string, unknown> = {
  webhook: WebhookSchema,
  query: QuerySchema,
  validation: ValidationRuleSchema,
  qa: TestSuiteSchema,
  manifest: ManifestSchema,
  crud_endpoints: CrudEndpointsConfigSchema,
  metadata_endpoints: MetadataEndpointsConfigSchema,
  batch_endpoints: BatchEndpointsConfigSchema,
  route_generation: RouteGenerationConfigSchema,
  rest_api: RestApiConfigSchema,
  realtime_subscription: SubscriptionSchema,
};

/** The prefix `retiredKey()` writes onto a tombstone's description. */
const TOMBSTONE_MARKER = '[REMOVED]';

/** The population measured on the commit that pinned this — the non-vacuity floor. */
const TOMBSTONE_FLOOR = 40;

function defOf(s: any): any {
  return s && (s._zod?.def ?? s._def);
}
function unwrap(s: any, depth = 0): any {
  if (!s || depth > 16) return s;
  const def = defOf(s);
  if (!def) return s;
  if (def.type === 'lazy' && typeof def.getter === 'function') return unwrap(def.getter(), depth + 1);
  if (['optional', 'default', 'nullable', 'readonly', 'catch', 'nonoptional', 'prefault'].includes(def.type)) {
    return unwrap(def.innerType, depth + 1);
  }
  if (def.type === 'pipe') {
    const inDef = defOf(unwrap(def.in, depth + 1));
    if (inDef?.type === 'transform') return unwrap(def.out, depth + 1);
    return unwrap(def.in ?? def.out, depth + 1);
  }
  return s;
}
function shapeOf(s: any): Record<string, any> | null {
  const u = unwrap(s);
  const def = defOf(u);
  if (def?.type === 'object') return def.shape ?? u.shape ?? null;
  if (def?.type === 'union' && Array.isArray(def.options)) {
    for (const opt of def.options) {
      const uo = unwrap(opt);
      const od = defOf(uo);
      if (od?.type === 'object') return od.shape ?? uo.shape ?? null;
    }
  }
  return null;
}
function descOf(s: any): string {
  let cur = s;
  for (let i = 0; i < 16 && cur; i++) {
    if (cur.description) return cur.description;
    const def = defOf(cur);
    if (def?.description) return def.description;
    cur = def?.innerType ?? (def?.type === 'lazy' && def.getter ? def.getter() : undefined) ?? def?.in;
  }
  return '';
}

function ledgerOf(type: string): any {
  const f = join(ledgerRoot, `${type}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { props: {} };
}

interface Tombstone {
  /** `<type>.<key>` — the ledger coordinate. */
  coord: string;
  /** Whether the tombstone is `never`-typed, i.e. genuinely unwritable. */
  neverTyped: boolean;
  /** The status its ledger row claims, or `(no row)`. */
  status: string;
}

function collectTombstones(): Tombstone[] {
  const types = new Set<string>([...listMetadataTypeSchemaTypes(), ...Object.keys(SPEC_ONLY_SCHEMAS)]);
  const out: Tombstone[] = [];
  for (const type of [...types].sort()) {
    const schema = SPEC_ONLY_SCHEMAS[type] ?? getMetadataTypeSchema(type);
    if (!schema) continue;
    const shape = shapeOf(schema);
    if (!shape) continue;
    const ledger = ledgerOf(type);
    for (const key of Object.keys(shape)) {
      if (!descOf(shape[key]).startsWith(TOMBSTONE_MARKER)) continue;
      out.push({
        coord: `${type}.${key}`,
        neverTyped: defOf(unwrap(shape[key]))?.type === 'never',
        status: ledger.props?.[key]?.status ?? '(no row)',
      });
    }
  }
  return out;
}

describe('shipped ledgers — a tombstoned key is `dead`', () => {
  it('every `[REMOVED]` top-level key on a governed type carries a `dead` row', () => {
    const tombstones = collectTombstones();
    const offenders = tombstones.filter((t) => t.status !== 'dead').map((t) => `${t.coord} → status=${t.status}`);
    expect(offenders).toEqual([]);
    // Non-vacuity: a walker that stopped resolving shapes would satisfy the
    // line above by asking nothing at all. 40 was the measured population.
    expect(tombstones.length).toBeGreaterThanOrEqual(TOMBSTONE_FLOOR);
  });

  it('every tombstone in that population is `never`-typed — the reason the verdict is not a judgement call', () => {
    // `retiredKey()` is `z.never(...).optional().describe('[REMOVED] …')`. A
    // `[REMOVED]` description on something still writable would mean the prose
    // marker and the accept set disagree, and the invariant above would be
    // resting on a label rather than on a refusal.
    const writable = collectTombstones().filter((t) => !t.neverTyped).map((t) => t.coord);
    expect(writable).toEqual([]);
  });

  it('`agent.tools` is the #18304 row: tombstoned in AgentSchema, `dead` in the ledger, with no `evidence` pointer', () => {
    const shape = shapeOf(getMetadataTypeSchema('agent'))!;
    expect(descOf(shape.tools)).toContain(TOMBSTONE_MARKER);
    expect(defOf(unwrap(shape.tools))?.type).toBe('never');

    const row = ledgerOf('agent').props.tools;
    expect(row.status).toBe('dead');
    // A `dead` row's pointer lives in `note` by the gate's own design
    // (EVIDENCE_UNSCANNED_STATUSES): an `evidence` string here would be a claim
    // no check reads, on a key the status says has no consumer.
    expect(row).not.toHaveProperty('evidence');
    expect(row.note).toContain('retiredKey');
  });
});
