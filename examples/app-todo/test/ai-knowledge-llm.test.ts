// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Knowledge Protocol **real-LLM** smoke test.
//
// Demonstrates two things end-to-end:
//   1. `search_knowledge` is wired through `ai.chatWithTools` and a real
//      model (Vercel AI Gateway) picks it up to answer a user question.
//   2. Permission-aware retrieval works: the same query, run as two
//      different users, returns only the rows each user is allowed to
//      see. This proves the orchestrator's RLS re-check (which goes
//      through `IDataEngine.find({ context })`) is engaged for the
//      LLM-driven path — not just for direct unit tests.
//
// Gated on `AI_GATEWAY_API_KEY` (or `OPENAI_API_KEY`). Without a key the
// deterministic RLS demo still runs; only the LLM steps are skipped.
//
// Run via:
//   AI_GATEWAY_API_KEY=... pnpm --filter @example/app-todo test:knowledge:llm

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  VercelLLMAdapter,
  registerKnowledgeTools,
} from '@objectstack/service-ai';
import {
  KnowledgeServicePlugin,
} from '@objectstack/service-knowledge';
import { KnowledgeMemoryPlugin } from '@objectstack/knowledge-memory';
import type {
  IAIService,
  IDataEngine,
  IKnowledgeService,
} from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { createGateway } from '@ai-sdk/gateway';
import TodoApp from '../objectstack.config';

const ALICE = 'user_alice';
const BOB = 'user_bob';

const SEED: Array<{ subject: string; description: string; owner: string }> = [
  // Alice — payments / billing themed
  {
    subject: 'Refactor payment gateway integration',
    description:
      'Migrate the Stripe webhook handler to the new ObjectStack action ' +
      'runtime. Document the retry budget for failed charges.',
    owner: ALICE,
  },
  {
    subject: 'Investigate dispute handling for credit-card refunds',
    description:
      'Customer reports indicate refunds are taking 7+ days. Trace the ' +
      'payment ledger and confirm the refund event is emitted exactly once.',
    owner: ALICE,
  },
  {
    subject: 'Personal: schedule dentist appointment',
    description: 'Annual cleaning, prefer Friday morning.',
    owner: ALICE,
  },
  // Bob — analytics / dashboards themed
  {
    subject: 'Ship Q3 analytics dashboard prototype',
    description:
      'Build the revenue cohort dashboard in Studio using the new ' +
      'Knowledge Protocol for documentation lookups inside the editor.',
    owner: BOB,
  },
  {
    subject: 'Document payment funnel KPIs',
    description:
      'Define the funnel from checkout-started to payment-succeeded. ' +
      'Used for the analytics dashboard and weekly exec readouts.',
    owner: BOB,
  },
];

