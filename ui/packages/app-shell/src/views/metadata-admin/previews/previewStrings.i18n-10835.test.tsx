// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10835 — the dashboard designer's preview canvas and the flow Debug
 * run, the designer surfaces that still rendered English under zh-CN after
 * objectui#10804.
 *
 * - `DashboardPreview`: the empty-canvas message, the error-boundary hint, the
 *   loading text, and the selected-widget strip ("Selected", its title button's
 *   tooltip, the untitled fallback and three aria-labels).
 * - The Debug run (`FlowSimulatorPanel` driving `FlowSimulator`): every note
 *   and error sentence a step records, each step's status chip and an
 *   out-edge's error result. The simulator writes its sentences in the locale
 *   its constructor already took for `validateFlowDraft`; the screen step
 *   passes it on to `unevaluableVisibleWhen`, so the reason inside the frame
 *   reads the same `engine.flowRef.notAScreenField` row the inspector shows.
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The objectui#10696 / objectui#10748 / objectui#10804 harness: every case
 * reads the RENDERED text or attribute of the real component. Each zh
 * expectation is read back from the catalogue and guarded by `zhRow` — not the
 * key echoed back, not the en row — so no case passes on a missing row and none
 * restates a translation. Each en case reads the en row through `t` / `tFormat`
 * for `en-US` rather than pin the wording.
 *
 * ── Lit controls ─────────────────────────────────────────────────────────────
 * On the same mount, a word that already rendered in zh before this change:
 * the dashboard's add-widget trigger (添加组件) and the Debug run's Run button
 * and Timeline heading.
 *
 * ── Left as written on purpose (the objectui#10678 / objectui#10651 ruling) ──
 * A widget's stored `title` (`New bar chart`) is author data, and adding a
 * widget keeps writing it in English. Node labels, node ids, node types, branch
 * labels, CEL sources and a guard's `true` / `false` value read the same in
 * every locale; the cases assert them as they are.
 *
 * `DashboardRenderer` is a stand-in here: the cases read the preview's own
 * chrome, and the stand-in can suspend or throw on demand, which is what shows
 * the loading text and the error-boundary hint.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({ renderer: 'draw' as 'draw' | 'suspend' | 'throw' }));

vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/plugin-dashboard')>();
  return {
    ...mod,
    DashboardRenderer: () => {
      if (state.renderer === 'suspend') throw new Promise<never>(() => {});
      if (state.renderer === 'throw') throw new Error('widget "w1" names no object');
      return <div data-testid="dashboard-renderer" />;
    },
  };
});
// Module-scope import of the lazily loaded renderer, so the preview's
// `React.lazy` factory resolves at once instead of racing the test's wait
// window (AGENTS.md, flaky-test discipline).
import '@object-ui/plugin-dashboard';

// The Debug run's paused screen mounts `ScreenPreview`, which reads both.
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ fake: 'adapter' }),
}));
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: [] }),
}));

import { t, tFormat } from '../i18n';
import { DashboardPreview } from './DashboardPreview';
import { FlowSimulatorPanel } from './FlowSimulatorPanel';
import type { SimEdge, SimNode } from './simulator/flow-sim-types';

