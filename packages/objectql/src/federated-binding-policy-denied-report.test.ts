// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25079 — `reconcileFederatedBindings`' report for a federated object whose
 * datasource the connect POLICY denied.
 *
 * `os migrate apply` on the stock showcase denies its `schemaMode: 'external'`
 * datasource on purpose (the CLI's managed-only connect policy) and then
 * printed, at ERROR, that the federated objects "keep their REST routes and
 * keep rendering in the UI, while every read … resolves to a table named after
 * the OBJECT". For a denied datasource that consequence is false on every
 * composition: the datasource layer records the verdict as kind `blocked`
 * (`engine.markDatasourceUnavailable`), and every read against such an object
 * refuses with `DatasourceUnavailableError`. So the report is judged on that
 * recorded verdict alone, never on what the composition serves:
 *
 *  - `blocked`                       → ONE `info` line, outside the ERROR;
 *  - undeclared / `failed` / a driver without `registerExternalObject` /
 *    a registration that threw       → the ERROR, unchanged, as before.
 *
 * The composition is not read by the code under test; the two shapes below
 * pin that a migrate-shaped and a serving-shaped context answer alike.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/** A federated object bound to `datasource` by an explicit `object.datasource`. */
function federated(name: string, datasource: string): ServiceObject {
  return {
    name,
    label: name,
    datasource,
    fields: { id: { name: 'id', label: 'ID', type: 'text' as const } },
    external: { remoteName: `remote_${name}` },
  } as ServiceObject;
}

/** A driver registered under `name`; `register` decides what `registerExternalObject` does. */
function namedDriver(name: string, register?: 'ok' | 'throws') {
  return {
    name,
    supports: {},
    async syncSchema() { /* not reached for a federated object */ },
    async find() { return []; },
    ...(register
      ? {
          async registerExternalObject() {
            if (register === 'throws') throw new Error('remote catalog unreachable');
          },
        }
      : {}),
  };
}

/** The two composition shapes: one that serves (an `http.server` is published) and a migrate run's (none is). */
const SHAPES = {
  serving: (logger: unknown) => ({
    logger,
    getService: (n: string) => {
      if (n === 'http.server') return {};
      throw new Error(`[Kernel] Service '${n}' not found`);
    },
  }),
  migrate: (logger: unknown) => ({
    logger,
    getService: (n: string) => {
      throw new Error(`[Kernel] Service '${n}' not found`);
    },
  }),
} as const;

type Setup = {
  objects: ServiceObject[];
  drivers?: unknown[];
  unavailable?: Array<{ name: string; kind: 'blocked' | 'failed' }>;
};

async function reconcile(setup: Setup, shape: keyof typeof SHAPES = 'serving') {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  engine.registerDriver(namedDriver('default', 'ok') as any, true);
  for (const d of setup.drivers ?? []) engine.registerDriver(d as any);
  for (const obj of setup.objects) engine.registerObject(obj as any);
  for (const u of setup.unavailable ?? []) engine.markDatasourceUnavailable(u);
  const plugin = new ObjectQLPlugin();
  (plugin as any).ql = engine;
  await (plugin as any).reconcileFederatedBindings(SHAPES[shape](rec.logger));
  return rec;
}

/** The info lines that report a policy denial — identified by the object they name. */
const deniedLines = (rec: ReturnType<typeof recordingLogger>, object: string) =>
  rec.at('info').filter((r) => r.message.includes(object));

describe('#25079 a policy-denied (`blocked`) datasource is reported at info, never in the ERROR', () => {
  for (const shape of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
    it(`one info line naming the denial, the datasource and the object; no ERROR (${shape}-shaped composition)`, async () => {
      const rec = await reconcile(
        {
          objects: [federated('fed_customer', 'ext_denied'), federated('fed_order', 'ext_denied')],
          unavailable: [{ name: 'ext_denied', kind: 'blocked' }],
        },
        shape,
      );

      expect(rec.at('error')).toHaveLength(0);
      const lines = deniedLines(rec, 'fed_customer');
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toContain('fed_order');
      expect(lines[0].message).toContain("'ext_denied'");
      expect(lines[0].message).toContain('denied');
      expect(lines[0].message).toContain('DatasourceUnavailableError');
      expect(lines[0].args[0]).toEqual({ denied: 2 });
    });
  }
});

describe('#25079 controls — every other unbound class keeps the ERROR, on either composition', () => {
  const CONTROLS: Array<{ label: string; object: string; setup: Setup; meta: Record<string, number> }> = [
    {
      label: 'an undeclared datasource (no recorded verdict)',
      object: 'fed_orphan',
      setup: { objects: [federated('fed_orphan', 'ext_missing')] },
      meta: { bound: 0, unbound: 1, unsupported: 0, failed: 0 },
    },
    {
      label: "a FAILED connect (kind 'failed')",
      object: 'fed_down',
      setup: {
        objects: [federated('fed_down', 'ext_down')],
        unavailable: [{ name: 'ext_down', kind: 'failed' }],
      },
      meta: { bound: 0, unbound: 1, unsupported: 0, failed: 0 },
    },
    {
      label: 'a driver without external-object registration',
      object: 'fed_plain',
      setup: { objects: [federated('fed_plain', 'ext_plain')], drivers: [namedDriver('ext_plain')] },
      meta: { bound: 0, unbound: 0, unsupported: 1, failed: 0 },
    },
    {
      label: 'a registration that threw',
      object: 'fed_throws',
      setup: { objects: [federated('fed_throws', 'ext_throws')], drivers: [namedDriver('ext_throws', 'throws')] },
      meta: { bound: 0, unbound: 0, unsupported: 0, failed: 1 },
    },
  ];

  for (const c of CONTROLS) {
    for (const shape of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
      it(`${c.label} → the ERROR (${shape}-shaped)`, async () => {
        const rec = await reconcile(c.setup, shape);

        const errors = rec.at('error');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain(c.object);
        expect(errors[0].message).toContain('NOT bound to their remote table');
        expect(errors[0].args[1]).toEqual(c.meta);
        expect(deniedLines(rec, c.object)).toHaveLength(0);
      });
    }
  }
});

describe('#25079 a mixed boot — info for the denied, the ERROR for the rest', () => {
  it('splits by verdict, and the ERROR counts exclude the denied objects', async () => {
    const rec = await reconcile({
      objects: [
        federated('fed_customer', 'ext_denied'),
        federated('fed_orphan', 'ext_missing'),
        federated('fed_down', 'ext_down'),
      ],
      unavailable: [
        { name: 'ext_denied', kind: 'blocked' },
        { name: 'ext_down', kind: 'failed' },
      ],
    });

    const info = deniedLines(rec, 'fed_customer');
    expect(info).toHaveLength(1);
    expect(info[0].args[0]).toEqual({ denied: 1 });
    expect(info[0].message).not.toContain('fed_orphan');
    expect(info[0].message).not.toContain('fed_down');

    const errors = rec.at('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/^2 federated \(external\) object\(s\) are NOT bound/);
    expect(errors[0].message).toContain('fed_orphan');
    expect(errors[0].message).toContain('fed_down');
    expect(errors[0].message).not.toContain('fed_customer');
    expect(errors[0].args[1]).toEqual({ bound: 0, unbound: 2, unsupported: 0, failed: 0 });
  });
});
