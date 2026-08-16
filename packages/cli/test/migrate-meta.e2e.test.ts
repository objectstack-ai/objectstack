// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta` — end-to-end over the REAL CLI process (ADR-0087 D3/D5).
 *
 * The chain's transforms are fixture-tested in @objectstack/spec
 * (conversions.test.ts, migrations.test.ts), but the COMMAND path — config
 * loading via bundleRequire, the convert:false normalization that keeps the
 * chain attributable, the schema-validity verdict, the machine JSON shape,
 * `--out` snapshots, and the support-floor refusal — had no test at all.
 * This spawns `bin/run-dev.js` against a temp project authored in the
 * PRE-protocol-17 dialect, exercising one key from every v17 conversion
 * family in a single pass, exactly the cross-major "consumer upgrades"
 * scenario the command exists for.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * A stack authored against protocol 16: every line marked `// 16:` is a shape
 * the v17 chain must rewrite, spanning each conversion family — renames
 * (action execute→target, sharing full→edit), the required→storage.notNull
 * explicitization, and the #3896 close-out removals (rls.priority, the four
 * tool keys, flow active/template/outputSchema/fallbackNodeId, view/dashboard
 * inert keys, agent.knowledge, skill.triggerPhrases).
 */
const PRE17_CONFIG = `
export default {
  // #8687: top-level name/label were never stack keys (silently stripped
  // before the strict close, refused now) — the identity lives in manifest.
  manifest: { id: 'migrate_meta_e2e', name: 'Migrate Meta E2E', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'e2e_ticket',
    label: 'Ticket',
    fields: {
      title: { type: 'text', label: 'Title', required: true },      // 16: required implied NOT NULL
      notes: { type: 'textarea', label: 'Notes' },
    },
  }],
  actions: [{
    name: 'close_ticket',
    label: 'Close',
    type: 'script',
    execute: 'closeHandler',        // 16: renamed to target
    shortcut: 'Ctrl+K',             // 16: removed (never dispatched)
    bulkEnabled: true,              // 16: removed (toolbar reads view bulkActions)
  }],
  flows: [{
    name: 'e2e_flow',
    label: 'E2E Flow',
    type: 'autolaunched',
    active: false,                  // 16: removed (status is the lifecycle)
    template: true,                 // 16: removed (no reader)
    // 16: fallbackNodeId removed (fault edges own this). maxRetries is stated
    // because #4247 refuses a zero-attempt 'retry' — the count is the one v17
    // flow change the chain surfaces as a semantic TODO instead of rewriting.
    errorHandling: { strategy: 'retry', maxRetries: 2, fallbackNodeId: 'n9' },
    nodes: [
      { id: 'n1', type: 'start', label: 'Start', outputSchema: { ok: { type: 'boolean' } } },  // 16: removed
      { id: 'n2', type: 'delete_record', label: 'Purge', config: { objectName: 'e2e_ticket', filter: { done: true } } },  // canonical since protocol 11 — must pass through untouched
    ],
    edges: [],
  }],
  views: [{
    object: 'e2e_ticket',
    list: { type: 'grid', columns: ['title'], responsive: { hiddenOn: ['xs'] }, performance: { lazyLoad: true } },  // 16: removed
    form: { type: 'simple', sections: [{ fields: ['title'] }], defaultSort: [{ field: 'title' }], aria: { label: 'Ticket' } },  // 16: removed
  }],
  dashboards: [{
    name: 'e2e_kpis',
    label: 'E2E KPIs',
    aria: { label: 'KPIs' },        // 16: removed
    performance: { prefetch: true },// 16: removed
    widgets: [],
  }],
  agents: [{
    name: 'e2e_agent',
    label: 'Agent',
    role: 'Helper',
    instructions: 'help',
    knowledge: { sources: ['faq'] },  // 16: removed (never scoped retrieval)
  }],
  skills: [{
    name: 'e2e_skill',
    label: 'Skill',
    tools: ['query_records'],
    triggerPhrases: ['do the thing'],  // 16: removed (never matched)
  }],
  tools: [{
    name: 'e2e_tool',
    label: 'Tool',
    description: 'A tool',
    parameters: { type: 'object' },
    category: 'action',             // 16: removed
    permissions: ['x.y'],           // 16: removed (gated nothing)
    active: true,                   // 16: removed (withdrew nothing)
    builtIn: false,                 // 16: removed
  }],
  permissions: [{
    name: 'e2e_set',
    label: 'Set',
    objects: { e2e_ticket: { allowRead: true } },
    rowLevelSecurity: [{
      name: 'own_rows',
      object: 'e2e_ticket',
      operation: 'select',
      using: 'owner = current_user.id',
      enabled: true,
      priority: 10,                 // 16: removed (no conflict to order)
    }],
  }],
  sharingRules: [{
    name: 'share_hot',
    type: 'criteria',
    object: 'e2e_ticket',
    label: 'Hot tickets',
    condition: "record.hot == true",
    sharedWith: { type: 'team', value: 'support' },
    accessLevel: 'full',             // 16: full→edit (walked at the TOP-LEVEL collection)
  }],
};
`;

