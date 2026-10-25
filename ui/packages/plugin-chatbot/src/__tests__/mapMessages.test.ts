/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for the UIMessage → ChatMessage mappers. These are the
 * single source of truth used by both `useObjectChat` and apps that drive
 * `@ai-sdk/react`'s `useChat()` directly (e.g. Studio's chat panel).
 */
import { describe, it, expect } from 'vitest';
import type { UIMessage } from '@ai-sdk/react';
import {
  uiMessageToChatMessage,
  uiMessagesToChatMessages,
  detectDraftResult,
  detectProposedPlan,
  detectBuilderHandoff,
  buildProgressFromDraftReview,
} from '../mapMessages';

describe('uiMessageToChatMessage', () => {
  it('concatenates text parts and falls back to streaming=false by default', () => {
    const out = uiMessageToChatMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ],
    });
    expect(out).toMatchObject({
      id: 'm1',
      role: 'assistant',
      content: 'Hello world',
    });
    expect(out.streaming).toBeUndefined();
  });

  it('extracts reasoning parts into the `reasoning` field', () => {
    const out = uiMessageToChatMessage({
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Thinking step 1.' },
        { type: 'text', text: 'Answer.' },
      ],
    });
    expect(out.content).toBe('Answer.');
    expect(out.reasoning).toContain('Thinking step 1.');
  });

  it('extracts tool-* parts into ChatToolInvocation entries', () => {
    const out = uiMessageToChatMessage({
      id: 'm3',
      role: 'assistant',
      parts: [
        {
          type: 'tool-listUsers',
          toolCallId: 'call_1',
          state: 'output-available',
          input: { limit: 5 },
          output: { users: [] },
        },
      ],
    });
    expect(out.toolInvocations).toHaveLength(1);
    expect(out.toolInvocations?.[0]).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'listUsers',
      state: 'output-available',
    });
  });

  it('promotes a stale input-available state to output-available when an output is present (reloaded conversations)', () => {
    // A conversation persisted mid-stream can carry `input-available` next to a
    // present output (the terminal state was never snapshotted) — without the
    // promotion a reloaded chat shows "Running" forever on a finished build.
    const out = uiMessageToChatMessage({
      id: 'm-reload',
      role: 'assistant',
      parts: [
        {
          type: 'tool-apply_blueprint',
          toolCallId: 'call_b',
          state: 'input-available',
          input: { blueprint: {} },
          output: { status: 'drafted', drafted: [{ type: 'object', name: 'job' }] },
        },
      ],
    });
    expect(out.toolInvocations?.[0]?.state).toBe('output-available');
  });

  it('keeps input-available when there is genuinely no output yet AND this is the live streaming tail', () => {
    const out = uiMessageToChatMessage(
      {
        id: 'm-live',
        role: 'assistant',
        parts: [
          { type: 'tool-apply_blueprint', toolCallId: 'call_c', state: 'input-available', input: {} },
        ],
      },
      { streaming: true },
    );
    expect(out.toolInvocations?.[0]?.state).toBe('input-available');
  });

  it('promotes a dangling input-available to Completed on a NON-streaming (historical) message, even without an output', () => {
    // The real staging incident: a reloaded build conversation showed every
    // tool stuck on "Running" because the server never snapshotted terminal
    // tool states. A tool in a turn that has ENDED cannot still be running.
    const out = uiMessageToChatMessage({
      id: 'm-history',
      role: 'assistant',
      parts: [
        { type: 'tool-add_field', toolCallId: 'call_d', state: 'input-available', input: {} },
        { type: 'tool-verify_build', toolCallId: 'call_e', state: 'input-streaming', input: {} },
      ],
    });
    expect(out.toolInvocations?.[0]?.state).toBe('output-available');
    expect(out.toolInvocations?.[1]?.state).toBe('output-available');
  });

  it('uiMessagesToChatMessages: only the streaming tail keeps a tool Running; prior messages terminalize', () => {
    const msgs: UIMessage[] = [
      {
        id: 'm-prior',
        role: 'assistant',
        parts: [{ type: 'tool-create_object', toolCallId: 'c1', state: 'input-available', input: {} }],
      },
      {
        id: 'm-tail',
        role: 'assistant',
        parts: [{ type: 'tool-add_field', toolCallId: 'c2', state: 'input-available', input: {} }],
      },
    ];
    const out = uiMessagesToChatMessages(msgs, { isStreaming: true });
    expect(out[0].toolInvocations?.[0]?.state).toBe('output-available'); // prior turn → terminalized
    expect(out[1].toolInvocations?.[0]?.state).toBe('input-available');  // live tail → still Running
  });

  it('preserves legacy msg.toolInvocations when no tool-* parts are present', () => {
    const out = uiMessageToChatMessage({
      id: 'm4',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
      toolInvocations: [
        // "legacy" in this case's name is the top-level `msg.toolInvocations`
        // array (as opposed to `parts: [tool-*]`), which is what the case pins.
        // The STATE spelling was separately stale: `'result'` is the AI SDK v4
        // name, `ChatToolInvocation.state` is documented as the v6 lifecycle and
        // admits only `output-available` for it. Nothing in `mapMessages.ts`
        // branches on the value — line 642 passes the array through verbatim —
        // so this is the fixture catching up with the dialect, not the assertion
        // weakening (objectui#4040).
        { toolCallId: 'legacy', toolName: 'foo', state: 'output-available', result: {} },
      ],
    });
    expect(out.toolInvocations).toHaveLength(1);
    expect(out.toolInvocations?.[0]).toMatchObject({ toolCallId: 'legacy' });
  });

  it('honours opts.streaming', () => {
    const out = uiMessageToChatMessage(
      { id: 'm5', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      { streaming: true },
    );
    expect(out.streaming).toBe(true);
  });

  it('lifts a reconciled data-build-progress part into buildProgress', () => {
    const out = uiMessageToChatMessage({
      id: 'm6',
      role: 'assistant',
      parts: [
        {
          type: 'data-build-progress',
          id: 'build-progress',
          data: {
            phase: 'data',
            appLabel: 'CRM',
            items: [{ type: 'object', name: 'customer' }, { type: 'view', name: 'customer.list' }],
            done: 2,
            total: 6,
          },
        },
      ],
    });
    expect(out.buildProgress).toEqual({
      phase: 'data',
      appLabel: 'CRM',
      items: [{ type: 'object', name: 'customer' }, { type: 'view', name: 'customer.list' }],
      done: 2,
      total: 6,
    });
  });

  it('leaves buildProgress undefined when there is no build-progress part', () => {
    const out = uiMessageToChatMessage({ id: 'm7', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] });
    expect(out.buildProgress).toBeUndefined();
  });

  it('lifts a reconciled data-blueprint-progress part into blueprintProgress', () => {
    const out = uiMessageToChatMessage({
      id: 'mbp1',
      role: 'assistant',
      parts: [
        {
          type: 'data-blueprint-progress',
          id: 'blueprint-progress',
          data: {
            phase: 'designing',
            summary: '招聘管理系统',
            appLabel: '招聘管理',
            objects: [
              { name: 'candidate', label: '候选人', fields: 5 },
              { name: 'job', label: '职位', fields: 4 },
            ],
            counts: { objects: 2, views: 2, dashboards: 1 },
            seq: 7,
          },
        },
      ],
    });
    expect(out.blueprintProgress).toEqual({
      phase: 'designing',
      summary: '招聘管理系统',
      appLabel: '招聘管理',
      objects: [
        { name: 'candidate', label: '候选人', fields: 5 },
        { name: 'job', label: '职位', fields: 4 },
      ],
      counts: { objects: 2, views: 2, dashboards: 1 },
      seq: 7,
    });
  });

  it('reconciles to the latest data-blueprint-progress frame (objects appear one by one)', () => {
    // The SDK keeps a single reconciled part per stable id; given two frames we
    // take the most recent — the one with more objects revealed + higher seq.
    const out = uiMessageToChatMessage({
      id: 'mbp2',
      role: 'assistant',
      parts: [
        {
          type: 'data-blueprint-progress',
          id: 'blueprint-progress',
          data: { phase: 'designing', objects: [{ name: 'candidate' }], seq: 1 },
        },
        {
          type: 'data-blueprint-progress',
          id: 'blueprint-progress',
          data: {
            phase: 'designing',
            objects: [{ name: 'candidate' }, { name: 'job' }],
            seq: 2,
          },
        },
      ],
    });
    expect(out.blueprintProgress?.objects).toHaveLength(2);
    expect(out.blueprintProgress?.seq).toBe(2);
  });

  it('maps phase:done with the extend target and drops malformed objects/fields', () => {
    const out = uiMessageToChatMessage({
      id: 'mbp3',
      role: 'assistant',
      parts: [
        {
          type: 'data-blueprint-progress',
          id: 'blueprint-progress',
          data: {
            phase: 'done',
            targetApp: 'recruiting',
            objects: [
              { name: 'candidate' },
              { label: 'no name — dropped' },
              { name: 'job', fields: 'not-a-number' },
            ],
          },
        },
      ],
    });
    expect(out.blueprintProgress?.phase).toBe('done');
    expect(out.blueprintProgress?.targetApp).toBe('recruiting');
    // Nameless object dropped; non-numeric `fields` omitted (chip shows no "· N").
    expect(out.blueprintProgress?.objects).toEqual([{ name: 'candidate' }, { name: 'job' }]);
  });

  it('defaults an unknown/absent phase to designing and tolerates a missing objects array', () => {
    const out = uiMessageToChatMessage({
      id: 'mbp4',
      role: 'assistant',
      parts: [
        { type: 'data-blueprint-progress', id: 'blueprint-progress', data: { summary: 'CRM' } },
      ],
    });
    expect(out.blueprintProgress?.phase).toBe('designing');
    expect(out.blueprintProgress?.objects).toEqual([]);
    expect(out.blueprintProgress?.summary).toBe('CRM');
  });

  it('drops counts entirely when none of its numeric fields are present', () => {
    const out = uiMessageToChatMessage({
      id: 'mbp5',
      role: 'assistant',
      parts: [
        {
          type: 'data-blueprint-progress',
          id: 'blueprint-progress',
          data: { phase: 'designing', objects: [], counts: { objects: 'x' } },
        },
      ],
    });
    expect(out.blueprintProgress?.counts).toBeUndefined();
  });

  it('leaves blueprintProgress undefined when there is no blueprint-progress part', () => {
    const out = uiMessageToChatMessage({
      id: 'mbp6',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
    });
    expect(out.blueprintProgress).toBeUndefined();
  });

  it('lifts data-chart parts into charts[] (visualize_data)', () => {
    const out = uiMessageToChatMessage({
      id: 'm8',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here is the breakdown:' },
        {
          type: 'data-chart',
          id: 'chart-0',
          data: {
            type: 'chart',
            chartType: 'bar',
            title: 'Deals by status',
            xAxisKey: 'status',
            series: [{ dataKey: 'count', label: 'Count' }],
            data: [
              { status: 'won', count: 5 },
              { status: 'lost', count: 2 },
            ],
          },
        },
      ],
    });
    expect(out.content).toBe('Here is the breakdown:');
    expect(out.charts).toHaveLength(1);
    expect(out.charts?.[0]).toEqual({
      chartType: 'bar',
      title: 'Deals by status',
      xAxisKey: 'status',
      series: [{ dataKey: 'count', label: 'Count' }],
      data: [
        { status: 'won', count: 5 },
        { status: 'lost', count: 2 },
      ],
      // objectui#13492 — the chart arrived after the whole text.
      textOffset: 'Here is the breakdown:'.length,
    });
  });

  it('keeps multiple data-chart parts in arrival order and drops series-less payloads', () => {
    const out = uiMessageToChatMessage({
      id: 'm9',
      role: 'assistant',
      parts: [
        { type: 'data-chart', id: 'c0', data: { type: 'chart', chartType: 'pie', series: [{ dataKey: 'count' }], data: [] } },
        { type: 'data-chart', id: 'c1', data: { type: 'chart', series: [], data: [] } }, // unrenderable → dropped
        { type: 'data-chart', id: 'c2', data: { type: 'chart', chartType: 'line', series: [{ dataKey: 'total' }], data: [] } },
      ],
    });
    expect(out.charts).toHaveLength(2);
    expect(out.charts?.map((c) => c.chartType)).toEqual(['pie', 'line']);
  });

  it('leaves charts undefined when there is no data-chart part', () => {
    const out = uiMessageToChatMessage({ id: 'm10', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] });
    expect(out.charts).toBeUndefined();
  });
});

