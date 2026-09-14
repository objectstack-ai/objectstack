// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18023] Pins for the capability-name collision diagnostic's PURE half —
 * the token, the record and the report channel, with no seeder and no engine
 * double in the way.
 *
 * ⛔ Not the skip. Refusing to write into a `sys_capability` row another
 * package owns is correct under ADR-0086 D4; the seeder-side pins in
 * `bootstrap-declared-capabilities.test.ts` assert it UNCHANGED. What this file
 * pins is that the refusal REACHES somebody, and says something true.
 *
 * ## The three trap shapes these discriminate against
 *
 *  1. `logger?.warn?.(…)` — the defect. A sink-less call must still print, so
 *     the no-sink case asserts `console.warn` fired, not merely "did not throw".
 *  2. `(logger?.warn ?? console.warn)(…)` — evaluates to a bare function and
 *     calls it with `this === undefined`. A class-based host sink that reaches
 *     for `this` throws, so one case below injects exactly that sink.
 *  3. A diagnostic that fires ALWAYS is as unreadable as one that never fires
 *     (#12015), so the empty-collection case asserts total silence.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  CAPABILITY_NAME_COLLISION,
  capabilityNameCollisionDiagnostic,
  formatCapabilityNameCollisionDiagnostic,
  reportCapabilityNameCollisions,
} from './capability-name-collision.js';

/**
 * Capture EVERY console channel. "Author-visible output" is not
 * channel-specific — the pre-fix failure was that NONE of them carried
 * anything — so a pin watching only `warn` could be satisfied by a change that
 * merely MOVED the silence.
 */