afterEach(() => {
  cleanup();
  state.renderer = 'draw';
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

// ─── DashboardPreview ────────────────────────────────────────────────────────

const BAR = { id: 'w1', type: 'bar', title: 'New bar chart', layout: { x: 0, y: 0, w: 6, h: 4 } };

function mountDashboard(
  lang: Lang,
  opts: { widgets?: Array<Record<string, unknown>>; selected?: string; onPatch?: (p: Record<string, unknown>) => void } = {},
) {
  const widgets = opts.widgets ?? [];
  inLang(lang, (
    <DashboardPreview
      type="dashboard"
      name="sales"
      draft={{ name: 'sales', label: 'Sales', widgets }}
      editing
      selection={opts.selected ? { kind: 'widget', id: opts.selected } : null}
      onSelectionChange={() => {}}
      onPatch={opts.onPatch ?? (() => {})}
      locale={LOCALE[lang]}
    />
  ));
}

/** The add-widget trigger: the lit control, its label read its row before this change. */
const addWidgetTrigger = (lang: Lang) => screen.getByRole('button', { name: row(lang, 'engine.inspector.add.widget') });

/** The text of the canvas's `PreviewMessage`. */
const previewMessage = () => document.body.querySelector('div.m-4 div.flex-1')?.textContent ?? null;

/** The selected-widget strip's words: its chip, its title button, the tooltip, and each aria-label. */
function strip() {
  const chip = document.body.querySelector('span.uppercase.tracking-wide');
  const bar = chip?.parentElement ?? null;
  const labels = Array.from(bar?.querySelectorAll('button[aria-label]') ?? []).map((b) => b.getAttribute('aria-label'));
  const titleButton = bar?.querySelector('button[title]') ?? null;
  return {
    chip: chip?.textContent ?? null,
    title: titleButton?.textContent ?? null,
    tooltip: titleButton?.getAttribute('title') ?? null,
    labels,
    titleButton,
  };
}

describe('DashboardPreview — the empty canvas (objectui#10835)', () => {
  it('zh: the message reads engine.dashboardPreview.empty beside the add-widget trigger', () => {
    mountDashboard('zh');
    expect(addWidgetTrigger('zh')).toBeTruthy();
    zhRow('engine.inspector.add.widget');
    expect(previewMessage()).toBe(row('zh', 'engine.dashboardPreview.empty'));
    zhRow('engine.dashboardPreview.empty');
  });

  it('en: the message reads the en row', () => {
    mountDashboard('en');
    expect(previewMessage()).toBe(row('en', 'engine.dashboardPreview.empty'));
  });
});

describe('DashboardPreview — the error-boundary hint (objectui#10835)', () => {
  const hint = () => document.body.querySelector('div.mt-2.opacity-70')?.textContent ?? null;

  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: a widget that fails to render leaves the hint engine.dashboardPreview.malformed`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      state.renderer = 'throw';
      mountDashboard(lang, { widgets: [BAR] });
      await flush();
      expect(hint()).toBe(row(lang, 'engine.dashboardPreview.malformed'));
      if (lang === 'zh') zhRow('engine.dashboardPreview.malformed');
    });
  }
});

describe('DashboardPreview — the loading text (objectui#10835)', () => {
  const loading = () => document.body.querySelector('div.p-6.text-sm')?.textContent?.trim() ?? null;

  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: while the renderer loads, the canvas reads engine.dashboardPreview.loading`, async () => {
      state.renderer = 'suspend';
      mountDashboard(lang, { widgets: [BAR] });
      await flush();
      expect(loading()).toBe(row(lang, 'engine.dashboardPreview.loading'));
      if (lang === 'zh') zhRow('engine.dashboardPreview.loading');
    });
  }
});

describe('DashboardPreview — the selected-widget strip (objectui#10835)', () => {
  const STRIP_KEYS = ['engine.dashboardPreview.renameWidget', 'engine.dashboardPreview.clearSelection'];

  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: the chip, the tooltip and the aria-labels read their rows; the stored title shows as written`, async () => {
      mountDashboard(lang, { widgets: [BAR], selected: 'w1' });
      await flush();
      expect(addWidgetTrigger(lang)).toBeTruthy();
      const { chip, tooltip, labels, title } = strip();
      expect({ chip, tooltip, labels, title }).toEqual({
        chip: row(lang, 'engine.dashboardPreview.selected'),
        tooltip: row(lang, 'engine.dashboardPreview.clickToRename'),
        labels: STRIP_KEYS.map((k) => row(lang, k)),
        // Stored author data: the title reads the same in every locale.
        title: 'New bar chart',
      });
      if (lang === 'zh') {
        for (const k of ['engine.dashboardPreview.selected', 'engine.dashboardPreview.clickToRename', ...STRIP_KEYS]) zhRow(k);
      }
    });

    it(`${lang}: renaming shows the save button's aria-label engine.dashboardPreview.saveTitle`, async () => {
      mountDashboard(lang, { widgets: [BAR], selected: 'w1' });
      await flush();
      fireEvent.click(strip().titleButton!);
      await flush();
      expect(screen.getByDisplayValue('New bar chart')).toBeTruthy();
      expect(strip().labels).toEqual([
        row(lang, 'engine.dashboardPreview.saveTitle'),
        row(lang, 'engine.dashboardPreview.clearSelection'),
      ]);
      if (lang === 'zh') zhRow('engine.dashboardPreview.saveTitle');
    });

    it(`${lang}: a widget with an empty title shows engine.dashboardPreview.untitled`, async () => {
      mountDashboard(lang, { widgets: [{ ...BAR, title: '' }], selected: 'w1' });
      await flush();
      expect(strip().title).toBe(row(lang, 'engine.dashboardPreview.untitled'));
      if (lang === 'zh') zhRow('engine.dashboardPreview.untitled');
    });
  }
});

