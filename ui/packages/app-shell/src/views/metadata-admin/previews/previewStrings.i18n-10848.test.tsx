// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10848 — the designer preview chrome that still rendered English
 * under zh-CN after objectui#10835.
 *
 * - `PreviewErrorBoundary`'s heading, shown by every designer preview's error
 *   boundary. It reads the designer locale through `useMetadataLocale()`, so a
 *   boundary whose caller passes no locale reads it too.
 * - `ScreenPreview`'s own words: the header, the empty state, the disabled
 *   Submit button, the no-backend note and the hidden-field note. Both homes
 *   pass the locale they already hold: the flow node inspector and the Debug
 *   run's paused screen.
 * - The frames `flow-sim-validate` puts around a CEL failure on a step or an
 *   out-edge, and the fallback when the producer gives no message.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The objectui#10748 / objectui#10804 / objectui#10835 harness: every case
 * reads the RENDERED text of the real component. Each zh expectation is read
 * back from the catalogue and guarded by `zhRow`, so no case passes on a
 * missing row and none restates a translation. Each en case reads the en row
 * through `t` / `tFormat` for `en-US` rather than pin the wording.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * On the same mount, a word that already rendered in zh before this change:
 * the flow preview's error-boundary hint, the Debug run's Screen heading and
 * its out-edge error result, and the flow node inspector's kind label.
 *
 * ── Left as written on purpose ───────────────────────────────────────────────
 * The producer's text inside a CEL frame is `@objectstack/formula`'s own
 * (objectstack-ai/objectstack#20291 gives it a code); the cases read it from
 * the producer and expect it verbatim in every locale. The error a preview
 * threw, a screen's field labels, node labels and CEL sources are author or
 * producer data and read the same in every locale.
 *
 * `FlowCanvas` is a stand-in that can throw, which is how the flow preview's
 * error boundary is shown. `ExpressionEngine.evaluate` delegates to the real
 * engine except for one source, `boom == 1`, where it throws an error with no
 * message: the only way the evaluators reach their fallback.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ExpressionEngine } from '@objectstack/formula';

const state = vi.hoisted(() => ({
  canvas: 'draw' as 'draw' | 'throw',
  adapter: { fake: 'adapter' } as unknown,
  metadataClient: {
    get: async () => undefined,
    list: async (): Promise<unknown[]> => [],
    listDrafts: async (): Promise<unknown[]> => [],
  },
}));

vi.mock('@objectstack/formula', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@objectstack/formula')>();
  const engine = Object.create(mod.ExpressionEngine) as typeof mod.ExpressionEngine;
  engine.evaluate = ((input: { source?: string }, ctx: unknown) => {
    if (input?.source === 'boom == 1') throw new Error('');
    return mod.ExpressionEngine.evaluate(input as never, ctx as never);
  }) as typeof mod.ExpressionEngine.evaluate;
  return { ...mod, ExpressionEngine: engine };
});

vi.mock('./FlowCanvas', () => ({
  FlowCanvas: () => {
    if (state.canvas === 'throw') throw new Error('edge "e9" names no node');
    return <div data-testid="flow-canvas" />;
  },
}));

// `ScreenPreview` reads both.
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => state.adapter,
}));
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));
// The flow node inspector's rosters and config schemas: nothing here needs one.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('./useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { t, tFormat } from '../i18n';
import { PreviewErrorBoundary } from './PreviewShell';
import { FlowPreview } from './FlowPreview';
import { ScreenPreview } from './ScreenPreview';
import { FlowSimulatorPanel } from './FlowSimulatorPanel';
import { FlowNodeInspector } from '../inspectors/FlowNodeInspector';
import type { SimEdge, SimNode } from './simulator/flow-sim-types';

afterEach(() => {
  cleanup();
  state.canvas = 'draw';
  state.adapter = { fake: 'adapter' };
  vi.restoreAllMocks();
});

type Lang = 'en' | 'zh';
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** Let mount-time effects and resolved fetches settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/**
 * The row `key` in `lang`, formatted with `vars`, UNGUARDED: a case compares
 * the rendered text to it first and guards the zh rows after, so a red run
 * shows the text the site rendered rather than the guard's message.
 */
function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

// ─── Site 1: PreviewErrorBoundary's heading ──────────────────────────────────

