/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MetadataClient` no longer offers actor attribution — negative pin
 * (objectui#4834, inheriting objectstack#7941).
 *
 * ## What was removed
 *
 * Four methods took an `actor` option and turned it into an `X-Actor` request
 * header: `save` (PUT), `reset` (DELETE), `publish` (POST), `rollback` (POST).
 * Three declarations carried it — `MetadataClientSaveOptions.actor` (which
 * `MetadataDeleteOptions` inherits via `extends`, so it served both `save` and
 * `reset`), plus an inline `{ actor?: string }` on each of `publish` and
 * `rollback`.
 *
 * ## Why it went, rather than being documented or deprecated
 *
 * Maintainer ruling objectstack#7941 settled that the recorded actor is the
 * identity the request was authorized as, and removed the header limb from the
 * server's resolver outright — `resolveMetaWriteActor` now states that
 * `X-Actor` "is ignored outright ... there is no shape in which a caller can
 * choose the name the audit row records". The server's own pin
 * (`packages/rest/src/meta-write-actor-identity.test.ts`, cases 3 and 4) fixes
 * that in both directions: an explicit `X-Actor` does not outrank the
 * authenticated identity, and it is inert on the machine-write path too.
 *
 * So the option could not affect the outcome. It typed cleanly and sent a
 * header the server discards, which is worse than absent: it promises
 * attribution and silently fails to deliver it. That is the false affordance
 * the ruling's reasoning excludes, so the knob goes rather than acquiring a
 * doc-comment apologising for itself.
 *
 * ## Why a runtime pin, and why it smuggles the property in through a cast
 *
 * Removing the declaration stops *TypeScript* callers. It does nothing to
 * JavaScript ones, and this is published surface — `@object-ui/data-objectstack`
 * ships to consumers this repo cannot enumerate. A stale external caller still
 * passing `{ actor }` must have it dropped on the floor, not forwarded, so the
 * assertion has to run against the real request rather than against the type.
 * The cast reproduces exactly that caller.
 *
 * The header check is case-insensitive on purpose: `X-Actor`, `x-actor` and
 * any other casing are the same header, and a reintroduction that changed the
 * spelling would otherwise slip past a literal key lookup.
 *
 * ## If per-request attribution is ever wanted again
 *
 * It cannot be re-added here alone — the server would still ignore it. It
 * starts as a producer change in `objectstack`, which means revisiting #7941's
 * ruling that attribution may not drift from authorization. This pin is what
 * you delete in that PR, deliberately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataClient } from './metadata-client';

describe('MetadataClient actor attribution is retired (objectui#4834)', () => {
  let sent: (RequestInit | undefined)[];

  function client() {
    return new MetadataClient({
      baseUrl: 'http://localhost:3000',
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push(init);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });
  }

  /** Every header key on the recorded request, lowercased. */
  function headerKeys(init: RequestInit | undefined): string[] {
    return Object.keys((init?.headers ?? {}) as Record<string, string>).map((k) =>
      k.toLowerCase(),
    );
  }

  beforeEach(() => {
    sent = [];
  });

  // Without this, every assertion below would also pass against a client that
  // sent no headers at all — or against a capture that recorded nothing.
  describe('the probe itself works', () => {
    it('captures a request whose headers this instrument can read', async () => {
      await client().save('object', 'account', { foo: 1 }, { ifMatch: 'sha256:abc' });
      expect(sent).toHaveLength(1);
      const keys = headerKeys(sent[0]);
      // A header the client DOES still send, proving the capture is live.
      expect(keys).toContain('if-match');
      expect(keys.length).toBeGreaterThan(1);
    });
  });

  const CALLS: ReadonlyArray<
    readonly [name: string, run: (c: MetadataClient, opts: object) => Promise<unknown>]
  > = [
    ['save', (c, opts) => c.save('object', 'account', { foo: 1 }, opts)],
    ['reset', (c, opts) => c.reset('object', 'account', opts)],
    ['publish', (c, opts) => c.publish('object', 'account', opts)],
    ['rollback', (c, opts) => c.rollback('object', 'account', 2, opts)],
  ] as const;

  it.each(CALLS)(
    '`%s` sends no X-Actor header even when a stale caller still passes `actor`',
    async (_name, run) => {
      // The cast is the point: a JS consumer of the published package can still
      // pass this, and it must not reach the wire.
      await run(client(), { actor: 'user_1' } as object);
      expect(sent).toHaveLength(1);
      expect(headerKeys(sent[0])).not.toContain('x-actor');
    },
  );

  it('no method spells the header at all', async () => {
    for (const [, run] of CALLS) {
      await run(client(), { actor: 'user_1' } as object);
    }
    const everyHeaderKey = sent.flatMap(headerKeys);
    expect(everyHeaderKey.length).toBeGreaterThan(0);
    expect(everyHeaderKey.filter((k) => k.includes('actor'))).toEqual([]);
  });
});
