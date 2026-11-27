// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An agent's model provider — `agent.model.provider` — RETIRED as a whole key
 * (ADR-0049 enforce-or-remove, #37712): it was parsed and never read. The cloud
 * AI runtime, the one runtime that executes agents, applies the model name,
 * `temperature` and `maxTokens` from the block and nothing else, and the
 * provider that serves an agent is the deployment's AI settings' choice.
 *
 * Bookkeeping shapes, pinned below:
 *   1. A `retiredKey()` tombstone inside the `strictObject` model block, so the
 *      refusal carries the prescription and the key's input type is `never`
 *      for `tsc`.
 *   2. The key was DEFAULTED (`'openai'`) on every released 18.x line, so a
 *      released toolchain wrote `provider: 'openai'` into every agent it parsed
 *      with a `model` block. That emitted default is inert residue
 *      (`acceptRetiredDefaultResidue`, the #12840 rule): accepted and stripped.
 *      Every other value keeps the tombstone's refusal.
 *   3. D2 conversion `agent-model-provider-removed` (step 19), a lossless delete
 *      of the key from every `agents[]` entry's `model`, retired from the load
 *      path: a live author is refused, a stored or built agent replays clean.
 *   4. `RETIRED_KEYS_BY_MAJOR[19]` carries `ai/AIModelConfig:provider`, and the
 *      D3 entry `agent-model-provider-retired` carries the judgement the
 *      conversion cannot make.
 *   5. The liveness row is the `model` container's: a nested key has no row of
 *      its own (`check:liveness` is the judge of that half).
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
import { AgentSchema, AIModelConfigSchema, type Agent } from './agent.zod';

const MIGRATE_SENTENCE =
  'Run `os migrate meta --from 18` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const MODEL_AGENT = {
  name: 'model_agent',
  label: 'Model Agent',
  role: 'Assistant',
  instructions: 'Answer the question.',
} as const;

/**
 * The tombstone's prescription: why, the fix. Unanchored, because a thrown
 * `ZodError`'s message is the JSON of its issues; the key-first house
 * convention is asserted on the issue message itself below.
 */
const PROVIDER_PRESCRIPTION =
  /`agent\.model\.provider` was removed in @objectstack\/spec 19\.0\.0 \(ADR-0049 enforce-or-remove\) — it never had an effect: .*Delete the key\. To pin a model, name it in `agent\.model\.model`/s;

/** The one refusal `defineStack` raised, as its ADR-0112 envelope. */
const stackRefusal = (agent: Record<string, unknown>) => {
  let thrown: unknown;
  try {
    defineStack({
      manifest: { id: 'com.example.agent-model', name: 'agent_model', version: '1.0.0', type: 'app' },
      agents: [agent],
    } as never);
  } catch (e) {
    thrown = e;
  }
  return thrown as { code?: string; status?: number; issues?: Array<{ path: PropertyKey[]; message: string }> };
};

describe('agent model provider retirement — the tombstone, at every door that carries an agent', () => {
  it('refuses every value an author could have written at its path with the prescription', () => {
    for (const provider of ['anthropic', 'azure_openai', 'local', 'google', {}, null, 0]) {
      const r = AgentSchema.safeParse({ ...MODEL_AGENT, model: { provider, model: 'gpt-4o' } });
      expect(r.success, `provider: ${JSON.stringify(provider)}`).toBe(false);
      const issues = r.error!.issues;
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('invalid_type');
      expect(issues[0].path).toEqual(['model', 'provider']);
      expect(issues[0].message).toMatch(PROVIDER_PRESCRIPTION);
      // House convention 1: the fully-qualified key, in backticks, opens it.
      expect(issues[0].message.startsWith('`agent.model.provider` was removed')).toBe(true);
      expect(issues[0].message.endsWith(MIGRATE_SENTENCE)).toBe(true);
    }
  });

  it('accepts the 18.x emitted default `openai` as inert residue and strips it — the parsed agent carries no provider', () => {
    const parsed = AgentSchema.parse({ ...MODEL_AGENT, model: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 } });
    expect(parsed.model).toEqual({ model: 'gpt-4o', temperature: 0.2 });
    expect('provider' in (parsed.model as object)).toBe(false);
    // The model block's own door agrees.
    const block = AIModelConfigSchema.parse({ provider: 'openai' });
    expect('provider' in block).toBe(false);
    // CONTROL: a near value is not the residue — only the exact literal is.
    expect(AIModelConfigSchema.safeParse({ provider: 'OpenAI' }).success).toBe(false);
    expect(AIModelConfigSchema.safeParse({ provider: 'openai ' }).success).toBe(false);
  });

  it('the walked shape keeps `provider` as a key — the tombstone stays reachable for its refusal', () => {
    expect(Object.keys(AIModelConfigSchema.shape)).toContain('provider');
    expect(Object.keys(AIModelConfigSchema.shape), 'CONTROL: its live neighbour').toContain('model');
  });

  it('fails tsc at the authoring site: the input type of `provider` is `never`', () => {
    const agent: Agent = {
      ...MODEL_AGENT,
      model: {
        // @ts-expect-error — `provider` is a retiredKey() tombstone: its input type is `never`.
        provider: 'anthropic',
        model: 'claude-sonnet-4',
      },
    };
    // The parse channel agrees with the type channel on the same literal.
    expect(() => AgentSchema.parse(agent)).toThrow(PROVIDER_PRESCRIPTION);
  });

  it('the authoring door, defineStack, refuses it with the STACK_SCHEMA_INVALID envelope — never rewrites it', () => {
    const refusal = stackRefusal({ ...MODEL_AGENT, model: { provider: 'anthropic', model: 'claude-sonnet-4' } });
    expect(refusal?.code).toBe('STACK_SCHEMA_INVALID');
    expect(refusal?.status).toBe(422);
    expect(refusal.issues).toHaveLength(1);
    expect(refusal.issues?.[0]?.path).toEqual(['agents', 0, 'model', 'provider']);
    expect(refusal.issues?.[0]?.message).toMatch(PROVIDER_PRESCRIPTION);
  });
});