function captureConsole() {
  const seen: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      seen.push(`${m}: ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    }),
  );
  return { seen, restore: () => spies.forEach((s) => s.mockRestore()) };
}

const collision = (over: Record<string, any> = {}) => capabilityNameCollisionDiagnostic({
  name: 'shared_cap',
  declaredBy: 'com.example.b',
  ownedBy: 'com.example.a',
  ...over,
});

describe('[#18023] capabilityNameCollisionDiagnostic — the record', () => {
  it('is stamped with the token, is a warning, and carries both owners', () => {
    const d = collision();
    expect(d.event).toBe(CAPABILITY_NAME_COLLISION);
    expect(CAPABILITY_NAME_COLLISION).toBe('capability_name_collision');
    expect(d.severity).toBe('warning');
    expect(d.name).toBe('shared_cap');
    expect(d.declaredBy).toBe('com.example.b');
    expect(d.ownedBy).toBe('com.example.a');
  });

  it('states the CAPABILITY-axis consequence, not the permission-set one', () => {
    const d = collision();
    // ⛔ The load-bearing discrimination against a mechanical copy of the
    // sibling axis: on THIS axis the name still resolves through the owning
    // package's row, so a message claiming the grant is dead would send the
    // author hunting a break that is not there.
    expect(d.message).toContain('The name still resolves');
    expect(d.message).toContain('ADR-0086 D4');
    expect(d.message).toContain('label, description and scope');
    expect(d.message).toContain('attributes the capability to com.example.a');
    // ⛔ And it does not borrow the sibling's wording, which is about a set
    // whose permissions are not in effect at all.
    expect(d.message).not.toContain('none of its object, field, tab');
  });

  it('names the granting permission sets — the blast radius — when there are any', () => {
    const d = collision({ grantedBy: ['ops', 'support'] });
    expect(d.grantedBy).toEqual(['ops', 'support']);
    expect(d.message).toContain('Permission set(s) granting it: ops, support');
  });

  it('says so explicitly when NOTHING grants it, rather than going quiet', () => {
    const d = collision();
    expect(d.grantedBy).toEqual([]);
    expect(d.message).toContain('No bootstrap permission set grants it');
    // Still a finding: an inert declaration is the thing being reported.
    expect(d.message).toContain('the declaration is still inert');
  });

  it('reads a NULLISH owner as an unowned row, never as `undefined`', () => {
    // The predicate half of this is pinned on the seeder (a package-managed row
    // with no `package_id` is FOREIGN, ADR-0086 D3). This is the WORDING half:
    // printing `undefined` at an author is worse than saying what is true.
    for (const ownedBy of [null, undefined]) {
      const d = collision({ ownedBy });
      expect(d.ownedBy).toBeNull();
      expect(d.message).toContain('(a package-managed row with no package_id)');
      expect(d.message).not.toContain('undefined');
    }
  });

  it('offers both remedies — rename, or single-declarer co-ownership', () => {
    const d = collision();
    expect(d.fix).toContain('Rename the capability in package "com.example.b"');
    expect(d.fix).toContain('ADR-0130 D1');
  });
});

describe('[#18023] formatCapabilityNameCollisionDiagnostic — one line, whole finding', () => {
  it('carries the grep token, the message and the fix', () => {
    const line = formatCapabilityNameCollisionDiagnostic(collision());
    expect(line.startsWith(`[security] [${CAPABILITY_NAME_COLLISION}] `)).toBe(true);
    expect(line).toContain(collision().message);
    expect(line).toContain(`Fix: ${collision().fix}`);
  });
});

describe('[#18023] reportCapabilityNameCollisions — the refusal reaches somebody', () => {
  it('PRINTS with NO SINK INJECTED — the exact call shape that used to be mute', () => {
    const cap = captureConsole();
    try {
      reportCapabilityNameCollisions(undefined, [collision()]);
    } finally {
      cap.restore();
    }
    // ⛔ Not "did not throw": `logger?.warn?.(…)` did not throw either, and
    // that is precisely how an entire declared capability disappeared.
    expect(cap.seen).toHaveLength(1);
    expect(cap.seen[0]).toContain(CAPABILITY_NAME_COLLISION);
    expect(cap.seen[0]!.startsWith('warn: ')).toBe(true);
  });

  it('says it ONCE for a whole pass, with every record in the structured meta', () => {
    const warn = vi.fn();
    reportCapabilityNameCollisions({ warn }, [
      collision({ name: 'a_cap' }),
      collision({ name: 'b_cap', grantedBy: ['ops'] }),
    ]);
    // One line, not one per dropped capability: a package that collides on its
    // whole declaration would otherwise bury its own remedy.
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toContain('2 declared capabilities were NOT applied');
    expect(meta.event).toBe(CAPABILITY_NAME_COLLISION);
    expect(meta.collisions.map((c: any) => c.name)).toEqual(['a_cap', 'b_cap']);
    expect(meta.collisions[1].grantedBy).toEqual(['ops']);
    expect(meta.collisions[0].fix).toContain('Rename the capability');
  });

  it('uses the SINGULAR wording for one, so the line reads as English', () => {
    const warn = vi.fn();
    reportCapabilityNameCollisions({ warn }, [collision()]);
    expect(warn.mock.calls[0]![0]).toContain('1 declared capability was NOT applied');
  });

  it('prefers an injected sink and leaves the console alone', () => {
    const warn = vi.fn();
    const cap = captureConsole();
    try {
      reportCapabilityNameCollisions({ warn }, [collision()]);
    } finally {
      cap.restore();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(cap.seen).toEqual([]);
  });

  it('KEEPS THE RECEIVER — a class-based sink that reaches for `this` must not throw', () => {
    // ⛔ The `(logger?.warn ?? console.warn)(…)` trap: that form evaluates to a
    // bare function and calls it with `this === undefined`. `@objectstack/core`'s
    // `ObjectLogger` is exactly this shape.
    const seen: string[] = [];
    class HostSink {
      private readonly prefix = '[host] ';
      warn(message: string): void {
        seen.push(this.prefix + message);
      }
    }
    expect(() => reportCapabilityNameCollisions(new HostSink(), [collision()])).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.startsWith('[host] ')).toBe(true);
  });

  it('is SILENT on an empty pass — a diagnostic that always fires is unreadable', () => {
    const warn = vi.fn();
    const cap = captureConsole();
    try {
      reportCapabilityNameCollisions(undefined, []);
      reportCapabilityNameCollisions({ warn }, []);
    } finally {
      cap.restore();
    }
    expect(cap.seen).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
