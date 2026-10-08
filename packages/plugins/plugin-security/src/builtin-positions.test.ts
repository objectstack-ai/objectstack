// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D2, C2 stage S2] The six built-in positions, declared once.
 *
 * The list is read off the spec constants that name the six (ADR-0068 D2's
 * identity names, ADR-0090 D5/D9's audience anchors) — the expected values
 * below come from those constants, never from the list under test — and
 * registered with the engine registry under the owning package's id.
 */

import { describe, it, expect } from 'vitest';
import { AUDIENCE_ANCHOR_POSITIONS, BUILTIN_IDENTITY_METADATA, BUILTIN_IDENTITY_NAMES } from '@objectstack/spec';
import { PositionSchema } from '@objectstack/spec/identity';
import { isBuiltinPositionName, registerBuiltinPositions, securityBuiltinPositions } from './builtin-positions.js';

describe('securityBuiltinPositions', () => {
  it('declares the four identity names, then the two audience anchors, and nothing else', () => {
    expect(securityBuiltinPositions.map((p) => p.name)).toEqual([...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS]);
  });

  it('carries the spec’s label and description for every identity name', () => {
    for (const name of BUILTIN_IDENTITY_NAMES) {
      const declared = securityBuiltinPositions.find((p) => p.name === name);
      expect(declared).toEqual({ name, ...BUILTIN_IDENTITY_METADATA[name] });
    }
  });

  it('is a valid position definition, every one of the six', () => {
    for (const declaration of securityBuiltinPositions) {
      expect(PositionSchema.safeParse(declaration).success, declaration.name).toBe(true);
    }
  });

  it('answers membership by exact name only', () => {
    for (const name of [...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS]) expect(isBuiltinPositionName(name)).toBe(true);
    for (const name of ['Everyone', 'org_admins', 'field_rep', '', undefined, 42]) expect(isBuiltinPositionName(name)).toBe(false);
  });
});

describe('registerBuiltinPositions', () => {
  it('registers each of the six as a `position`, keyed by name, under the owning package', () => {
    const calls: Array<[string, Record<string, unknown>, string, string | undefined]> = [];
    const registry = {
      registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string) {
        // The real registry stamps provenance onto the object it is handed.
        item._packageId = packageId;
        calls.push([type, item, keyField, packageId]);
      },
    };
    expect(registerBuiltinPositions(registry, 'com.example.owner')).toBe(6);
    expect(calls.map(([type, item, keyField, packageId]) => [type, item.name, keyField, packageId])).toEqual(
      [...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS].map((name) => ['position', name, 'name', 'com.example.owner']),
    );
    // Each registration got its own copy: the shared declarations carry no stamp.
    for (const declaration of securityBuiltinPositions) expect(declaration).not.toHaveProperty('_packageId');
  });

  it('registers nothing, and says so with 0, when there is no registration seam', () => {
    expect(registerBuiltinPositions(undefined, 'com.example.owner')).toBe(0);
    expect(registerBuiltinPositions({ listItems: () => [] }, 'com.example.owner')).toBe(0);
  });
});