/** The boundary's message box: its heading, the thrown error's text and the caller's hint. */
function boundary() {
  const box = document.body.querySelector('div.m-4 div.flex-1');
  return {
    heading: box?.querySelector('div.font-medium')?.textContent ?? null,
    error: box?.querySelector('div.font-mono')?.textContent ?? null,
    hint: box?.querySelector('div.mt-2')?.textContent ?? null,
  };
}

const FLOW_DRAFT = {
  name: 'intake',
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'end', type: 'end' },
  ],
  edges: [{ id: 'e0', source: 'start', target: 'end' }],
};

function Thrower(): React.ReactElement {
  throw new Error('widget "w1" names no object');
}

describe('PreviewErrorBoundary — the heading (objectui#10848)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the flow preview's boundary reads engine.previewShell.renderFailed beside its hint; the thrown text shows as written`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      state.canvas = 'throw';
      inLang(lang, <FlowPreview type="flow" name="intake" draft={FLOW_DRAFT} locale={LOCALE[lang]} />);
      await flush();
      expect(boundary()).toEqual({
        heading: row(lang, 'engine.previewShell.renderFailed'),
        error: 'edge "e9" names no node',
        // Lit control: the hint read its row before this change.
        hint: row(lang, 'engine.flowPreview.malformed'),
      });
      if (lang === 'zh') for (const k of ['engine.previewShell.renderFailed', 'engine.flowPreview.malformed']) zhRow(k);
    });

    it(`${lang}: a boundary whose caller passes no locale and no hint reads the heading in the designer language`, () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      inLang(lang, <PreviewErrorBoundary><Thrower /></PreviewErrorBoundary>);
      expect(boundary()).toEqual({
        heading: row(lang, 'engine.previewShell.renderFailed'),
        error: 'widget "w1" names no object',
        hint: null,
      });
      if (lang === 'zh') zhRow('engine.previewShell.renderFailed');
    });
  }
});

// ─── Site 2: ScreenPreview's own words ───────────────────────────────────────

/** The last `ScreenPreview` on the page: its header, and its body element. */
function screenPreview() {
  const headers = document.body.querySelectorAll('div.border-b.uppercase.tracking-wide');
  const header = headers[headers.length - 1] ?? null;
  const body = header?.nextElementSibling ?? null;
  return {
    header: header?.textContent ?? null,
    body,
    submit: body?.querySelector('div.mt-4.justify-end button') ?? null,
    hiddenNote: body?.querySelector('p.mt-3.italic')?.textContent ?? null,
    noDataSource: body?.querySelector('div.text-destructive')?.textContent ?? null,
  };
}

type Flow = { nodes: SimNode[]; edges: SimEdge[] };

const linear = (...nodes: SimNode[]): Flow => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
});
const START: SimNode = { id: 'start', type: 'start', label: 'Start' };
const END: SimNode = { id: 'end', type: 'end', label: 'End' };

interface TimelineRow {
  label: string | null;
  status: string | null;
  note: string | null;
  error: string | null;
  /** Each out-edge row: its condition text and its result. */
  edges: Array<[string | null, string | null]>;
}

/** Mount the Debug panel on `flow`, press Run, and read the timeline. */
function runFlow(lang: Lang, flow: Flow): TimelineRow[] {
  inLang(lang, <FlowSimulatorPanel nodes={flow.nodes} edges={flow.edges} variables={[]} locale={LOCALE[lang]} />);
  fireEvent.click(screen.getByRole('button', { name: row(lang, 'engine.flowSim.run') }));
  const heading = screen.getByText(row(lang, 'engine.flowSim.timeline'));
  const list = heading.parentElement!.querySelector('ol')!;
  return Array.from(list.children).map((li) => {
    const [header, ...rest] = Array.from(li.children);
    const spans = header.querySelectorAll('span');
    const div = (cls: string) => rest.find((c) => c.tagName === 'DIV' && c.classList.contains(cls))?.textContent ?? null;
    return {
      label: header.querySelector('span.font-medium')?.textContent ?? null,
      status: spans[spans.length - 1]?.textContent ?? null,
      note: div('text-muted-foreground'),
      error: div('text-rose-600'),
      edges: Array.from(li.querySelectorAll('ul > li > div.font-mono')).map((d) => {
        const cells = d.querySelectorAll('span');
        return [cells[1]?.textContent ?? null, cells[2]?.textContent ?? null];
      }),
    };
  });
}

const SCREEN_INPUT_FLOW = linear(
  START,
  { id: 'form', type: 'screen', label: 'Form', config: { fields: [{ name: 'discount', label: 'Discount', type: 'number' }] } },
  END,
);

describe("ScreenPreview — the Debug run's paused screen (objectui#10848)", () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the header and the disabled Submit read their rows; the field label shows as written`, async () => {
      const steps = runFlow(lang, SCREEN_INPUT_FLOW);
      await flush();
      // Lit controls: the paused step's note and the panel's Screen heading.
      expect(steps[1].note).toBe(row(lang, 'engine.flowSim.note.screenReached'));
      expect(screen.getByText(row(lang, 'engine.flowSim.screen'))).toBeTruthy();
      const preview = screenPreview();
      expect({
        header: preview.header,
        submit: preview.submit?.textContent ?? null,
        disabled: (preview.submit as HTMLButtonElement | null)?.disabled ?? null,
        // Author data: the field's label reads the same in every locale.
        field: preview.body?.querySelector('label')?.textContent ?? null,
      }).toEqual({
        header: row(lang, 'engine.screenPreview.header'),
        submit: row(lang, 'engine.screenPreview.submit'),
        disabled: true,
        field: 'Discount',
      });
      if (lang === 'zh') {
        for (const k of ['engine.screenPreview.header', 'engine.screenPreview.submit', 'engine.flowSim.screen']) zhRow(k);
      }
    });
  }
});

