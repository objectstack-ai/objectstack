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
 * [#5040 E8 / #5112] Declarative api endpoints — declared again, and now LIVE.
 *
 * The history in three lines, because it is the reason these assertions look
 * the way they do. Originally: "both endpoints are wired into the stack" — true,
 * and exactly the problem, because the metadata loaded perfectly while a real
 * boot answered a bare 404 on each declared path (#4936: nothing mounted them,
 * and the dispatcher branch behind them called a `matchEndpoint` no
 * implementation provided). Then, for one release: "the stack declares NONE",
 * asserting an empty `apis:`, because a non-empty one was refused at publish.
 * Now: declared again, with the executor behind them.
 *
 * These are STATIC assertions about the declaration — the executable proof that
 * the endpoints actually answer lives where it can only be answered, on a real
 * boot: `packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`.
 * Keeping the two apart is deliberate: a static test that claims runtime
 * behaviour is what #4936 caught, and no assertion in this file can tell you a
 * route is mounted.
 */
describe('[#5112] showcase declares its api endpoints again (#5040 E8)', () => {
  it('is wired into the stack definition', () => {
    const apis = (stack as { apis?: Array<{ name: string }> }).apis ?? [];
    expect(apis.map((a) => a.name)).toEqual(
      expect.arrayContaining(['showcase_task_feed', 'showcase_inquiry_purge_api']),
    );
  });

  it('declares every path inside this app’s ADR-0121 D1 namespace carve-out', () => {
    // The one edit the restoration made to the pre-#4936 declarations, and the
    // gate publish enforces: a path outside `/api/v1/apps/<namespace>/` parses
    // fine and matches NOTHING, because the endpoint step only ever consults
    // declarations under that mount.
    const namespace = (stack as { manifest?: { namespace?: string } }).manifest?.namespace;
    expect(namespace, '`apis:` requires an explicit manifest.namespace (ADR-0121 D2)').toBe('showcase');
    const apis = (stack as { apis?: Array<{ name: string; path: string }> }).apis ?? [];
    for (const api of apis) {
      expect(api.path, `endpoint '${api.name}' must live under this app's carve-out`).toMatch(
        new RegExp(`^/api/v1/apps/${namespace}/.+`),
      );
    }
  });

  it('opens no anonymous surface — every endpoint is session-gated', () => {
    // `authRequired` DEFAULTS to true, so this passes for an omitted key too.
    // The assertion is about `false`: it is the only thing that opens an
    // anonymous execution entry point, and ADR-0121 D6 pairs it with a
    // mandatory ARMED rate limit. Neither of these endpoints was ever
    // anonymous; an example must not grow a public surface it never had.
    const apis = (stack as { apis?: Array<{ name: string; authRequired?: boolean; rateLimit?: { enabled?: boolean } }> }).apis ?? [];
    for (const api of apis) {
      if (api.authRequired === false) {
        expect(
          api.rateLimit?.enabled,
          `endpoint '${api.name}' is anonymous, so ADR-0121 D6 requires an ARMED rateLimit`,
        ).toBe(true);
      }
    }
    expect(apis.filter((a) => a.authRequired === false)).toEqual([]);
  });

  it('flow-typed endpoints target flows that actually exist (no 500 at dispatch)', () => {
    const apis = (stack as { apis?: Array<{ type: string; target: string }> }).apis ?? [];
    const flowNames = ((stack as { flows?: Array<{ name: string }> }).flows ?? []).map((f) => f.name);
    for (const api of apis.filter((a) => a.type === 'flow')) {
      expect(flowNames, `api endpoint targets missing flow '${api.target}'`).toContain(api.target);
    }
  });

  it('object_operation endpoints address objects that exist (via objectParams.object — `target` is unread for this type, #10338)', () => {
    const apis = (stack as { apis?: Array<{ type: string; objectParams?: { object?: string } }> }).apis ?? [];
    const objectNames = ((stack as { objects?: Array<{ name: string }> }).objects ?? []).map((o) => o.name);
    for (const api of apis.filter((a) => a.type === 'object_operation')) {
      // `objectParams.object` is what the executor delegates on; `target` is
      // unread for this type and the example no longer writes it.
      expect(objectNames, `api endpoint addresses missing object '${api.objectParams?.object}'`)
        .toContain(api.objectParams?.object);
    }
  });

  it('still demonstrates HTTP endpoints in code as well', () => {
    // The code-mounted counterpart the coverage note points at. If this file
    // ever disappears the note is lying too, so pin it here rather than
    // trusting the prose alone. (vitest runs with cwd = the package root, as
    // test/coverage.test.ts also relies on.)
    expect(
      existsSync(`${process.cwd()}/src/system/server/recalc-endpoint.ts`),
      'the code-mounted endpoint is the showcase’s other live HTTP proof',
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
