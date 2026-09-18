// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the NESTED resolution rules behind checks (b2)/(b3) (#17969).
 *
 * THE DEFECT THESE PIN. `build-schemas.ts` built the set check (b2) consults
 * from `schema.properties`, ONE LEVEL DEEP. A dotted `RETIRED_KEYS_BY_MAJOR`
 * row therefore matched nothing in it and was silently IGNORED rather than
 * judged — measured by ablation on `origin/main`: a fabricated nested row
 * (`system/SchemaLevelIsolationStrategy:performance.zzNotARealKey9999`) passed
 * `check:authorable-surface` at exit 0 with zero ❌, against a lit control (a
 * live TOP-LEVEL key) refused at exit 1. 48 of the shipped rows are nested, and
 * the retirement ledger feeds the ADR-0087 conversions downstream.
 *
 * WHY A UNIT PIN BESIDE THE SANDBOX ONE. The gate's own discrimination is
 * pinned end-to-end in `build-schemas-check-mode.test.ts` (#17969's four
 * controls, spawned against the real generator). What cannot be reached from
 * there is the RESOLUTION rule itself: the shipped tree exercises three of its
 * traversals and none of its refusals, so a rule that quietly stopped following
 * `$ref`, or started descending into a record's value shape, would move nothing
 * a sandbox case can see until the first row lands on that shape — and land it
 * would, as a false red or a false green. These are the same
 * "assert the extracted pure function, not the artifact" shape as
 * `nested-shape.test.ts` and `authorable-defaults.test.ts`.
 *
 * MEASURED over the 48 nested rows this tree declares: `properties` alone
 * resolves 43, `items` carries the other 2, and 3 name a def this build does
 * not emit (the change-management family, retired whole). `$ref`, the union
 * combinators and the `additionalProperties` refusal are load-bearing for rows
 * that do not exist yet — which is exactly why they are pinned here rather than
 * left to the population.
 */

import { describe, expect, it } from 'vitest';

import {
  isNestedAuthorableKey,
  isRetiredJsonSchemaNode,
  nestedAuthorableKeyState,
  type NestedAuthorableKeyState,
} from './lib/nested-authorable-keys';

/** `retiredKey()` as Zod renders it into a JSON Schema property. */
const TOMBSTONE = { not: {} } as const;