describe('DashboardPreview — the stored default title stays English (objectui#10835 control)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: adding a bar chart from the canvas writes type bar and the title New bar chart`, async () => {
      const onPatch = vi.fn();
      mountDashboard(lang, { onPatch });
      fireEvent.click(addWidgetTrigger(lang));
      await flush();
      const entry = Array.from(screen.getByRole('dialog').querySelectorAll('button')).find(
        (b) => b.querySelector('code')?.textContent === 'bar',
      );
      expect(entry, 'the bar entry').toBeTruthy();
      fireEvent.click(entry!);
      const patch = onPatch.mock.calls.at(-1)?.[0] as { widgets?: Array<Record<string, unknown>> } | undefined;
      expect(patch?.widgets?.[0]).toMatchObject({ type: 'bar', title: 'New bar chart' });
    });
  }
});

// ─── The Debug run (FlowSimulatorPanel → FlowSimulator) ──────────────────────

interface TimelineRow {
  label: string | null;
  status: string | null;
  note: string | null;
  error: string | null;
  /** Each out-edge row: its condition text and its result. */
  edges: Array<[string | null, string | null]>;
}

/** Mount the Debug panel on `flow`, press Run, and read the timeline. */
function runFlow(lang: Lang, flow: { nodes: SimNode[]; edges: SimEdge[] }): TimelineRow[] {
  inLang(lang, <FlowSimulatorPanel nodes={flow.nodes} edges={flow.edges} variables={[]} locale={LOCALE[lang]} />);
  // Lit control: the Run button read its row before this change.
  fireEvent.click(screen.getByRole('button', { name: row(lang, 'engine.flowSim.run') }));
  return timeline(lang);
}

function timeline(lang: Lang): TimelineRow[] {
  // Lit control: the Timeline heading read its row before this change.
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

/** One row's note in `lang`, and the keys a zh run must find rows for. */
const note = (lang: Lang, key: string, vars?: Vars) => row(lang, key, vars);
const statusChip = (lang: Lang, status: string) => row(lang, `engine.flowSim.stepStatus.${status}`);

const linear = (...nodes: SimNode[]): { nodes: SimNode[]; edges: SimEdge[] } => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
});
const START: SimNode = { id: 'start', type: 'start', label: 'Start' };
const END: SimNode = { id: 'end', type: 'end', label: 'End' };

const WAIT_FLOW = linear(START, { id: 'hold', type: 'wait', label: 'Hold' }, END);
const SCREEN_INPUT_FLOW = linear(
  START,
  { id: 'form', type: 'screen', label: 'Form', config: { fields: [{ name: 'discount', label: 'Discount', type: 'number' }] } },
  END,
);
const SCREEN_NO_INPUT_FLOW = linear(START, { id: 'info', type: 'screen', label: 'Info', config: { title: 'Thanks' } }, END);
const SCREEN_SCOPE_FLOW = linear(
  START,
  {
    id: 'form',
    type: 'screen',
    label: 'Form',
    config: {
      fields: [
        { name: 'discount', label: 'Discount', type: 'number' },
        { name: 'reason', label: 'Reason', type: 'text', visibleWhen: 'needsApproval == true' },
      ],
    },
  },
  END,
);