/** The flow node inspector on one node of `nodes`, the way the flow designer mounts it. */
function mountInspector(lang: Lang, nodes: Array<Record<string, unknown>>, id: string) {
  inLang(lang, (
    <FlowNodeInspector
      type="flow"
      name="intake"
      draft={{ name: 'intake', nodes, edges: [] }}
      selection={{ kind: 'node', id }}
      onPatch={() => {}}
      onClearSelection={() => {}}
      readOnly={false}
      locale={LOCALE[lang]}
    />
  ));
}

describe('ScreenPreview — the flow node inspector (objectui#10848)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: a screen with nothing configured shows the header and engine.screenPreview.empty`, async () => {
      mountInspector(lang, [{ id: 'ask', type: 'screen', label: 'Ask', config: {} }], 'ask');
      await flush();
      // Lit control: the inspector's kind label read its row before this change.
      expect(screen.getAllByText(row(lang, 'engine.inspector.flowNode.kind')).length).toBeGreaterThan(0);
      const preview = screenPreview();
      expect({ header: preview.header, body: preview.body?.textContent ?? null }).toEqual({
        header: row(lang, 'engine.screenPreview.header'),
        body: row(lang, 'engine.screenPreview.empty'),
      });
      if (lang === 'zh') for (const k of ['engine.screenPreview.header', 'engine.screenPreview.empty']) zhRow(k);
    });
  }
});

/** A screen whose `oppName` / `oppAmount` fields are gated on a sibling boolean. */
function gatedScreen(gated: number) {
  const fields: Array<Record<string, unknown>> = [{ name: 'createOpp', label: 'Create Opportunity?', type: 'boolean' }];
  if (gated >= 1) fields.push({ name: 'oppName', label: 'Opportunity Name', type: 'text', visibleWhen: 'createOpp == true' });
  if (gated >= 2) fields.push({ name: 'oppAmount', label: 'Amount', type: 'number', visibleWhen: 'createOpp == true' });
  return { id: 's1', config: { fields } };
}

