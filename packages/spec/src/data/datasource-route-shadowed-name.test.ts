// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DatasourceSchema.name` refuses the route-shadowed names (#29308).
 *
 * ## What was wrong
 *
 * The datasource admin API mounts the driver catalog at
 * `GET /api/v1/datasources/drivers`, ahead of `GET /api/v1/datasources/:name`,
 * so a datasource named `drivers` can never be read by name. The admin create
 * door refused it, but `DatasourceSchema.name` accepted it, so the same
 * unreachable name was minted from code (`defineStack`) or through the
 * metadata save door (`PUT /api/v1/meta/datasource/drivers`).
 *
 * ## What is pinned
 *
 * - the reserved set is ONE exported constant, frozen, whose entries are
 *   identifiers the `name` pattern accepts (so the refusal pattern built from
 *   them needs no escaping);
 * - `DatasourceSchema` refuses every entry: one issue at `name`, an
 *   `invalid_format` whose message names the name and the shadowing route,
 *   and carries no tracker number;
 * - `defineStack` (the code door) refuses it with the ADR-0112 envelope at
 *   `datasources.0.name`;
 * - the published JSON Schema carries the refusal (a second `pattern`), so a
 *   JSON-Schema consumer refuses the name too;
 * - CONTROLS: near names (`driver`, `drivers_archive`, `my_drivers`), the
 *   host's `default` row and `test` (a literal that shadows no by-name read)
 *   still parse.
 *
 * The admin door's half (the registrar mounts the literal from this list, and
 * the create door refuses it) is pinned in
 * `packages/services/service-datasource/src/__tests__/datasource-route-reserved-names.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { DatasourceSchema, ROUTE_SHADOWED_DATASOURCE_NAMES } from './datasource.zod';
import { defineStack } from '../stack.zod';

const sqlite = (name: string) => ({ name, driver: 'sqlite', config: { filename: `${name}.db` } });
const manifest = { id: 'com.example.fx', name: 'fx', version: '1.0.0', type: 'app' as const };

type Envelope = Error & {
  code?: string;
  status?: number;
  issues?: ReadonlyArray<{ code?: string; path?: readonly PropertyKey[]; message?: string }>;
};

function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

describe('ROUTE_SHADOWED_DATASOURCE_NAMES', () => {
  it('is the frozen list the admin API shadows today: `drivers`', () => {
    expect([...ROUTE_SHADOWED_DATASOURCE_NAMES]).toEqual(['drivers']);
    expect(Object.isFrozen(ROUTE_SHADOWED_DATASOURCE_NAMES)).toBe(true);
  });

  it('every entry is an identifier the `name` pattern accepts, so the refusal pattern needs no escaping', () => {
    for (const name of ROUTE_SHADOWED_DATASOURCE_NAMES) {
      expect(name, name).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});

describe('DatasourceSchema.name refuses a route-shadowed name', () => {
  for (const name of ROUTE_SHADOWED_DATASOURCE_NAMES) {
    it(`refuses '${name}' with one issue at \`name\` naming the name and the route`, () => {
      const result = DatasourceSchema.safeParse(sqlite(name));
      expect(result.success).toBe(false);
      const issues = result.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_format');
      expect(issues[0]!.path).toEqual(['name']);
      const message = issues[0]!.message;
      expect(message.startsWith(`Datasource name '${name}' is reserved: `), message).toBe(true);
      expect(message).toContain(`/api/v1/datasources/${name}`);
      expect(message).toContain('could never be read by name');
      expect(message).not.toMatch(/#\d{3,}/);
    });

    it(`the refusal for '${name}' names only that name: built from the input, never from the whole list`, () => {
      const message = DatasourceSchema.safeParse(sqlite(name)).error!.issues[0]!.message;
      // Every quoted name and every literal route the sentence carries is this one.
      expect([...message.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])).toEqual([name]);
      expect([...message.matchAll(/\/api\/v1\/datasources\/([a-z0-9_]+)/g)].map((m) => m[1])).toEqual([name]);
    });
  }

  it('the code door: defineStack refuses it with STACK_SCHEMA_INVALID / 422 at datasources.0.name', () => {
    const refused = refusal(() => defineStack({ manifest, datasources: [sqlite('drivers')] } as never));
    expect(refused?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refused?.status).toBe(422);
    const hits = (refused?.issues ?? []).filter((i) => (i.message ?? '').startsWith("Datasource name 'drivers' is reserved"));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toEqual(['datasources', 0, 'name']);
  });

  it('the published JSON Schema carries the refusal: some `name` pattern rejects each reserved name', () => {
    const json = z.toJSONSchema(DatasourceSchema, { io: 'input', unrepresentable: 'any' }) as {
      properties: Record<string, { pattern?: string; allOf?: Array<{ pattern?: string }> }>;
    };
    const name = json.properties.name!;
    const patterns = [name.pattern, ...(name.allOf ?? []).map((s) => s.pattern)]
      .filter((p): p is string => typeof p === 'string')
      .map((p) => new RegExp(p));
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    for (const reserved of ROUTE_SHADOWED_DATASOURCE_NAMES) {
      expect(patterns.every((p) => p.test(reserved)), reserved).toBe(false);
    }
    for (const legal of ['reporting', 'drivers_archive', 'driver']) {
      expect(patterns.every((p) => p.test(legal)), legal).toBe(true);
    }
  });

  it('CONTROL: near names, `test` and the host `default` row still parse', () => {
    for (const name of ['driver', 'drivers_archive', 'my_drivers', '_drivers', 'test', 'default', 'reporting']) {
      const result = DatasourceSchema.safeParse(sqlite(name));
      expect(result.success, `${name}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('CONTROL: an off-pattern name still meets the identifier pattern, not this refusal', () => {
    const result = DatasourceSchema.safeParse(sqlite('Drivers'));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).some((m) => m.includes('is reserved'))).toBe(false);
  });
});
