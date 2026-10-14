// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #3050 — OWD posture authoring gate: env-tighten-only over packaged
// declarations (ADR-0086 D1), enforced on the runtime write path.
//
// R2 (`owd_external_wider`, external ≤ internal) was RETIRED from this gate
// by the maintainer ruling on #8310, and the key it ordered,
// `externalSharingModel`, is itself retired since #23268 (ADR-0049): the
// object shape refuses it at parse, so R1 compares the internal
// `sharingModel` alone — no body reaching this gate can carry the key.

import { describe, it, expect } from 'vitest';
import { objectPostureGate, registerObjectPostureGate } from './object-posture-gate.js';

const base = (over: Partial<Parameters<typeof objectPostureGate>[0]> = {}) => ({
  type: 'object',
  name: 'crm_account',
  body: {},
  isArtifactBacked: false,
  ...over,
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

  it('accepts tightening the packaged posture', () => {
    expect(() => objectPostureGate(base({
      isArtifactBacked: true,
      declaredBody: { sharingModel: 'public_read_write' },
      body: { sharingModel: 'private' },
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
    // R1 through the registered seam (R2 is retired, so the wiring pin uses
    // the surviving rule: widening a packaged declaration).
    await expect(async () => gate({
      type: 'object', name: 'crm_account', body: { sharingModel: 'public_read_write' },
      isArtifactBacked: true, declaredBody: { sharingModel: 'private' },
    })).rejects.toThrowError(/owd_widening_forbidden/);
  });

  it('feature-detects: returns false on a protocol without the seam', () => {
    expect(registerObjectPostureGate({})).toBe(false);
    expect(registerObjectPostureGate(undefined)).toBe(false);
  });
});
