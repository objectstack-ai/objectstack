// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5672] The SDK's capability type lie, made falsifiable.
//
// `client.capabilities` is declared `WellKnownCapabilities | undefined` and used
// to reach that type by assertion:
//
//     return result as unknown as WellKnownCapabilities;
//
// …over an object built from whatever keys the SERVER happened to send. The two
// discovery producers sent disjoint key sets (#5672), so against a
// dispatcher-served host `client.capabilities.transactionalBatch` was statically
// `boolean` and actually `undefined` — and `comments` / `cron` / `export` /
// `chunkedUpload` with it.
//
// Note WHY this file is a runtime probe and not a `tsc` one: the lie was inside
// a type ASSERTION, so `pnpm typecheck` was green before the fix and is green
// after it. A compiler cannot falsify a cast — only running the getter against
// a real producer's payload can. Each test below therefore pairs the static
// promise (a `const x: boolean = …` binding, which only compiles because the
// declared type says so) with the runtime fact it used to contradict.

import { describe, it, expect, vi } from 'vitest';
import { WELL_KNOWN_CAPABILITY_KEYS } from '@objectstack/spec/api';
import { ObjectStackClient } from './index';

/**
 * The EXACT `capabilities` map the runtime dispatcher emitted between #4828 and
 * #5672 — seven keys, six of which the vocabulary did not contain, and none of
 * the seven `WellKnownCapabilities` keys that a consumer was typed to expect.
 */
const DISPATCHER_SHAPE_BEFORE_5672 = {
  search: { enabled: true },
  websockets: { enabled: false },
  files: { enabled: false },
  analytics: { enabled: false },
  ai: { enabled: false },
  notifications: { enabled: false },
  i18n: { enabled: false },
};

async function connectedTo(capabilities: unknown) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ version: 'v1', name: 'ObjectOS', capabilities }),
  });
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl as any });
  await client.connect();
  return client;
}

describe('[#5672] client.capabilities is the whole vocabulary, honestly typed', () => {
  it('the probe: `transactionalBatch` is a real boolean against a dispatcher-shaped payload', async () => {
    const client = await connectedTo(DISPATCHER_SHAPE_BEFORE_5672);
    const caps = client.capabilities!;

    // The static half. This binding compiles only because the declared type
    // promises `boolean` — it is the promise under test, written out so the
    // reader can see there is nothing else holding it up.
    const promisedBoolean: boolean = caps.transactionalBatch;

    // The runtime half. Before the fix this was `undefined`: the getter copied
    // the server's key set, and this producer had no such key. `typeof` is the
    // assertion that catches it — `toBe(false)` alone would read "the backend
    // says no" and pass for a payload that says nothing at all.
    expect(typeof promisedBoolean).toBe('boolean');
    expect(promisedBoolean).toBe(false);
  });

  it('every flag the type declares is present and boolean, whichever producer answered', async () => {
    const client = await connectedTo(DISPATCHER_SHAPE_BEFORE_5672);
    const caps = client.capabilities! as unknown as Record<string, unknown>;

    const notBoolean = WELL_KNOWN_CAPABILITY_KEYS.filter(k => typeof caps[k] !== 'boolean');
    expect(notBoolean, 'declared capability flags that are not booleans at runtime').toEqual([]);

    // …and the dispatcher's own answers still come through unchanged.
    expect(caps.search).toBe(true);
    expect(caps.websockets).toBe(false);
  });

  it('reads a key the server omits as `false` — fail-closed, matching the wire rule', async () => {
    // A server that predates the vocabulary. Ruling A says an undelivered
    // capability is `enabled: false`; a key that never arrives is read the same
    // way, so a consumer skips the feature rather than calling an endpoint that
    // may not exist.
    const client = await connectedTo({ search: { enabled: true } });
    const caps = client.capabilities!;

    expect(caps.search).toBe(true);
    expect(caps.chunkedUpload).toBe(false);
    expect(caps.comments).toBe(false);
  });

  it('normalizes the flat boolean form as well as the hierarchical one', async () => {
    // Both shapes have been on the wire; the getter reads one bit from either.
    const client = await connectedTo({ ...DISPATCHER_SHAPE_BEFORE_5672, comments: true, cron: false });

    expect(client.capabilities!.comments).toBe(true);
    expect(client.capabilities!.cron).toBe(false);
  });

  it('does NOT coerce an off-spec value into a capability claim', async () => {
    // `'yes'` / `1` are not booleans on a machine-readable surface. Coercing
    // them would fossilise a second dialect in the consumer, which is exactly
    // what Prime Directive #12 forbids — the producer's conformance gate is
    // where that payload gets called out, not here.
    const client = await connectedTo({
      ...DISPATCHER_SHAPE_BEFORE_5672,
      comments: 'yes',
      cron: { enabled: 1 },
    });

    expect(client.capabilities!.comments).toBe(false);
    expect(client.capabilities!.cron).toBe(false);
  });

  it('exposes exactly the vocabulary — a key outside it never reaches the caller', async () => {
    const client = await connectedTo({ ...DISPATCHER_SHAPE_BEFORE_5672, feed: { enabled: true } });

    expect(Object.keys(client.capabilities!).sort())
      .toEqual([...WELL_KNOWN_CAPABILITY_KEYS].sort());
    expect(client.capabilities!).not.toHaveProperty('feed');
  });

  it('still returns undefined before connect, and for a body carrying no capabilities', async () => {
    const offline = new ObjectStackClient({ baseUrl: 'http://localhost:3000' });
    expect(offline.capabilities).toBeUndefined();

    const client = await connectedTo(undefined);
    expect(client.capabilities).toBeUndefined();
  });
});
