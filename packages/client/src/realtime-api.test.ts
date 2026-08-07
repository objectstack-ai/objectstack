// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4602 — subscribeMetadata delivers TRUE `MetadataEvent`s, validated at the
 * boundary.
 *
 * The callback is typed `(event: MetadataEvent) => void` — top-level `id`
 * (uuid), `metadataType`, `name`, `definition?`, `userId?`. Before this fix
 * the handler delivered the raw `RealtimeEventPayload` envelope via
 * `callback(event as any as MetadataEvent)`, so `event.name` /
 * `event.metadataType` were `undefined` at runtime while the types said
 * `string`.
 *
 * Pins:
 *  - the subscriber receives the top-level fields (fails on the pre-fix
 *    envelope-passthrough);
 *  - an off-contract payload (e.g. the pre-fix producer's nested shape) is
 *    rejected LOUDLY — callback never invoked, error surfaced — not passed
 *    through or coerced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { MetadataEvent, MetadataEventSubject } from '@objectstack/spec/api';
import { RealtimeAPI } from './realtime-api';

const VALID_EVENT = {
  id: 'a3bb189e-8bf9-4888-9912-ace4e6543002',
  type: 'metadata.object.created',
  metadataType: 'object',
  name: 'account',
  packageId: 'com.acme.crm',
  definition: { name: 'account', label: 'Account' },
  userId: 'usr_123',
  timestamp: '2026-08-02T12:00:00.000Z',
} as const;

function envelopeOf(payload: Record<string, unknown>, type = 'metadata.object.created'): RealtimeEventPayload {
  return {
    type,
    object: 'object',
    payload,
    timestamp: '2026-08-02T12:00:00.000Z',
  };
}

describe('#4602 — RealtimeAPI.subscribeMetadata contract boundary', () => {
  let api: RealtimeAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    api = new RealtimeAPI('http://localhost:3000');
  });

  afterEach(() => {
    api.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function deliver(envelope: RealtimeEventPayload): void {
    api._bufferEvent(envelope);
    vi.advanceTimersByTime(2000); // poll interval drains the buffer
  }

  it('delivers the MetadataEvent with top-level fields to the callback', () => {
    const seen: unknown[] = [];
    api.subscribeMetadata('object', (event) => seen.push(event));

    deliver(envelopeOf({ ...VALID_EVENT }));

    expect(seen).toHaveLength(1);
    const event = seen[0] as typeof VALID_EVENT;
    // Top-level, as the type declares — NOT nested under `payload`.
    expect(event.id).toBe(VALID_EVENT.id);
    expect(event.type).toBe('metadata.object.created');
    expect(event.metadataType).toBe('object');
    expect(event.name).toBe('account');
    expect(event.packageId).toBe('com.acme.crm');
    expect(event.definition).toEqual({ name: 'account', label: 'Account' });
    expect(event.userId).toBe('usr_123');
    expect(event.timestamp).toBe(VALID_EVENT.timestamp);
  });

  it('rejects the pre-fix producer shape LOUDLY instead of passing it through', () => {
    // The old MetadataManager payload: no id/type/timestamp inside, fields
    // that DO exist are fine — but the event as a whole violates the schema.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeMetadata('object', callback);

    deliver(envelopeOf({
      metadataType: 'object',
      name: 'account',
      definition: { name: 'account' },
    }));

    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const logged = String(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n'));
    expect(logged).toContain('realtime event handler');
  });

  it('rejects a payload with a wrong field type instead of coercing it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();
    api.subscribeMetadata('object', callback);

    deliver(envelopeOf({ ...VALID_EVENT, id: 'not-a-uuid' }));

    expect(callback).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('still filters by event type and packageId on the envelope', () => {
    const callback = vi.fn();
    api.subscribeMetadata('object', callback, { packageId: 'com.other' });

    // packageId mismatch → filtered out before the boundary parse.
    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).not.toHaveBeenCalled();

    // matching packageId → delivered.
    const matching = { ...VALID_EVENT, packageId: 'com.other' };
    deliver(envelopeOf(matching));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].packageId).toBe('com.other');
  });

  it('unsubscribe stops delivery', () => {
    const callback = vi.fn();
    const off = api.subscribeMetadata('object', callback);

    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);

    off();
    deliver(envelopeOf({ ...VALID_EVENT }));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// #4627 — the `type` parameter is the closed MetadataEventSubject, not string
// ===========================================================================
//
// Every pin below is resolved by tsc, not by vitest. `packages/client`'s
// `typecheck` script compiles this file through `tsconfig.test.json`, and
// `test-typecheck-debt.json` carries NO entry for `src/realtime-api.test.ts` —
// which, under that ledger's "a file not listed here may have no errors at all"
// rule, makes zero the measurable baseline these pins move away from. Reverting
// the parameter to `string` leaves the `@ts-expect-error` directives unused,
// and an unused directive is itself an error (TS2578), so the revert is red.
//
// Reverse verification, direction declared before running it: `type: string`
// restored → the two `@ts-expect-error` lines below go red as TS2578 "Unused
// '@ts-expect-error' directive", and `ParameterIsExactlySubject` resolves to
// `never` so its initializer goes red as TS2322. Both were measured and both
// landed. A fourth red was NOT predicted and is recorded here rather than
// tidied away: `realtime-api.ts`'s own `const eventTypes: MetadataEventType[]`
// goes red too (three TS2322, `` `metadata.${string}.created` `` not assignable
// to the enum), because a widened `type` makes the composed names unprovable.
// The implementation carries a pin of its own, one level below the signature.
//
// The `@ts-expect-error` directives are deliberately NOT the only pin. A bare
// directive passes on ANY error at that line — the phantom-check hazard — so
// each is corroborated by a type-level assertion that fixes exactly WHICH
// error it can be: the parameter type is pinned to `MetadataEventSubject`
// exactly, and the positive cases below prove the callback/options arms of the
// same signature still compile. What is left for the directive to catch can
// then only be argument one (TS2345 — the code recorded in each comment,
// measured by deleting the directive and reading tsc's output).

describe('#4627 — subscribeMetadata narrows `type` to the event vocabulary', () => {
  const api = new RealtimeAPI('http://localhost:3000');
  const callback = (_event: MetadataEvent): void => undefined;

  it('declares the parameter as exactly MetadataEventSubject', () => {
    // Read off the METHOD, not off the alias: a revert that widened the
    // signature back to `string` while leaving `MetadataEventSubject` exported
    // would sail past any alias-scoped assertion.
    //
    // Both directions are asserted, and each catches a different regression:
    //   - `Param extends MetadataEventSubject` fails on a re-widening
    //     (`string extends MetadataEventSubject` is false);
    //   - `MetadataEventSubject extends Param` fails on an over-narrowing to a
    //     subset (`… extends 'object'` is false).
    // Together they are exactness; either alone is not.
    type Param = Parameters<RealtimeAPI['subscribeMetadata']>[0];
    type ParameterIsExactlySubject =
      Param extends MetadataEventSubject
        ? MetadataEventSubject extends Param
          ? 'exact'
          : never
        : never;
    const exact: ParameterIsExactlySubject = 'exact';
    expect(exact).toBe('exact');
  });

  it('accepts every member of the vocabulary, not just the one this file uses', () => {
    // The other 12 subjects compile too — this is a union, not `'object'`.
    const offs = [
      api.subscribeMetadata('field', callback),
      api.subscribeMetadata('view', callback),
      api.subscribeMetadata('permission', callback, { packageId: 'com.acme' }),
    ];
    expect(offs).toHaveLength(3);
    for (const off of offs) off();
    api.disconnect();
  });

  it('rejects a metadata type that has no realtime event contract', () => {
    // `translation` IS registrable (`DEFAULT_METADATA_TYPE_REGISTRY`) but has
    // no `metadata.translation.*` name in `MetadataEventType`, so #4602's
    // producer publishes nothing for it. Before #4627 this line compiled and
    // the callback waited forever.
    // @ts-expect-error TS2345 - '"translation"' is not assignable to parameter of type 'MetadataEventSubject'
    const off = api.subscribeMetadata('translation', callback);
    expect(off).toBeTypeOf('function');
    off();
    api.disconnect();
  });

  it('rejects a plain `string` variable — the one real migration break', () => {
    // This is what a 17.x caller has to change: a `string`-typed variable no
    // longer flows in. The fix is to type the variable (or the state, or the
    // route param) as `MetadataEventSubject`; there is no runtime change to
    // accompany it, because the runtime already ignored these subscriptions.
    const fromConfig: string = 'object';
    // @ts-expect-error TS2345 - 'string' is not assignable to parameter of type 'MetadataEventSubject'
    const off = api.subscribeMetadata(fromConfig, callback);
    expect(off).toBeTypeOf('function');
    off();
    api.disconnect();
  });
});
