// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18163] The published hook `ctx.api` type face, pinned from both sides.
 *
 * Two independent things can go wrong with {@link HookApi}, and each leg below
 * answers exactly one of them:
 *
 *  1. **It stops describing the object the engine binds.** Pinned as
 *     assignability against `IScopedContext` — the CHECKED contract ObjectQL's
 *     `ScopedContext` and `ObjectRepository` carry `implements` clauses
 *     against. If `HookApi` ever declares a member or a return the checked
 *     contract cannot satisfy, this file stops compiling.
 *
 *     ⚠️ NOT PINNED HERE, by construction: that the CLASS `ScopedContext`
 *     satisfies `HookApi`. `packages/spec` must not depend on
 *     `packages/objectql` (only objectql can execute a dispatch, and spec is
 *     the contract both sides read), so the class-vs-type leg belongs in
 *     objectql beside `hook-input-shape-contract.test.ts`, which is where the
 *     engine's other spec-contract pins live. It has been MEASURED once — this
 *     card's contract review ran an objectql scratch probe with negative
 *     controls and both `ScopedContext extends HookApi` and
 *     `ObjectRepository extends HookObjectApi` hold — but a measurement taken
 *     once is not a pin, and the standing pin is still owed.
 *
 *     ⛔ The assignability leg below is NOT a substitute for it: it runs the
 *     other direction. `IScopedObjectRepository` declares no `delete`, so
 *     "`HookApi` is a usable `IScopedContext`" cannot stand in for "the object
 *     the engine builds is a usable `HookApi`".
 *
 *  2. **The option bags drift from the engine's accepted vocabulary.** Every
 *     shape is derived by `Omit`/`Pick` from the `Engine*Options` schemas the
 *     engine's own per-method legal-key sets are pinned against
 *     (`engine-unknown-option.test.ts` asserts each `ENGINE_*_OPTION_KEYS` set
 *     equals its schema's shape). The runtime leg below pins each schema's key
 *     set as KEPT ∪ OMITTED, so a seventh key added to a schema lands red here
 *     until someone decides which side of the split it is on — the same
 *     discipline the engine applies to `RPC_QUERY_ALIAS_SLOTS`.
 *
 * The `@ts-expect-error` pins are real checks here: `tsconfig.test.json`
 * compiles this layer (`pnpm --filter @objectstack/spec check:test-typecheck`),
 * so deleting a directive turns the gate red rather than leaving it green.
 */

import { describe, expect, it } from 'vitest';

import {
  EngineCountOptionsSchema,
  EngineDeleteOptionsSchema,
  EngineQueryOptionsSchema,
  EngineUpdateOptionsSchema,
} from './data-engine.zod';
import type {
  EngineTransactionInfo,
  EngineTransactionOptions,
  HookApi,
  HookCountQuery,
  HookDeleteOptions,
  HookObjectApi,
  HookQuery,
  HookUpdateOptions,
} from './hook-api';
import type { IScopedContext, IScopedObjectRepository } from '../contracts/scoped-context';

/** `true` only when every `A` is a usable `B`. */
type Assignable<A, B> = [A] extends [B] ? true : false;

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();

describe('HookApi — the published hook ctx.api face', () => {
  describe('stays a usable IScopedContext', () => {
    it('HookApi satisfies the checked implementation contract', () => {
      const apiIsAScopedContext: Assignable<HookApi, IScopedContext> = true;
      const repoIsAScopedRepository: Assignable<HookObjectApi, IScopedObjectRepository> = true;
      expect([apiIsAScopedContext, repoIsAScopedRepository]).toEqual([true, true]);
    });

    it('a hook can narrow ctx.api to it without going through `unknown`', () => {
      // The authoring idiom the export exists for. `HookContext['api']` is
      // `IScopedContext | undefined`; this cast has to stay legal, so the two
      // faces must remain COMPARABLE — a direct `as` here, never `as unknown as`.
      const ctxApi = undefined as unknown as IScopedContext | undefined;
      const api = ctxApi as HookApi | undefined;
      expect(api).toBeUndefined();
    });
  });

  describe('the where-only rule', () => {
    it('accepts the canonical spellings', () => {
      const query: HookQuery = {
        where: { status: 'active' },
        fields: ['id', 'name'],
        orderBy: [{ field: 'name', order: 'asc' }],
        limit: 10,
        offset: 20,
      };
      expect(Object.keys(query).sort()).toEqual(
        ['fields', 'limit', 'offset', 'orderBy', 'where'].sort(),
      );
    });

    it('refuses the alias spellings at compile time', () => {
      const withFilter: HookQuery = {
        where: { status: 'active' },
        // @ts-expect-error `filter` is the ALIAS of `where`. The engine folds
        // the slot and throws when the two spellings carry different values;
        // omitting the key makes that hazard a compile error instead.
        filter: { status: 'won' },
      };
      const withTop: HookQuery = {
        limit: 3,
        // @ts-expect-error `top` is the OData alias of `limit`, folded by the
        // same slot table and refused on the same value disagreement.
        top: 1,
      };
      const withContext: HookQuery = {
        where: { id: 'a' },
        // @ts-expect-error the repository INJECTS `context` after the spread,
        // so a caller-supplied one is discarded before the engine sees it.
        context: { isSystem: true },
      };
      expect([withFilter, withTop, withContext].length).toBe(3);
    });

    it('refuses the wire-only spellings the engine rejects at the entry point', () => {
      const wireOnly: HookQuery = {
        // @ts-expect-error `select` is the wire spelling of `fields`; a direct
        // engine call bypasses the RPC fold, so the engine rejects it by name.
        select: ['id'],
      };
      expect(wireOnly).toBeTruthy();
    });
  });

  describe('count is not find narrowed by habit', () => {
    it('takes `where` and refuses everything else', () => {
      const ok: HookCountQuery = { where: { status: 'active' } };
      const withLimit: HookCountQuery = {
        // @ts-expect-error `count` honours no pagination — `ENGINE_COUNT_OPTION_KEYS`
        // is `{ context, where }` and the engine rejects anything else.
        limit: 5,
      };
      const withPassthrough: HookCountQuery = {
        // @ts-expect-error `count` never forwards its bag to the driver, so the
        // pass-through keys that ARE legal on find/update/delete are rejected here.
        tenantId: 'org_1',
      };
      expect([ok, withLimit, withPassthrough].length).toBe(3);
    });
  });

  describe('write option bags', () => {
    it('update carries the predicate form, the observability keys and the pass-throughs', () => {
      const bulk: HookUpdateOptions = {
        where: { status: 'draft' },
        multi: true,
        returning: true,
        strictReadonlyWrites: true,
        onFieldsDropped: (event) => void event.fields,
        tenantId: 'org_1',
      };
      const retired: HookUpdateOptions = {
        // @ts-expect-error `upsert` is a retired-key tombstone (#8057). It stays
        // on the schema to carry its migration text, never on a surface
        // published after the retirement.
        upsert: true,
      };
      expect([bulk, retired].length).toBe(2);
    });

    it('delete carries the predicate form and no update-only keys', () => {
      const ok: HookDeleteOptions = { where: { status: 'stale' }, multi: true };
      const wrong: HookDeleteOptions = {
        where: { id: 'a' },
        // @ts-expect-error `returning` is an UPDATE option; the engine's delete
        // set is `{ context, where, multi }` plus the pass-throughs.
        returning: true,
      };
      expect([ok, wrong].length).toBe(2);
    });
  });

  describe('nameability — every type this face references structurally is reachable here', () => {
    // These three names are imported FROM './hook-api', not from the contracts
    // files that declare them, so deleting a re-export line does not merely
    // widen the surface: it stops this file compiling and `check:test-typecheck`
    // goes red. That is the whole pin — a consumer importing only
    // `@objectstack/spec/data` and emitting declarations answers TS2883 without
    // them, and `check:entry-nameability` cannot see it (it probes the call
    // surface of VALUE exports; `HookApi` is a type).
    it('both types the transaction signature references', () => {
      const infoIsReachable: Assignable<EngineTransactionInfo, EngineTransactionInfo> = true;
      const optsIsReachable: Assignable<EngineTransactionOptions, EngineTransactionOptions> = true;
      expect([infoIsReachable, optsIsReachable]).toEqual([true, true]);
    });
  });

  describe('drift pin — each derived shape equals KEPT ∪ OMITTED on its schema', () => {
    // Restated here on purpose rather than imported: a schema key added later
    // has to be DECIDED onto one of the two lists, and this pin is what forces
    // the decision instead of letting `Omit` silently widen the published type.
    const cases: { name: string; schema: unknown; kept: string[]; omitted: string[] }[] = [
      {
        name: 'HookQuery / EngineQueryOptionsSchema',
        schema: EngineQueryOptionsSchema,
        kept: ['where', 'fields', 'orderBy', 'limit', 'offset', 'search', 'searchFields', 'expand'],
        omitted: ['context', 'top', 'cursor', 'distinct'],
      },
      {
        name: 'HookCountQuery / EngineCountOptionsSchema',
        schema: EngineCountOptionsSchema,
        kept: ['where'],
        omitted: ['context'],
      },
      {
        name: 'HookUpdateOptions / EngineUpdateOptionsSchema',
        schema: EngineUpdateOptionsSchema,
        kept: ['where', 'multi', 'returning'],
        omitted: ['context', 'upsert'],
      },
      {
        name: 'HookDeleteOptions / EngineDeleteOptionsSchema',
        schema: EngineDeleteOptionsSchema,
        kept: ['where', 'multi'],
        omitted: ['context'],
      },
    ];

    for (const { name, schema, kept, omitted } of cases) {
      it(name, () => {
        expect(shapeKeys(schema)).toEqual([...kept, ...omitted].sort());
      });
    }
  });
});