// ADR-0033 Phase B — the chat lifts draft envelopes onto the invocation so a
// "Review N change(s)" affordance can open the designer's review/diff.
describe('draftReview detection (ADR-0033)', () => {
  const toolPart = (output: unknown) => ({
    type: 'tool-create_metadata',
    toolCallId: 'd1',
    state: 'output-available' as const,
    input: {},
    output,
  });
  const draftReviewOf = (output: unknown) =>
    uiMessageToChatMessage({ id: 'm', role: 'assistant', parts: [toolPart(output)] })
      .toolInvocations?.[0]?.draftReview;

  it('lifts a single drafted item ({status:drafted, type, name})', () => {
    const dr = draftReviewOf({ status: 'drafted', type: 'object', name: 'project', summary: 'Drafted new object "project"' });
    expect(dr).toEqual({ items: [{ type: 'object', name: 'project' }], summary: 'Drafted new object "project"' });
  });

  it('lifts a batch from apply_blueprint ({status:drafted, drafted:[…]})', () => {
    const dr = draftReviewOf({
      status: 'drafted',
      drafted: [
        { type: 'object', name: 'project' },
        { type: 'view', name: 'open_tasks' },
      ],
      failed: [],
      summary: 'drafted 2 artifact(s)',
    });
    expect(dr?.items).toEqual([
      { type: 'object', name: 'project' },
      { type: 'view', name: 'open_tasks' },
    ]);
  });

  it('parses the Vercel `{ type:text, value }` wrapper (stringified JSON)', () => {
    const dr = draftReviewOf({ type: 'text', value: JSON.stringify({ status: 'drafted', type: 'view', name: 'grid_v' }) });
    expect(dr?.items).toEqual([{ type: 'view', name: 'grid_v' }]);
  });

  it('lifts apply_blueprint nextSteps for the getting-started checklist (drops blanks)', () => {
    const dr = draftReviewOf({
      status: 'drafted',
      drafted: [{ type: 'app', name: 'recruiting' }],
      summary: 'built 13 artifact(s)',
      nextSteps: ['Make the data yours', '', '   ', 'Publish from the status panel'],
    });
    expect(dr?.nextSteps).toEqual(['Make the data yours', 'Publish from the status panel']);
  });

  it('omits nextSteps when absent or not a string array', () => {
    expect(draftReviewOf({ status: 'drafted', type: 'object', name: 'x' })?.nextSteps).toBeUndefined();
    expect(draftReviewOf({ status: 'drafted', type: 'object', name: 'x', nextSteps: 'nope' })?.nextSteps).toBeUndefined();
  });

  it('does NOT surface blueprint_proposed (no draft yet) or plain results', () => {
    expect(draftReviewOf({ status: 'blueprint_proposed', counts: { objects: 3 } })).toBeUndefined();
    expect(draftReviewOf({ users: [] })).toBeUndefined();
    expect(draftReviewOf({ status: 'drafted' })).toBeUndefined(); // no type/name → no target
  });

  it('lifts ADR-0038 lint issues (message + fix) alongside the verification counts', () => {
    const dr = draftReviewOf({
      status: 'drafted',
      type: 'object',
      name: 'book',
      summary: 'Drafted new object "book"',
      verification: { errors: 1, warnings: 1 },
      issues: [
        {
          layer: 'graph',
          severity: 'error',
          artifact: { type: 'object', name: 'book' },
          code: 'select_without_options',
          message: 'genre is a required select with no options',
          fix: 'Add an options array.',
        },
        { severity: 'warning', code: 'unknown_column', message: 'author renders empty' },
        { code: 'no_message_dropped' }, // malformed → must be dropped
      ],
    });
    expect(dr?.verification).toEqual({ errors: 1, warnings: 1 });
    expect(dr?.issues).toEqual([
      {
        severity: 'error',
        code: 'select_without_options',
        message: 'genre is a required select with no options',
        fix: 'Add an options array.',
      },
      { severity: 'warning', code: 'unknown_column', message: 'author renders empty' },
    ]);
  });

  it('omits the issues key entirely when there are none (no envelope churn)', () => {
    const dr = draftReviewOf({ status: 'drafted', type: 'view', name: 'grid_v' });
    expect(dr).toEqual({ items: [{ type: 'view', name: 'grid_v' }] });
  });
});

