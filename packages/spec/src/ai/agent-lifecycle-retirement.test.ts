// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An agent's conversation state machine — `agent.lifecycle` — RETIRED as a
 * whole key (ADR-0049 enforce-or-remove, ruled D on objectstack-ai/cloud#2569,
 * #21320): it was parsed and never read. No runtime moved an agent through a
 * declared state or refused an undeclared transition; a conversation phase is a
 * skill selected by its `triggerConditions` (ADR-0064), orchestration is a Flow
 * (ADR-0019), and a record's status transitions are the `state_machine`
 * validation rule (ADR-0020). Its value schema — the XState `StateMachineSchema`
 * family in `automation/state-machine.zod.ts` — had no other authorable door
 * and left the package with it.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone on the strict `AgentSchema`, so the refusal
 *      carries the prescription and the key's input type is `never` for `tsc`.
 *   2. D2 conversion `agent-lifecycle-removed` (step 18), a lossless delete of
 *      the key from every `agents[]` entry, retired from the load path: a live
 *      author is refused, a stored or built agent replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ai/Agent:lifecycle`,
 *      `RETIRED_DEFS_BY_MAJOR[18]` the family's five published defs, and the D3
 *      entry `agent-lifecycle-retired` carries the judgement the conversion
 *      cannot make (which of the three destinations a machine meant).
 *   4. The family's exports are gone from every entry that carried them.
 *   5. Tree-scoped absence: nothing inside the declared radius still authors an
 *      agent machine or imports the retired exports.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` — that envelope belongs to the
 * authoring door, `defineStack`, which is pinned with its `code` and `status`
 * below. Everywhere else: refusal, the issue `code`, the `path` naming the key,
 * and the prescription text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as automationEntry from '../automation';
import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import { AgentSchema, type Agent } from './agent.zod';

const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const CONVERSION_ID = 'agent-lifecycle-removed';

const BASE_AGENT = {
  name: 'intake_agent',
  label: 'Intake Agent',
  role: 'Assistant',
  instructions: 'Greet the user, then triage the request.',
} as const;

/** The shape the retired schema accepted, as an author wrote it. */
const MACHINE = {
  id: 'intake',
  initial: 'greeting',
  states: {
    greeting: { on: { IDENTIFIED: 'triage' } },
    triage: { on: { RESOLVED: 'done' } },
    done: { type: 'final' },
  },
};

/**
 * The tombstone's prescription: why, the fix, and the three destinations.
 * Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
 * the key-first house convention is asserted on the issue message itself.
 */
const PRESCRIPTION =
  /`agent\.lifecycle` was removed in @objectstack\/spec 17\.7\.0 \(ADR-0049 enforce-or-remove\) — no runtime ever read it.*Delete the key\. A phase of a conversation is a skill .*`triggerConditions`.*a Flow.*`state_machine` validation rule/s;

/** The one refusal `defineStack` raised, as its ADR-0112 envelope. */
const stackRefusal = (agent: Record<string, unknown>) => {
  let thrown: unknown;
  try {
    defineStack({
      manifest: { id: 'com.example.agent-lifecycle', name: 'agent_lifecycle', version: '1.0.0', type: 'app' },
      agents: [agent],
    } as never);
  } catch (e) {
    thrown = e;
  }
  return thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
};

describe('agent lifecycle retirement — the tombstone, at every door that carries an agent', () => {
  it('refuses EVERY value at its path with the prescription — a full machine, an empty one, and non-objects', () => {
    for (const lifecycle of [MACHINE, {}, 'draft', null, 0]) {
      const r = AgentSchema.safeParse({ ...BASE_AGENT, lifecycle });
      expect(r.success, `lifecycle: ${JSON.stringify(lifecycle)}`).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('invalid_type');
      expect(issues[0].path).toEqual(['lifecycle']);
      expect(issues[0].message).toMatch(PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issues[0].message.startsWith('`agent.lifecycle` was removed')).toBe(true);
      expect(issues[0].message.endsWith(MIGRATE_SENTENCE)).toBe(true);
    }
  });

  it('CONTROL — the same agent without the key parses, so the refusal above is the key and nothing else', () => {
    const r = AgentSchema.safeParse(BASE_AGENT);
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    expect(r.data).not.toHaveProperty('lifecycle');
  });

  it('the walked shape keeps `lifecycle` as a key — the tombstone stays reachable for its refusal', () => {
    expect(Object.keys(AgentSchema.shape)).toContain('lifecycle');
    expect(Object.keys(AgentSchema.shape), 'CONTROL: a live neighbour').toContain('instructions');
  });

  it('fails tsc at the authoring site: the input type of `lifecycle` is `never`', () => {
    const agent: Agent = {
      ...BASE_AGENT,
      // @ts-expect-error — `lifecycle` is a retiredKey() tombstone: its input type is `never`.
      lifecycle: MACHINE,
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => AgentSchema.parse(agent)).toThrow(PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never strips it', () => {
    const refusal = stackRefusal({ ...BASE_AGENT, lifecycle: MACHINE });
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['agents', 0, 'lifecycle']);
    expect(refusal.issues?.[0]?.message).toMatch(PRESCRIPTION);
  });
});

describe('agent lifecycle retirement — the D2 conversion', () => {
  it('a STORED agent row carrying the key replays clean through the rehydration seam', () => {
    const notices: Array<{ conversionId?: string; path?: string; from?: string; to?: string }> = [];
    const rehydrated = applyConversionsToStoredItem('agent', { ...BASE_AGENT, lifecycle: MACHINE }, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;
    expect(notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'agents[0].lifecycle', 'lifecycle', '(removed)'],
    ]);
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual(BASE_AGENT);
    // And the rehydrated row is exactly what the write door accepts now.
    expect(AgentSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ agents: [{ ...BASE_AGENT, lifecycle: MACHINE }] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`agent.lifecycle` was removed');
    const after = ObjectStackDefinitionSchema.safeParse(applyConversions(artifact(), { includeRetired: true }));
    expect(after.success, JSON.stringify(after.error?.issues ?? [])).toBe(true);
  });

  it('touches only agents: an OBJECT\'s ADR-0057 `lifecycle` block of the same name rides through untouched', () => {
    const objectLifecycle = { class: 'telemetry', retention: { maxAge: '30d' } };
    const input = {
      objects: [{ name: 'probe_event', lifecycle: objectLifecycle }],
      agents: [{ ...BASE_AGENT, lifecycle: MACHINE }],
    };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    expect((stack.objects as Array<Record<string, unknown>>)[0]!.lifecycle).toBe(objectLifecycle);
  });

  it('is idempotent by construction, and leaves an agent without the key untouched by reference', () => {
    const input = { agents: [{ ...BASE_AGENT, lifecycle: MACHINE }, { ...BASE_AGENT, name: 'plain_agent' }] };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    expect((stack.agents as unknown[])[1]).toBe(input.agents[1]);
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { agents: [{ ...BASE_AGENT, lifecycle: MACHINE }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });

  it('is registered under major 18: the exact key, the five defs, the chain step, and one D3 entry', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ai/Agent:lifecycle');
    for (const def of ['StateMachine', 'StateNode', 'Transition', 'ActionRef', 'GuardRef']) {
      expect(RETIRED_DEFS_BY_MAJOR[18], def).toContain(`automation/${def}`);
    }
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.surface).toBe('agent.lifecycle');
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === 'agent-lifecycle-retired');
    expect(d3).toHaveLength(1);
    expect(d3[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(d3[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
  });
});

describe('agent lifecycle retirement — the StateMachineSchema family left the package', () => {
  it('`@objectstack/spec/automation` exports none of the family at runtime', () => {
    const names = Object.keys(automationEntry);
    for (const retired of ['StateMachineSchema', 'StateNodeSchema', 'TransitionSchema', 'ActionRefSchema', 'GuardRefSchema']) {
      expect(names, `./automation must not export ${retired}`).not.toContain(retired);
    }
    // CONTROL: the entry is the real one, not an empty namespace.
    expect(names).toContain('FlowSchema');
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types `lifecycle` `never` on
// `Agent`, and the family's exports are gone, so every TYPED authoring site and
// every typed import fails to compile. The residue is what `tsc` never judges:
// JSON, YAML, MD/MDX code fences, untyped `.js`, and TS literals typed `any` /
// `unknown`. This walk covers that residue across the five repo roots
// `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// Two matchers, each judging an AUTHORING SHAPE, never a mention:
//   - a `lifecycle` key whose object value holds `initial` or `states` before
//     any nested brace (TS / JS / JSON, and YAML block form). `lifecycle` alone
//     is far too common a word — an object's ADR-0057 data-lifecycle block
//     (`class` / `retention` / `ttl` / `storage`) shares the name and none of
//     these keys, which the control below asserts;
//   - an `import` / `export … from` of a retired family export from an
//     `@objectstack/spec` specifier. Only the distinctive names are judged —
//     the bare `Transition` / `ActionRef` / `GuardRef` / `StateNode` type
//     names are too generic to own across the tree, and a typed import of
//     them already fails `tsc`.
// Inline code is prose and is stripped before judging. The bound, stated: a
// machine assembled by spread or under computed keys, and `docs/**`,
// `.claude/**`, `.github/**` and the repo-root files are outside what this
// walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors an agent machine or imports the family', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Under `examples/` the non-code extensions, plus `.ts` inside an app's own `src/` tree. */
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const MACHINE_KEYS = '(initial|states)';
  const RETIRED_EXPORTS =
    '(StateMachineSchema|StateNodeSchema|TransitionSchema|ActionRefSchema|GuardRefSchema|StateMachineConfig|StateNodeConfig)';
  const AUTHORING = [
    // TS / JS / JSON, block or inline: the key, then an object whose own keys
    // (before any nested brace) include a machine key.
    new RegExp(`(^|[^\\w.$])["']?lifecycle["']?\\s*:\\s*\\{[^{}]*?(^|[^\\w.$])["']?${MACHINE_KEYS}["']?\\s*:`, 'm'),
    // YAML block form: the key on its own line, a machine key indented below
    // it among its siblings.
    new RegExp(`^[ \\t]*(-[ \\t]+)?lifecycle[ \\t]*:[ \\t]*\\r?\\n(?:[ \\t]+[^\\s][^\\n]*\\r?\\n)*?[ \\t]+${MACHINE_KEYS}[ \\t]*:`, 'm'),
    // An import or re-export naming a retired export from the spec package.
    new RegExp(`\\b(import|export)\\s+(type\\s+)?\\{[^}]*\\b${RETIRED_EXPORTS}\\b[^}]*\\}\\s*from\\s*['"]@objectstack/spec`, 'm'),
  ];

  /**
   * Inline code spans are prose — the house style `check:doc-authoring` enforces
   * — so stripping single-backtick spans separates "the retirement kit
   * describing what it removed" from "a source still writing it".
   * Newline-bounded: a fenced block's content is NOT stripped.
   */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (text: string): RegExpExecArray | null => {
    const stripped = stripInlineCode(text);
    for (const re of AUTHORING) {
      const m = re.exec(stripped);
      if (m) return m;
    }
    return null;
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired key.
   */
  const EXCLUDED = new Set([
    // This pin authors the key to assert its refusal and its conversion.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement agent on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
    // GITIGNORED build output (`packages/spec/json-schema/`), reached only
    // because this is a FILESYSTEM walk. Its source is the Zod tree.
    'packages/spec/json-schema/',
  ];
  /** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  /** Tolerates ONLY a path that vanished mid-walk; every other read fault is re-raised. */
  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores a prose mention and a neighbour (anti-vacuity)', () => {
    // Offenders — the retired shapes, in each syntax the walk reads.
    expect(judge("defineAgent({ name: 'a', lifecycle: { id: 'm', initial: 'idle', states: {} } })")).not.toBeNull();
    expect(judge("    lifecycle: {\n      id: 'bot',\n      initial: 'idle',\n      states: {\n")).not.toBeNull();
    expect(judge('{ "lifecycle": { "id": "m", "states": { "idle": {} } } }')).not.toBeNull();
    expect(judge('agents:\n  - name: a\n    lifecycle:\n      id: m\n      initial: idle\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\nimport { StateMachineSchema } from '@objectstack/spec/automation';\n```\n")).not.toBeNull();
    expect(judge("import type { StateNodeConfig } from '@objectstack/spec';")).not.toBeNull();
    expect(judge("export { TransitionSchema } from '@objectstack/spec/automation';")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge("the `lifecycle: { initial: 'idle' }` block was retired")).toBeNull();
    expect(judge("lifecycle: { class: 'telemetry', ttl: { field: 'expires_at', expireAfter: '30d' } }")).toBeNull();
    expect(judge('  lifecycle:\n    class: telemetry\n    storage:\n      strategy: rotation\n')).toBeNull();
    expect(judge("lifecycle: retiredKey(LIFECYCLE_RETIRED),")).toBeNull();
    expect(judge("const s = { lifecycle: 1, nested: { initial: 'x' } };")).toBeNull();
    expect(judge("import { StateMachineValidationSchema } from '@objectstack/spec/data';")).toBeNull();
    expect(judge("import { StateMachineSchema } from './local-machine';")).toBeNull();
  });

  it('no agent machine authoring or retired import survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    let exampleSources = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        if (EXAMPLE_APP_SRC_TS.test(rel)) exampleSources += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = judge(text);
        if (m) offenders.push(`${rel} authors \`${m[0].trim().replace(/\s+/g, ' ')}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree, and the example apps'
    // sources were really read.
    expect(visited).toBeGreaterThan(1000);
    expect(exampleSources).toBeGreaterThan(50);
    expect(offenders, 'an agent machine authoring or a retired import means the retirement is being undone').toEqual([]);
  });
});
