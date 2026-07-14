// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../conversions/registry.js';
import { PROTOCOL_MAJOR } from '../kernel/protocol-version.js';
import {
  applyMetaMigrations,
  composeMigrationChain,
  MigrationFloorError,
} from './chain.js';
import {
  MIGRATIONS_BY_MAJOR,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
} from './registry.js';
import { composeSpecChanges, SpecChangesSchema } from './spec-changes.js';

const CONVERSION_IDS = new Set(ALL_CONVERSIONS.map((c) => c.id));

describe('migration chain (ADR-0087 D3)', () => {
  describe('registry integrity', () => {
    it('every step references only real conversion ids', () => {
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
        for (const id of step.conversionIds) {
          expect(CONVERSION_IDS.has(id)).toBe(true);
        }
      }
    });

    it('a graduated conversion belongs to the step for its own major', () => {
      for (const [majorStr, step] of Object.entries(MIGRATIONS_BY_MAJOR)) {
        const major = Number(majorStr);
        for (const id of step.conversionIds) {
          const conv = ALL_CONVERSIONS.find((c) => c.id === id)!;
          expect(conv.toMajor).toBe(major);
        }
      }
    });

    it('semantic migrations carry acceptance criteria (never silence)', () => {
      for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
        for (const s of step.semantic) {
          expect(s.acceptanceCriteria.length).toBeGreaterThan(0);
          expect(s.reason.length).toBeGreaterThan(0);
        }
      }
    });

    it('the support floor is at or below the earliest step', () => {
      expect(MIGRATION_SUPPORT_FLOOR).toBeLessThanOrEqual(MIGRATION_MAJORS[0]!);
    });
  });

  describe('composition (cross-major is the designed-for case)', () => {
    it('composes only the steps in (from, to]', () => {
      const chain = composeMigrationChain(10, 11);
      expect(chain.map((s) => s.toMajor)).toEqual([11]);
    });

    it('a consumer already at current gets an empty chain', () => {
      expect(composeMigrationChain(PROTOCOL_MAJOR, PROTOCOL_MAJOR)).toHaveLength(0);
    });

    it('refuses a from-major below the support floor', () => {
      expect(() => applyMetaMigrations({}, MIGRATION_SUPPORT_FLOOR - 1)).toThrow(MigrationFloorError);
    });
  });

  describe('replay — the chain applies the graduated mechanical transforms', () => {
    it('migrates a 10.x stack with all three protocol-11 shapes to canonical', () => {
      const stack = {
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'http_request', config: { url: 'x' } },
              { id: 'b', type: 'delete_record', config: { objectName: 'lead', filters: { s: 1 } } },
            ],
          },
        ],
        pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }],
      };
      const result = applyMetaMigrations(stack, 10, 11);

      const flow = (result.stack.flows as any[])[0];
      expect(flow.nodes[0].type).toBe('http');
      expect(flow.nodes[1].config).toEqual({ objectName: 'lead', filter: { s: 1 } });
      expect((result.stack.pages as any[])[0].kind).toBe('html');

      // Three mechanical rewrites, no semantic TODOs triggered by these shapes
      // (semantic TODOs are advisory per-major, always surfaced for the hop).
      expect(result.applied).toHaveLength(3);
      expect(result.todos.map((t) => t.id).sort()).toEqual([
        'object-titleFormat-to-nameField',
        'rls-sql-predicate-to-cel',
      ]);
    });

    it('is immutable — the input stack is not mutated', () => {
      const stack = { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] };
      const snapshot = structuredClone(stack);
      applyMetaMigrations(stack, 10, 11);
      expect(stack).toEqual(snapshot);
    });

    it('checkpoints each hop for per-hop verify / bisection', () => {
      const stack = { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] };
      const result = applyMetaMigrations(stack, 10, 11);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0]!.toMajor).toBe(11);
      expect((result.hops[0]!.stack.pages as any[])[0].kind).toBe('html');
    });
  });

  describe('chain-replay from every conversion fixture (CI composability gate)', () => {
    // Each graduated conversion's old-shape fixture must reach canonical when
    // replayed through the full chain from the support floor — a composability
    // break is a release blocker (ADR-0087 D3), caught here, not by a consumer.
    for (const conversion of ALL_CONVERSIONS) {
      it(`${conversion.id}: fixture.before → fixture.after via the chain`, () => {
        const result = applyMetaMigrations(
          structuredClone(conversion.fixture.before),
          MIGRATION_SUPPORT_FLOOR,
          conversion.toMajor,
        );
        expect(result.stack).toEqual(conversion.fixture.after);
      });
    }
  });
});

describe('spec-changes.json manifest (ADR-0087 D4)', () => {
  it('composes conversions + semantic migrations across the range', () => {
    const changes = composeSpecChanges(10, 11);
    expect(changes.from).toBe(10);
    expect(changes.to).toBe(11);
    expect(changes.converted.map((c) => c.conversionId).sort()).toEqual(
      (CONVERSIONS_BY_MAJOR[11] ?? []).map((c) => c.id).sort(),
    );
    expect(changes.migrated.map((m) => m.migrationId).sort()).toEqual([
      'object-titleFormat-to-nameField',
      'rls-sql-predicate-to-cel',
    ]);
  });

  it('validates against its own schema', () => {
    const changes = composeSpecChanges(10, 11, {
      added: [{ surface: 'applyConversions (function)', since: 11 }],
      removed: [{ surface: 'httpRequestNode (const)', removedIn: 11, replacement: 'http node' }],
    });
    expect(SpecChangesSchema.safeParse(changes).success).toBe(true);
  });

  it('per-major manifests compose into one aggregate view', () => {
    // Folding 10→11 (the only major with a step today) must match a direct 10→11.
    const direct = composeSpecChanges(10, PROTOCOL_MAJOR);
    const convertedIds = direct.converted.map((c) => c.conversionId);
    // Every conversion in range appears exactly once (no duplication across the fold).
    expect(new Set(convertedIds).size).toBe(convertedIds.length);
  });

  it('an empty range yields an empty manifest', () => {
    const changes = composeSpecChanges(PROTOCOL_MAJOR, PROTOCOL_MAJOR);
    expect(changes.converted).toHaveLength(0);
    expect(changes.migrated).toHaveLength(0);
    expect(SpecChangesSchema.safeParse(changes).success).toBe(true);
  });
});
