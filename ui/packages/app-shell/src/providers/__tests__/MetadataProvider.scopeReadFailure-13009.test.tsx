// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13009 — the by-name object scope tells a not-found answer from a
 * failed read. `getItem` hands its callers `null` for both, and the scope used
 * to record that `null` as `missing`, so a transient 5xx or a network drop read
 * as "this deployment has no such object" for the session, and
 * `useObjectPresence` answered `absent` where its contract says an error reads
 * `unknown`.
 *
 * What these pins hold:
 *
 *   (a) a by-name read that rejects without an answer (a 5xx, a network drop,
 *       a 404 carrying no declared code) leaves the name out of `missing`, the
 *       scope unsettled, and `useObjectPresence` reading `unknown`. Since
 *       objectui#13052 the failure is recorded once (so a route can stop
 *       waiting on it) and a later read does not ask it again: `invalidate`
 *       (the route's Retry) or `refresh` does;
 *   (b) CONTROL: a not-found ANSWER (a thrown `RESOURCE_NOT_FOUND`, or a
 *       read that resolves with no document) still records `missing` and reads
 *       `absent`; a found answer still records the item and reads `present`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';
import { ExpressionProvider } from '../ExpressionProvider';
import { useObjectPresence } from '../../hooks/useObjectPresence';

type Ctx = ReturnType<typeof useMetadata>;
type Answer = 'found' | 'absent-code' | 'absent-null' | 'server-error' | 'network' | 'bare-404';

const OBJECTS = [{ name: 'sys_activity', _packageId: 'plugin.audit' }];

/** The thrown shapes the ObjectStack client produces (`httpStatus` + ADR-0112 `code`). */
function clientError(httpStatus: number, code?: string): Error {
  return Object.assign(new Error(`request failed: ${httpStatus}`), { httpStatus, ...(code ? { code } : {}) });
}

function answerFor(answer: Answer, type: string, name: string): Promise<unknown> {
  const item = OBJECTS.find((o) => o.name === name);
  switch (answer) {
    case 'found':
      return item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.resolve({ type, name });
    case 'absent-code':
      return Promise.reject(clientError(404, 'RESOURCE_NOT_FOUND'));
    case 'absent-null':
      // The preview client's by-name read resolves `null` on a 404.
      return Promise.resolve(null);
    case 'server-error':
      return Promise.reject(clientError(503, 'SERVICE_UNAVAILABLE'));
    case 'network':
      return Promise.reject(new TypeError('Failed to fetch'));
    case 'bare-404':
      return Promise.reject(clientError(404));
  }
}

interface Server {
  calls: string[];
  /** What the next by-name read answers. */
  next: Answer;
}

function makeAdapter(server: Server) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          return Promise.resolve({ type, items: [] });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          return answerFor(server.next, type, name);
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

type Reading = { presence: ReturnType<typeof useObjectPresence>; ctx: Ctx };

/** A package-less app: `useObjectPresence` reads the names-only scope by name. */
function mount(next: Answer) {
  const server: Server = { calls: [], next };
  let latest: Reading | null = null;
  function Probe() {
    latest = { presence: useObjectPresence('sys_activity'), ctx: useMetadata() };
    return null;
  }
  const view = render(
    <MetadataProvider adapter={makeAdapter(server)}>
      <ExpressionProvider app={{ name: 'notes', navigation: [] }}>
        <Probe />
      </ExpressionProvider>
    </MetadataProvider>,
  );
  return { server, read: () => latest as unknown as Reading, rerender: () => view.rerender(
    <MetadataProvider adapter={makeAdapter(server)}>
      <ExpressionProvider app={{ name: 'notes', navigation: [] }}>
        <Probe />
      </ExpressionProvider>
    </MetadataProvider>,
  ) };
}

const byNameCalls = (calls: string[]) => calls.filter((c) => c === 'object/sys_activity');
const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const scopeOf = (ctx: Ctx) => ctx.readObjectScope!({ names: ['sys_activity'] });

afterEach(() => cleanup());

describe('the by-name object scope tells a failed read from a not-found answer (objectui#13009)', () => {
  for (const failure of ['server-error', 'network', 'bare-404'] as const) {
    it(`(a) a ${failure} read leaves the name unanswered: not missing, not settled, presence unknown`, async () => {
      const m = mount(failure);
      await waitFor(() => expect(byNameCalls(m.server.calls)).toHaveLength(1));
      // Let the rejection land and every follow-up render run.
      await settle();

      const scope = scopeOf(m.read().ctx);
      expect(scope.missing).not.toContain('sys_activity');
      expect(scope.settled).toBe(false);
      expect(m.read().presence).toEqual({ presence: 'unknown', settled: false });
    });
  }

  it('(a) a later read does not ask a failed name again; invalidate does, and a later answer settles it (objectui#13052)', async () => {
    const m = mount('server-error');
    await waitFor(() => expect(byNameCalls(m.server.calls)).toHaveLength(1));
    // The boot's own list loads re-render the reader, and each such read may
    // ask once; once those are over, a failure alone asks nothing more: no
    // retry loop, no timer.
    await settle();
    const asked = byNameCalls(m.server.calls).length;
    await settle(150);
    expect(byNameCalls(m.server.calls)).toHaveLength(asked);
    expect(m.read().presence).toEqual({ presence: 'unknown', settled: false });

    m.server.next = 'found';
    m.rerender();
    await settle();
    expect(byNameCalls(m.server.calls)).toHaveLength(asked);
    expect(m.read().presence).toEqual({ presence: 'unknown', settled: false });

    act(() => m.read().ctx.invalidate('object', 'sys_activity'));
    await waitFor(() => expect(m.read().presence.settled).toBe(true));
    expect(byNameCalls(m.server.calls)).toHaveLength(asked + 1);
    expect(m.read().presence.presence).toBe('present');
    expect(scopeOf(m.read().ctx).missing).toEqual([]);
  });

  it('CONTROL (b): a thrown RESOURCE_NOT_FOUND is an answer: missing, settled, absent', async () => {
    const m = mount('absent-code');
    await waitFor(() => expect(m.read().presence.settled).toBe(true));
    expect(m.read().presence.presence).toBe('absent');
    expect(scopeOf(m.read().ctx).missing).toEqual(['sys_activity']);
  });

  it('CONTROL (b): a read that resolves with no document is an answer: missing, settled, absent', async () => {
    const m = mount('absent-null');
    await waitFor(() => expect(m.read().presence.settled).toBe(true));
    expect(m.read().presence.presence).toBe('absent');
    expect(scopeOf(m.read().ctx).missing).toEqual(['sys_activity']);
  });

  it('CONTROL (b): a found answer records the item: present, nothing missing', async () => {
    const m = mount('found');
    await waitFor(() => expect(m.read().presence.settled).toBe(true));
    expect(m.read().presence.presence).toBe('present');
    const scope = scopeOf(m.read().ctx);
    expect(scope.missing).toEqual([]);
    expect(scope.served.map((o: any) => o.name)).toEqual(['sys_activity']);
  });

  it('CONTROL: getItem still answers null to its own callers for a failed read and for an absence', async () => {
    const m = mount('found');
    await waitFor(() => expect(m.read().presence.settled).toBe(true));
    m.server.next = 'server-error';
    await expect(m.read().ctx.getItem!('object', 'other_a')).resolves.toBeNull();
    m.server.next = 'absent-code';
    await expect(m.read().ctx.getItem!('object', 'other_b')).resolves.toBeNull();
  });
});
