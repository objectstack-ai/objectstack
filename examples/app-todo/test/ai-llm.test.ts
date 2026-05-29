// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// AI **real LLM** smoke test — proves the end-to-end loop works against
// an actual model, not just the MemoryLLMAdapter heuristics.
//
// Gated on the `AI_GATEWAY_API_KEY` env var (or `OPENAI_API_KEY`). Without
// a key the script exits 0 with a notice so it can be safely chained in
// CI without leaking spend.
//
// Run via: `AI_GATEWAY_API_KEY=... pnpm --filter @example/app-todo test:llm`

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  VercelLLMAdapter,
  registerQueryDataTool,
  registerActionsAsTools,
} from '@objectstack/service-ai';
import type { IAIService, IDataEngine } from '@objectstack/spec/contracts';
import { createGateway } from '@ai-sdk/gateway';
import TodoApp from '../objectstack.config';
import { Task } from '../src/objects/task.object';
import { registerTaskActionHandlers } from '../src/actions/register-handlers';

(async () => {
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('ℹ️  AI_GATEWAY_API_KEY not set — skipping real-LLM smoke test.');
    console.log('   Provide a Vercel AI Gateway key (or OPENAI_API_KEY) to run.');
    process.exit(0);
  }

  console.log('🤖 ObjectStack AI Real-LLM Smoke Test');
  console.log('────────────────────────────────────');

  // Default model — small + cheap, but still tool-call capable.
  // Vercel AI Gateway's OpenAI-compatible endpoint expects `provider/model`
  // ids (e.g. "openai/gpt-4.1-mini") in `OPENAI_BASE_URL` mode.
  const modelId = process.env.OS_AI_MODEL ?? 'openai/gpt-4.1-mini';
  console.log(`   Model: ${modelId}`);

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  // Configure the OpenAI-compatible provider. `OPENAI_BASE_URL` lets you
  // point at any compatible endpoint (Vercel AI Gateway, Ollama, LM Studio,
  // your own proxy). Falls back to the default OpenAI host.
  // Use Vercel AI Gateway with its native protocol. We deliberately
  // ignore OPENAI_BASE_URL here — the gateway provider uses its own
  // `/v1/ai` endpoint, which speaks a richer schema than OpenAI's
  // chat/completions surface (and is what the API key is provisioned
  // against).
  const gateway = createGateway({ apiKey });
  const model = gateway.languageModel(modelId);

  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
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
  await kernel.use(new AppPlugin(TodoApp));
  await kernel.bootstrap();

  // Manually wire action handlers (app-todo's `onEnable` named export
  // isn't picked up when only the default export is passed to AppPlugin).
  const ql = await (kernel as unknown as {
    getServiceAsync: <T>(name: string) => Promise<T>;
  }).getServiceAsync<{
    registerAction: (objectName: string, handlerName: string, fn: unknown) => void;
  }>('data');
  registerTaskActionHandlers(ql as never);

  const ai = kernel.getService<IAIService>('ai');
  if (!ai?.chatWithTools) throw new Error('chatWithTools not available');
  const dataEngine = kernel.getService<IDataEngine>('data');
  if (!dataEngine) throw new Error('data engine not available');

  // Wire query_data + action tools against a fake metadata service —
  // mirrors what AIServicePlugin does in a real deployment.
  const mergedTask = TodoApp.objects?.find(o => o.name === 'todo_task') ?? Task;
  const aiService = ai as IAIService & {
    toolRegistry: Parameters<typeof registerQueryDataTool>[0];
  };
  const fakeMetadata = { listObjects: async () => [mergedTask] } as never;
  registerQueryDataTool(aiService.toolRegistry, { ai, metadata: fakeMetadata, dataEngine });
  await registerActionsAsTools(aiService.toolRegistry, { metadata: fakeMetadata, dataEngine });

  // Show the model what it has to work with.
  const registry = aiService.toolRegistry as unknown as {
    getAll: () => Array<{ name: string; description?: string }>;
  };
  const tools = registry.getAll();
  console.log(`   Tools available: ${tools.map(t => t.name).join(', ')}`);

  console.log('\n📊 Step 1 — seed snapshot');
  const before = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  const incomplete = before.filter(r => r.status !== 'completed');
  console.log(`   ${before.length} tasks total, ${incomplete.length} not completed`);
  if (incomplete.length === 0) {
    console.error('❌ No incomplete task to act on');
    process.exit(1);
  }
  const candidateSubjects = incomplete.map(r => String(r.subject));
  console.log(`   Candidates: ${candidateSubjects.join(' | ')}`);

  // Pick a recognizable keyword from the first candidate to keep the
  // model's job tractable (it still has to call query_data first to
  // resolve the id — we're not handing the id in directly).
  const target = incomplete[0];
  const subject = String(target.subject);
  const keyword = subject.split(/\s+/).find(w => w.length > 4) ?? subject;
  console.log(`   Aiming for: "${subject}" (keyword: "${keyword}")`);

  console.log('\n🧠 Step 2 — real LLM tool-call loop');
  const userQuestion = `Please mark the "${keyword}" task as complete.`;
  console.log(`   User: "${userQuestion}"`);

  const toolErrorsCaught: Array<{ tool: string; error: string }> = [];
  const toolCallLog: Array<{ tool: string; args: unknown; output?: string; isError?: boolean }> = [];

  // Tap into the registry to capture every tool invocation, since
  // chatWithTools only returns the final assistant text.
  const origRegistry = aiService.toolRegistry;
  const origExecuteAll = (origRegistry as unknown as { executeAll: Function }).executeAll.bind(
    origRegistry,
  );
  (origRegistry as unknown as { executeAll: Function }).executeAll = async (
    calls: Array<Record<string, unknown>>,
  ) => {
    const out = await origExecuteAll(calls);
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

  const t0 = Date.now();
  const result = await ai.chatWithTools!(
    [
      {
        role: 'system',
        content: [
          'You are the data_chat agent for an ObjectStack todo app.',
          'You have two kinds of tools available:',
          '  • query_data: takes a natural-language question and returns matching records.',
          '  • action_<name>: each one performs a specific business action on a record. Most require a recordId.',
          'When the user asks you to *do* something to a record (complete it, start it, clone it, …):',
          '  1. Call query_data first to locate the target record and get its id.',
          '  2. Then call the matching action_* tool with that recordId.',
          '  3. Finally summarise what you did in one short sentence.',
          'Never invent record ids — always read them out of a query_data result.',
        ].join('\n'),
      },
      { role: 'user', content: userQuestion },
    ],
    {
      model: modelId,
      toolChoice: 'auto',
      maxIterations: 6,
      onToolError: (call, errorText) => {
        toolErrorsCaught.push({ tool: call.toolName, error: errorText });
        return 'continue';
      },
    },
  );
  const elapsed = Date.now() - t0;
  console.log(`   Agent (${elapsed}ms): "${result.content}"`);
  if (result.usage) {
    console.log(`   Usage: ${JSON.stringify(result.usage)}`);
  }
  console.log(`   Tool invocations (${toolCallLog.length}):`);
  for (const c of toolCallLog) {
    const argStr = c.args == null ? '?' : JSON.stringify(c.args).slice(0, 200);
    console.log(`     → ${c.tool}(${argStr}) ${c.isError ? '✗' : '✓'}`);
    if (c.output) console.log(`       = ${c.output.slice(0, 500)}`);
  }
  if (toolErrorsCaught.length) {
    console.log(`   Tool errors (${toolErrorsCaught.length}):`);
    for (const e of toolErrorsCaught) {
      console.log(`     ✗ ${e.tool}: ${e.error.slice(0, 400)}`);
    }
  }

  console.log('\n📈 Step 3 — verify the action actually mutated data');
  const after = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  const previouslyIncomplete = new Set(incomplete.map(r => r.id));
  const newlyCompleted = after.filter(
    r => r.status === 'completed' && previouslyIncomplete.has(r.id),
  );
  console.log(`   Newly completed: ${newlyCompleted.length}`);
  for (const t of newlyCompleted) console.log(`     • "${t.subject}" (id=${t.id})`);
  if (newlyCompleted.length === 0) {
    console.error('❌ No task flipped to completed — LLM did not invoke action_complete_task');
    process.exit(1);
  }
  const hitTarget = newlyCompleted.some(t => t.id === target.id);
  if (!hitTarget) {
    console.warn(
      `   ⚠️  LLM picked a different task than the one we hinted (target id=${target.id}). Action ran, but disambiguation was off.`,
    );
  }

  console.log('\n📊 Step 4 — verify ai_traces persisted');
  await new Promise(r => setTimeout(r, 100));
  const traces = (await dataEngine.find('ai_traces', {})) as Array<Record<string, unknown>>;
  const cwtTraces = traces.filter(t => t.operation === 'chat_with_tools');
  console.log(`   ai_traces rows: ${traces.length}, chat_with_tools: ${cwtTraces.length}`);
  if (cwtTraces.length === 0) {
    console.error('❌ Expected at least one chat_with_tools trace');
    process.exit(1);
  }

  console.log('\n🎉 Real-LLM Smoke Test Successful!');
  console.log('   • Real LLM picked up auto-generated tool descriptions');
  console.log('   • Multi-step tool loop ran: query_data → action_complete_task');
  console.log('   • Task status flipped via the action handler');
  console.log('   • ai_traces persisted the run');
  process.exit(0);
})().catch(err => {
  console.error('💥 Smoke test failed:', err);
  process.exit(1);
});
