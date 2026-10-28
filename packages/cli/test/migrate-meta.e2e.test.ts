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
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import { MIGRATIONS_BY_MAJOR } from '@objectstack/spec/migrations';
import { childEnv } from './helpers/serve-process.js';

const execFileP = promisify(execFile);
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/**
 * A stack authored against protocol 16: every line marked `// 16:` is a shape
 * the v17 chain must rewrite, one per conversion step 17 still registers — the
 * sharing-rule `full`→`edit` rename, the flow-node config aliases and lifts,
 * the mongo driver alias, the converged retry policy, the page-header subtitle
 * alias and the inline action's object-form `params`.
 *
 * The protocol-16.x conversions (action execute→target, the #3896 close-out
 * removals: rls.priority, the four tool keys, flow active/template/
 * outputSchema/fallbackNodeId, view/dashboard inert keys, agent.knowledge,
 * skill.triggerPhrases) are deliberately NOT here. They aged out with their
 * retirement kits (#25767, ADR-0087 2026-10-26 amendment): `--from 16` no
 * longer rewrites those shapes, and the strict schema refuses them as unknown
 * keys pointing at the protocol upgrade guide, so carrying one would make the
 * replayed snapshot invalid by design rather than test the chain.
 */
const PRE17_CONFIG = `
export default {
  // #8687: top-level name/label were never stack keys (silently stripped
  // before the strict close, refused now) — the identity lives in manifest.
  manifest: { id: 'com.example.migrate-meta-e2e', name: 'Migrate Meta E2E', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'e2e_ticket',
    label: 'Ticket',
    fields: {
      title: { type: 'text', label: 'Title', required: true },      // 16: required implied NOT NULL — v17 does NOT write that down (#16693)
      notes: { type: 'textarea', label: 'Notes' },
    },
  }],
  datasources: [{
    name: 'events',
    label: 'Events',
    driver: 'mongo',                // 16: mongo→mongodb
    config: { url: 'mongodb://mongo.internal:27017/events' },
  }],
  flows: [{
    name: 'e2e_flow',
    label: 'E2E Flow',
    type: 'autolaunched',
    // 16: retryDelayMs→backoffMs. maxRetries is stated because #4247 refuses
    // a zero-attempt 'retry' — the count is the one v17 flow change the chain
    // surfaces as a semantic TODO instead of rewriting.
    errorHandling: { strategy: 'retry', maxRetries: 2, retryDelayMs: 500 },
    nodes: [
      { id: 'n1', type: 'start', label: 'Start' },
      { id: 'n2', type: 'delete_record', label: 'Purge', config: { objectName: 'e2e_ticket', filter: { done: true } } },  // canonical since protocol 11 — must pass through untouched
      { id: 'n3', type: 'get_record', label: 'Load', config: { object: 'e2e_ticket', filter: { done: false } } },  // 16: object→objectName
      { id: 'n4', type: 'notify', label: 'Tell', config: { to: ['{record.owner}'], subject: 'Closed', body: 'Ticket closed.', channels: ['inbox'] } },  // 16: to/subject/body→recipients/title/message
      { id: 'n5', type: 'wait', label: 'Pause', config: { duration: 'PT1M' } },  // 16: lifted into waitEventConfig
      { id: 'n6', type: 'connector_action', label: 'Post', config: { connectorId: 'slack', actionId: 'chat.postMessage', input: { text: 'done' } } },  // 16: lifted into connectorConfig
      { id: 'n7', type: 'map', label: 'Each', config: { collection: '{rows}', flow: 'e2e_child' } },  // 16: flow→flowName
      { id: 'n8', type: 'subflow', label: 'Child', config: { flow: 'e2e_child' } },  // 16: flow→flowName
      { id: 'n9', type: 'script', label: 'Score', config: { functionName: 'score_ticket', input: { id: '{recordId}' } } },  // 16: functionName/input→function/inputs
    ],
    edges: [],
  }],
  pages: [{
    name: 'e2e_page',
    label: 'E2E Page',
    type: 'app',
    regions: [{
      name: 'header',
      components: [
        { type: 'page:header', properties: { title: 'Tickets', description: 'All open tickets' } },  // 16: description→subtitle
        { type: 'element:button', properties: { label: 'Submit', action: { type: 'api', target: '/api/v1/e2e/submit', method: 'POST', params: { note: 'hi' } } } },  // 16: object-form params→bodyExtra
      ],
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

/**
 * Conversion ids the run MUST attribute at least one rewrite to: step 17's
 * own `conversionIds`, written out so a family leaving the step reds here by
 * name (the registry pin in the case below) instead of thinning the fixture's
 * coverage in silence.
 */
const EXPECTED_CONVERSIONS = [
  'sharing-rule-access-level-full-to-edit',
  'flow-node-crud-object-alias',
  'flow-node-notify-config-aliases',
  'flow-node-wait-event-config-lift',
  'flow-node-connector-config-lift',
  'flow-node-map-flow-alias',
  'flow-node-subflow-flow-alias',
  'flow-node-script-config-aliases',
  'datasource-driver-mongo-to-mongodb',
  'retry-policy-converged',
  'page-header-subtitle-alias',
  'inline-action-api-params-to-body-extra',
];

let dir: string;
let out: { stdout: string; parsed: any };

async function runMeta(args: string[], cwd: string) {
  const { stdout } = await execFileP(TSX, [CLI, 'migrate', 'meta', ...args], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
    env: childEnv({ NO_COLOR: '1' }),
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
    // The list IS step 17's: a conversion that ages out of the step (as the
    // 16.x ones did, #25767) or joins it fails here naming the drift, before
    // the per-id loop reads it as a missing rewrite.
    expect([...EXPECTED_CONVERSIONS].sort(), 'EXPECTED_CONVERSIONS must equal step 17\'s registered conversionIds')
      .toEqual([...(MIGRATIONS_BY_MAJOR[17]?.conversionIds ?? [])].sort());
    const ids = new Set(out.parsed.applied.map((a: any) => a.conversionId));
    for (const id of EXPECTED_CONVERSIONS) {
      expect(ids.has(id), `expected a rewrite from ${id}; got ${[...ids].join(', ')}`).toBe(true);
    }
  });

  /**
   * ⛔ The negative half of the assertion above (#16693). A conversion that
   * stamps `storage: { notNull: true }` onto every `required: true` field
   * asserts the implication ADR-0113 abolished, so `migrate meta` must
   * attribute NOTHING to it — on a source (`title`) that would have triggered
   * it, which is what keeps this from passing vacuously.
   */
  it('attributes nothing to the withdrawn required→storage.notNull conversion', () => {
    const ids = new Set(out.parsed.applied.map((a: any) => a.conversionId));
    expect(ids.has('field-required-notnull-explicit')).toBe(false);
    // Anti-vacuity: the same run DID attribute rewrites, so an empty `applied`
    // cannot be what makes the line above green.
    expect(ids.size).toBeGreaterThan(0);
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
    const [, purge, load, tell, pause, post, each, child, score] = snap.flows[0].nodes;
    expect(purge.config.filter, 'canonical key passes through untouched').toEqual({ done: true });
    expect(load.config.objectName).toBe('e2e_ticket');
    expect(load.config.object).toBeUndefined();
    expect(tell.config.recipients).toEqual(['{record.owner}']);
    expect(tell.config.to).toBeUndefined();
    expect(pause.waitEventConfig.timerDuration).toBe('PT1M');
    expect(post.connectorConfig.connectorId).toBe('slack');
    expect(each.config.flowName).toBe('e2e_child');
    expect(child.config.flowName).toBe('e2e_child');
    expect(score.config.function).toBe('score_ticket');
    expect(score.config.functionName).toBeUndefined();
    expect(snap.flows[0].errorHandling.backoffMs).toBe(500);
    expect(snap.flows[0].errorHandling.retryDelayMs).toBeUndefined();
    expect(snap.datasources[0].driver).toBe('mongodb');
    const [header, button] = snap.pages[0].regions[0].components;
    expect(header.properties.subtitle).toBe('All open tickets');
    expect(header.properties.description).toBeUndefined();
    expect(button.properties.action.bodyExtra).toEqual({ note: 'hi' });
    expect(button.properties.action.params).toBeUndefined();
    expect(snap.sharingRules[0].accessLevel).toBe('edit');
    // ⛔ ADR-0113, #16693: the chain does NOT write a column constraint for the
    // author. `required: true` crosses 16→17 as the write-time contract and
    // nothing else, so `title` comes out with NO `storage` block — exactly like
    // the optional field beside it. The withdrawn `field-required-notnull-
    // explicit` conversion used to make this line read `{ notNull: true }`, and
    // an app that followed the boot warning it raised was performing a
    // destructive `tighten_not_null` migration on a populated database while
    // believing it was clearing a deprecation notice.
    expect(snap.objects[0].fields.title.required, 'the write contract survives the chain').toBe(true);
    expect(snap.objects[0].fields.title.storage, 'no column constraint is invented').toBeUndefined();
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