(async () => {
  console.log('🧠 ObjectStack Knowledge Protocol — Real-LLM Smoke');
  console.log('───────────────────────────────────────────────────');

  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;
  const modelId = process.env.OS_AI_MODEL ?? 'openai/gpt-4.1-mini';
  if (apiKey) {
    console.log(`   LLM model:  ${modelId}`);
  } else {
    console.log('   LLM model:  (none — deterministic RLS demo only)');
  }

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  // ── Boot kernel ──────────────────────────────────────────────────
  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));

  if (apiKey) {
    const gateway = createGateway({ apiKey });
    const model = gateway.languageModel(modelId);
    await kernel.use(
      new AIServicePlugin({
        adapter: new VercelLLMAdapter({ model }),
        models: [
          {
            id: modelId,
            name: modelId,
            version: '1.0',
            provider: 'custom',
            capabilities: { textGeneration: true, toolCalling: true },
            limits: { maxTokens: 8192, contextWindow: 128_000 },
          },
        ],
        defaultModelId: modelId,
      }),
    );
  } else {
    // Even without a key we still register AI service so we can demo the
    // direct knowledgeService path without LLM noise.
    await kernel.use(new AIServicePlugin({}));
  }

  await kernel.use(
    new KnowledgeServicePlugin({
      sources: [
        {
          id: 'task_notes',
          label: 'Task descriptions',
          adapter: 'memory',
          source: {
            kind: 'object',
            object: 'todo_task',
            contentFields: ['subject', 'description'],
            metadataFields: ['owner', 'status'],
            titleField: 'subject',
          },
        },
      ],
      enableEventSync: false,
    }),
  );
  await kernel.use(new KnowledgeMemoryPlugin());
  await kernel.use(new AppPlugin(TodoApp));
  await kernel.bootstrap();

  const dataEngineRaw = kernel.getService<IDataEngine>('data');
  if (!dataEngineRaw) throw new Error('data engine not available');

  // ── Wrap data engine to enforce a simple owner-based RLS ────────
  //
  // The bundled SqliteWasmDriver doesn't have a sharing-rule layer for
  // arbitrary objects, so to make the permission filter *visible* we
  // wrap `find` to drop rows whose `owner !== ctx.userId` whenever the
  // caller is not a system actor. This is what a real-world sharing
  // policy would do declaratively — same shape, same effect.
  const dataEngine: IDataEngine = new Proxy(dataEngineRaw, {
    get(target, prop, receiver) {
      if (prop === 'find') {
        const orig = (target as IDataEngine).find.bind(target);
        return async (
          objectName: string,
          query?: { context?: ExecutionContext; fields?: string[] } & Record<string, unknown>,
        ) => {
          const ctx = query?.context;
          if (!ctx || ctx.isSystem || objectName !== 'todo_task') {
            return orig(objectName, query as never);
          }
          const userId = ctx.userId;
          if (!userId) return [];
          // Pull full rows (or at least include `owner`) so we can filter.
          const fields = query?.fields
            ? Array.from(new Set([...query.fields, 'owner']))
            : undefined;
          const rows = (await orig(objectName, {
            ...(query as Record<string, unknown>),
            fields,
          } as never)) as Array<Record<string, unknown>>;
          return rows
            .filter((r) => r.owner === userId)
            .map((r) => {
              if (!query?.fields || query.fields.includes('owner')) return r;
              const { owner: _drop, ...rest } = r;
              return rest;
            });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as IDataEngine;

  // Re-bind the knowledge service to the wrapped data engine so its
  // RLS re-check goes through our owner filter.
  const knowledge = kernel.getService<IKnowledgeService>('knowledge');
  if (!knowledge) throw new Error('knowledge service not registered');
  (knowledge as unknown as { options: { dataEngine: IDataEngine } }).options.dataEngine =
    dataEngine;

  // ── Seed tasks (as system, bypassing the wrapper) ───────────────
  console.log('\n🌱 Step 1 — seed 5 tasks across two owners');
  for (const t of SEED) {
    await dataEngineRaw.insert('todo_task', {
      subject: t.subject,
      description: t.description,
      status: 'not_started',
      priority: 'normal',
      owner: t.owner,
    } as never);
  }
  const all = (await dataEngineRaw.find('todo_task', {})) as Array<Record<string, unknown>>;
  console.log(`   seeded ${all.length} rows`);
  console.log(`     alice owns: ${all.filter((r) => r.owner === ALICE).length}`);
  console.log(`     bob   owns: ${all.filter((r) => r.owner === BOB).length}`);

  // ── Index the source ────────────────────────────────────────────
  console.log('\n📚 Step 2 — reindex knowledge source `task_notes`');
  const reindex = await knowledge.reindexSource('task_notes');
  console.log(`   indexed=${reindex.indexed} deleted=${reindex.deleted ?? 0}`);
  if (reindex.indexed < SEED.length) {
    console.error(`❌ Expected at least ${SEED.length} docs indexed, got ${reindex.indexed}`);
    process.exit(1);
  }

  // ── Direct (non-LLM) RLS demo ───────────────────────────────────
  console.log('\n🔐 Step 3 — direct search (no LLM) proves the RLS filter');

  const ctxFor = (userId: string): ExecutionContext => ({
    userId,
    roles: [],
    permissions: [],
    isSystem: false,
  });
  const ctxSystem: ExecutionContext = { roles: [], permissions: [], isSystem: true };

  const aliceHits = await knowledge.search('payment refunds', {
    sourceIds: ['task_notes'],
    topK: 10,
    executionContext: ctxFor(ALICE),
  });
  const bobHits = await knowledge.search('payment refunds', {
    sourceIds: ['task_notes'],
    topK: 10,
    executionContext: ctxFor(BOB),
  });
  const sysHits = await knowledge.search('payment refunds', {
    sourceIds: ['task_notes'],
    topK: 10,
    executionContext: ctxSystem,
  });

  const printHits = (label: string, hits: typeof aliceHits) => {
    console.log(`   ${label} → ${hits.length} hit(s)`);
    for (const h of hits.slice(0, 5)) {
      console.log(
        `     • [${h.score.toFixed(3)}] ${h.title ?? h.snippet.slice(0, 60)} ` +
          `(owner=${(h.metadata as Record<string, unknown>)?.owner ?? '?'})`,
      );
    }
  };
  printHits('alice', aliceHits);
  printHits('bob  ', bobHits);
  printHits('system', sysHits);

  const aliceOwnsAll = aliceHits.every(
    (h) => (h.metadata as Record<string, unknown>)?.owner === ALICE,
  );
  const bobOwnsAll = bobHits.every(
    (h) => (h.metadata as Record<string, unknown>)?.owner === BOB,
  );
  const systemSeesBoth =
    sysHits.some((h) => (h.metadata as Record<string, unknown>)?.owner === ALICE) &&
    sysHits.some((h) => (h.metadata as Record<string, unknown>)?.owner === BOB);

  if (!aliceOwnsAll) {
    console.error('❌ Alice received hits owned by someone else — RLS failed.');
    process.exit(1);
  }
  if (!bobOwnsAll) {
    console.error('❌ Bob received hits owned by someone else — RLS failed.');
    process.exit(1);
  }
  if (!systemSeesBoth) {
    console.error('❌ System actor did not see both owners — sanity check failed.');
    process.exit(1);
  }
  if (aliceHits.length === 0 || bobHits.length === 0) {
    console.error('❌ Expected each actor to see at least one of their own hits.');
    process.exit(1);
  }
  console.log('   ✅ RLS verified: each actor only sees their own rows');

  // ── LLM-driven step ─────────────────────────────────────────────
  if (!apiKey) {
    console.log('\nℹ️  Skipping Step 4 (LLM) — set AI_GATEWAY_API_KEY to enable.');
    console.log('\n🎉 Knowledge Protocol smoke test passed (RLS demo only).');
    process.exit(0);
  }

  const ai = kernel.getService<IAIService>('ai');
  if (!ai?.chatWithTools) throw new Error('chatWithTools not available');
  const aiService = ai as IAIService & {
    toolRegistry: Parameters<typeof registerKnowledgeTools>[0];
  };
  registerKnowledgeTools(aiService.toolRegistry, { knowledgeService: knowledge });

  // Tap the registry to record every tool invocation (the assistant
  // text alone doesn't show whether `search_knowledge` was called).
  const toolCallLog: Array<{ tool: string; args: unknown; output?: string; isError?: boolean }> = [];
  const origRegistry = aiService.toolRegistry;
  const origExecuteAll = (origRegistry as unknown as { executeAll: Function }).executeAll.bind(
    origRegistry,
  );
  (origRegistry as unknown as { executeAll: Function }).executeAll = async (
    calls: Array<Record<string, unknown>>,
    ctx?: unknown,
  ) => {
    const out = await origExecuteAll(calls, ctx);
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const args = c.args ?? c.input ?? c.arguments ?? {};
      const tool = String(c.toolName ?? c.name);
      const r = (out as Array<{ output?: unknown; isError?: boolean }>)[i];
      const outText =
        r && typeof r.output === 'string'
          ? r.output
          : JSON.stringify(r?.output ?? r);
      toolCallLog.push({ tool, args, output: outText, isError: !!r?.isError });
    }
    return out;
  };

  const runAsActor = async (label: string, actorId: string) => {
    console.log(`\n🧠 Step 4.${label} — LLM as ${actorId}`);
    toolCallLog.length = 0;
    const t0 = Date.now();
    const result = await ai.chatWithTools!(
      [
        {
          role: 'system',
          content: [
            'You are an assistant for an ObjectStack todo app.',
            'When the user asks about their tasks or notes, you MUST call',
            'the `search_knowledge` tool. Do not answer from memory. After',
            'the tool returns, summarise the matching task subjects in one',
            'short sentence. If no hits, say so plainly.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: 'What tasks do I have related to payments?',
        },
      ],
      {
        model: modelId,
        toolChoice: 'auto',
        maxIterations: 4,
        toolExecutionContext: {
          actor: { id: actorId, roles: [], permissions: [] },
        },
      },
    );
    const elapsed = Date.now() - t0;
    console.log(`   reply (${elapsed}ms): "${result.content}"`);
    console.log(`   tool calls: ${toolCallLog.length}`);
    for (const c of toolCallLog) {
      const argStr = JSON.stringify(c.args).slice(0, 160);
      console.log(`     → ${c.tool}(${argStr}) ${c.isError ? '✗' : '✓'}`);
      if (c.output) console.log(`       = ${c.output.slice(0, 400)}`);
    }
    return { content: result.content, tools: [...toolCallLog] };
  };

  const aliceRun = await runAsActor('a', ALICE);
  const bobRun = await runAsActor('b', BOB);

  // Verify the LLM actually invoked the knowledge tool for both runs.
  const calledSearch = (run: typeof aliceRun) =>
    run.tools.some((c) => c.tool === 'search_knowledge' && !c.isError);
  if (!calledSearch(aliceRun) || !calledSearch(bobRun)) {
    console.error('❌ LLM did not invoke search_knowledge — tool wiring broken.');
    process.exit(1);
  }

  // Verify each run's tool output is owner-scoped.
  const checkOwnerScoped = (
    label: string,
    run: typeof aliceRun,
    expectedOwner: string,
    forbiddenOwner: string,
  ) => {
    const knowledgeCalls = run.tools.filter(
      (c) => c.tool === 'search_knowledge' && c.output,
    );
    let sawOwn = false;
    for (const c of knowledgeCalls) {
      const out = c.output ?? '';
      if (out.includes(`owner":"${forbiddenOwner}"`) || out.includes(`owner": "${forbiddenOwner}"`)) {
        console.error(`❌ ${label} tool result leaked ${forbiddenOwner}'s row.`);
        process.exit(1);
      }
      if (out.includes(`owner":"${expectedOwner}"`) || out.includes(`owner": "${expectedOwner}"`)) {
        sawOwn = true;
      }
    }
    if (!sawOwn) {
      console.error(`❌ ${label} tool result did not include any ${expectedOwner}-owned hits.`);
      process.exit(1);
    }
  };
  checkOwnerScoped('alice', aliceRun, ALICE, BOB);
  checkOwnerScoped('bob  ', bobRun, BOB, ALICE);

  console.log('\n🎉 Knowledge Protocol Real-LLM Smoke Test Successful!');
  console.log('   • Memory adapter indexed task descriptions');
  console.log('   • Direct search proved per-user RLS dropping');
  console.log('   • Real LLM picked up `search_knowledge` and used it');
  console.log('   • Tool outputs were owner-scoped per-actor (no leakage)');
  process.exit(0);
})().catch((err) => {
  console.error('💥 Knowledge smoke test failed:', err);
  process.exit(1);
});
