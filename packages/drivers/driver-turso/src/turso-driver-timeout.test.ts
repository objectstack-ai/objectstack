// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `TursoDriverConfig.timeout` bounds the remote operations the driver performs
 * — the promise its docblock has made since the key was declared ("Operation
 * timeout in milliseconds for remote operations. Effective in replica and
 * remote modes."), delivered by no code until the ADR-0049 enforce-or-remove
 * ruling on it. Two arms, two seams, both measured against
 * `@libsql/client@0.17.4`:
 *
 *  - REMOTE over HTTP: the hrana transport takes a custom `fetch`
 *    (`Config.fetch`) and routes EVERY request through it, the protocol-version
 *    probe included. The driver hands it one that aborts after `timeout` ms.
 *    The stalled remote here is a REAL `http.Server` that accepts the
 *    connection and never answers, so what is measured is the platform fetch
 *    under a real abort — not a stub that honours `signal` by construction.
 *  - REPLICA: the only remote operation on this arm is `sync()`, and it runs in
 *    the native `libsql` binding, which consults no `fetch`. The driver bounds
 *    the awaited `sync()` itself. A stub client whose `sync()` never settles is
 *    the stalled remote.
 *
 * "The remote was reached" is an AWAITED LATCH here, never a sampled counter.
 * The sample instant would be chosen by the very timer under test, and libuv
 * runs the TIMERS phase before the POLL phase: a stall that spans the window
 * delivers the abort — and every assertion that follows it — before the
 * server's already-arrived bytes are parsed into a `request` event. A counter
 * read there says 0 about a request that is demonstrably on the wire. Measured
 * on this fixture, with the loop frozen 300 ms from the moment undici publishes
 * `undici:client:sendHeaders`: the counter reads 0 in 6/6 runs while the
 * handler dispatches ~2 ms after the assertion would have run, every time.
 *
 * The positive case takes that one step further and proves reachability with an
 * UNBOUNDED driver BEFORE the timed one runs. A window may legitimately close
 * before its own request is issued — under a long enough stall the deadline is
 * already spent when the transport gets its turn, and no implementation could
 * have put bytes on the wire — so "this timed request reached the remote" is
 * not something the timed operation can be made to promise. "This fixture is a
 * remote the transport reaches" is, off the timed path, and that is the
 * anti-vacuity guard the case actually needs.
 *
 * Both latch assertions carry a failure message naming their bound, so a red
 * says in words that a DURATION went unmet. Merge-queue triage classifies a red
 * by asking whether the assertion names a duration; a bare `expected 0 to be
 * greater than 0` from a sampled counter answers no and is read as a behaviour
 * regression, which is exactly how this file's flake was first read.
 *
 * Each arm carries a NEGATIVE control — the same stalled remote with no
 * `timeout` (and, on the replica arm, `timeout: 0`, the documented "no bound")
 * is still pending well past the window — so the failure the positive case
 * measures is the key's doing and not the fixture's. The assertions are on the
 * refusal ENVELOPE (`code` + `status`, ADR-0112), never on a bare rejection: a
 * fixture torn down early rejects too, and a bare `rejects` cannot tell the two
 * apart.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TursoDriver } from './turso-driver';

/** The window the positive cases configure, and the slack the box is allowed. */
const WINDOW_MS = 100;
const CONTROL_WAIT_MS = 1000;
const ELAPSED_BOUND_MS = 5000;
/**
 * The bound on the AWAITED "the transport reached the fixture" latch. It is not
 * a budget any assertion measures — the condition holds in ~2 ms on an idle box
 * and in at most ~38 ms measured under six CPU hogs on four cores — it is the
 * point past which "nothing is reaching this server at all" is the only reading
 * left. vitest's own 5 s per-test timeout is the backstop behind it.
 */
const REACH_BOUND_MS = 2000;

const PENDING = Symbol('still pending');

/** Resolves to `PENDING` when `operation` has not settled within `ms`. */
function stillPendingAfter<T>(operation: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const window = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });
  return Promise.race([operation, window]).finally(() => clearTimeout(timer));
}

/** Whether `signal` has settled within `ms` — an AWAITED condition, never a sampled one. */
async function settlesWithin(signal: Promise<unknown>, ms: number): Promise<boolean> {
  return (await stillPendingAfter(signal, ms)) !== PENDING;
}

/** The rejection an operation produced, or `null` when it resolved. */
function failureOf<T>(operation: Promise<T>): Promise<(Error & { code?: string; status?: number }) | null> {
  return operation.then(
    () => null,
    (error: Error & { code?: string; status?: number }) => error,
  );
}

/**
 * A remote that accepts every TCP connection and never writes a byte back —
 * the shape of a stalled Turso endpoint as the driver's HTTP transport sees it.
 *
 * `firstRequest` LATCHES: it resolves the moment this server has dispatched a
 * request handler — whenever that is — and stays resolved. A counter read at
 * one instant cannot make that statement, because the instant is chosen by the
 * very timer under test; see the header note on phase ordering.
 */