/**
 * #9418 — the input class the codemod EXISTS for: a source carrying a RETIRED
 * key, migrated end-to-end.
 *
 * The suite above deliberately does not reach this. Its fixture is a bare
 * `export default { … }` object literal, and a bare literal is validated by
 * nobody at load — so it passed on a build where `os migrate meta` could not
 * open a single real project. A real `objectstack.config.ts` runs the CURRENT
 * schema itself: `os init` scaffolds `export default defineStack({ … })`, every
 * `define*` helper is a `Schema.parse()`, and a retired key is a `retiredKey()`
 * tombstone — `z.never()` carrying the upgrade prescription — so the parse
 * REJECTS it rather than stripping it. The refusal therefore happened while the
 * config module was being evaluated inside the load, before the command reached
 * its first conversion, and the message it printed was the very prescription
 * telling the author to run this command.
 *
 * So the fixture here is deliberately shaped like a real project and not like a
 * test: `defineStack` at the root, per-artifact helpers imported from spec
 * SUBPATHS (`@objectstack/spec/ai`, `@objectstack/spec/ui`, the spellings the
 * example apps use), and the retired keys authored inside them. A
 * `defineStack`-only tolerance passes the first and fails the last two.
 *
 * The retired spellings are ones whose refusal and conversion still stand
 * (the `dashboard.refreshInterval` tombstone, and `regex`, a retired member of
 * `agent.structuredOutput.format` refused at parse with its prescription;
 * protocol 18, which `--from 16` replays into). The fixture used to carry
 * `agent.knowledge` and `skill.triggerPhrases`, whose 16.x kits aged out
 * (#25767): their tombstones and conversions left the spec, so neither is a
 * retired key any more, only an unknown one. `agent.lifecycle` is not used:
 * its retirement pins the key absent from the tree outside its own kit.
 *
 * The second test is the other half of the pin, and it is the one that keeps
 * this a restoration rather than a widening: `os validate` on the SAME fixture
 * must still refuse. The tolerance belongs to the codemod alone — for every
 * other command the tombstone is the upgrade channel.
 */