describe('agent model provider retirement — the D2 conversion', () => {
  const CONVERSION_ID = 'agent-model-provider-removed';
  const persisted = (provider: unknown) => ({
    ...MODEL_AGENT,
    model: { provider, model: 'claude-sonnet-4', temperature: 0.3 },
  });

  it('a STORED agent row carrying the key replays clean through the rehydration seam', () => {
    const notices: Array<{ conversionId?: string; path?: string; from?: string; to?: string }> = [];
    const rehydrated = applyConversionsToStoredItem('agent', persisted('anthropic'), {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string; from?: string; to?: string }),
    }) as Record<string, unknown>;
    expect(notices.map((n) => [n.conversionId, n.path, n.from, n.to])).toEqual([
      [CONVERSION_ID, 'agents[0].model.provider', 'provider', '(removed)'],
    ]);
    // CONTROL: every live key on the same row survives byte-for-byte.
    expect(rehydrated).toEqual({ ...MODEL_AGENT, model: { model: 'claude-sonnet-4', temperature: 0.3 } });
    // And the rehydrated row is exactly what the write door accepts now.
    expect(AgentSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('a persisted artifact is REFUSED at the boot door before the conversion and ACCEPTED after it', () => {
    const artifact = () => ({ agents: [persisted('local')] });
    const before = ObjectStackDefinitionSchema.safeParse(artifact());
    expect(before.success).toBe(false);
    expect(JSON.stringify(before.error?.issues ?? [])).toContain('`agent.model.provider` was removed');
    const after = ObjectStackDefinitionSchema.safeParse(applyConversions(artifact(), { includeRetired: true }));
    expect(after.success, JSON.stringify(after.error?.issues ?? [])).toBe(true);
  });

  it('is idempotent by construction, and leaves an agent without the key untouched by reference', () => {
    const input = { agents: [persisted('azure_openai'), { ...MODEL_AGENT, name: 'plain_agent', model: { temperature: 0.1 } }] };
    const { stack, notices } = collectConversionNotices(input, { includeRetired: true });
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(1);
    expect((stack.agents as unknown[])[1]).toBe(input.agents[1]);
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const input = { agents: [persisted('anthropic')] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter((n) => n.conversionId === CONVERSION_ID)).toHaveLength(0);
    expect(stack).toEqual(input);
  });

  it('is registered under major 19: the exact key, the chain step, and one D3 entry for the contract', () => {
    expect(RETIRED_KEYS_BY_MAJOR[19]).toContain('ai/AIModelConfig:provider');
    expect(MIGRATIONS_BY_MAJOR[19]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion, 'the D2 conversion must be registered').toBeDefined();
    expect(conversion!.toMajor).toBe(19);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.surface).toBe('agent.model.provider');
    const d3 = MIGRATIONS_BY_MAJOR[19]!.semantic.filter((s) => s.id === 'agent-model-provider-retired');
    expect(d3).toHaveLength(1);
    expect(d3[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(d3[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// `tsc` is the primary sweeper — `retiredKey()` types `provider` `never` on
// `Agent['model']`, so every TYPED authoring site fails to compile. The residue
// is what `tsc` never judges: JSON, YAML, MD/MDX code fences, untyped `.js`,
// and TS literals typed `any` / `unknown`. This walk covers that residue
// across the five repo roots `scripts/cross-package-test-inputs.mjs` already
// declares for `@objectstack/spec#test` (mirrored in `turbo.json`), plus the
// example apps' own `src/` trees, declared there as `examples/*/src/**/*.ts`.
//
// The matcher judges the AUTHORING SHAPE, never a mention: a `model` key whose
// object value holds a `provider` key before any nested brace (TS / JS / JSON,
// and YAML block and flow form). `provider` alone is far too common a word to
// judge — knowledge embedders, settings and model registries all carry one.
// Inline code is prose and is stripped before judging. The bound, stated: a
// block assembled by spread or under computed keys, and `docs/**`,
// `.claude/**`, `.github/**` and the repo-root files are outside what this
// walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors an agent model provider', () => {
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

  const AUTHORING = [
    // TS / JS / JSON, block or inline: the key, then an object whose own keys
    // (before any nested brace) include `provider`.
    /(^|[^\w.$])["']?model["']?\s*:\s*\{[^{}]*?(^|[^\w.$])["']?provider["']?\s*:/m,
    // YAML block form: the key on its own line, `provider` indented below it
    // among its siblings.
    /^[ \t]*(-[ \t]+)?model[ \t]*:[ \t]*\r?\n(?:[ \t]+[^\s][^\n]*\r?\n)*?[ \t]+provider[ \t]*:/m,
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
    // A DIFFERENT schema's live key: a model-registry entry's `model` block is
    // `ModelConfigSchema` (ai/model-registry.zod.ts), whose `provider` is live
    // and unrelated to an agent's. Its suite authors registry entries only.
    'packages/spec/src/ai/model-registry.test.ts',
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
    expect(judge("defineAgent({ model: { provider: 'openai', model: 'gpt-4o' } })")).not.toBeNull();
    expect(judge("    model: {\n      model: 'gpt-4o',\n      provider: 'anthropic',\n    },")).not.toBeNull();
    expect(judge('{ "model": { "provider": "openai", "model": "gpt-4" } }')).not.toBeNull();
    expect(judge('model:\n  temperature: 0.2\n  provider: anthropic\n')).not.toBeNull();
    expect(judge("Prose.\n\n```ts\ndefineAgent({ model: { provider: 'openai' } });\n```\n")).not.toBeNull();
    // Neighbours that must NOT match.
    expect(judge("the `model: { provider: 'openai' }` block loses its provider")).toBeNull();
    expect(judge("model: { model: 'gpt-4o', temperature: 0.2 }")).toBeNull();
    expect(judge("defaultModel: { provider: 'openai', model: 'gpt-4o-mini' }")).toBeNull();
    expect(judge("embedder_model: 'x', embedder_provider: 'openai'")).toBeNull();
    expect(judge("provider: retiredKey(MODEL_PROVIDER_RETIRED),")).toBeNull();
    expect(judge("const s = { model: 1, nested: { provider: 'x' } };")).toBeNull();
    expect(judge('model:\n  temperature: 0.2\nprovider:\n  kind: x\n')).toBeNull();
  });

  it('no agent model provider authoring survives inside the declared radius outside the retirement kit', () => {
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
    expect(offenders, 'an agent model provider authoring means the retirement is being undone').toEqual([]);
  });
});