async function stalledHttpServer(): Promise<{ url: string; firstRequest: Promise<void>; close: () => Promise<void> }> {
  let reached!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const server: Server = createServer(() => {
    reached();
    // Deliberately no response: the request hangs until the socket is torn down.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    firstRequest,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A `@libsql/client` whose `sync()` never settles — a stalled primary on the replica arm. */
function stalledSyncClient(): Client {
  const stub = {
    sync: () => new Promise<never>(() => {}),
    close: () => {},
    closed: false,
    protocol: 'file',
  };
  return stub as unknown as Client;
}

describe('TursoDriverConfig.timeout — remote mode over HTTP', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  it('a stalled remote fails the operation within the configured window, as TIMEOUT / 504', async () => {
    const remote = await stalledHttpServer();
    cleanups.push(remote.close);

    // PREMISE, established OFF the timed path: this fixture really is a remote
    // that the driver's HTTP transport reaches, so the refusal measured below
    // is a window closing on a live conversation and not a green run against a
    // server nobody ever dialled. It is proved with an UNBOUNDED driver —
    // nothing can preempt its request — which is what makes the latch an
    // awaited condition rather than a race. A fixture nothing reaches still
    // fails here, loudly, which is the whole job of this line.
    const reachable = new TursoDriver({ url: remote.url });
    await reachable.connect();
    cleanups.push(() => reachable.disconnect());
    // Settles only when the fixture tears the socket down; nobody reads that.
    reachable.find('probe', {}).catch(() => {});
    expect(
      await settlesWithin(remote.firstRequest, REACH_BOUND_MS),
      `the HTTP transport did not reach the stalled fixture within ${REACH_BOUND_MS} ms`,
    ).toBe(true);

    const driver = new TursoDriver({ url: remote.url, timeout: WINDOW_MS });
    expect(driver.transportMode).toBe('remote');
    await driver.connect();
    cleanups.push(() => driver.disconnect());

    const started = Date.now();
    const failure = await failureOf(driver.find('probe', {}));
    const elapsed = Date.now() - started;

    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('TIMEOUT');
    expect(failure!.status).toBe(504);
    expect(failure!.message).toContain(`${WINDOW_MS} ms`);
    expect(failure!.message).toContain('TursoDriverConfig.timeout');
    expect(elapsed).toBeLessThan(ELAPSED_BOUND_MS);
  });

  it('NEGATIVE CONTROL: with no timeout the same stalled remote leaves the operation pending', async () => {
    const remote = await stalledHttpServer();
    cleanups.push(remote.close);

    const driver = new TursoDriver({ url: remote.url });
    await driver.connect();
    cleanups.push(() => driver.disconnect());

    const operation = driver.find('probe', {});
    // It settles only when the fixture tears the socket down; nobody reads that.
    operation.catch(() => {});

    expect(await stillPendingAfter(operation, CONTROL_WAIT_MS)).toBe(PENDING);
    // Same latch, same reason: nothing bounds this operation, so the request is
    // reached and the condition is awaited, never sampled at a chosen instant.
    expect(
      await settlesWithin(remote.firstRequest, REACH_BOUND_MS),
      `the HTTP transport did not reach the stalled fixture within ${REACH_BOUND_MS} ms`,
    ).toBe(true);
  });
});

describe('TursoDriverConfig.timeout — replica mode (sync)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  function replicaDriver(timeout: number | undefined): TursoDriver {
    return new TursoDriver({
      url: ':memory:',
      syncUrl: 'libsql://primary.example.turso.io',
      authToken: 'token',
      client: stalledSyncClient(),
      sync: { onConnect: false },
      ...(timeout === undefined ? {} : { timeout }),
    });
  }

  it('a sync that does not complete within the window rejects as TIMEOUT / 504', async () => {
    const driver = replicaDriver(WINDOW_MS);
    expect(driver.transportMode).toBe('replica');
    await driver.connect();
    cleanups.push(() => driver.disconnect());
    expect(driver.isSyncEnabled()).toBe(true);

    const started = Date.now();
    const failure = await failureOf(driver.sync());
    const elapsed = Date.now() - started;

    expect(failure).not.toBeNull();
    expect(failure!.code).toBe('TIMEOUT');
    expect(failure!.status).toBe(504);
    expect(failure!.message).toContain(`${WINDOW_MS} ms`);
    expect(failure!.message).toContain('sync');
    expect(elapsed).toBeLessThan(ELAPSED_BOUND_MS);
  });

  it('NEGATIVE CONTROL: with no timeout the stalled sync is still pending past the window', async () => {
    const driver = replicaDriver(undefined);
    await driver.connect();
    cleanups.push(() => driver.disconnect());

    expect(await stillPendingAfter(driver.sync(), CONTROL_WAIT_MS)).toBe(PENDING);
  });

  it('NEGATIVE CONTROL: `timeout: 0` means no bound, as the published schema documents', async () => {
    const driver = replicaDriver(0);
    await driver.connect();
    cleanups.push(() => driver.disconnect());

    expect(await stillPendingAfter(driver.sync(), CONTROL_WAIT_MS)).toBe(PENDING);
  });
});
