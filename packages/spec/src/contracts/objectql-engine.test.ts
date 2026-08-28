import { describe, it, expect } from 'vitest';
import type { EngineSchemaRegistryView, IObjectQLEngine } from './objectql-engine';
import type { ServiceObject } from '../data/object.zod';

/**
 * `getObject` — typed on the contract, not re-declared by consumers
 * (#12248, fork 3 of the 2026-08-25 maintainer ruling on #11833).
 *
 * Reverse-verified against the pre-#12248 contract (measured 2026-08-26 on
 * this branch's base): with both members declared `unknown`, the consumer
 * reads below (`?.fields`, `?.external`) are compile errors on the contract
 * value — which is exactly why `service-analytics`, `service-storage` and the
 * registry-view readers each carried a private structural re-declaration or
 * an `any` to perform them. Every positive pin below therefore goes red on a
 * revert to `unknown` with no `@ts-expect-error` needed: the read itself
 * stops compiling.
 *
 * No engine double is stood up here — every pin reads the MEMBER type off the
 * contract (`check:engine-double-contract` counts this file's doubles against
 * a shrink-only baseline, and a pin block is not a reason to grow it).
 */
describe('getObject return contract (#12248, #11833 fork 3)', () => {
  type EngineAnswer = ReturnType<IObjectQLEngine['getObject']>;
  type RegistryAnswer = ReturnType<EngineSchemaRegistryView['getObject']>;

  it('the engine-level member answers exactly the spec registered-object type', () => {
    // Mutual extends: a revert to `unknown` — the shape that forced the
    // consumer-side re-declarations — resolves `Exact` to `never`, as does a
    // drift to the PARSED state (`ServiceObjectParsed`): the registry stores
    // the authored state (`z.input`, ADR-0122).
    type Exact = EngineAnswer extends ServiceObject | undefined
      ? (ServiceObject | undefined extends EngineAnswer ? 'exact' : never)
      : never;
    const exact: Exact = 'exact';
    expect(exact).toBe('exact');
  });

  it('the registry view answers the same type — the alias holds', () => {
    type Exact = RegistryAnswer extends ServiceObject | undefined
      ? (ServiceObject | undefined extends RegistryAnswer ? 'exact' : never)
      : never;
    const exact: Exact = 'exact';
    expect(exact).toBe('exact');
  });

  it('a consumer reads fields and the federation marker off the contract value directly', () => {
    // The two reads every measured re-declaration existed to perform:
    // `service-analytics` (field metadata for dimension labels + the ADR-0015
    // `external` marker) and `service-storage` (file-class field scan). On the
    // pre-#12248 `unknown` return, each line below is a compile error.
    const readFields = (engine: IObjectQLEngine, objectName: string) =>
      engine.getObject(objectName)?.fields;
    const readExternal = (view: EngineSchemaRegistryView, objectName: string) =>
      view.getObject(objectName)?.external;
    const readFieldFacts = (engine: IObjectQLEngine, objectName: string, field: string) => {
      const def = engine.getObject(objectName)?.fields[field];
      return { type: def?.type, reference: def?.reference, options: def?.options };
    };
    expect(typeof readFields).toBe('function');
    expect(typeof readExternal).toBe('function');
    expect(typeof readFieldFacts).toBe('function');
  });

  it('the contract answer satisfies the shape service-analytics re-declared locally', () => {
    // The exhibit from the #11833 measurement: `DataEngineLike.getObject?`'s
    // declared return in `service-analytics/src/plugin.ts`. The contract type
    // must remain assignable to it, or substituting the contract for the
    // local type (the services-lane half this card unblocks) needs a cast —
    // the outcome the ruling forbids.
    type AnalyticsLocalView =
      | {
          fields?: Record<
            string,
            {
              type?: string;
              reference?: string;
              options?: Array<{ value: unknown; label?: string }>;
            }
          >;
          external?: unknown;
        }
      | undefined;
    type Substitutable = EngineAnswer extends AnalyticsLocalView ? 'substitutable' : never;
    const ok: Substitutable = 'substitutable';
    expect(ok).toBe('substitutable');
  });
});

/**
 * `getSchema` — typed on the contract, one member over from `getObject`
 * (#12481; the #11833 ruling's fork 3 as executed by #12248, applied by
 * inheritance: `ObjectQL.getObject` is literally `return this.getSchema(name)`,
 * so the mother ruling's reason transfers whole).
 *
 * Same pin discipline as the block above: every pin reads the MEMBER type off
 * the contract, no engine double is stood up, and on a revert to `unknown` the
 * consumer reads below stop compiling with no `@ts-expect-error` needed.
 */
describe('getSchema return contract (#12481 — #12248 one member over, #11833 fork 3 by inheritance)', () => {
  type SchemaAnswer = ReturnType<IObjectQLEngine['getSchema']>;

  it('answers exactly the spec registered-object type', () => {
    // Mutual extends: a revert to `unknown` (the shape that forced the
    // consumer-side casts) resolves `Exact` to `never`, as does a drift to
    // the parsed state (`ServiceObjectParsed`) — authored state (`z.input`,
    // ADR-0122), exactly as the `getObject` pins above.
    type Exact = SchemaAnswer extends ServiceObject | undefined
      ? (ServiceObject | undefined extends SchemaAnswer ? 'exact' : never)
      : never;
    const exact: Exact = 'exact';
    expect(exact).toBe('exact');
  });

  it('getSchema and getObject cannot drift apart — the alias holds on the contract', () => {
    type ObjectAnswer = ReturnType<IObjectQLEngine['getObject']>;
    type Same = SchemaAnswer extends ObjectAnswer
      ? (ObjectAnswer extends SchemaAnswer ? 'same' : never)
      : never;
    const same: Same = 'same';
    expect(same).toBe('same');
  });

  it('the engine-owned write guard reads its slice off the contract value directly', () => {
    // The measured re-narrowing this typing ends: `plugin-security`'s
    // engine-owned write guard cast `ql.getSchema(...)` to its local
    // `EngineOwnedSchemaLike` slice (`name` / `managedBy` / `userActions`)
    // to perform these reads. On the pre-#12481 `unknown` return each read
    // below is a compile error; after it, the contract answer must stay
    // assignable to that slice, or dropping the cast (the repair) would need
    // a cast back — the outcome the ruling forbids.
    const readManagedBy = (engine: IObjectQLEngine, objectName: string) =>
      engine.getSchema(objectName)?.managedBy;
    const readUserActions = (engine: IObjectQLEngine, objectName: string) =>
      engine.getSchema(objectName)?.userActions;
    type WriteGuardSlice =
      | { name?: string; managedBy?: string; userActions?: unknown }
      | undefined;
    type Substitutable = SchemaAnswer extends WriteGuardSlice ? 'substitutable' : never;
    const ok: Substitutable = 'substitutable';
    expect(typeof readManagedBy).toBe('function');
    expect(typeof readUserActions).toBe('function');
    expect(ok).toBe('substitutable');
  });
});
