// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #3050 — OWD posture authoring gate: env-tighten-only over packaged
// declarations (ADR-0086 D1), enforced on the runtime write path.
//
// R2 (`owd_external_wider`, external ≤ internal) is RETIRED from this gate —
// maintainer ruling on #8310: since `validateSecurityPosture` declares
// `object` in `runtimeTypes`, the runtime lint door refuses the same defect
// as a 422 (`security-external-wider-than-internal`, and `security-owd-unset`
// for the unset-internal shape) BEFORE this gate runs. The retirement pins
// below keep that removal deliberate; the 422-door coverage is pinned
// end-to-end in `packages/rest/src/meta-object-owd-gate.test.ts`.

import { describe, it, expect } from 'vitest';
import { objectPostureGate, registerObjectPostureGate } from './object-posture-gate.js';

const base = (over: Partial<Parameters<typeof objectPostureGate>[0]> = {}) => ({
  type: 'object',
  name: 'crm_account',
  body: {},
  isArtifactBacked: false,
  ...over,
});

describe('R2 retirement (#8310) — this gate no longer judges external ≤ internal', () => {
  it('passes an external-wider pair on a non-artifact body — the 422 lint door owns this refusal now', () => {
    // Before #8310 this threw 403 `owd_external_wider`. The refusal is NOT
    // gone from the platform: `saveMetaItem` runs the runtime lint table
    // first, and an active-state publish of this body answers 422
    // `security-external-wider-than-internal` before this gate is reached.
    expect(() => objectPostureGate(base({
      body: { sharingModel: 'public_read', externalSharingModel: 'public_read_write' },
    }))).not.toThrow();
  });

  it('passes an explicit external on an OWD-less body — 422 `security-owd-unset` answers upstream', () => {
    // R2 resolved the unset internal to `private` and refused. The ruled door
    // is stricter about the CAUSE: an unauthored `sharingModel` is itself the
    // refusal (absence is not a decision) — and for system objects, where
    // owd-unset deliberately does not apply, the runtime default is PUBLIC
    // (`effectiveSharingModel`), so R2's private baseline was a false
    // premise there, not protection.
    expect(() => objectPostureGate(base({
      body: { externalSharingModel: 'public_read' },
    }))).not.toThrow();
  });

  it('still accepts every legal pair (nothing new is refused by the retirement)', () => {
    for (const body of [
      { sharingModel: 'public_read', externalSharingModel: 'public_read' },
      { sharingModel: 'public_read_write', externalSharingModel: 'private' },
      { sharingModel: 'controlled_by_parent', externalSharingModel: 'public_read' },
      { sharingModel: 'public_read', externalSharingModel: 'controlled_by_parent' },
      { name: 'crm_account', fields: {} },
    ]) {
      expect(() => objectPostureGate(base({ body }))).not.toThrow();
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
