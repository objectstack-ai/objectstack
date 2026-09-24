// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';

/** The slice of zod's metadata registry (`$ZodRegistry`) the facade uses. */
interface MetadataRegistryLike {
  get(schema: unknown): Record<string, unknown> | undefined;
  has(schema: unknown): boolean;
  add(schema: unknown, meta: Record<string, unknown>): unknown;
}

/** The slice of zod's `toJSONSchema` context a `processJSONSchema` hook receives. */
interface JsonSchemaHookContext {
  seen?: Map<unknown, unknown>;
  metadataRegistry?: MetadataRegistryLike;
}

/**
 * Wrap a Zod schema constructor so its body is only evaluated on first use.
 *
 * Why: building Zod schemas at module-load creates millions of closures that
 * dominate dev-server RSS even though most schemas are never parsed in a
 * given session. Wrapping the constructor in a Proxy defers allocation until
 * the first property access (`.parse`, `.shape`, `._def`, etc.) and reuses
 * a single cached instance thereafter.
 *
 * Type system: the returned Proxy is structurally indistinguishable from the
 * underlying ZodType, so `z.infer<typeof X>` and `.parse()` callers do not
 * need to change.
 *
 * Emergency rollback: set `OS_EAGER_SCHEMAS=1` to evaluate the
 * factory immediately and bypass the Proxy entirely.
 */
export function lazySchema<T extends z.ZodTypeAny>(factory: () => T): T {
  if (typeof process !== 'undefined' && process.env?.OS_EAGER_SCHEMAS === '1') {
    return factory();
  }

  let cached: T | undefined;
  const resolve = (): T => {
    if (cached === undefined) cached = factory();
    return cached;
  };

  const target = function lazyZod() {} as unknown as T;

  /**
   * Memoised `_zod` facade (one per proxy — `_zod.run` is the parse hot path).
   *
   * Why it exists: zod's `toJSONSchema` traversal keys its `seen` map on the
   * node object it was handed — this Proxy, wherever the schema is referenced
   * lazily (a `z.lazy(() => X)` recursion getter, or a direct conversion
   * root). But zod's per-type JSON-Schema hooks close over the REAL instance
   * at construction time (`inst._zod.processJSONSchema = (ctx, …) =>
   * pipeProcessor(inst, ctx, …)`), and the wrapper-type processors
   * (pipe/lazy/optional/default/…) then resolve `ctx.seen.get(inst)` — which
   * misses when the entry was keyed on the Proxy, crashing with
   * `Cannot set properties of undefined (setting 'ref')`. Plain-object
   * schemas never look themselves up, which kept this latent until ADR-0089
   * D3a turned FormFieldSchema / PageComponentSchema into
   * `.strict().transform(…)` pipes.
   *
   * The facade prototype-delegates every `_zod` read to the real internals,
   * wrapping only `processJSONSchema` to alias the Proxy's `seen` entry onto
   * the real instance before delegating, so both identities resolve to the
   * same entry. If the real instance was already traversed under its own
   * identity it keeps its entry (alias, never clobber).
   *
   * The same wrapper aliases the real instance's METADATA onto the Proxy
   * (#19101). zod reads a node's `.describe()` / `.meta()` with
   * `ctx.metadataRegistry.get(node)` right after this hook returns — a
   * WeakMap keyed on identity — and the node it holds is the Proxy while the
   * metadata was registered on the real instance, so every lazySchema
   * referenced by identity lost its authored `description` in lazy mode and
   * kept it under `OS_EAGER_SCHEMAS=1`, where no Proxy exists. The two modes
   * then published different JSON Schemas from one source: the OpenAPI
   * artifact, `/meta/types` and the `os generate` IDE schema all shipped the
   * lazy, description-less answer.
   */
  let zodFacade: object | undefined;
  const makeZodFacade = (real: T): object | undefined => {
    const realZod = (real as unknown as { _zod?: Record<string, unknown> })._zod;
    if (!realZod || typeof realZod.processJSONSchema !== 'function') {
      return realZod;
    }
    const delegate = realZod.processJSONSchema as (...a: unknown[]) => unknown;
    return Object.create(realZod as object, {
      processJSONSchema: {
        enumerable: true,
        value: (ctx: JsonSchemaHookContext, json: unknown, params: unknown) => {
          const seen = ctx?.seen;
          if (seen && typeof seen.get === 'function') {
            const entry = seen.get(proxy);
            if (entry !== undefined && !seen.has(real)) seen.set(real, entry);
          }
          const emitted = delegate(ctx, json, params);
          aliasMetadataOntoProxy(ctx?.metadataRegistry, real);
          return emitted;
        },
      },
    }) as object;
  };

  /**
   * Register the real instance's metadata under the Proxy identity in the
   * registry this conversion reads, once, and only when nothing is registered
   * under the Proxy already (alias, never clobber). The registry merges a
   * node's `_zod.parent` chain on read, which the Proxy shares with the real
   * instance, so the Proxy then answers exactly what the real instance does —
   * less `id`.
   */
  const aliasMetadataOntoProxy = (registry: MetadataRegistryLike | undefined, real: T): void => {
    if (!registry || typeof registry.get !== 'function' || typeof registry.has !== 'function'
      || typeof registry.add !== 'function' || registry.has(proxy)) {
      return;
    }
    const meta = registry.get(real);
    if (!meta) return;
    const aliased: Record<string, unknown> = { ...meta };
    // `id` stays un-aliased: the Proxy and the real instance both enter one conversion's seen map, and zod throws "Duplicate schema id" when two of its nodes share an id.
    delete aliased.id;
    if (Object.keys(aliased).length > 0) registry.add(proxy, aliased);
  };

  const proxy = new Proxy(target as object, {
    get(_t, prop) {
      const real = resolve() as unknown as Record<PropertyKey, unknown>;
      if (prop === '_zod') {
        zodFacade ??= makeZodFacade(real as unknown as T);
        return zodFacade;
      }
      const value = real[prop];
      if (typeof value === 'function') {
        return (value as (...a: unknown[]) => unknown).bind(real);
      }
      return value;
    },
    set(_t, prop, value) {
      const real = resolve() as unknown as Record<PropertyKey, unknown>;
      real[prop] = value;
      return true;
    },
    has(_t, prop) {
      return prop in (resolve() as object);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve() as object);
    },
    getOwnPropertyDescriptor(_t, prop) {
      return Reflect.getOwnPropertyDescriptor(resolve() as object, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve() as object);
    },
  });

  return proxy as T;
}