describe('os migrate meta over a source carrying a retired key (#9418)', () => {
  /**
   * Resolved through node_modules rather than by walking up from this file:
   * `packages/cli` already depends on `@objectstack/spec`, so the dependency is
   * one turbo already knows about, and a package specifier is not a
   * cross-package source read.
   */
  const SPEC_PACKAGE_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

  const RETIRED_KEY_CONFIG = `
import { defineStack } from '@objectstack/spec';
import { defineAgent } from '@objectstack/spec/ai';
import { Dashboard } from '@objectstack/spec/ui';

export default defineStack({
  manifest: { id: 'com.example.retired-key-e2e', name: 'Retired Key E2E', version: '1.0.0', type: 'app', namespace: 'rk' },
  objects: [{
    name: 'rk_ticket',
    label: 'Ticket',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  agents: [defineAgent({
    name: 'rk_agent',
    label: 'Agent',
    role: 'Helper',
    instructions: 'help',
    structuredOutput: { format: 'regex' },  // RETIRED member in 17.7.0 — the whole point
  })],
  dashboards: [Dashboard.create({
    name: 'rk_ops',
    label: 'Ops',
    widgets: [],
    refreshInterval: 300,                // RETIRED: renamed to refreshIntervalSeconds
  })],
});
`;

  let rkDir: string;
  let specLink: string;

  beforeAll(() => {
    rkDir = mkdtempSync(join(tmpdir(), 'os-migrate-meta-retired-'));
    mkdirSync(join(rkDir, 'node_modules', '@objectstack'), { recursive: true });
    specLink = join(rkDir, 'node_modules', '@objectstack', 'spec');
    symlinkSync(SPEC_PACKAGE_ROOT, specLink, 'dir');
    writeFileSync(join(rkDir, 'objectstack.config.ts'), RETIRED_KEY_CONFIG);
  });

  afterAll(() => {
    // Unlinked BEFORE the recursive remove, and named explicitly: this symlink
    // points at the real `packages/spec` in the checkout, and the one thing
    // that must never be ambiguous in a cleanup is whether it can follow it.
    try { unlinkSync(specLink); } catch { /* already gone */ }
    try { rmSync(rkDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('loads it, converts it, and reports the migrated stack schema-valid', async () => {
    const stdout = await runMeta(['--from', '16', '--json', '--out', join(rkDir, 'migrated.json')], rkDir);
    const parsed = JSON.parse(stdout);

    const appliedAt = new Map<string, string>(
      parsed.applied.map((a: any) => [a.conversionId, a.path] as [string, string]),
    );
    // Authored through `defineStack`'s own inline literal…
    expect(parsed.from).toBe(16);
    // …and through helpers imported from a spec subpath, which is where a
    // tolerance scoped to `defineStack` alone would still have refused.
    expect(appliedAt.get('agent-structured-output-refused-members-removed')).toBe('agents[0].structuredOutput.format');
    expect(appliedAt.get('dashboard-refresh-interval-to-refresh-interval-seconds')).toBe('dashboards[0].refreshIntervalSeconds');
    expect(parsed.schemaValid).toBe(true);

    const snap = JSON.parse(readFileSync(join(rkDir, 'migrated.json'), 'utf-8'));
    expect(snap.agents[0].structuredOutput).toBeUndefined();
    expect(snap.dashboards[0].refreshInterval).toBeUndefined();
    // The rest of the artifact survives the tolerant load intact — the codemod
    // removes what retired, not what it could not parse.
    expect(snap.agents[0].name).toBe('rk_agent');
    expect(snap.dashboards[0].refreshIntervalSeconds).toBe(300);
  }, 180_000);

  it('still refuses the same source everywhere else — `os validate` keeps the prescription', async () => {
    let refused = false;
    try {
      await execFileP(TSX, [CLI, 'validate'], {
        cwd: rkDir,
        maxBuffer: 16 * 1024 * 1024,
        env: childEnv({ NO_COLOR: '1' }),
      });
    } catch (e: any) {
      refused = true;
      const output = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`;
      expect(output).toMatch(/`regex` was removed/);
      expect(output).toMatch(/os migrate meta --from 17/);
    }
    expect(refused, '`os validate` must still reject a retired key').toBe(true);
  }, 180_000);
});

/**
 * The chain line states this build's protocol in the protocol's own units.
 *
 * `PROTOCOL_VERSION` is the protocol major padded to a semver ('17.0.0') and is
 * never the installed package version. Printed here as a bare semver under the
 * word "runtime", it read as one: on a 17.3.0 install the operator saw
 * "runtime 17.0.0" beside the real package versions of the same upgrade
 * session, which reads as an apparent downgrade or a stale install. Nothing
 * about the VALUE was wrong; the label and the semver FORM were.
 *
 * Both halves are asserted, because either one alone is satisfiable the wrong
 * way. A line that merely stopped saying "runtime" could still print the padded
 * semver in a version position; and a line that dropped the parenthetical
 * altogether would lose the one fact it carries -- with `--to` stopping below
 * this build's major it is the only place the operator is told where the
 * runtime actually stands, which is why the third case drives exactly that.
 *
 * The `--json` half is pinned by the last case, and that pin was RE-POINTED
 * rather than deleted when the key moved: it used to hold `runtime` unchanged,
 * and it now holds `protocolVersion` carrying the value AND `runtime` being
 * absent. Both halves are asserted for the same reason the human line asserts
 * two: a pin that only checked the new key would stay green if the old spelling
 * were quietly re-added alongside, which is precisely the dual-key state this
 * rename was ruled against. Keeping the pin pointed at the live key is what
 * makes the NEXT rename of this published payload loud instead of silent.
 */
describe('os migrate meta — the chain line names the protocol, not a package version', () => {
  const LABEL_CONFIG = `
export default {
  manifest: { id: 'com.example.chain-label-e2e', name: 'Chain Label E2E', version: '1.0.0', type: 'app' },
  objects: [{ name: 'label_ticket', label: 'Ticket', fields: { title: { type: 'text', label: 'Title' } } }],
};
`;
  let labelDir: string;

  beforeAll(() => {
    labelDir = mkdtempSync(join(tmpdir(), 'os-migrate-meta-label-'));
    writeFileSync(join(labelDir, 'objectstack.config.ts'), LABEL_CONFIG);
  });

  afterAll(() => {
    try { rmSync(labelDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("names this build's protocol major, in majors", async () => {
    // `--to` is pinned to PROTOCOL_MAJOR deliberately: the unqualified default
    // is CHAIN_TERMINUS_MAJOR (the highest major ANY migration step is
    // registered for), which legitimately runs ahead of PROTOCOL_MAJOR once a
    // future major's steps are pre-authored (see migrate/meta.ts). This case
    // is specifically the "already at this runtime's own major" no-op chain,
    // so it names both ends explicitly rather than riding a default that is
    // designed to drift.
    const stdout = await runMeta(['--from', String(PROTOCOL_MAJOR), '--to', String(PROTOCOL_MAJOR)], labelDir);
    expect(stdout).toContain(
      `Chain:  protocol ${PROTOCOL_MAJOR} → ${PROTOCOL_MAJOR} (this runtime implements protocol ${PROTOCOL_MAJOR})`,
    );
  }, 120_000);

  it('prints no padded protocol semver in the human output, under any label', async () => {
    // Deliberately NOT pinning `--to` here: the default climbs to
    // CHAIN_TERMINUS_MAJOR, which is exactly what exercises the real risk
    // surface this test guards — a hop's semantic `why:` prose (which may
    // legitimately CITE a past release's bare semver, e.g. "measured on
    // 17.0.0 GA …") printed verbatim into stdout. The instrument must not
    // confuse that citation with the mislabelled-runtime defect the docblock
    // above describes, so it targets the version-label surface (the `Chain:`
    // line / the word "runtime") instead of the whole transcript.
    const stdout = await runMeta(['--from', String(PROTOCOL_MAJOR)], labelDir);
    const chainLine = stdout.split('\n').find((line) => line.includes('Chain:'));
    expect(chainLine, 'the Chain: line must be present to assert against').toBeTruthy();
    expect(chainLine).not.toContain(PROTOCOL_VERSION);
    expect(stdout).not.toMatch(/runtime \d+\.\d+\.\d+/);
  }, 120_000);

  it('still says where the runtime stands when --to stops below this build\'s major', async () => {
    const below = PROTOCOL_MAJOR - 1;
    const stdout = await runMeta(['--from', String(below), '--to', String(below)], labelDir);
    expect(stdout).toContain(
      `Chain:  protocol ${below} → ${below} (this runtime implements protocol ${PROTOCOL_MAJOR})`,
    );
    expect(stdout).not.toContain(PROTOCOL_VERSION);
  }, 120_000);

  it('emits the protocol version under `protocolVersion`, with no `runtime` key left', async () => {
    const parsed = JSON.parse(await runMeta(['--from', String(PROTOCOL_MAJOR), '--json'], labelDir));
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    // Removed OUTRIGHT -- no alias, no dual-key grace window. `in` rather than
    // a truthiness check: an explicit `runtime: undefined` would satisfy the
    // latter while still shipping the key through `JSON.stringify`'s omission.
    expect(Object.keys(parsed)).not.toContain('runtime');
  }, 120_000);
});