/** One def's emitted document, in the shape `gen:schema` writes it. */
const DEF = {
  type: 'object',
  properties: {
    strategy: { type: 'string' },
    performance: {
      type: 'object',
      properties: {
        poolPerSchema: { type: 'boolean' },
        schemaCacheTtlSeconds: { type: 'integer' },
        schemaCacheTTL: { ...TOMBSTONE, description: '[REMOVED] renamed to schemaCacheTtlSeconds' },
      },
    },
    exporter: {
      type: 'object',
      properties: {
        batch: {
          type: 'object',
          properties: { scheduledDelay: TOMBSTONE, maxQueueSize: { type: 'integer' } },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { estimatedMinutes: TOMBSTONE, description: { type: 'string' } },
      },
    },
    headers: {
      type: 'object',
      additionalProperties: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} as const;

const REFFED = {
  type: 'object',
  properties: { window: { $ref: '#/$defs/Window' } },
  $defs: {
    Window: { type: 'object', properties: { size: TOMBSTONE, unit: { type: 'string' } } },
  },
} as const;

const UNION = {
  anyOf: [
    { type: 'object', properties: { retry: { type: 'object', properties: { delay: TOMBSTONE } } } },
    {
      type: 'object',
      properties: { retry: { type: 'object', properties: { delay: { type: 'integer' } } } },
    },
  ],
} as const;

/** A recursive schema, in the spelling Zod emits for one: a bare root `#`. */
const SELF_REFERENTIAL = {
  type: 'object',
  properties: { child: { $ref: '#' }, leaf: TOMBSTONE },
} as const;

const SCHEMAS: ReadonlyMap<string, Record<string, unknown>> = new Map<string, Record<string, unknown>>([
  ['system/Def', DEF as unknown as Record<string, unknown>],
  ['system/Reffed', REFFED as unknown as Record<string, unknown>],
  ['system/Union', UNION as unknown as Record<string, unknown>],
  ['system/SelfRef', SELF_REFERENTIAL as unknown as Record<string, unknown>],
]);

const state = (key: string): NestedAuthorableKeyState => nestedAuthorableKeyState(key, SCHEMAS);

describe('isNestedAuthorableKey — a dotted NAME half, never a dotted def half', () => {
  it('is true only when the name half carries a dot', () => {
    expect(isNestedAuthorableKey('system/Def:performance.schemaCacheTTL')).toBe(true);
    expect(isNestedAuthorableKey('system/Def:strategy')).toBe(false);
  });

  it('a def key with no name half is not nested', () => {
    // `carryAuthorableKey` returns such a string unchanged, so the filter has
    // to answer it rather than index past a `-1`.
    expect(isNestedAuthorableKey('system/Def')).toBe(false);
  });

  it('is LEXICAL, and therefore not by itself a verdict that a row names a path', () => {
    // Four keys on the shipped baseline are TOP-LEVEL property names that carry
    // a dot. This predicate says `true` for all of them, on purpose: the caller
    // asks the emitted schema first (`currentKeys.has(key)`) and only reads what
    // is left over as a path. A test that expected `false` here would be
    // pinning a disambiguation this function cannot perform — it is handed one
    // string and no schema.
    expect(isNestedAuthorableKey('api/ODataResponse:@odata.context')).toBe(true);
    expect(
      isNestedAuthorableKey(
        'identity/SCIMUser:urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      ),
    ).toBe(true);
  });
});

describe('isRetiredJsonSchemaNode — the `{ "not": {} }` a retiredKey() renders as', () => {
  it('reads an empty `not` as the tombstone and anything else as live', () => {
    expect(isRetiredJsonSchemaNode(TOMBSTONE)).toBe(true);
    expect(isRetiredJsonSchemaNode({ not: { type: 'string' } })).toBe(false);
    expect(isRetiredJsonSchemaNode({ type: 'string' })).toBe(false);
    expect(isRetiredJsonSchemaNode(undefined)).toBe(false);
  });
});

describe('nestedAuthorableKeyState — the three states a registered nested row can be in', () => {
  it('a nested tombstone reads `retired` — the state a correct row is in', () => {
    expect(state('system/Def:performance.schemaCacheTTL')).toBe('retired');
  });

  it('a nested key still writable reads `live` — the (b2) defect, one level down', () => {
    expect(state('system/Def:performance.poolPerSchema')).toBe('live');
  });

  it('a path the def does not carry reads `unresolvable` — the #17969 probe', () => {
    expect(state('system/Def:performance.zzNotARealKey9999')).toBe('unresolvable');
  });

  it('an absent INTERMEDIATE segment reads `unresolvable` too, not just an absent leaf', () => {
    expect(state('system/Def:zzNoSuchBlock.schemaCacheTTL')).toBe('unresolvable');
  });

  it('a def this build does not emit reads `def-not-emitted` — the steady state, left unjudged', () => {
    // The whole-def removal route: registered in RETIRED_DEFS_BY_MAJOR and
    // adjudicated by the json-schema.manifest/ ratchet, which subsumes the key
    // entries under it. Reading these as unresolvable would be a false red on
    // three shipped rows.
    expect(state('system/ChangeImpact:downtime.durationMinutes')).toBe('def-not-emitted');
  });

  it('a two-level path resolves through both objects', () => {
    expect(state('system/Def:exporter.batch.scheduledDelay')).toBe('retired');
    expect(state('system/Def:exporter.batch.maxQueueSize')).toBe('live');
  });

  it('an empty segment is unresolvable rather than a match on the object itself', () => {
    expect(state('system/Def:performance.')).toBe('unresolvable');
  });

  it('a key with no name half at all is unresolvable, never a crash', () => {
    expect(state('system/Def')).toBe('unresolvable');
  });
});

describe('nestedAuthorableKeyState — the traversals that keep a legitimate row resolving', () => {
  it('an array member is spelled WITHOUT its `[]`, so `items` costs no segment', () => {
    // The registry writes `system/RollbackPlan:steps.estimatedMinutes` for what
    // its own prose calls `RollbackPlan.steps[].estimatedMinutes`. Two shipped
    // rows resolve only through this step.
    expect(state('system/Def:steps.estimatedMinutes')).toBe('retired');
    expect(state('system/Def:steps.description')).toBe('live');
  });

  it('a `$ref` into the document\'s own `$defs` is followed', () => {
    expect(state('system/Reffed:window.size')).toBe('retired');
    expect(state('system/Reffed:window.unit')).toBe('live');
  });

  it('a bare root `#` — how a RECURSIVE schema refers to its own document — is followed', () => {
    // 36 of the shipped refs are spelled `#` rather than `#/$defs/…`. Reading
    // one as an external ref would make every path under a recursive node read
    // as a typo, which is this module's own false-red direction.
    expect(state('system/SelfRef:child.leaf')).toBe('retired');
  });

  it('a self-referential `$ref` terminates instead of recursing forever', () => {
    expect(state('system/SelfRef:child.child.child.leaf')).toBe('retired');
  });
});

describe('nestedAuthorableKeyState — the two directions it deliberately errs in', () => {
  it('a leaf live on ANY union branch reads `live`: the author can still write it', () => {
    // Refusing is the safe direction here — the row registers a retirement that
    // has not happened on at least one branch, which is (b2)'s whole subject.
    expect(state('system/Union:retry.delay')).toBe('live');
  });

  it('a record VALUE shape is not traversed — matching `headers.value` would skip a segment', () => {
    // An author writes `headers.<someHeader>.value`. Descending into
    // `additionalProperties` would resolve `headers.value` against a path no
    // author can write: a false GREEN, the one direction this must not take.
    expect(state('system/Def:headers.value')).toBe('unresolvable');
  });
});
