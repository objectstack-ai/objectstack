// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// HITL (Human-In-The-Loop) action-tool integration demo.
//
// Verifies the Phase 3 approval-queue end-to-end against a real
// `defineStack` app and a real ObjectQL data engine:
//
//   1. Plugin starts with `enableActionApproval: true`.
//   2. `delete_completed` (a `variant: 'danger'` script action) gets
//      registered as `action_delete_completed`.
//   3. Invoking that tool returns `{ status: 'pending_approval', ... }`
//      and a row appears in `ai_pending_actions` — without executing.
//   4. Approving via `IAIService.approvePendingAction(id, actorId)`
//      runs the underlying handler — completed tasks disappear from
//      `todo_task` and the row flips to `executed`.
//
// Mirrors `ai-action.test.ts` in style. Drives the tool registry
// directly instead of going through the heuristic LLM adapter, so the
// pass/fail signal is purely about the HITL plumbing rather than the
// memory adapter's verb routing. (A parallel real-LLM smoke test lives
// under `examples/app-todo/test/ai-real-llm.test.ts`.)
//
// Run via: `pnpm --filter @example/app-todo test:hitl`

import { ObjectKernel, DriverPlugin, AppPlugin } from '@objectstack/runtime';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQLPlugin } from '@objectstack/objectql';
import {
  AIServicePlugin,
  MemoryLLMAdapter,
  registerActionsAsTools,
} from '@objectstack/service-ai';
import type { IAIService, IDataEngine } from '@objectstack/spec/contracts';
import TodoApp from '../objectstack.config';
import { Task } from '../src/objects/task.object';
import { registerTaskActionHandlers } from '../src/actions/register-handlers';