// propose_blueprint returns a PLAN before anything is staged. The chat surfaces
// it as a reviewable "Proposed plan" card (the confirm gate), so detection must
// lift the objects, counts, assumptions, and structure-deciding questions.
describe('proposedPlan detection (propose_blueprint)', () => {
  const fullEnvelope = {
    status: 'blueprint_proposed',
    summary: 'A lightweight applicant tracker',
    counts: { objects: 2, views: 3, dashboards: 1, seedData: 2 },
    questions: ['Track interviews as a separate object, or as a stage field?'],
    blueprint: {
      summary: 'A lightweight applicant tracker',
      assumptions: ['One pipeline for all roles', 'No external job-board sync'],
      objects: [
        { name: 'candidate', label: 'Candidate', fields: [{ name: 'full_name' }, { name: 'stage' }] },
        { name: 'job', label: 'Job', fields: [{ name: 'title' }] },
      ],
      views: [{ name: 'pipeline' }, { name: 'all' }, { name: 'archived' }],
      questions: ['ignored — envelope questions win'],
    },
  };

  it('lifts the plan shape (objects, counts, assumptions, questions) from the envelope', () => {
    const plan = detectProposedPlan(fullEnvelope);
    expect(plan).toEqual({
      summary: 'A lightweight applicant tracker',
      objects: [
        {
          name: 'candidate',
          label: 'Candidate',
          fieldCount: 2,
          fields: [{ name: 'full_name' }, { name: 'stage' }],
        },
        { name: 'job', label: 'Job', fieldCount: 1, fields: [{ name: 'title' }] },
      ],
      views: [{ name: 'pipeline' }, { name: 'all' }, { name: 'archived' }],
      counts: { objects: 2, views: 3, dashboards: 1, seedData: 2 },
      questions: ['Track interviews as a separate object, or as a stage field?'],
      assumptions: ['One pipeline for all roles', 'No external job-board sync'],
    });
  });

  it('parses a JSON-string result (what the tool actually returns) and wires onto the tool invocation', () => {
    const msg = uiMessageToChatMessage({
      id: 'm',
      role: 'assistant',
      parts: [
        {
          type: 'tool-propose_blueprint',
          toolCallId: 'p1',
          state: 'output-available' as const,
          input: {},
          output: JSON.stringify(fullEnvelope),
        },
      ],
    });
    expect(msg.toolInvocations?.[0]?.proposedPlan?.objects).toEqual([
      {
        name: 'candidate',
        label: 'Candidate',
        fieldCount: 2,
        fields: [{ name: 'full_name' }, { name: 'stage' }],
      },
      { name: 'job', label: 'Job', fieldCount: 1, fields: [{ name: 'title' }] },
    ]);
  });

  it('derives counts from the blueprint when the envelope omits them, and drops malformed objects', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      blueprint: {
        objects: [
          { name: 'task', fields: [{ name: 'title' }] },
          { label: 'no name → dropped' },
          { name: 'note' }, // no fields → fieldCount 0
        ],
        views: [{ name: 'board' }],
      },
    });
    expect(plan?.objects).toEqual([
      { name: 'task', fieldCount: 1, fields: [{ name: 'title' }] },
      { name: 'note', fieldCount: 0 },
    ]);
    expect(plan?.counts).toEqual({ objects: 2, views: 1, dashboards: 0, seedData: 0 });
    expect(plan?.questions).toEqual([]);
    expect(plan?.assumptions).toEqual([]);
  });

  // objectui#12724 — the plan card v2 rows, from what the spec's
  // `SolutionBlueprintSchema` declares and nothing else: each field's and
  // view's `name` + `label`, and `app.label`.
  it('lifts field and view names + labels and the app label (objectui#12724)', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      blueprint: {
        app: { name: 'library_app', label: '图书借阅管理' },
        objects: [
          {
            name: 'book',
            label: '图书',
            fields: [
              { name: 'title', label: '书名', type: 'text' },
              { name: 'isbn', type: 'text' },
              { label: 'no name → dropped' },
              null,
            ],
          },
        ],
        views: [{ name: 'loan_board', label: '借阅看板', type: 'kanban', groupBy: 'status' }, { type: 'list' }],
      },
    });
    expect(plan?.appLabel).toBe('图书借阅管理');
    expect(plan?.objects[0]).toEqual({
      name: 'book',
      label: '图书',
      fieldCount: 4,
      fields: [{ name: 'title', label: '书名' }, { name: 'isbn' }],
    });
    expect(plan?.views).toEqual([{ name: 'loan_board', label: '借阅看板' }]);
  });

  it('a count-only fields array (the cache-fallback copy) lifts no field rows (objectui#12724)', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      blueprint: { objects: [{ name: 'book', fields: [null, null, null] }] },
    });
    expect(plan?.objects).toEqual([{ name: 'book', fieldCount: 3 }]);
    expect(plan?.views).toBeUndefined();
    expect(plan?.appLabel).toBeUndefined();
  });

  it('surfaces the extend-mode targetApp', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      targetApp: 'recruiting',
      blueprint: { objects: [{ name: 'offer', fields: [] }] },
    });
    expect(plan?.targetApp).toBe('recruiting');
  });

  it('returns undefined for non-proposal statuses and proposals with no nameable objects', () => {
    expect(detectProposedPlan({ status: 'drafted', type: 'object', name: 'x' })).toBeUndefined();
    expect(detectProposedPlan({ status: 'blueprint_proposed', blueprint: { objects: [] } })).toBeUndefined();
    expect(detectProposedPlan({ status: 'blueprint_proposed' })).toBeUndefined();
    expect(detectProposedPlan({ foo: 1 })).toBeUndefined();
  });

  it('lifts well-formed questionChoices and drops malformed / <2-option ones', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      blueprint: { objects: [{ name: 'book', fields: [] }] },
      questions: ['Track loans separately?', 'Star ratings or 1-10?'],
      questionChoices: [
        { text: 'Track loans separately?', options: ['Separate object', 'Status field'] },
        { text: 'Star ratings or 1-10?', options: ['only one'] }, // <2 → dropped
        { text: '', options: ['a', 'b'] }, // no text → dropped
        { options: ['a', 'b'] }, // no text → dropped
      ],
    });
    expect(plan?.questionChoices).toEqual([
      { text: 'Track loans separately?', options: ['Separate object', 'Status field'] },
    ]);
  });

  it('omits questionChoices entirely when absent or not an array', () => {
    const plan = detectProposedPlan({
      status: 'blueprint_proposed',
      blueprint: { objects: [{ name: 'book', fields: [] }] },
      questions: ['Q?'],
    });
    expect(plan?.questionChoices).toBeUndefined();
  });
});