/** Conversion ids the run MUST attribute at least one rewrite to. */
const EXPECTED_CONVERSIONS = [
  'action-execute-to-target',
  'action-inert-keys-removed',
  'flow-inert-keys-removed',
  'view-inert-keys-removed',
  'dashboard-inert-keys-removed',
  'agent-knowledge-removed',
  'skill-trigger-phrases-removed',
  'tool-inert-authoring-keys-removed',
  'permission-rls-priority-removed',
  'field-required-notnull-explicit',
  'sharing-rule-access-level-full-to-edit',
];

let dir: string;
let out: { stdout: string; parsed: any };

async function runMeta(args: string[], cwd: string) {
  const { stdout } = await execFileP(TSX, [CLI, 'migrate', 'meta', ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return stdout;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-migrate-meta-e2e-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), PRE17_CONFIG);
  const stdout = await runMeta(['--from', '16', '--json', '--out', join(dir, 'migrated.json')], dir);
  out = { stdout, parsed: JSON.parse(stdout) };
}, 120_000);

afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('os migrate meta --from 16 (e2e over the real CLI)', () => {
  it('replays the v17 chain and reports schema-valid output', () => {
    expect(out.parsed.from).toBe(16);
    expect(out.parsed.schemaValid).toBe(true);
  });

  it('attributes at least one rewrite to every expected v17 conversion family', () => {
    const ids = new Set(out.parsed.applied.map((a: any) => a.conversionId));
    for (const id of EXPECTED_CONVERSIONS) {
      expect(ids.has(id), `expected a rewrite from ${id}; got ${[...ids].join(', ')}`).toBe(true);
    }
  });

  it('surfaces the semantic TODOs instead of auto-applying them', () => {
    expect(Array.isArray(out.parsed.todos)).toBe(true);
    expect(out.parsed.todos.length).toBeGreaterThan(0);
    for (const t of out.parsed.todos) {
      expect(t.reason?.length).toBeGreaterThan(0);
      expect(t.acceptanceCriteria?.length).toBeGreaterThan(0);
    }
  });

  it('the --out snapshot re-parses under the CURRENT schema and carries the rewrites', () => {
    const snap = JSON.parse(readFileSync(join(dir, 'migrated.json'), 'utf-8'));
    const parsed = ObjectStackDefinitionSchema.safeParse(snap);
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues.slice(0, 3))).toBe(true);

    // Spot-check one rewrite per family on the snapshot itself.
    expect(snap.actions[0].target).toBe('closeHandler');
    expect(snap.actions[0].execute).toBeUndefined();
    expect(snap.actions[0].shortcut).toBeUndefined();
    expect(snap.flows[0].active).toBeUndefined();
    expect(snap.flows[0].errorHandling.fallbackNodeId).toBeUndefined();
    expect(snap.flows[0].nodes[0].outputSchema).toBeUndefined();
    expect(snap.flows[0].nodes[1].config.filter, 'canonical key passes through untouched').toEqual({ done: true });
    expect(snap.views[0].list.responsive).toBeUndefined();
    expect(snap.views[0].form.defaultSort).toBeUndefined();
    expect(snap.dashboards[0].aria).toBeUndefined();
    expect(snap.agents[0].knowledge).toBeUndefined();
    expect(snap.skills[0].triggerPhrases).toBeUndefined();
    expect(snap.tools[0].category).toBeUndefined();
    expect(snap.permissions[0].rowLevelSecurity[0].priority).toBeUndefined();
    expect(snap.sharingRules[0].accessLevel).toBe('edit');
    // ADR-0113 explicitization: the pre-17 required field carries its column
    // constraint in writing; the optional field gains nothing.
    expect(snap.objects[0].fields.title.storage).toEqual({ notNull: true });
    expect(snap.objects[0].fields.notes.storage).toBeUndefined();
  });

  it('is idempotent: replaying the chain on the migrated snapshot applies zero changes', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'os-migrate-meta-e2e2-'));
    try {
      const snap = readFileSync(join(dir, 'migrated.json'), 'utf-8');
      writeFileSync(join(dir2, 'objectstack.config.ts'), `export default ${snap};`);
      const stdout = await runMeta(['--from', '16', '--json'], dir2);
      const again = JSON.parse(stdout);
      expect(again.applied).toEqual([]);
      expect(again.schemaValid).toBe(true);
    } finally {
      try { rmSync(dir2, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }, 120_000);

  /**
   * ADR-0104 / #3438. The metadata half of a 16→17 upgrade is only half of it:
   * two DATA migrations gate enforcement per deployment, and a gate nobody is
   * told about is served by nobody. The advice is scoped to the field classes
   * the author actually declares, so it is never noise.
   */
  describe('per-deployment data migrations (#3438)', () => {
    const withFields = (fields: string) => `
      export default {
        name: 'dm_probe', label: 'DM Probe',
        objects: [{ name: 'dm_thing', label: 'Thing', fields: { ${fields} } }],
      };
    `;

    async function runJson(fields: string, args: string[] = ['--from', '16', '--json']) {
      const d = mkdtempSync(join(tmpdir(), 'os-migrate-meta-dm-'));
      try {
        writeFileSync(join(d, 'objectstack.config.ts'), withFields(fields));
        return JSON.parse(await runMeta(args, d));
      } finally {
        try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }

    it('names the file migration when the metadata declares a media field', async () => {
      const res = await runJson(`cover: { type: 'image', label: 'Cover' }`);
      expect(res.dataMigrations.map((m: any) => m.id)).toEqual(['adr-0104-file-references']);
    }, 120_000);

    it('names the value-shape scan when the metadata declares a covered field', async () => {
      const res = await runJson(`spot: { type: 'location', label: 'Spot' }`);
      expect(res.dataMigrations.map((m: any) => m.id)).toEqual(['adr-0104-value-shapes']);
    }, 120_000);

    it('names both when both classes are declared', async () => {
      const res = await runJson(
        `cover: { type: 'image', label: 'Cover' }, spot: { type: 'location', label: 'Spot' }`,
      );
      expect(res.dataMigrations.map((m: any) => m.id).sort()).toEqual([
        'adr-0104-file-references',
        'adr-0104-value-shapes',
      ]);
    }, 120_000);

    it('stays silent for metadata that declares neither class', async () => {
      const res = await runJson(`title: { type: 'text', label: 'Title' }`);
      expect(res.dataMigrations).toEqual([]);
    }, 120_000);

    it('says nothing on a chain that does not cross into 17', async () => {
      const res = await runJson(`cover: { type: 'image', label: 'Cover' }`, ['--from', '17', '--json']);
      expect(res.dataMigrations).toEqual([]);
    }, 120_000);

    it('ends the human-readable upgrade with the advice, not just the JSON', async () => {
      // Where an operator actually reads it. The advice names the command and
      // says the run is dry by default, so nothing here reads as "do this and
      // something irreversible happens".
      const d = mkdtempSync(join(tmpdir(), 'os-migrate-meta-dm-h-'));
      try {
        writeFileSync(join(d, 'objectstack.config.ts'), withFields(`cover: { type: 'image', label: 'Cover' }`));
        const stdout = await runMeta(['--from', '16'], d);
        expect(stdout).toMatch(/os migrate files-to-references/);
        expect(stdout).toMatch(/dry-run by default/);
      } finally {
        try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }, 120_000);
  });

  it('refuses a --from below the support floor with the structured error', async () => {
    let failed = false;
    try {
      await runMeta(['--from', '9', '--json'], dir);
    } catch (e: any) {
      failed = true;
      const body = JSON.parse(String(e.stdout || '{}'));
      expect(body.error).toBe('unsupported_from_major');
      expect(body.message).toMatch(/floor|support/i);
    }
    expect(failed, 'expected a non-zero exit below the floor').toBe(true);
  }, 120_000);
});
