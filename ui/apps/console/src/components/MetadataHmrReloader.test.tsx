// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7257 — a production-posture console kept polling
 * `GET /api/v1/dev/metadata-events` every `reconnectDelayMs` forever, each
 * attempt landing on a 404 because the server doesn't mount this dev-only
 * route there (~30 requests/min, flooding the console and drowning out the
 * legitimate `sys_inbox_message` / `sys_notification_receipt` polling).
 *
 * `enabled` (default `import.meta.env.DEV`) is the primary gate, but it is
 * not airtight: a build can end up with `DEV === true` baked in even while
 * the server it talks to is in production posture (a "prod-like" rig that
 * forces `NODE_ENV=development` for the *build tooling* is one concrete way
 * this happens — see the file header of `MetadataHmrReloader.tsx`). So the
 * fix under test lives one layer down, in the reconnect loop itself: the
 * first `connect()` attempt doubles as a capability probe. A stream that
 * closes before ever reaching `open` is read as "the server doesn't support
 * this", and the component gives up for good — no retry, and specifically
 * NOT a longer retry interval (that would still spam 404s, just slower). A
 * stream that DID open at least once and later drops is a different case —
 * that proves the route exists, so ordinary reconnect-on-drop keeps working
 * for real dev-server restarts / network blips.
 *
 * A fake `EventSource` drives both branches directly (this repo's jsdom-ish
 * `happy-dom` test environment does not implement `EventSource`), so each
 * case controls exactly which lifecycle events fire and in what order.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MetadataHmrReloader } from './MetadataHmrReloader';

type Listener = (event: unknown) => void;

/** Minimal, test-controlled stand-in for the browser `EventSource`. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /** Every instance constructed across the whole test file, in order. */
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener() {
    /* not exercised — the component never calls this */
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  private emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** The 404 case: the connection never reaches `open` before it closes. */
  failWithoutOpening() {
    this.readyState = FakeEventSource.CLOSED;
    this.emit('error');
  }

  /** The dev-server-restart case: a real connection that later drops. */
  openThenDrop() {
    this.readyState = FakeEventSource.OPEN;
    this.emit('open');
    this.readyState = FakeEventSource.CLOSED;
    this.emit('error');
  }
}

describe('MetadataHmrReloader — give up after the first connection fails without opening', () => {
  const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    cleanup();
    (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
    vi.useRealTimers();
  });

  it('THE FIX: a 404-shaped failure (closed before `open`) is not retried at all', () => {
    vi.useFakeTimers();

    render(
      <MetadataHmrReloader
        enabled
        url="/api/v1/dev/metadata-events"
        reconnectDelayMs={2000}
      />,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].failWithoutOpening();

    // Advance well past what would have been ~15 reconnect attempts under
    // the old fixed-interval retry — the regression this pins is "polls
    // forever", not "polls a little less".
    vi.advanceTimersByTime(2000 * 15);

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('⛔ does not fall back to a longer interval either — zero further attempts, not a slower loop', () => {
    vi.useFakeTimers();

    render(
      <MetadataHmrReloader
        enabled
        url="/api/v1/dev/metadata-events"
        reconnectDelayMs={2000}
      />,
    );

    FakeEventSource.instances[0].failWithoutOpening();

    // Even an interval an order of magnitude longer than the configured one
    // must not produce a second attempt.
    vi.advanceTimersByTime(2000 * 100);

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('CONTROL: a stream that opened once and then drops keeps reconnecting (real dev-server churn)', () => {
    vi.useFakeTimers();

    render(
      <MetadataHmrReloader
        enabled
        url="/api/v1/dev/metadata-events"
        reconnectDelayMs={2000}
      />,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].openThenDrop();

    vi.advanceTimersByTime(2000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // The reconnect is itself a fresh probe: if it also opens and later
    // drops, the loop keeps going — this is the behavior the fix must NOT
    // disturb for a route that genuinely exists.
    FakeEventSource.instances[1].openThenDrop();
    vi.advanceTimersByTime(2000);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it('does not subscribe at all when disabled (unaffected by this change)', () => {
    render(<MetadataHmrReloader enabled={false} url="/api/v1/dev/metadata-events" />);

    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
