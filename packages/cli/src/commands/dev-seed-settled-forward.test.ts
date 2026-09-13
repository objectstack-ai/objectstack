// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { forwardSeedSettledToParent } from './dev.js';

/**
 * #17329 — `os dev` relays the `serve` child's settle announcement to its OWN
 * parent, and does nothing at all when no parent holds the channel.
 *
 * ## Why the hop is the card
 *
 * The producer already exists and is published: `@objectstack/runtime` declares
 * every seed source and settles it at the moment its boot-time write is done,
 * under the spec's `seed-settlement` contract. `serve` now announces that on the
 * ipc channel. But the consumer — a demo script, a test harness, anything that
 * spawns a dev server and wants to print one line after the boot — spawns
 * `os dev`, not `serve`; `os dev` runs the child over
 * `stdio: ['inherit','inherit','inherit','ipc']`, so without this the message
 * lands in the middle process and stops. One hop is the whole of what was
 * missing.
 *
 * ⚠️ Under vitest's `forks` pool `process.send` is the RUNNER's own control
 * channel. Every swap below is synchronous, spans one call, and is undone in
 * `finally` — a real message must never reach it.
 */
describe('#17329 `os dev` forwards `objectstack:seed-settled` outward', () => {
  /** Drive `fn` with `process.send` replaced by a recorder. */
  const recording = (fn: () => void): unknown[] => {
    const sent: unknown[] = [];
    const prior = process.send;
    (process as { send?: unknown }).send = (m: unknown) => { sent.push(m); return true; };
    try { fn(); } finally { (process as { send?: unknown }).send = prior; }
    return sent;
  };

  /** Drive `fn` with NO ipc channel — the ordinary terminal `os dev`. */
  const withoutChannel = <T>(fn: () => T): T => {
    const prior = process.send;
    (process as { send?: unknown }).send = undefined;
    try { return fn(); } finally { (process as { send?: unknown }).send = prior; }
  };

  const settled = {
    type: 'objectstack:seed-settled',
    ok: false,
    suppressed: [],
    sources: [{ source: 'showcase', inserted: 24, updated: 0, skipped: 0, rejected: 14 }],
  };

  it('relays the message VERBATIM, not a re-derivation of it', () => {
    // ⛔ This process has no kernel and could only guess. Passing the object
    // through is what keeps `os dev`'s parent and the `serve` child from being
    // made to say two different things about one boot.
    const sent = recording(() => {
      expect(forwardSeedSettledToParent(settled)).toBe(true);
    });
    expect(sent).toEqual([settled]);
    expect(sent[0], 'the message was rebuilt rather than relayed').toBe(settled);
  });

  it('⛔ a parent with no ipc channel is UNAFFECTED — no throw, no send', () => {
    // An ipc channel must not become a requirement of running a published
    // command. `process.send` is undefined under a terminal `os dev`.
    withoutChannel(() => {
      expect(() => forwardSeedSettledToParent(settled)).not.toThrow();
      expect(forwardSeedSettledToParent(settled), 'the message is still HANDLED here').toBe(true);
    });
  });

  it('survives a parent channel that has already closed', () => {
    // Best-effort, exactly like the child's own `announceListening`: a
    // supervision nicety must never take a healthy dev server down.
    const prior = process.send;
    (process as { send?: unknown }).send = () => { throw new Error('channel closed'); };
    try {
      expect(() => forwardSeedSettledToParent(settled)).not.toThrow();
    } finally {
      (process as { send?: unknown }).send = prior;
    }
  });

  describe('⛔ and it claims ONLY its own message', () => {
    it.each([
      ['the listening announcement', { type: 'objectstack:listening', port: 3001, url: 'http://localhost:3001' }],
      ['an unrelated type', { type: 'something:else' }],
      ['no type at all', { port: 3001 }],
      ['null', null],
      ['undefined', undefined],
      ['a string', 'objectstack:seed-settled'],
    ])('%s is left to the caller', (_label, msg) => {
      // Returning `true` here would swallow `objectstack:listening` and take
      // the bound-port readout and the MCP connect hint down with it.
      const sent = recording(() => {
        expect(forwardSeedSettledToParent(msg)).toBe(false);
      });
      expect(sent, 'a message that is not ours was forwarded anyway').toEqual([]);
    });

    it('…and the positive control on the same path still fires', () => {
      // So the zeros above are readings rather than a function that forwards
      // nothing at all.
      const sent = recording(() => { forwardSeedSettledToParent(settled); });
      expect(sent).toHaveLength(1);
    });
  });
});