describe('the Debug run — the four named sites (objectui#10835)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: a wait node pauses with engine.flowSim.note.waitReached`, () => {
      const steps = runFlow(lang, WAIT_FLOW);
      expect(steps.map((s) => [s.label, s.status, s.note])).toEqual([
        ['Start', statusChip(lang, 'ok'), null],
        ['Hold', statusChip(lang, 'paused'), note(lang, 'engine.flowSim.note.waitReached')],
      ]);
      if (lang === 'zh') for (const k of ['engine.flowSim.note.waitReached', 'engine.flowSim.stepStatus.ok', 'engine.flowSim.stepStatus.paused']) zhRow(k);
    });

    it(`${lang}: a screen with inputs pauses with engine.flowSim.note.screenReached`, async () => {
      const steps = runFlow(lang, SCREEN_INPUT_FLOW);
      await flush();
      expect(steps.map((s) => [s.label, s.status, s.note, s.error])).toEqual([
        ['Start', statusChip(lang, 'ok'), null, null],
        ['Form', statusChip(lang, 'paused'), note(lang, 'engine.flowSim.note.screenReached'), null],
      ]);
      if (lang === 'zh') zhRow('engine.flowSim.note.screenReached');
    });

    it(`${lang}: a screen with no input passes through with engine.flowSim.note.screenNoInput`, () => {
      const steps = runFlow(lang, SCREEN_NO_INPUT_FLOW);
      expect(steps.map((s) => [s.label, s.status, s.note])).toEqual([
        ['Start', statusChip(lang, 'ok'), null],
        ['Info', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.screenNoInput')],
        ['End', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.flowEnd')],
      ]);
      if (lang === 'zh') for (const k of ['engine.flowSim.note.screenNoInput', 'engine.flowSim.note.flowEnd']) zhRow(k);
    });

    it(`${lang}: a visibleWhen naming a non-screen field is named in engine.flowSim.note.screenUnevaluable, its reason in engine.flowRef.notAScreenField`, async () => {
      const steps = runFlow(lang, SCREEN_SCOPE_FLOW);
      await flush();
      const reason = row(lang, 'engine.flowRef.notAScreenField', { token: 'needsApproval' });
      const field = row(lang, 'engine.flowSim.note.screenUnevaluableField', { name: 'reason', reason });
      expect(steps[1]).toMatchObject({
        label: 'Form',
        status: statusChip(lang, 'paused'),
        note: note(lang, 'engine.flowSim.note.screenReached'),
        error: row(lang, 'engine.flowSim.note.screenUnevaluable', { fields: field }),
      });
      if (lang === 'zh') {
        for (const k of ['engine.flowSim.note.screenUnevaluable', 'engine.flowSim.note.screenUnevaluableField', 'engine.flowRef.notAScreenField']) zhRow(k);
      }
    });
  }
});

/**
 * One run through most of what the Debug run writes: an assignment, a mocked
 * record read, a decision branch, a single-pass loop over a list variable,
 * a parallel split, a node kind the simulator does not model, a mocked function
 * call and the end.
 */
const SWEEP_FLOW: { nodes: SimNode[]; edges: SimEdge[] } = {
  nodes: [
    START,
    { id: 'setup', type: 'assignment', label: 'Setup', config: { assignments: { x: 1, rows: ['a', 'b'] } } },
    { id: 'fetch', type: 'get_record', label: 'Fetch', config: { outputVariable: 'acct' } },
    { id: 'route', type: 'decision', label: 'Route', config: { conditions: [{ label: 'big', expression: 'x > 0' }] } },
    { id: 'each', type: 'loop', label: 'Each', config: { collection: 'rows' } },
    { id: 'split', type: 'parallel_gateway', label: 'Split' },
    { id: 'sub', type: 'subflow', label: 'Sub' },
    { id: 'call', type: 'script', label: 'Call', config: { function: 'notifyOwner' } },
    END,
  ],
  edges: [
    { id: 'e0', source: 'start', target: 'setup' },
    { id: 'e1', source: 'setup', target: 'fetch' },
    { id: 'e2', source: 'fetch', target: 'route' },
    { id: 'e3', source: 'route', target: 'each', label: 'big' },
    { id: 'e4', source: 'each', target: 'split' },
    { id: 'e5', source: 'split', target: 'sub' },
    { id: 'e6', source: 'sub', target: 'call' },
    { id: 'e7', source: 'call', target: 'end' },
  ],
};

/** An approval, resumed down its `approve` branch. */
const APPROVAL_FLOW: { nodes: SimNode[]; edges: SimEdge[] } = {
  nodes: [START, { id: 'ask', type: 'approval', label: 'Ask' }, END, { id: 'no', type: 'end', label: 'Rejected' }],
  edges: [
    { id: 'e0', source: 'start', target: 'ask' },
    { id: 'e1', source: 'ask', target: 'end', label: 'approve' },
    { id: 'e2', source: 'ask', target: 'no', label: 'reject' },
  ],
};

/** A decision whose only out-edge is guarded and false, then one whose guard does not parse. */
const GUARD_FALSE_FLOW = linear(START, { id: 'd', type: 'decision', label: 'Gate' }, END);
GUARD_FALSE_FLOW.edges[1].condition = '1 > 2';
const GUARD_ERROR_FLOW = linear(START, { id: 'd', type: 'decision', label: 'Gate' }, END);
GUARD_ERROR_FLOW.edges[1].condition = '(1 > 2';

