// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// AI **agent** integration demo — boots the Todo stack, asks the
// built-in `data_chat` agent in natural language, and verifies that
//   1. the agent invoked the `query_data` tool, and
//   2. a `chat_with_tools` row landed in `ai_traces`.
//
// Run via: `pnpm --filter @example/app-todo test:agent`
//
// No API key required — uses `MemoryLLMAdapter`, which knows how to
// dispatch `query_data` heuristically and summarise the result.

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  MemoryLLMAdapter,
  registerQueryDataTool,
} from '@objectstack/service-ai';
import type { IAIService, IDataEngine } from '@objectstack/spec/contracts';
import TodoApp from '../objectstack.config';
import { Task } from '../src/objects/task.object';

(async () => {
  console.log('🤖 ObjectStack AI Agent Demo — data_chat over Todo data');
  console.log('────────────────────────────────────────────────────────');

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));
  await kernel.use(
    new AIServicePlugin({
      adapter: new MemoryLLMAdapter(),
      models: [
        {
          id: 'memory',
          name: 'Memory Adapter',
          version: '1.0',
          provider: 'custom',
          capabilities: { textGeneration: true },
          limits: { maxTokens: 8192, contextWindow: 8192 },
        },
      ],
      defaultModelId: 'memory',
    }),
  );
  await kernel.use(new AppPlugin(TodoApp));
  await kernel.bootstrap();

  const ai = kernel.getService<IAIService>('ai');
  if (!ai?.chatWithTools) throw new Error('chatWithTools not available');
  const dataEngine = kernel.getService<IDataEngine>('data');
  if (!dataEngine) throw new Error('data engine not available');

  // The app-todo example doesn't load MetadataPlugin, so AIServicePlugin's
  // auto-wire of query_data is skipped. Register the tool manually here
  // against an ad-hoc IMetadataService that just exposes the Task schema —
  // mirrors what a real metadata service would return.
  const aiService = ai as IAIService & { toolRegistry: Parameters<typeof registerQueryDataTool>[0] };
  registerQueryDataTool(aiService.toolRegistry, {
    ai,
    metadata: { listObjects: async () => [Task] } as never,
    dataEngine,
  });

  console.log('\n📊 Step 1 — confirm seed data');
  const seeded = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  console.log(`   Found ${seeded.length} seeded tasks`);
  if (seeded.length === 0) {
    console.error('❌ No seed data — aborting demo');
    process.exit(1);
  }

  console.log('\n🧠 Step 2 — ask the data_chat agent in natural language');
  const userQuestion = 'show me my tasks';
  console.log(`   User: "${userQuestion}"`);

  const result = await ai.chatWithTools!(
    [
      {
        role: 'system',
        content:
          'You are the data_chat agent. Use the query_data tool when the user asks about data.',
      },
      { role: 'user', content: userQuestion },
    ],
    { model: 'memory', toolChoice: 'auto', maxIterations: 3 },
  );

  console.log(`   Agent: "${result.content}"`);

  console.log('\n📈 Step 3 — verify ai_traces was recorded');
  // Trace writes are fire-and-forget; give them a tick to flush.
  await new Promise(r => setTimeout(r, 100));
  const traces = (await dataEngine.find('ai_traces', {})) as Array<Record<string, unknown>>;
  const cwtTraces = traces.filter(t => t.operation === 'chat_with_tools');
  console.log(`   ai_traces rows: ${traces.length}`);
  console.log(`   chat_with_tools rows: ${cwtTraces.length}`);
  if (cwtTraces.length === 0) {
    console.error('❌ Expected a chat_with_tools trace row');
    process.exit(1);
  }
  const sample = cwtTraces[0];
  console.log('   Sample trace:', {
    operation: sample.operation,
    model: sample.model,
    latency_ms: sample.latency_ms,
    status: sample.status,
  });

  // The agent should have produced a non-error final message that
  // references the records it retrieved.
  if (!result.content || !/\d+\s+record/i.test(result.content)) {
    console.error(`❌ Agent response didn't mention a record count: "${result.content}"`);
    process.exit(1);
  }

  console.log('\n🎉 Agent Demo Successful!');
  console.log('   • data_chat agent routed to query_data via MemoryLLMAdapter');
  console.log('   • Tool result was summarised back to the user');
  console.log('   • chat_with_tools trace persisted in ai_traces');
  process.exit(0);
})().catch(err => {
  console.error('💥 Demo failed:', err);
  process.exit(1);
});