describe('builderHandoff detection (ADR-0057 P4 — suggest_builder)', () => {
  it('lifts the { status:build_handoff, prompt, packageId } envelope', () => {
    const h = detectBuilderHandoff({
      status: 'build_handoff',
      handoff: 'build',
      prompt: 'Add a priority field to tasks',
      packageId: 'com.acme.crm',
    });
    expect(h).toEqual({ prompt: 'Add a priority field to tasks', packageId: 'com.acme.crm' });
  });

  it('parses a JSON-string result and the Vercel { type:text, value } wrapper', () => {
    const json = JSON.stringify({ status: 'build_handoff', prompt: 'Build a CRM' });
    expect(detectBuilderHandoff(json)).toEqual({ prompt: 'Build a CRM' });
    expect(detectBuilderHandoff({ type: 'text', value: json })).toEqual({ prompt: 'Build a CRM' });
  });

  it('omits packageId when absent/blank and trims the prompt', () => {
    expect(detectBuilderHandoff({ status: 'build_handoff', prompt: '  hi  ' })).toEqual({ prompt: 'hi' });
    expect(detectBuilderHandoff({ status: 'build_handoff', prompt: 'x', packageId: '  ' })).toEqual({ prompt: 'x' });
  });

  it('ignores non-handoff results and an empty prompt', () => {
    expect(detectBuilderHandoff({ status: 'blueprint_proposed' })).toBeUndefined();
    expect(detectBuilderHandoff({ status: 'build_handoff', prompt: '   ' })).toBeUndefined();
    expect(detectBuilderHandoff({ foo: 1 })).toBeUndefined();
    expect(detectBuilderHandoff(undefined)).toBeUndefined();
  });

  it('attaches builderHandoff to the mapped tool invocation', () => {
    const [msg] = uiMessagesToChatMessages([
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-suggest_builder',
            toolCallId: 't1',
            state: 'output-available',
            output: { status: 'build_handoff', prompt: 'Add a field', packageId: 'p.kg' },
          },
        ],
      },
    ] as never);
    expect(msg.toolInvocations?.[0]?.builderHandoff).toEqual({ prompt: 'Add a field', packageId: 'p.kg' });
  });
});

