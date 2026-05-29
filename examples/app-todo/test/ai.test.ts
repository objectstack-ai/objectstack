// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// AI integration demo — boots the Todo stack with an in-memory LLM adapter,
// runs the `query_data` tool end-to-end against seeded data, and verifies the
// call was persisted in the `ai_traces` object.
//
// Run via: `pnpm --filter @example/app-todo test:ai`
//
// No API key required — the demo uses MemoryLLMAdapter, whose heuristic
// `generateObject()` builds a QueryPlan from the schema-context snippet.

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  MemoryLLMAdapter,
  createQueryDataHandler,
} from '@objectstack/service-ai';
import type { IAIService } from '@objectstack/spec/contracts';
import TodoApp from '../objectstack.config';
import { Task } from '../src/objects/task.object';

(async () => {
  console.log('🤖 ObjectStack AI Demo — Todo Stack');
  console.log('────────────────────────────────────');

  process.env.OS_MULTI_ORG_ENABLED = 'false';

  const kernel = new ObjectKernel();

  // Core services
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DriverPlugin(new SqliteWasmDriver({ filename: ':memory:' })));

  // AI service — MemoryLLMAdapter needs no API key.
  // `models` populates the ModelRegistry so trace rows carry a model id.
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

  // Load Todo app (objects + seed data)
  await kernel.use(new AppPlugin(TodoApp));

  await kernel.bootstrap();

  const ql = kernel.getService('objectql') as {
    find: (object: string, opts: unknown) => Promise<unknown[]>;
    insert: (object: string, data: unknown) => Promise<unknown>;
  };
  const ai = kernel.getService<IAIService>('ai');
  if (!ai) throw new Error('AI service missing');

  console.log('\n📊 Step 1 — confirm seed data');
  const seeded = (await ql.find('todo_task', {})) as Array<Record<string, unknown>>;
  console.log(`   Found ${seeded.length} seeded tasks`);
  if (seeded.length === 0) {
    console.error('❌ No seed data — aborting demo');
    process.exit(1);
  }

  console.log('\n🧠 Step 2 — query_data: "list my tasks"');

  // The `query_data` tool is wired by AIServicePlugin only when an
  // IMetadataService is available. The app-todo example doesn't ship
  // MetadataPlugin (objects come from AppPlugin), so build the handler
  // directly with a lightweight metadata adapter that exposes the Task
  // ObjectSchema. This mirrors how a custom plugin would wire it.
  const metadata = {
    listObjects: async () => [Task],
  };
  const handler = createQueryDataHandler({
    ai,
    metadata: metadata as never,
    dataEngine: ql as never,
  });
  const raw = await handler({ request: 'show me my tasks' });
  const parsed = JSON.parse(raw) as {
    plan?: { objectName: string; limit?: number };
    count?: number;
    records?: unknown[];
    error?: string;
  };

  console.log('   Plan:   ', JSON.stringify(parsed.plan));
  console.log('   Count:  ', parsed.count);
  if (parsed.error) {
    console.error('❌ query_data error:', parsed.error);
    process.exit(1);
  }
  if (parsed.plan?.objectName !== 'todo_task') {
    console.error(`❌ Plan picked wrong object: ${parsed.plan?.objectName}`);
    process.exit(1);
  }
  if (!parsed.count || parsed.count < 1) {
    console.error('❌ Expected at least one task in result');
    process.exit(1);
  }

  console.log('\n📈 Step 3 — verify ai_traces was recorded');
  const traces = (await ql.find('ai_traces', {})) as Array<Record<string, unknown>>;
  console.log(`   ai_traces rows: ${traces.length}`);
  const generateObjectTraces = traces.filter(t => t.operation === 'generate_object');
  console.log(`   generate_object rows: ${generateObjectTraces.length}`);
  if (generateObjectTraces.length === 0) {
    console.error('❌ Expected at least one generate_object trace row');
    process.exit(1);
  }
  const sample = generateObjectTraces[0];
  console.log('   Sample trace:', {
    operation: sample.operation,
    model: sample.model,
    latency_ms: sample.latency_ms,
    status: sample.status,
  });

  console.log('\n🎉 AI Demo Successful!');
  console.log('   • Memory adapter served structured output');
  console.log('   • query_data tool composed retriever + plan + execute');
  console.log('   • All LLM calls auto-recorded in ai_traces');
  process.exit(0);
})().catch(err => {
  console.error('❌ Demo failed:', err);
  process.exit(1);
});
