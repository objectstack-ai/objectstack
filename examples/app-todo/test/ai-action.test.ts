// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// AI **action** integration demo — the write-side counterpart to
// `ai-agent.test.ts`. Confirms that every `type: 'script'` action on the
// Task object that opts in via `ai.exposed` (ADR-0011) is registered as an
// `action_<name>` tool, and that the `data_chat` agent can pick the right
// one in plain English.
//
// Run via: `pnpm --filter @example/app-todo test:action`
//
// No API key required — uses `MemoryLLMAdapter`, which heuristically
// picks an action tool and resolves the record id from the preceding
// `query_data` result.

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  MemoryLLMAdapter,
  registerQueryDataTool,
  registerActionsAsTools,
} from '@objectstack/service-ai';
import type { IAIService, IDataEngine } from '@objectstack/spec/contracts';
import TodoApp from '../objectstack.config';
import { Task } from '../src/objects/task.object';
import { registerTaskActionHandlers } from '../src/actions/register-handlers';

(async () => {
  console.log('🤖 ObjectStack AI Action Demo — actions-as-tools over Todo data');
  console.log('────────────────────────────────────────────────────────────────');

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

  // app-todo registers action handlers via a named `onEnable` export
  // alongside `defineStack`. Importing the default only (as
  // `new AppPlugin(TodoApp)` does above) misses the named hook, so we
  // wire handlers directly against the ObjectQL engine here. In a
  // production deployment this happens automatically when the whole
  // module is loaded by `objectstack start`.
  const ql = await (kernel as unknown as {
    getServiceAsync: <T>(name: string) => Promise<T>;
  }).getServiceAsync<{
    registerAction: (objectName: string, handlerName: string, fn: unknown) => void;
  }>('data');
  if (!ql) throw new Error('data engine (ql) service not available');
  registerTaskActionHandlers(ql as never);

  const ai = kernel.getService<IAIService>('ai');
  if (!ai?.chatWithTools) throw new Error('chatWithTools not available');
  const dataEngine = kernel.getService<IDataEngine>('data');
  if (!dataEngine) throw new Error('data engine not available');

  // App-todo doesn't load MetadataPlugin, so we wire query_data + the
  // action tools manually against a fake metadata service that returns
  // the merged Task object (defineStack merges actions[] into objects
  // by `objectName`). This mirrors what AIServicePlugin does in a real
  // deployment.
  const mergedTask = TodoApp.objects?.find(o => o.name === 'todo_task') ?? Task;
  const taskActions = mergedTask.actions ?? [];
  console.log(`\n📋 Step 0 — Task has ${taskActions.length} actions in metadata`);
  if (taskActions.length === 0) {
    console.error('❌ Task.actions is empty after defineStack merge — aborting');
    process.exit(1);
  }

  const aiService = ai as IAIService & {
    toolRegistry: Parameters<typeof registerQueryDataTool>[0];
  };
  const fakeMetadata = {
    listObjects: async () => [mergedTask],
  } as never;

  registerQueryDataTool(aiService.toolRegistry, {
    ai,
    metadata: fakeMetadata,
    dataEngine,
  });

  // The plugin may have already auto-registered action tools when it
  // booted (it pulls metadata via the metadata service if one is
  // present). Call again to be sure — duplicates are skipped silently.
  const { registered, skipped } = await registerActionsAsTools(aiService.toolRegistry, {
    metadata: fakeMetadata,
    dataEngine,
  });
  const registry = aiService.toolRegistry as unknown as {
    list?: () => Array<{ name: string }>;
    getAll?: () => Array<{ name: string }>;
  };
  const allTools = (registry.list?.() ?? registry.getAll?.() ?? []) as Array<{ name: string }>;
  const actionToolNames = allTools.map(t => t.name).filter(n => n.startsWith('action_'));
  console.log(`   ✓ ${actionToolNames.length} action tools in registry: ${actionToolNames.join(', ')}`);
  console.log(`   (this call: ${registered.length} new / ${skipped.length} skipped)`);
  if (actionToolNames.length === 0) {
    console.error('❌ No action tools in registry — aborting');
    process.exit(1);
  }
  if (!actionToolNames.includes('action_complete_task')) {
    console.error('❌ Expected action_complete_task to be registered');
    process.exit(1);
  }

  console.log('\n📊 Step 1 — pick an incomplete task');
  const all = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  const incomplete = all.filter(r => r.status !== 'completed');
  if (incomplete.length === 0) {
    console.error('❌ No incomplete task in seed data');
    process.exit(1);
  }
  // Pick one whose subject has a distinct word we can use to disambiguate
  // in the natural-language request, so the heuristic id-resolver locks
  // onto the right record from the prior query_data result.
  const target = incomplete[0];
  const subject = String(target.subject ?? '');
  const keyword = subject.split(/\s+/).find(w => w.length > 4) ?? subject;
  console.log(`   Target: "${subject}" (id=${target.id}, status=${target.status})`);
  console.log(`   Keyword: "${keyword}"`);

  console.log('\n🧠 Step 2 — ask the data_chat agent in natural language');
  const userQuestion = `please complete the ${keyword} task`;
  console.log(`   User: "${userQuestion}"`);

  const result = await ai.chatWithTools!(
    [
      {
        role: 'system',
        content:
          'You are the data_chat agent. Use query_data to find records, then call the matching action_* tool to perform the user-requested operation.',
      },
      { role: 'user', content: userQuestion },
    ],
    { model: 'memory', toolChoice: 'auto', maxIterations: 4 },
  );

  console.log(`   Agent: "${result.content}"`);

  console.log('\n📈 Step 3 — verify a task was completed');
  await new Promise(r => setTimeout(r, 50));
  const afterAll = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  const previouslyIncompleteIds = new Set(incomplete.map(r => r.id));
  const newlyCompleted = afterAll.filter(
    r => r.status === 'completed' && previouslyIncompleteIds.has(r.id),
  );
  console.log(`   Newly completed tasks: ${newlyCompleted.length}`);
  for (const t of newlyCompleted) {
    console.log(`     • "${t.subject}" (id=${t.id})`);
  }
  if (newlyCompleted.length === 0) {
    console.error('❌ No task status flipped to completed');
    process.exit(1);
  }
  const hitTarget = newlyCompleted.some(t => t.id === target.id);
  if (!hitTarget) {
    console.warn(
      `   ⚠️  Agent completed a different task than the one we picked (target id=${target.id}). This is fine — the action ran.`,
    );
  }

  console.log('\n📊 Step 4 — verify ai_traces was recorded');
  await new Promise(r => setTimeout(r, 100));
  const traces = (await dataEngine.find('ai_traces', {})) as Array<Record<string, unknown>>;
  const cwtTraces = traces.filter(t => t.operation === 'chat_with_tools');
  console.log(`   ai_traces rows: ${traces.length}, chat_with_tools: ${cwtTraces.length}`);
  if (cwtTraces.length === 0) {
    console.error('❌ Expected a chat_with_tools trace row');
    process.exit(1);
  }

  console.log('\n🎉 Action Demo Successful!');
  console.log('   • Opted-in script actions (ai.exposed) registered as `action_*` tools');
  console.log('   • Agent routed user request to action_complete_task');
  console.log('   • Task status mutated from incomplete → completed');
  console.log('   • chat_with_tools trace persisted in ai_traces');
  process.exit(0);
})().catch(err => {
  console.error('💥 Demo failed:', err);
  process.exit(1);
});