describe('uiMessagesToChatMessages', () => {
  it('returns [] for empty / non-array input', () => {
    expect(uiMessagesToChatMessages([])).toEqual([]);
    expect(uiMessagesToChatMessages(undefined as never)).toEqual([]);
  });

  it('only flags the trailing assistant message as streaming when isStreaming=true', () => {
    const out = uiMessagesToChatMessages(
      [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
        { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'how can I help' }] },
      ],
      { isStreaming: true },
    );
    expect(out.map((m) => Boolean(m.streaming))).toEqual([false, false, true]);
  });

  it('does not flag streaming when the last message is a user turn', () => {
    const out = uiMessagesToChatMessages(
      [
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'a follow-up' }] },
      ],
      { isStreaming: true },
    );
    expect(out.map((m) => Boolean(m.streaming))).toEqual([false, false]);
  });

  it('omits streaming flag entirely when isStreaming is false', () => {
    const out = uiMessagesToChatMessages(
      [{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }],
      { isStreaming: false },
    );
    expect(out[0]?.streaming).toBeFalsy();
  });
});

// Refresh-survival (the user-reported bug): the live `data-build-progress` parts
// are transient and never persisted, so a reloaded whole-app build lost its
// "Built X" panel + Open/Preview affordances. We reconstruct a completed summary
// from the apply_blueprint draft envelope, which IS persisted on the tool result.
describe('buildProgressFromDraftReview (reload synthesis)', () => {
  it('synthesizes a done panel from a whole-app draft (includes an app item)', () => {
    const bp = buildProgressFromDraftReview({
      items: [
        { type: 'object', name: 'expense' },
        { type: 'view', name: 'expense.list' },
        { type: 'app', name: 'expense_tracker' },
      ],
      packageId: 'com.workspace',
    });
    expect(bp).toEqual({
      phase: 'done',
      appLabel: 'Expense Tracker',
      items: [
        { type: 'object', name: 'expense' },
        { type: 'view', name: 'expense.list' },
        { type: 'app', name: 'expense_tracker' },
      ],
      done: 3,
      total: 3,
    });
  });

  it('returns undefined for an incremental edit (no app item) — keeps the draft card but no build tree', () => {
    expect(
      buildProgressFromDraftReview({ items: [{ type: 'field', name: 'expense.payment_method' }] }),
    ).toBeUndefined();
  });

  it('returns undefined for empty / missing input', () => {
    expect(buildProgressFromDraftReview(undefined)).toBeUndefined();
    expect(buildProgressFromDraftReview({ items: [] })).toBeUndefined();
  });

  it('uiMessageToChatMessage reconstructs buildProgress from a persisted apply_blueprint result (no live build-progress part)', () => {
    const out = uiMessageToChatMessage({
      id: 'm-reload-build',
      role: 'assistant',
      parts: [
        {
          type: 'tool-apply_blueprint',
          toolCallId: 'call_reload',
          state: 'output-available',
          input: { blueprint: {} },
          // The persisted ModelMessage result merged back onto the call part —
          // no `data-build-progress` part exists after reload.
          output: {
            status: 'drafted',
            drafted: [
              { type: 'object', name: 'expense' },
              { type: 'app', name: 'expense_tracker' },
            ],
            packageId: 'com.workspace',
            materialized: true,
          },
        },
      ],
    });
    expect(out.buildProgress).toMatchObject({ phase: 'done', appLabel: 'Expense Tracker', done: 2, total: 2 });
    // and the draft affordances survive too
    expect(out.toolInvocations?.[0]?.draftReview?.packageId).toBe('com.workspace');
  });

  it('does NOT override a live data-build-progress part with the synthesized summary', () => {
    const out = uiMessageToChatMessage({
      id: 'm-live-build',
      role: 'assistant',
      parts: [
        {
          type: 'data-build-progress',
          id: 'build-progress',
          data: { phase: 'data', appLabel: 'Live', items: [{ type: 'object', name: 'x' }], done: 1, total: 4 },
        },
        {
          type: 'tool-apply_blueprint',
          toolCallId: 'call_live',
          state: 'output-available',
          input: {},
          output: { status: 'drafted', drafted: [{ type: 'app', name: 'x_app' }], packageId: 'p' },
        },
      ],
    });
    // live progress wins (phase 'data', not the synthesized 'done')
    expect(out.buildProgress).toMatchObject({ phase: 'data', appLabel: 'Live', done: 1, total: 4 });
  });
});

describe('detectDraftResult is exported for shared hydration', () => {
  it('parses a batch envelope into items', () => {
    expect(detectDraftResult({ status: 'drafted', drafted: [{ type: 'app', name: 'a' }] })?.items).toEqual([
      { type: 'app', name: 'a' },
    ]);
  });
});