describe('the Debug run — the other step records (objectui#10835)', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}: every note of one run reads its engine.flowSim.note.* row`, () => {
      const steps = runFlow(lang, SWEEP_FLOW);
      expect(steps.map((s) => [s.label, s.status, s.note])).toEqual([
        ['Start', statusChip(lang, 'ok'), null],
        ['Setup', statusChip(lang, 'ok'), null],
        ['Fetch', statusChip(lang, 'mocked'), note(lang, 'engine.flowSim.note.mocked', { type: 'get record' })],
        ['Route', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.branchMatched', { label: 'big' })],
        ['Each', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.loopCollection', { ref: 'rows', count: 2 })],
        ['Split', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.parallelSplit')],
        ['Sub', statusChip(lang, 'skipped'), note(lang, 'engine.flowSim.note.unsupported', { type: 'subflow' })],
        ['Call', statusChip(lang, 'mocked'), note(lang, 'engine.flowSim.note.mockedCall', { fn: 'notifyOwner' })],
        ['End', statusChip(lang, 'ok'), note(lang, 'engine.flowSim.note.flowEnd')],
      ]);
      if (lang === 'zh') {
        for (const k of [
          'engine.flowSim.note.mocked',
          'engine.flowSim.note.branchMatched',
          'engine.flowSim.note.loopCollection',
          'engine.flowSim.note.parallelSplit',
          'engine.flowSim.note.unsupported',
          'engine.flowSim.note.mockedCall',
          'engine.flowSim.stepStatus.mocked',
          'engine.flowSim.stepStatus.skipped',
        ]) zhRow(k);
      }
    });

    it(`${lang}: an approval pauses with approvalReached and resumes with decisionTaken`, () => {
      const paused = runFlow(lang, APPROVAL_FLOW)[1].note;
      // The branch button names the out-edge's label: author data.
      fireEvent.click(screen.getByRole('button', { name: 'approve' }));
      const resumed = timeline(lang)[2];
      expect([paused, resumed.label, resumed.status, resumed.note]).toEqual([
        note(lang, 'engine.flowSim.note.approvalReached'),
        'Ask',
        statusChip(lang, 'ok'),
        note(lang, 'engine.flowSim.note.decisionTaken', { decision: 'approve', taken: 'end' }),
      ]);
      if (lang === 'zh') for (const k of ['engine.flowSim.note.approvalReached', 'engine.flowSim.note.decisionTaken']) zhRow(k);
    });

    it(`${lang}: a false guard with no default reads noEdgeTaken; the guard's value stays false`, () => {
      const steps = runFlow(lang, GUARD_FALSE_FLOW);
      expect(steps[1]).toMatchObject({
        label: 'Gate',
        status: statusChip(lang, 'ok'),
        note: note(lang, 'engine.flowSim.note.noEdgeTaken'),
        edges: [['1 > 2', 'false']],
      });
      if (lang === 'zh') zhRow('engine.flowSim.note.noEdgeTaken');
    });

    it(`${lang}: a guard that does not parse marks the step and the out-edge with their error rows`, () => {
      const steps = runFlow(lang, GUARD_ERROR_FLOW);
      expect(steps[1]).toMatchObject({
        label: 'Gate',
        status: statusChip(lang, 'error'),
        edges: [['(1 > 2', row(lang, 'engine.flowSim.edge.error')]],
      });
      // The error sentence is the CEL source and the parser's own text.
      expect(steps[1].error?.startsWith('(1 > 2: ')).toBe(true);
      if (lang === 'zh') for (const k of ['engine.flowSim.stepStatus.error', 'engine.flowSim.edge.error']) zhRow(k);
    });

    it(`${lang}: a loop whose collection is no list fails with loopCollectionNotList (objectui#12329)`, () => {
      const steps = runFlow(
        lang,
        linear(
          START,
          {
            id: 'each',
            type: 'loop',
            label: 'Each',
            config: {
              collection: { dialect: 'cel', source: '1 + 1' },
              iteratorVariable: 'it',
              body: { nodes: [{ id: 'inner', type: 'assignment' }], edges: [] },
            },
          },
          END,
        ),
      );
      expect(steps[1]).toMatchObject({
        label: 'Each',
        status: statusChip(lang, 'error'),
        error: note(lang, 'engine.flowSim.note.loopCollectionNotList', { ref: '1 + 1' }),
      });
      if (lang === 'zh') zhRow('engine.flowSim.note.loopCollectionNotList');
    });
  }
});
