// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #3050 — OWD posture authoring gate: env-tighten-only over packaged
// declarations (ADR-0086 D1) + external ≤ internal (ADR-0090 D11), enforced
// on the runtime write path (previously CLI-lint-only).

import { describe, it, expect } from 'vitest';
import { objectPostureGate, registerObjectPostureGate } from './object-posture-gate.js';

const base = (over: Partial<Parameters<typeof objectPostureGate>[0]> = {}) => ({
  type: 'object',
  name: 'crm_account',
  body: {},
  isArtifactBacked: false,
  ...over,
});

describe('R2 — external ≤ internal (ADR-0090 D11)', () => {
  it('rejects external wider than internal', () => {
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'public_read', externalSharingModel: 'public_read_write' },
    }))).toThrowError(/owd_external_wider/);
  });

  it('rejects explicit external on an OWD-less body (internal defaults to private, ADR-0090 D1)', () => {
    expect(() => objectPostureGate(base({
      body: { externalSharingModel: 'public_read' },
    }))).toThrowError(/owd_external_wider/);
  });

  it('accepts external equal to internal', () => {
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'public_read', externalSharingModel: 'public_read' },
    }))).not.toThrow();
  });

  it('accepts external tighter than internal', () => {
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'public_read_write', externalSharingModel: 'private' },
    }))).not.toThrow();
  });

  it('skips ordering when either side is controlled_by_parent (inherits master pair)', () => {
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'controlled_by_parent', externalSharingModel: 'public_read' },
    }))).not.toThrow();
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'public_read', externalSharingModel: 'controlled_by_parent' },
    }))).not.toThrow();
  });

  it('accepts a body with no posture fields at all', () => {
    expect(() => objectPostureGate(base({ body: { name: 'crm_account', fields: {} } }))).not.toThrow();
  });

  it('carries 403 + code on the error', () => {
    try {
      objectPostureGate(base({ body: { sharingModel: 'private', externalSharingModel: 'public_read' } }));
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.status).toBe(403);
      expect(e.code).toBe('owd_external_wider');
    }
  });
});

describe('R1 — env-tighten-only over a packaged declaration (ADR-0086 D1)', () => {
  it('rejects widening internal beyond the declared baseline', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'private' },
      body: { sharingModel: 'public_read_write' },
    }))).toThrowError(/owd_widening_forbidden/);
  });

  it('rejects widening when the declaration is OWD-less (baseline = private per ADR-0090 D1)', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { name: 'crm_account' },
      body: { sharingModel: 'public_read' },
    }))).toThrowError(/owd_widening_forbidden/);
  });

  it('rejects widening external beyond the declared external (default private, D11)', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'public_read' },
      body: { sharingModel: 'public_read', externalSharingModel: 'public_read' },
    }))).toThrowError(/owd_widening_forbidden/);
  });

  it('accepts tightening the packaged posture', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'public_read_write', externalSharingModel: 'public_read' },
      body: { sharingModel: 'private', externalSharingModel: 'private' },
    }))).not.toThrow();
  });

  it('accepts an overlay that leaves posture unchanged', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'public_read' },
      body: { sharingModel: 'public_read', label: 'Renamed' },
    }))).not.toThrow();
  });

  it('accepts an overlay that omits posture fields entirely', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'private' },
      body: { label: 'Renamed' },
    }))).not.toThrow();
  });

  it('skips tighten comparison when declared side is controlled_by_parent', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'controlled_by_parent' },
      body: { sharingModel: 'public_read' },
    }))).not.toThrow();
  });

  it('does not apply R1 to runtime-created (non-artifact) objects — env owns them', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: false,
      body: { sharingModel: 'public_read_write' },
    }))).not.toThrow();
  });

  it('does not apply R1 when the declared baseline is unavailable', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      body: { sharingModel: 'public_read_write' },
    }))).not.toThrow();
  });
});

describe('registerObjectPostureGate wiring', () => {
  it('registers on a protocol exposing registerAuthoringGate and rejects through it', async () => {
    const gates = new Map<string, (ctx: any) => void | Promise<void>>();
    const protocol = {
      registerAuthoringGate: (type: string, gate: (ctx: any) => void) => gates.set(type, gate),
    };
    expect(registerObjectPostureGate(protocol)).toBe(true);
    const gate = gates.get('object')!;
    expect(gate).toBeTypeOf('function');
    await expect(async () => gate({
      type: 'object', name: 'crm_account', body: { sharingModel: 'private', externalSharingModel: 'public_read' },
      isArtifactBacked: false,
    })).rejects.toThrowError(/owd_external_wider/);
  });

  it('feature-detects: returns false on a protocol without the seam', () => {
    expect(registerObjectPostureGate({})).toBe(false);
    expect(registerObjectPostureGate(undefined)).toBe(false);
  });
});
