// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17516] The set-name collision diagnostic — the ONE derivation every door
 * that refuses a foreign set name shares.
 *
 * The runtime door that raised it — the declared-permission seeder's refusal to
 * write into a `sys_permission_set` row another package owns — retired with the
 * seeder (ADR-0131 D3: the boot writes no catalog row), and its pins went with
 * it. The compile-time door (`os build` / `os validate`) still consumes the
 * predicate and the wording from here, so the derivation keeps its own pins.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  PERMISSION_SET_NAME_COLLISION,
  formatPermissionSetNameCollisionDiagnostic,
  permissionSetNameCollisionDiagnostic,
  permissionSetNameIsForeign,
  reportPermissionSetNameCollisions,
} from './permission-set-name-collision.js';

/**
 * Capture EVERY console channel. "Author-visible output" is not channel-specific
 * — the pre-fix failure was that NONE of them carried anything — so a pin that
 * watched only `warn` could be satisfied by a change that moved the silence.
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

describe('[#17516] the shared derivation both doors must use', () => {
  it('permissionSetNameIsForeign: same owner is ours, anything else is foreign', () => {
    expect(permissionSetNameIsForeign('com.example.a', 'com.example.a')).toBe(false);
    expect(permissionSetNameIsForeign('com.example.a', 'com.example.b')).toBe(true);
    // A nullish owner is FOREIGN — never silently adopted on a name match.
    expect(permissionSetNameIsForeign(undefined, 'com.example.b')).toBe(true);
    expect(permissionSetNameIsForeign(null, 'com.example.b')).toBe(true);
    // Both unowned is not a collision between two different packages.
    expect(permissionSetNameIsForeign(null, undefined)).toBe(false);
  });

  /**
   * The literal is asserted rather than only imported — the precedent the
   * sibling `position_name_fold_grant` pin sets. Importing it on both sides
   * would let a rename pass green while every operator's grep went dead.
   */
  it('stamps a stable, greppable token', () => {
    expect(PERMISSION_SET_NAME_COLLISION).toBe('permission_set_name_collision');
    const d = permissionSetNameCollisionDiagnostic({
      name: 'crm_sales_rep', declaredBy: 'com.example.b', ownedBy: 'com.example.a',
    });
    expect(formatPermissionSetNameCollisionDiagnostic(d))
      .toContain('[security] [permission_set_name_collision]');
  });

  it('reportPermissionSetNameCollisions says nothing when there is nothing to say', () => {
    const cap = captureConsole();
    try {
      reportPermissionSetNameCollisions(undefined, []);
    } finally {
      cap.restore();
    }
    expect(cap.seen).toEqual([]);
  });

  /**
   * The measured-and-rejected spelling next door: `(logger.warn ?? console.warn)(…)`
   * detaches the receiver, and a class-based host sink reaching for `this`
   * throws. Every double in this package is a plain closure and would survive
   * it, so the pin uses a real class.
   */
  it('keeps the receiver when the host sink is a class instance', () => {
    class HostSink {
      lines: string[] = [];
      warn(m: string): void { this.lines.push(m); }
    }
    const sink = new HostSink();
    const d = permissionSetNameCollisionDiagnostic({
      name: 'crm_sales_rep', declaredBy: 'com.example.b', ownedBy: 'com.example.a',
    });
    expect(() => reportPermissionSetNameCollisions(sink, [d])).not.toThrow();
    expect(sink.lines).toHaveLength(1);
  });
});
