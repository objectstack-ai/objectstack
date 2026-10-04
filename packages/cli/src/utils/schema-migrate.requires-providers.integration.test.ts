// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootSchemaStack } from './schema-migrate.js';

/**
 * #21732 — `os migrate plan` / `apply` boot a config whose plugins hard-depend
 * on a service that only `requires` supplies.
 *
 * Every connector (`connector-rest`, `-openapi`, `-mcp`, `-slack`) declares
 * `dependencies = ['com.objectstack.service-automation']`, and the blank
 * template and the showcase ask for automation only through
 * `requires: ['automation', …]`. `os serve` resolves that token to the
 * provider; the schema-migration composition did not, so the kernel refused to
 * order the boot — `Dependency 'com.objectstack.service-automation' not found
 * for plugin 'com.objectstack.connector.rest'` — and both commands exited 1 on
 * every new blank app.
 *
 * The fixture is that shape with the connector reduced to what the kernel
 * reads: a name, the hard dependency, and an `init()` that registers a
 * provider factory on the `automation` service, as the real connectors do.
 * Pinned over the REAL kernel boot, because the defect is an ordering refusal
 * no composition-level assertion can stand in for; the composition itself is
 * pinned in `schema-migration-plugins.test.ts`.
 */
describe('os migrate plan/apply resolve the requires-supplied provider a plugin depends on (#21732)', () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-21732-'));
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      [
        'class DependentConnector {',
        "  name = 'com.example.os21732.connector';",
        "  dependencies = ['com.objectstack.service-automation'];",
        '  async init(ctx: any) {',
        "    ctx.getService('automation').registerConnectorProvider('os21732', () => ({}));",
        '  }',
        "  async start() { throw new Error('a host start() must not run under os migrate'); }",
        '}',
        'export default {',
        "  manifest: { id: 'com.example.os21732', name: 'requires-supplied provider', version: '0.0.0', type: 'app' },",
        "  requires: ['automation'],",
        "  objects: [{ name: 'os21732_thing', fields: { title: { type: 'text' } } }],",
        // A flow the inert engine must NOT register — registration is what
        // arms its trigger.
        "  flows: [{ name: 'os21732_flow', label: 'Flow', type: 'autolaunched',",
        "    nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [] }],",
        '  plugins: [new DependentConnector()],',
        '};',
        '',
      ].join('\n'),
    );
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    // Artifact-less on purpose: the config is the only host.
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  });

  afterAll(() => {
    if (savedEnv.OS_ARTIFACT_PATH === undefined) delete process.env.OS_ARTIFACT_PATH;
    else process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('boots, orders the dependent plugin after the provider, and arms nothing', async () => {
    const boot = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${join(dir, 'plan.db')}`,
      deferSchemaDdl: true,
      composeHostStack: true,
      projectRoot: dir,
    });
    try {
      const automation = boot.kernel.getService('automation');
      // The dependent plugin's init() ran AFTER the provider's — the ordering
      // the kernel refused to produce before this card.
      expect(automation.getConnectorProvider('os21732')).toBeTypeOf('function');
      // Inert: the config's flow is never registered, so no trigger is bound.
      expect(await automation.listFlows()).toEqual([]);
      // The provider's own tables are in the plan, as `os serve` creates them.
      const objects = boot.allObjects().map((o: any) => o?.name);
      expect(objects).toEqual(expect.arrayContaining(['sys_automation_run', 'sys_flow_dispatch', 'os21732_thing']));
      expect(boot.composition.notes.join(' ')).toContain(
        "Composed AutomationServicePlugin for `requires: ['automation']`",
      );
    } finally {
      await boot.shutdown();
    }
  }, 60_000);
});
