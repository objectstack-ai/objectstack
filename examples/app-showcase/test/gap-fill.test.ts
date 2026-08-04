// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { existsSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';

import stack from '../objectstack.config.js';
import { DeliveryCube } from '../src/data/analytics/showcase.cube.js';
import { AccountExtension } from '../src/data/extensions/account.extension.js';
import { Account } from '../src/data/objects/account.object.js';

/**
 * Proof for the two STACK_COLLECTION_COVERAGE entries marked `demonstrated`
 * (see src/coverage.ts): the cube and the object extension are not just
 * declared — they are wired into the stack, and the extension merge is
 * exercised against the REAL SchemaRegistry (the same merge `registerApp`
 * step 2b performs at boot).
 */
describe('showcase gap fill — analytics cube', () => {
  it('is wired into the stack definition', () => {
    const cubes = (stack as { analyticsCubes?: Array<{ name: string }> }).analyticsCubes ?? [];
    expect(cubes.map((c) => c.name)).toContain('showcase_delivery');
  });

  it('declares measures and dimensions over the delivery backbone', () => {
    expect(DeliveryCube.sql).toBe('showcase_task');
    expect(Object.keys(DeliveryCube.measures ?? {})).toEqual(
      expect.arrayContaining(['count', 'total_estimate_hours', 'avg_estimate_hours', 'done_rate']),
    );
    expect(Object.keys(DeliveryCube.dimensions ?? {})).toEqual(
      expect.arrayContaining(['status', 'priority', 'due_date']),
    );
    expect(DeliveryCube.joins?.showcase_project?.relationship).toBe('many_to_one');
  });
});

describe('showcase gap fill — named import mapping (#2611)', () => {
  it('is wired into the stack definition', () => {
    const mappings = (stack as { mappings?: Array<{ name: string }> }).mappings ?? [];
    expect(mappings.map((m) => m.name)).toContain('showcase_inquiry_feed');
  });

  it('targets an existing object and its upsertKey fields exist on that object', () => {
    const mappings = (stack as { mappings?: Array<{ targetObject: string; upsertKey?: string[]; fieldMapping: Array<{ target: string | string[] }> }> }).mappings ?? [];
    const objects = ((stack as { objects?: Array<{ name: string; fields?: Record<string, unknown> }> }).objects ?? []);
    for (const m of mappings) {
      const target = objects.find((o) => o.name === m.targetObject);
      expect(target, `mapping targets missing object '${m.targetObject}'`).toBeDefined();
      const fieldNames = new Set(Object.keys(target?.fields ?? {}));
      for (const key of m.upsertKey ?? []) {
        expect(fieldNames.has(key), `upsertKey '${key}' not a field of '${m.targetObject}'`).toBe(true);
      }
      // Every mapped target lands on a real field — a typo'd target would
      // silently import into nowhere.
      for (const entry of m.fieldMapping) {
        for (const t of Array.isArray(entry.target) ? entry.target : [entry.target]) {
          expect(fieldNames.has(t), `mapped target '${t}' not a field of '${m.targetObject}'`).toBe(true);
        }
      }
    }
  });
});

/**
 * [#4936] Declarative api endpoints — the showcase declares NONE, on purpose.
 *
 * This block used to assert the opposite: that `showcase_task_feed` and
 * `showcase_inquiry_purge_api` were wired into the stack. They were — and that
 * was the problem. The metadata loaded perfectly (`GET /api/v1/meta/api`
 * returned both) while a real boot answered a bare 404 on each declared path,
 * because no route was ever mounted and the dispatcher branch behind them
 * called a `matchEndpoint` that no implementation provided. Every key was
 * declared ≠ enforced, `authRequired: true` included.
 *
 * So the assertion is inverted rather than deleted. A test that merely stopped
 * checking would let the endpoints drift back in silently; this one fails if
 * they do — which matters because re-adding them is no longer just inert, it
 * now breaks `objectstack validate` for the whole example.
 */
describe('[#4936] showcase declares no executable-less api endpoints', () => {
  it('ships an EMPTY `apis:` — the shape publish/validate still accepts', () => {
    const apis = (stack as { apis?: Array<{ name: string }> }).apis ?? [];
    expect(
      apis,
      'A non-empty `apis:` is rejected at publish/validate (#4936): the runtime has no ' +
        'executor for declarative endpoints, so declaring one would fail `objectstack ' +
        'validate` AND advertise a capability that does not exist (Prime Directive #10). ' +
        'The two definitions this example used to ship are preserved, commented, in ' +
        'src/system/apis/index.ts — restore them in the same PR that lands the executor (#5040).',
    ).toEqual([]);
  });

  it('still demonstrates HTTP endpoints the honest way — in code', () => {
    // The replacement path the coverage waiver points at. If this file ever
    // disappears the waiver is lying too, so pin it here rather than trusting
    // the note alone. (vitest runs with cwd = the package root, as
    // test/coverage.test.ts also relies on.)
    expect(
      existsSync(`${process.cwd()}/src/system/server/recalc-endpoint.ts`),
      "the code-mounted endpoint is the showcase's live HTTP proof",
    ).toBe(true);
  });
});

describe('showcase gap fill — object extension (overlay merge)', () => {
  it('is wired into the stack definition', () => {
    const exts = (stack as { objectExtensions?: Array<{ extend: string }> }).objectExtensions ?? [];
    expect(exts.map((e) => e.extend)).toContain('showcase_account');
  });

  it('merges its fields into showcase_account via the real SchemaRegistry', () => {
    const registry = new SchemaRegistry();
    registry.registerObject(Account as never, 'com.example.showcase', undefined, 'own');
    registry.registerObject(
      {
        name: AccountExtension.extend,
        label: AccountExtension.label,
        fields: AccountExtension.fields,
      } as never,
      'com.example.showcase.overlay',
      undefined,
      'extend',
      AccountExtension.priority,
    );

    const merged = registry.getObject('showcase_account') as {
      fields?: Record<string, { type?: string }>;
    };
    expect(merged).toBeDefined();
    // Extension fields landed…
    expect(merged.fields?.loyalty_tier?.type).toBe('select');
    expect(merged.fields?.linkedin_url?.type).toBe('url');
    expect(merged.fields?.csat_score?.type).toBe('number');
    // …without clobbering the owner's fields.
    expect(merged.fields?.annual_revenue).toBeDefined();
  });
});
