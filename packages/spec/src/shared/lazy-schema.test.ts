// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { lazySchema } from './lazy-schema';

describe('lazySchema', () => {
  it('does not invoke factory until first access', () => {
    const factory = vi.fn(() => z.object({ name: z.string() }));
    lazySchema(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('invokes factory exactly once across many parses', () => {
    const factory = vi.fn(() => z.object({ name: z.string() }));
    const schema = lazySchema(factory);
    schema.parse({ name: 'a' });
    schema.parse({ name: 'b' });
    schema.safeParse({ name: 'c' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('parses and rejects identical to underlying schema', () => {
    const schema = lazySchema(() => z.object({ age: z.number() }));
    expect(schema.parse({ age: 5 })).toEqual({ age: 5 });
    const r = schema.safeParse({ age: 'x' });
    expect(r.success).toBe(false);
  });

  it('forwards .shape, .optional, .array', () => {
    const schema = lazySchema(() => z.object({ id: z.string() }));
    expect((schema as any).shape.id).toBeDefined();
    const opt = (schema as any).optional();
    expect(opt.safeParse(undefined).success).toBe(true);
    const arr = (schema as any).array();
    expect(arr.safeParse([{ id: 'a' }]).success).toBe(true);
  });

  it('preserves .refine / .transform behavior', () => {
    const schema = lazySchema(() =>
      z.string().transform((s) => s.toUpperCase()).pipe(z.string().min(2)),
    );
    expect(schema.parse('ab')).toBe('AB');
  });

  it('respects OS_EAGER_SCHEMAS=1', () => {
    const prev = process.env.OS_EAGER_SCHEMAS;
    process.env.OS_EAGER_SCHEMAS = '1';
    try {
      const factory = vi.fn(() => z.object({ x: z.number() }));
      lazySchema(factory);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env.OS_EAGER_SCHEMAS;
      else process.env.OS_EAGER_SCHEMAS = prev;
    }
  });
});

/**
 * zod's `toJSONSchema` keys its `seen` map on the traversed node (the Proxy),
 * while its wrapper-type processors (pipe/lazy/optional/…) look themselves up
 * via the construction-time REAL instance. Without the `_zod` facade aliasing
 * the two identities, any lazySchema wrapping a non-object root — e.g. the
 * ADR-0089 D3a `.strict().transform(…)` pipes — crashed with
 * `Cannot set properties of undefined (setting 'ref')` (objectui#2561).
 */
describe('lazySchema × z.toJSONSchema identity', () => {
  const TO_JSON = { io: 'input', unrepresentable: 'any' } as const;

  it('converts a lazy `.strict().transform(…)` pipe (ADR-0089 D3a shape)', () => {
    const schema = lazySchema(() =>
      z.object({ name: z.string() }).strict().transform((v) => v),
    );
    const json = z.toJSONSchema(schema, TO_JSON) as Record<string, any>;
    expect(json.properties?.name).toBeDefined();
  });

  it('converts recursion reaching the pipe through `z.lazy(() => proxy)` (FormFieldSchema shape)', () => {
    const NodeSchema: z.ZodType<any> = lazySchema(() =>
      z
        .object({
          field: z.string(),
          fields: z.array(z.lazy(() => NodeSchema)).optional(),
        })
        .strict()
        .transform((v) => v),
    );
    const json = z.toJSONSchema(NodeSchema, TO_JSON);
    expect(JSON.stringify(json)).toContain('field');
  });

  it('does not crash when one conversion sees both the proxy and the real instance', () => {
    const Leaf: z.ZodType<any> = lazySchema(() =>
      z.object({ id: z.string() }).strict().transform((v) => v),
    );
    // `.optional()` resolves through the proxy and captures the REAL pipe as
    // its innerType; the `z.lazy` getter hands zod the PROXY — one traversal
    // meets both identities in either order.
    const DocA = z.object({
      a: (Leaf as any).optional(),
      b: z.lazy(() => Leaf),
    });
    const DocB = z.object({
      b: z.lazy(() => Leaf),
      a: (Leaf as any).optional(),
    });
    for (const Doc of [DocA, DocB]) {
      const json = z.toJSONSchema(Doc, TO_JSON) as Record<string, any>;
      expect(json.properties?.a).toBeDefined();
      expect(json.properties?.b).toBeDefined();
    }
  });

  it('memoises the `_zod` facade (identity-stable across accesses)', () => {
    const schema = lazySchema(() => z.object({ x: z.number() }).strict().transform((v) => v));
    expect((schema as any)._zod).toBe((schema as any)._zod);
  });
});

/**
 * #19101 — a schema referenced through the Proxy converts with the SAME
 * metadata as the eager instance. zod reads `.describe()` / `.meta()` from its
 * registry by node identity; the node is the Proxy, the metadata sits on the
 * real instance, so before the facade aliased it every lazy reference lost its
 * `description` while `OS_EAGER_SCHEMAS=1` (no Proxy at all) kept it.
 */
describe('lazySchema × z.toJSONSchema metadata (#19101)', () => {
  it('a lazy reference converts exactly like the eager instance — nested and as the root', () => {
    const factory = () => z.record(z.string(), z.unknown()).describe('lazy-described record');
    const lazy = lazySchema(factory);
    const eager = factory();
    expect(z.toJSONSchema(z.object({ rows: z.array(lazy) }))).toEqual(
      z.toJSONSchema(z.object({ rows: z.array(eager) })),
    );
    expect(z.toJSONSchema(lazy)).toEqual(z.toJSONSchema(eager));
  });

  it("the real instance's own describe wins over the one it inherits from its parent", () => {
    const Base = z.string().describe('inherited');
    const lazy = lazySchema(() => Base.describe('own'));
    const json = z.toJSONSchema(z.object({ v: lazy })) as unknown as { properties: { v: { description?: string } } };
    expect(json.properties.v.description).toBe('own');
  });

  it('`id` is NOT aliased onto the Proxy — aliasing it makes zod throw "Duplicate schema id"', () => {
    const Leaf: z.ZodType<any> = lazySchema(() =>
      z.object({ x: z.string() }).meta({ id: 'LazySchemaIdProbe19101', description: 'probe' }),
    );
    const Doc = z.object({ a: (Leaf as any).optional(), b: z.lazy(() => Leaf) });
    const json = z.toJSONSchema(Doc) as unknown as { properties: { b: { description?: string } } };
    expect(json.properties.b.description).toBe('probe');
    expect(z.globalRegistry.get(Leaf)?.id).toBeUndefined();
  });
});

/**
 * The same property on the real contract, against a REAL eager run: a child
 * process imports the spec with `OS_EAGER_SCHEMAS=1` (no Proxy anywhere) and
 * prints the conversions; this process converts the same schemas lazily. The
 * child enters through `kernel/metadata-type-schemas.ts`, because an eager
 * load that starts at `api/` or `data/` dies on the filter.zod → strict-object
 * → suggestions.zod → field.zod cycle filed as #19930.
 *
 * Measured at the fix (lazy before → after, eager unchanged): the nine OpenAPI
 * components gain 2 descriptions, every `/meta/types` schema 170, the
 * `os generate` IDE schema 445; description is the only key that moved.
 */
describe('lazy == eager on the real contract (#19101)', () => {
  const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const CONTRACT = new URL('../api/contract.zod.ts', import.meta.url).href;
  const METADATA_TYPES = new URL('../kernel/metadata-type-schemas.ts', import.meta.url).href;
  const OPTS = { unrepresentable: 'any' } as const;
  // tsx compiles .ts to CJS, so a namespace may arrive under `default`.
  const pick = (mod: any, key: string): any => mod[key] ?? mod.default?.[key];

  it('RecordDataSchema inside ListRecordResponse, and the `dataset` /meta/types schema', async () => {
    const eager = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e',
          `import ${JSON.stringify(METADATA_TYPES)};
           const { z } = await import('zod');
           const pick = (mod, key) => mod[key] ?? mod.default?.[key];
           const contract = await import(${JSON.stringify(CONTRACT)});
           const types = await import(${JSON.stringify(METADATA_TYPES)});
           const opts = ${JSON.stringify(OPTS)};
           process.stdout.write(JSON.stringify({
             listRecordResponse: z.toJSONSchema(pick(contract, 'ListRecordResponseSchema'), opts),
             dataset: z.toJSONSchema(pick(types, 'getMetadataTypeSchema')('dataset'), opts),
           }));`],
        {
          cwd: PKG_ROOT,
          env: { ...process.env, OS_EAGER_SCHEMAS: '1' },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    );

    const contract = await import('../api/contract.zod');
    const types = await import('../kernel/metadata-type-schemas');
    const lazy = JSON.parse(JSON.stringify({
      listRecordResponse: z.toJSONSchema(pick(contract, 'ListRecordResponseSchema'), OPTS),
      dataset: z.toJSONSchema(pick(types, 'getMetadataTypeSchema')('dataset'), OPTS),
    }));

    // The named leaf first, for a failure that says what went missing.
    const declared = pick(contract, 'RecordDataSchema').description;
    expect(typeof declared === 'string' && declared.length > 0).toBe(true);
    expect(eager.listRecordResponse.properties.data.items.description).toBe(declared);
    expect(lazy.listRecordResponse.properties.data.items.description).toBe(declared);
    expect(lazy).toStrictEqual(eager);
  }, 60_000);
});
