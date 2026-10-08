// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An agent's long-term memory store — `agent.memory.longTerm.store` — RETIRED
 * as a whole key (ADR-0049 enforce-or-remove, ruling record 5950198150, letter
 * A′, #20274): the memory store is platform infrastructure, not agent metadata.
 * The cloud AI runtime, the one runtime that executes agents, keeps long-term
 * memory notes in its own database store and refused the `vector` default and
 * `redis` before an agent's first turn. The contract half of the same ruling —
 * `maxEntries` and `reflectionInterval` required once long-term memory is
 * enabled — is pinned in `agent.test.ts`.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone inside the `strictObject` `longTerm` block, so
 *      the refusal carries the prescription and the key's input type is `never`
 *      for `tsc`. Its three old alias spellings (`backend` / `storage` /
 *      `provider`) are `guidance` entries carrying the same answer, because an
 *      alias may not steer an author onto a tombstone.
 *   2. D2 conversion `agent-memory-long-term-store-removed` (step 18), a lossless
 *      delete of the key from every `agents[]` entry, retired from the load
 *      path: a live author is refused, a stored or built agent replays clean.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries the nested `ai/Agent:memory.longTerm.store`,
 *      and the D3 entry `agent-memory-store-retired-and-limits-required` carries
 *      the judgement the conversion cannot make.
 *   4. The liveness row is the `memory` container's, `live`: a nested key has no
 *      row of its own (`check:liveness` is the judge of that half).
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

import { applyConversions, collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import { AgentSchema, type Agent } from './agent.zod';

const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const MEMORY_AGENT = {
  name: 'memory_agent',
  label: 'Memory Agent',
  role: 'Assistant',
  instructions: 'Remember what the user told you.',
} as const;

/**
 * The store tombstone's prescription: why, the fix. Unanchored, because a thrown
 * `ZodError`'s message is the JSON of its issues; the key-first house convention
 * is asserted on the issue message itself below.
 */
const STORE_PRESCRIPTION =
  /`agent\.memory\.longTerm\.store` was removed in @objectstack\/spec 17\.7\.0 \(ADR-0049 enforce-or-remove\) — the memory store is platform infrastructure, not agent metadata: .*Delete the key; long-term memory is configured by `enabled`, `maxEntries` and `agent\.memory\.reflectionInterval`/s;

/** The one refusal `defineStack` raised, as its ADR-0112 envelope. */
const stackRefusal = (agent: Record<string, unknown>) => {
  let thrown: unknown;
  try {
    defineStack({
      manifest: { id: 'com.example.agent-memory', name: 'agent_memory', version: '1.0.0', type: 'app' },
      agents: [agent],
    } as never);
  } catch (e) {
    thrown = e;
  }
  return thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
};

describe('agent memory store retirement — the tombstone, at every door that carries an agent', () => {
  it('refuses EVERY value at its path with the prescription — the honoured one, the refused ones, and non-strings', () => {
    for (const store of ['database', 'vector', 'redis', {}, null, 0]) {
      const r = AgentSchema.safeParse({
        ...MEMORY_AGENT,
        memory: { longTerm: { enabled: true, store, maxEntries: 5 }, reflectionInterval: 3 },
      });
      expect(r.success, `store: ${JSON.stringify(store)}`).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('invalid_type');
      expect(issues[0].path).toEqual(['memory', 'longTerm', 'store']);
      expect(issues[0].message).toMatch(STORE_PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issues[0].message.startsWith('`agent.memory.longTerm.store` was removed')).toBe(true);
      expect(issues[0].message.endsWith(MIGRATE_SENTENCE)).toBe(true);
    }
  });

  it('the old store spellings `backend` / `storage` / `provider` are answered with the same fact, never steered onto `store`', () => {
    for (const spelling of ['backend', 'storage', 'provider']) {
      const r = AgentSchema.safeParse({
        ...MEMORY_AGENT,
        memory: { longTerm: { enabled: true, [spelling]: 'database', maxEntries: 5 }, reflectionInterval: 3 },
      });
      expect(r.success, spelling).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('unrecognized_keys');
      expect(issues[0].path).toEqual(['memory', 'longTerm']);
      expect(issues[0].message).toContain('there is no storage-backend key on long-term memory');
      expect(issues[0].message).not.toMatch(/→ `store`/);
    }
  });

  it('the did-you-mean never offers the tombstone: a near-miss `stor` is not steered onto `store`', () => {
    const r = AgentSchema.safeParse({
      ...MEMORY_AGENT,
      memory: { longTerm: { enabled: true, stor: 'database', maxEntries: 5 }, reflectionInterval: 3 },
    });
    expect(r.success).toBe(false);
    const issue = r.error!.issues[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('`stor`');
    expect(issue.message).not.toMatch(/`stor` → `store`/);
  });

  it('the walked shape keeps `store` as a key — the tombstone stays reachable for its refusal', () => {
    // `AgentSchema.shape.memory` is the very handle the cloud reader re-parses with.
    const longTerm = (AgentSchema.shape.memory as any).unwrap().shape.longTerm.unwrap();
    expect(Object.keys(longTerm.shape)).toContain('store');
    expect(Object.keys(longTerm.shape), 'CONTROL: its live neighbour').toContain('maxEntries');
  });

  it('fails tsc at the authoring site: the input type of `store` is `never`', () => {
    const agent: Agent = {
      ...MEMORY_AGENT,
      memory: {
        longTerm: {
          enabled: true,
          // @ts-expect-error — `store` is a retiredKey() tombstone: its input type is `never`.
          store: 'database',
          maxEntries: 5,
        },
        reflectionInterval: 3,
      },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => AgentSchema.parse(agent)).toThrow(STORE_PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const refusal = stackRefusal({
      ...MEMORY_AGENT,
      memory: { longTerm: { enabled: true, store: 'vector', maxEntries: 5 }, reflectionInterval: 3 },
    });
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['agents', 0, 'memory', 'longTerm', 'store']);
    expect(refusal.issues?.[0]?.message).toMatch(STORE_PRESCRIPTION);
  });
});

describe('agent memory store retirement — the D2 conversion', () => {
  const CONVERSION_ID = 'agent-memory-long-term-store-removed';
  const persisted = (store: unknown) => ({
    ...MEMORY_AGENT,
    memory: { longTerm: { enabled: true, store, maxEntries: 20 }, reflectionInterval: 5 },
  });

  it('a STORED agent row carrying the key replays clean through the rehydration seam', () => {
    const notices: Array<{ conversionId?: string; path?: string; from?: string; to?: string }> = [];
    const rehydrated = applyConversionsToStoredItem('agent', persisted('vector'), {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;
    expect(notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'agents[0].memory.longTerm.store', 'store', '(removed)'],
    ]);
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual({
      ...MEMORY_AGENT,
      memory: { longTerm: { enabled: true, maxEntries: 20 }, reflectionInterval: 5 },
    });
    // And the rehydrated row is exactly what the write door accepts now.
    expect(AgentSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ agents: [persisted('database')] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`agent.memory.longTerm.store` was removed');
    const after = ObjectStackDefinitionSchema.safeParse(applyConversions(artifact(), { includeRetired: true }));
    expect(after.success, JSON.stringify(after.error?.issues ?? [])).toBe(true);
  });

  it('LIT CONTROL — an agent missing a required number is refused on BOTH sides: the conversion supplies no number', () => {
    const artifact = () => ({
      agents: [{ ...MEMORY_AGENT, memory: { longTerm: { enabled: true, store: 'vector', maxEntries: 20 } } }],
    });
    expect(ObjectStackDefinitionSchema.safeParse(artifact()).success).toBe(false);
    const healed = applyConversions(artifact(), { includeRetired: true });
    const after = ObjectStackDefinitionSchema.safeParse(healed);
    expect(after.success).toBe(false);
    expect(JSON.stringify(after.error?.issues ?? [])).toContain('`agent.memory.reflectionInterval` is required');
  });

  it('is idempotent by construction, and leaves an agent without the key untouched by reference', () => {
    const input = { agents: [persisted('redis'), { ...MEMORY_AGENT, name: 'plain_agent' }] };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    expect((stack.agents as unknown[])[1]).toBe(input.agents[1]);
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { agents: [persisted('database')] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });

  it('is registered under major 18: the exact nested key, the chain step, and one D3 entry for the contract', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('ai/Agent:memory.longTerm.store');
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.surface).toBe('agent.memory.longTerm.store');
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === 'agent-memory-store-retired-and-limits-required');
    expect(d3).toHaveLength(1);
    expect(d3[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(d3[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types `store` `never` on
// `Agent`, so every TYPED authoring site fails to compile. The residue is what
// `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`, and TS
// literals typed `any` / `unknown`. This walk covers that residue across the
// five repo roots `scripts/cross-package-test-inputs.mjs` already declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), plus the example apps'
// own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// The matcher judges the AUTHORING SHAPE, never a mention: a `longTerm` key
// whose object value holds a `store` key — or one of its old spellings
// `backend` / `storage` / `provider` — before any nested brace (TS / JS / JSON,
// and YAML block and flow form). `store` alone is far too common a word to
// judge. Inline code is prose and is stripped before judging. The bound,
// stated: a block assembled by spread or under computed keys, and `docs/**`,
// `.claude/**`, `.github/**` and the repo-root files are outside what this
// walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a long-term memory store', () => {
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

  const STORE_KEYS = '(store|backend|storage|provider)';
  const AUTHORING = [
    // TS / JS / JSON, block or inline: the key, then an object whose own keys
    // (before any nested brace) include the store or one of its spellings.
    new RegExp(`(^|[^\\w.$])["']?longTerm["']?\\s*:\\s*\\{[^{}]*?(^|[^\\w.$])["']?${STORE_KEYS}["']?\\s*:`, 'm'),
    // YAML block form: the key on its own line, the store key indented below it
    // among its siblings.
    new RegExp(`^[ \\t]*(-[ \\t]+)?longTerm[ \\t]*:[ \\t]*\\r?\\n(?:[ \\t]+[^\\s][^\\n]*\\r?\\n)*?[ \\t]+${STORE_KEYS}[ \\t]*:`, 'm'),
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
    // because this is a FILESYSTEM walk. Its source is `agent.zod.ts`.
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
    // Offenders — the retired shape, in each syntax the walk reads.
    expect(judge("defineAgent({ memory: { longTerm: { enabled: true, store: 'vector' } } })")).not.toBeNull();
    expect(judge("    longTerm: {\n      enabled: true,\n      store: 'database',\n    },")).not.toBeNull();
    expect(judge('{ "longTerm": { "enabled": true, "store": "redis" } }')).not.toBeNull();
    expect(judge("longTerm: { backend: 'database' }")).not.toBeNull();
    expect(judge('memory:\n  longTerm:\n    enabled: true\n    storage: vector\n')).not.toBeNull();
    expect(judge('longTerm: { enabled: true, provider: redis }\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefineAgent({ memory: { longTerm: { store: 'vector' } } });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge("the `longTerm: { enabled: true, store: 'vector' }` block loses its store")).toBeNull();
    expect(judge("memory: { longTerm: { enabled: true, maxEntries: 5 }, reflectionInterval: 3 }")).toBeNull();
    expect(judge("store: retiredKey(LONG_TERM_STORE_RETIRED),")).toBeNull();
    expect(judge("'long.store': (memory.longTerm as any)?.store,")).toBeNull();
    expect(judge("const s = { longTerm: 1, nested: { store: 'x' } };")).toBeNull();
    expect(judge('longTerm:\n  enabled: true\nstore:\n  kind: x\n')).toBeNull();
  });

  it('no long-term memory store authoring survives inside the declared radius outside the retirement kit', () => {
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
    expect(offenders, 'a long-term memory store authoring means the retirement is being undone').toEqual([]);
  });
});
