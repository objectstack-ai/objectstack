// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { runEmbeddedEngine } from '../src/index.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/objectql/core';

describe('embed @objectstack/objectql/core (ADR-0076)', () => {
  it('runs the engine standalone and round-trips CRUD via the lean entry', async () => {
    const active = await runEmbeddedEngine();
    expect(active.map((r) => r.name)).toEqual(['Acme', 'Initech']);
    expect(active.every((r) => r.active === true)).toBe(true);
  });

  it('the lean entry exposes the engine but not the kernel plugin / protocol', async () => {
    const core: Record<string, unknown> = await import('@objectstack/objectql/core');
    expect(typeof core.ObjectQL).toBe('function');
    expect(core.ObjectQLPlugin).toBeUndefined();
    expect(core.ObjectStackProtocolImplementation).toBeUndefined();
  });
});