describe("ScreenPreview — the hidden-field and no-backend notes (objectui#10848)", () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: one hidden field reads engine.screenPreview.hiddenOne, two read engine.screenPreview.hiddenOther`, () => {
      const one = inLang(lang, <ScreenPreview node={gatedScreen(1)} locale={LOCALE[lang]} />);
      const oneNote = screenPreview().hiddenNote;
      one.unmount();
      inLang(lang, <ScreenPreview node={gatedScreen(2)} locale={LOCALE[lang]} />);
      expect([oneNote, screenPreview().hiddenNote]).toEqual([
        row(lang, 'engine.screenPreview.hiddenOne', { count: 1 }),
        row(lang, 'engine.screenPreview.hiddenOther', { count: 2 }),
      ]);
      if (lang === 'zh') for (const k of ['engine.screenPreview.hiddenOne', 'engine.screenPreview.hiddenOther']) zhRow(k);
    });

    it(`${lang}: an object-form screen with no data source reads engine.screenPreview.noDataSource`, () => {
      state.adapter = null;
      inLang(lang, <ScreenPreview node={{ id: 's1', config: { objectName: 'crm_account' } }} locale={LOCALE[lang]} />);
      const preview = screenPreview();
      expect({ header: preview.header, note: preview.noDataSource, submit: preview.submit }).toEqual({
        header: row(lang, 'engine.screenPreview.header'),
        note: row(lang, 'engine.screenPreview.noDataSource'),
        // Object-form mode has no preview Submit.
        submit: null,
      });
      if (lang === 'zh') zhRow('engine.screenPreview.noDataSource');
    });
  }
});

// ─── Site 3: the CEL failure frames in the Debug run ─────────────────────────

/**
 * The producer's own message for `source` evaluated with no variables bound,
 * read from `@objectstack/formula` itself: the text the frame must carry as is.
 * The scope is the one `flow-sim-validate` builds for an empty variable set.
 */
function producerMessage(source: string): string {
  const result = ExpressionEngine.evaluate({ dialect: 'cel', source }, { extra: { vars: {} }, record: {} });
  expect(result.ok, `${source} must fail to evaluate`).toBe(false);
  return (result as { ok: false; error: { message: string } }).error.message;
}

const decision = (config?: Record<string, unknown>): SimNode => ({ id: 'd', type: 'decision', label: 'Gate', ...(config ? { config } : {}) });

/** A decision whose only out-edge is guarded by `condition`. */
function guardFlow(condition: string): Flow {
  const flow = linear(START, decision(), END);
  flow.edges[1].condition = condition;
  return flow;
}

const BRANCH_FLOW = linear(START, decision({ conditions: [{ label: 'big', expression: 'discount > 1' }] }), END);

function assignmentFlow(source: string): Flow {
  return linear(
    START,
    { id: 'setup', type: 'assignment', label: 'Setup', config: { assignments: { bad: { dialect: 'cel', source } } } },
    END,
  );
}

describe('the Debug run — the CEL failure frames (objectui#10848)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: an out-edge guard that fails on live values reads engine.flowSim.note.celConditionFailed around the producer's text`, () => {
      const message = producerMessage('discount > 1');
      const steps = runFlow(lang, guardFlow('discount > 1'));
      expect(steps[1]).toMatchObject({
        label: 'Gate',
        status: row(lang, 'engine.flowSim.stepStatus.error'),
        error: `discount > 1: ${row(lang, 'engine.flowSim.note.celConditionFailed', { message })}`,
        // Lit control: the out-edge's error result read its row before this change.
        edges: [['discount > 1', row(lang, 'engine.flowSim.edge.error')]],
      });
      if (lang === 'zh') for (const k of ['engine.flowSim.note.celConditionFailed', 'engine.flowSim.edge.error']) zhRow(k);
    });

    it(`${lang}: a decision branch whose expression fails reads the same frame after its config path`, () => {
      const message = producerMessage('discount > 1');
      const steps = runFlow(lang, BRANCH_FLOW);
      expect(steps[1]).toMatchObject({
        label: 'Gate',
        status: row(lang, 'engine.flowSim.stepStatus.error'),
        error: `config.conditions[0].expression: ${row(lang, 'engine.flowSim.note.celConditionFailed', { message })}`,
      });
      if (lang === 'zh') zhRow('engine.flowSim.note.celConditionFailed');
    });

    it(`${lang}: an assignment's CEL value that fails reads engine.flowSim.note.celEvaluationFailed around the producer's text`, () => {
      const message = producerMessage('missing * 2');
      const steps = runFlow(lang, assignmentFlow('missing * 2'));
      expect(steps[1]).toMatchObject({
        label: 'Setup',
        status: row(lang, 'engine.flowSim.stepStatus.error'),
        error: `assignments.bad: ${row(lang, 'engine.flowSim.note.celEvaluationFailed', { message })}`,
      });
      if (lang === 'zh') zhRow('engine.flowSim.note.celEvaluationFailed');
    });

    it(`${lang}: a producer failure with no message reads engine.flowSim.note.evaluationFailed, on a guard and on a value`, () => {
      const guard = runFlow(lang, guardFlow('boom == 1'))[1].error;
      cleanup();
      const value = runFlow(lang, assignmentFlow('boom == 1'))[1].error;
      expect([guard, value]).toEqual([
        `boom == 1: ${row(lang, 'engine.flowSim.note.evaluationFailed')}`,
        `assignments.bad: ${row(lang, 'engine.flowSim.note.evaluationFailed')}`,
      ]);
      if (lang === 'zh') zhRow('engine.flowSim.note.evaluationFailed');
    });
  }
});