(async () => {
  console.log('🛡️  ObjectStack HITL Demo — approval queue for dangerous actions');
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
      // 🔑 Opt into the HITL approval queue. Without this flag, the
      // `delete_completed` action would be silently skipped at
      // registration time.
      enableActionApproval: true,
    }),
  );
  await kernel.use(new AppPlugin(TodoApp));
  await kernel.bootstrap();

  // App-todo registers action handlers via a named onEnable export, but
  // `new AppPlugin(default)` only imports the default. Wire handlers
  // directly against the engine for the test.
  const dataEngine = kernel.getService<IDataEngine>('data');
  if (!dataEngine) throw new Error('data engine not available');
  registerTaskActionHandlers(dataEngine as never);

  const ai = kernel.getService<IAIService>('ai');
  if (!ai) throw new Error('AI service not available');

  // Manual tool wiring (app-todo doesn't load MetadataPlugin).
  const mergedTask = TodoApp.objects?.find(o => o.name === 'todo_task') ?? Task;
  const fakeMetadata = { listObjects: async () => [mergedTask] } as never;
  const aiService = ai as IAIService & {
    toolRegistry: Parameters<typeof registerActionsAsTools>[0];
  };

  const { registered, skipped } = await registerActionsAsTools(
    aiService.toolRegistry,
    {
      metadata: fakeMetadata,
      dataEngine,
      enableActionApproval: true,
      aiService: ai as never,
    },
  );

  const registry = aiService.toolRegistry as unknown as {
    list?: () => Array<{ name: string }>;
    getAll?: () => Array<{ name: string }>;
  };
  const allActionTools = (registry.list?.() ?? registry.getAll?.() ?? [])
    .map(t => t.name)
    .filter(n => n.startsWith('action_'));

  console.log('\n📋 Step 0 — Action tools registered');
  console.log(`   ✓ In registry: ${allActionTools.join(', ') || '(none)'}`);
  console.log(`   (this call: ${registered.length} new / ${skipped.length} skipped)`);
  if (!allActionTools.includes('action_delete_completed')) {
    console.error(
      '❌ Expected action_delete_completed to be registered (variant:danger should opt into HITL when enableActionApproval=true)',
    );
    console.error(`   Skipped reasons: ${JSON.stringify(skipped)}`);
    process.exit(1);
  }

  console.log('\n📊 Step 1 — Snapshot tasks before approval');
  const beforeAll = (await dataEngine.find('todo_task', {})) as Array<Record<string, unknown>>;
  const completedBefore = beforeAll.filter(r => r.status === 'completed');
  console.log(`   Total tasks: ${beforeAll.length}, completed: ${completedBefore.length}`);
  if (completedBefore.length === 0) {
    console.warn(
      '   ⚠️  No completed tasks in seed data — marking the first one completed so the test has something to delete',
    );
    const first = beforeAll[0];
    if (!first) {
      console.error('❌ No tasks at all in seed data');
      process.exit(1);
    }
    await dataEngine.update(
      'todo_task',
      { id: first.id, status: 'completed', completed_date: new Date().toISOString() },
      { where: { id: first.id } },
    );
  }
  const after1 = (await dataEngine.find('todo_task', { where: { status: 'completed' } })) as Array<
    Record<string, unknown>
  >;
  console.log(`   ✓ Completed tasks ready to delete: ${after1.length}`);

  console.log('\n🤖 Step 2 — Simulate LLM picking action_delete_completed');
  const result = await aiService.toolRegistry.execute({
    type: 'tool-call',
    toolCallId: 'hitl-test-1',
    toolName: 'action_delete_completed',
    input: {},
  } as never);
  const envelopeRaw = (result.output as { value: string }).value;
  const envelope = JSON.parse(envelopeRaw);
  console.log(`   Tool returned: ${envelopeRaw}`);

  if (envelope.status !== 'pending_approval') {
    console.error(`❌ Expected status='pending_approval', got '${envelope.status}'`);
    process.exit(1);
  }
  if (!envelope.pendingActionId) {
    console.error('❌ Envelope missing pendingActionId');
    process.exit(1);
  }
  const pendingId = envelope.pendingActionId as string;
  console.log(`   ✓ Pending action enqueued: ${pendingId}`);

  console.log('\n📋 Step 3 — Verify completed tasks are STILL there (action did not run)');
  const stillCompleted = (await dataEngine.find('todo_task', {
    where: { status: 'completed' },
  })) as Array<Record<string, unknown>>;
  console.log(`   Completed tasks still present: ${stillCompleted.length}`);
  if (stillCompleted.length === 0) {
    console.error('❌ Completed tasks were deleted — HITL should have BLOCKED the action');
    process.exit(1);
  }

  console.log('\n🗂️  Step 4 — Pending row in ai_pending_actions');
  const pendingRows = await ai.listPendingActions!({ status: 'pending' });
  console.log(`   Pending rows: ${pendingRows.length}`);
  if (pendingRows.length === 0) {
    console.error('❌ Expected at least one row with status=pending');
    process.exit(1);
  }
  const row = pendingRows.find(r => r.id === pendingId);
  if (!row) {
    console.error(`❌ Could not find pending row with id=${pendingId}`);
    process.exit(1);
  }
  console.log(`   ✓ Row found — object=${row.object_name} action=${row.action_name} proposed_by=${row.proposed_by}`);

  console.log('\n✅ Step 5 — Operator approves');
  const outcome = await ai.approvePendingAction!(pendingId, 'alice@example.com');
  console.log(`   Outcome status: ${outcome.status}`);
  if (outcome.status !== 'executed') {
    console.error(`❌ Expected outcome.status='executed', got '${outcome.status}'`);
    console.error(`   Error: ${outcome.error}`);
    process.exit(1);
  }

  console.log('\n📈 Step 6 — Verify completed tasks are now gone');
  await new Promise(r => setTimeout(r, 50));
  const finalCompleted = (await dataEngine.find('todo_task', {
    where: { status: 'completed' },
  })) as Array<Record<string, unknown>>;
  console.log(`   Completed tasks after approval: ${finalCompleted.length}`);
  if (finalCompleted.length !== 0) {
    console.error('❌ Approval ran but completed tasks were not deleted');
    process.exit(1);
  }

  console.log('\n🗂️  Step 7 — Verify row transitioned to executed');
  const finalRows = await ai.listPendingActions!({});
  const finalRow = finalRows.find(r => r.id === pendingId);
  if (!finalRow) {
    console.error('❌ Row vanished');
    process.exit(1);
  }
  console.log(`   Row status: ${finalRow.status}, decided_by=${finalRow.decided_by}`);
  if (finalRow.status !== 'executed') {
    console.error(`❌ Expected status='executed', got '${finalRow.status}'`);
    process.exit(1);
  }
  if (finalRow.decided_by !== 'alice@example.com') {
    console.error(`❌ Expected decided_by='alice@example.com', got '${finalRow.decided_by}'`);
    process.exit(1);
  }

  console.log('\n🧪 Step 8 — Reject path (sanity check)');
  // Bring back a completed task, propose again, and reject.
  const someTask = (await dataEngine.find('todo_task', { limit: 1 })) as Array<Record<string, unknown>>;
  if (someTask.length > 0) {
    await dataEngine.update(
      'todo_task',
      { id: someTask[0].id, status: 'completed' },
      { where: { id: someTask[0].id } },
    );
    const r2 = await aiService.toolRegistry.execute({
      type: 'tool-call',
      toolCallId: 'hitl-test-2',
      toolName: 'action_delete_completed',
      input: {},
    } as never);
    const env2 = JSON.parse((r2.output as { value: string }).value);
    await ai.rejectPendingAction!(env2.pendingActionId, 'bob@example.com', 'changed my mind');
    const stillThere = (await dataEngine.find('todo_task', {
      where: { status: 'completed' },
    })) as Array<Record<string, unknown>>;
    console.log(`   ✓ After reject — completed tasks: ${stillThere.length} (action did NOT run)`);
    if (stillThere.length === 0) {
      console.error('❌ Reject did not actually block execution');
      process.exit(1);
    }
    const rejectedRows = await ai.listPendingActions!({ status: 'rejected' });
    const rejRow = rejectedRows.find(r => r.id === env2.pendingActionId);
    if (!rejRow || rejRow.rejection_reason !== 'changed my mind') {
      console.error('❌ Reject row missing or rejection_reason wrong');
      process.exit(1);
    }
  }

  console.log('\n🎉 HITL Demo Successful!');
  console.log('   • variant:"danger" action registered as a tool (not skipped)');
  console.log('   • Tool invocation returned {status:"pending_approval"} without executing');
  console.log('   • ai_pending_actions row persisted with proposed_by attribution');
  console.log('   • Approval re-ran the underlying handler — completed tasks deleted');
  console.log('   • Row transitioned pending → executed with decided_by recorded');
  console.log('   • Reject path blocks execution and records rejection_reason');
  process.exit(0);
})().catch(err => {
  console.error('💥 HITL demo failed:', err);
  process.exit(1);
});
