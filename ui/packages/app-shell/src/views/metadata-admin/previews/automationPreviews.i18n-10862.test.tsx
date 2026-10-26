// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10862, slice 1 — the flow / automation previews under zh-CN.
 *
 * `ActionPreview`, `AgentPreview`, `SkillPreview`, `ToolPreview` and
 * `JobPreview` never read the designer `t`: every word of their own rendered
 * in English beside a Chinese designer. Each now reads its `engine.*` rows in
 * the `locale` its host hands it (`ResourceEditPage`, `EmbeddedItemEditor` and
 * `StudioDesignSurface` pass `useMetadataLocale()` as the preview's `locale`).
 *
 * ── How each site is read ────────────────────────────────────────────────────
 * The objectui#10748 / #10804 / #10835 / #10848 harness: every case mounts the
 * REAL preview under the i18n provider in its language and reads what it
 * rendered. A site is one designer word on the mount: an element's whole text,
 * a `title`, or an input's `placeholder`. Each zh expectation is read back from
 * the catalogue and guarded by `zhRow`, so no case passes on a missing row and
 * none restates a translation. Each en case reads the en row through `t` /
 * `tFormat` for `en-US` rather than pin the wording, so it is the control that
 * the en row renders exactly what the literal rendered.
 *
 * ── Left as written on purpose ───────────────────────────────────────────────
 * Author data (labels, names, instructions, condition sources, handler keys),
 * identifiers (enum tokens, location keys, object and capability names,
 * JSON-Schema types, the compact durations a schedule is written in), the
 * cron syntax's name and producer text (a fetch error) read the same in every
 * locale; the cases check a sample of each on the same mount.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

import { t, tFormat } from '../i18n';
import { ActionPreview } from './ActionPreview';
import { AgentPreview } from './AgentPreview';
import { SkillPreview } from './SkillPreview';
import { ToolPreview } from './ToolPreview';
import { JobPreview } from './JobPreview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Lang = 'en' | 'zh';
const LANGS = ['zh', 'en'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Vars = Record<string, string | number>;

/** The console mounts every designer surface under the i18n provider in its language. */
function inLang(lang: Lang, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

/** The row `key` in `lang`, formatted with `vars`. */
function row(lang: Lang, key: string, vars?: Vars): string {
  return vars ? tFormat(key, LOCALE[lang], vars) : t(key, LOCALE[lang]);
}

/** A zh catalogue row that is really there: not the echoed key, not the en row. */
function zhRow(key: string): string {
  const zh = t(key, 'zh-CN');
  expect(zh, `${key}: a missing zh row echoes the key back`).not.toBe(key);
  expect(zh, `${key}: the zh row must not be the English one`).not.toBe(t(key, 'en-US'));
  return zh;
}

/** One designer word on the mount, and the row it reads. */
interface Site {
  key: string;
  vars?: Vars;
  /** Where the row lands: an element's whole text (default), a `title`, or a `placeholder`. */
  in?: 'text' | 'title' | 'placeholder';
  /** The element's whole text around the row, when the row is not all of it. */
  around?: (row: string) => string;
}

const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Whether some element on the page renders `text` as its whole text, its `title` or its `placeholder`. */
function rendered(where: NonNullable<Site['in']>, text: string): boolean {
  const els = Array.from(document.body.querySelectorAll<HTMLElement>('*'));
  if (where === 'title') return els.some((el) => el.getAttribute('title') === text);
  if (where === 'placeholder') return els.some((el) => el.getAttribute('placeholder') === text);
  return els.some((el) => norm(el.textContent) === text);
}

/** The sites the mount does NOT render in `lang`, each with the text it was expected to show. */
function unrendered(lang: Lang, sites: Site[]): string[] {
  return sites
    .map((s) => {
      const r = row(lang, s.key, s.vars);
      const text = norm(s.around ? s.around(r) : r);
      return rendered(s.in ?? 'text', text) ? null : `${s.key} (${s.in ?? 'text'}): ${JSON.stringify(text)}`;
    })
    .filter((x): x is string => x !== null);
}

/** Every site renders its row in `lang`; under zh, every row is a real zh row. */
function expectSites(lang: Lang, sites: Site[]) {
  expect(unrendered(lang, sites)).toEqual([]);
  if (lang === 'zh') for (const s of sites) zhRow(s.key);
}

/** Author data, identifiers and producer text: the same bytes in every locale. */
function expectAsWritten(texts: string[]) {
  expect(texts.filter((x) => !rendered('text', x))).toEqual([]);
}

const colon = (r: string) => `${r}:`;

// ─── ActionPreview ───────────────────────────────────────────────────────────

const ACTION_API = {
  name: 'sync_account',
  label: 'Sync Account',
  type: 'api',
  target: '/api/v1/sync',
  objectName: 'account',
  variant: 'primary',
  refreshAfter: true,
  aiExposed: false,
  locations: ['record_header', 'list_toolbar', 'list_item', 'record_section', 'record_more'],
  requiredPermissions: ['account.sync'],
  visible: "record.status == 'open'",
  disabled: 'record.locked == true',
  confirmText: 'Sync now?',
  successMessage: 'Synced.',
  params: [
    { name: 'note', label: 'Note', type: 'text', carryOver: true },
    { name: 'owner', label: 'Owner', type: 'text', defaultFromRow: 'owner_id' },
    { name: 'stage', label: 'Stage', type: 'select' },
    { name: 'account', label: 'Account', type: 'lookup', reference: 'account' },
    { name: 'contact', label: 'Contact', type: 'lookup' },
    { name: 'parent', label: 'Parent', type: 'lookup', field: 'parent_id' },
    { name: 'notify', label: 'Notify', type: 'boolean' },
  ],
  resultDialog: {},
};

const ACTION_API_SITES: Site[] = [
  { key: 'engine.actionPreview.pill.type', vars: { type: 'api' } },
  { key: 'engine.actionPreview.pill.object', vars: { object: 'account' } },
  { key: 'engine.actionPreview.pill.variant', vars: { variant: 'primary' } },
  { key: 'engine.actionPreview.pill.refreshAfter' },
  { key: 'engine.actionPreview.pill.aiOptedOut' },
  { key: 'engine.actionPreview.locations' },
  { key: 'engine.actionPreview.requires' },
  { key: 'engine.actionPreview.visibleWhen', around: colon },
  { key: 'engine.actionPreview.disabledWhen', around: colon },
  { key: 'engine.actionPreview.onClick' },
  { key: 'engine.actionPreview.handler.api', vars: { target: '/api/v1/sync' } },
  { key: 'engine.actionPreview.firstAsks', around: (r) => `${r} Sync now?` },
  { key: 'engine.actionPreview.onSuccess', around: (r) => `${r} Synced.` },
  { key: 'engine.actionPreview.section.placement' },
  { key: 'engine.actionPreview.capabilityGateNote', vars: { capabilities: 'account.sync' } },
  { key: 'engine.actionPreview.placement.sampleRecord' },
  { key: 'engine.actionPreview.placement.recordDetail' },
  { key: 'engine.actionPreview.placement.recordBody' },
  { key: 'engine.actionPreview.placement.records' },
  { key: 'engine.actionPreview.placement.rows' },
  { key: 'engine.actionPreview.placement.row', vars: { n: 1 } },
  { key: 'engine.actionPreview.placement.row', vars: { n: 2 } },
  { key: 'engine.actionPreview.placement.section' },
  { key: 'engine.actionPreview.placement.sectionBody' },
  { key: 'engine.actionPreview.placement.more' },
  { key: 'engine.actionPreview.section.testRequest' },
  { key: 'engine.actionPreview.api.paramsOther', vars: { count: 7 } },
  { key: 'engine.actionPreview.api.liveWarning', vars: { method: 'POST' } },
  { key: 'engine.actionPreview.api.send' },
  { key: 'engine.actionPreview.section.inputDialog' },
  { key: 'engine.actionPreview.param.carryOver' },
  { key: 'engine.actionPreview.param.fromRow', in: 'placeholder' },
  { key: 'engine.actionPreview.param.selectPlaceholder', vars: { label: 'Stage' } },
  { key: 'engine.actionPreview.param.noChoices' },
  { key: 'engine.actionPreview.param.searchObject', vars: { object: 'account' } },
  { key: 'engine.actionPreview.param.recordIdPlaceholder', vars: { label: 'Contact' }, in: 'placeholder' },
  { key: 'engine.actionPreview.param.noReference', vars: { reference: 'reference' } },
  { key: 'engine.actionPreview.param.searchRecords' },
  { key: 'engine.actionPreview.param.toggle' },
  { key: 'engine.cancel' },
  { key: 'engine.actionPreview.dialog.ok' },
  { key: 'engine.actionPreview.section.resultDialog' },
  { key: 'engine.actionPreview.result.title' },
  { key: 'engine.actionPreview.result.fullJson' },
  { key: 'engine.actionPreview.result.acknowledge' },
];

function mountAction(lang: Lang, draft: Record<string, unknown>) {
  return inLang(lang, <ActionPreview type="action" name={String(draft.name ?? '')} draft={draft} locale={LOCALE[lang]} />);
}

/** The "On click" sentence. */
function handlerText(): string {
  return norm(document.body.querySelector('div.text-blue-950.font-mono')?.textContent);
}

describe('ActionPreview — the designer words read engine.actionPreview.* (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an api action with every strip, frame, param mock and the result dialog`, () => {
      mountAction(lang, ACTION_API);
      expectSites(lang, ACTION_API_SITES);
      expectAsWritten([
        'Sync Account',
        'sync_account',
        "record.status == 'open'",
        'record.locked == true',
        'record_header',
        'list_item',
        'account.sync',
        'reference',
        'stage',
      ]);
    });

    it(`${lang}: a one-param api action counts its param in the singular`, () => {
      mountAction(lang, { name: 'ping', label: 'Ping', type: 'api', target: '/api/ping', params: [{ name: 'a', type: 'text' }] });
      expectSites(lang, [{ key: 'engine.actionPreview.api.paramsOne', vars: { count: 1 } }]);
    });

    it(`${lang}: an inline script body, exposed to AI`, () => {
      mountAction(lang, { name: 'recalc', label: 'Recalc', type: 'script', aiExposed: true, body: { source: 'record.total = 1' } });
      expectSites(lang, [
        { key: 'engine.actionPreview.pill.type', vars: { type: 'script' } },
        { key: 'engine.actionPreview.pill.aiExposed' },
        { key: 'engine.actionPreview.handler.scriptBody' },
        // `expression` is the body language's default token, shown as written.
        { key: 'engine.actionPreview.section.scriptBody', vars: { language: 'expression' } },
      ]);
      expectAsWritten(['record.total = 1']);
    });

    it(`${lang}: a lookup param authored with an empty \`reference\` degrades to the record-id box, as the base did — no Search placeholder`, () => {
      // The Search placeholder keeps the base's nullish reading of `reference`
      // (`reference ?? 'records'`), so an empty string is not "records". The
      // real component never reaches it with one: `paramDegradesWithoutTarget`
      // reads the empty target as missing, so this edge renders the degraded box.
      mountAction(lang, {
        name: 'assign',
        label: 'Assign',
        type: 'script',
        target: 'assign_owner',
        params: [{ name: 'owner', label: 'Owner', type: 'lookup', reference: '' }],
      });
      expectSites(lang, [
        { key: 'engine.actionPreview.param.recordIdPlaceholder', vars: { label: 'Owner' }, in: 'placeholder' },
        { key: 'engine.actionPreview.param.noReference', vars: { reference: 'reference' } },
      ]);
      const searches = [
        row(lang, 'engine.actionPreview.param.searchObject', { object: '' }),
        row(lang, 'engine.actionPreview.param.searchRecords'),
      ];
      expect(searches.filter((text) => rendered('text', norm(text)))).toEqual([]);
      expect(document.body.querySelector('[role="combobox"]')).toBeNull();
    });

    const HANDLERS: Array<[type: string, target: string | undefined, key: string, vars: Vars]> = [
      ['url', '/orders', 'engine.actionPreview.handler.url', { target: '/orders' }],
      ['flow', 'approve_order', 'engine.actionPreview.handler.flow', { target: 'approve_order' }],
      ['modal', 'order_modal', 'engine.actionPreview.handler.modal', { target: 'order_modal' }],
      ['form', 'order_form', 'engine.actionPreview.handler.form', { target: 'order_form', path: 'order_form' }],
      ['script', 'recalc_totals', 'engine.actionPreview.handler.scriptNamed', { target: 'recalc_totals' }],
      ['webhook', 'hook_1', 'engine.actionPreview.handler.invoke', { target: 'hook_1' }],
      ['url', undefined, 'engine.actionPreview.handler.none', {}],
    ];
    for (const [type, target, key, vars] of HANDLERS) {
      it(`${lang}: the On click sentence for a ${type} action${target ? '' : ' with no target'} reads ${key}`, () => {
        mountAction(lang, { name: 'a', label: 'A', type, ...(target ? { target } : {}) });
        expect(handlerText()).toBe(row(lang, key, Object.keys(vars).length ? vars : undefined));
        if (lang === 'zh') zhRow(key);
      });
    }

    it(`${lang}: a draft with no name and no label shows the empty prompt`, () => {
      mountAction(lang, {});
      expectSites(lang, [{ key: 'engine.actionPreview.empty' }]);
    });

    it(`${lang}: the test request reads its sending and network-error words; the fetch error shows as written`, async () => {
      let fail!: (e: Error) => void;
      vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, reject) => { fail = reject; })));
      mountAction(lang, { name: 'ping', label: 'Ping', type: 'api', target: '/api/ping' });
      const send = Array.from(document.body.querySelectorAll('button')).find(
        (b) => norm(b.textContent) === row(lang, 'engine.actionPreview.api.send'),
      );
      expect(send, 'the Send test request button').toBeTruthy();
      fireEvent.click(send!);
      expectSites(lang, [{ key: 'engine.actionPreview.api.sending' }]);
      await act(async () => {
        fail(new Error('connect ECONNREFUSED'));
      });
      expectSites(lang, [{ key: 'engine.actionPreview.api.networkError' }]);
      expectAsWritten(['connect ECONNREFUSED']);
    });
  }
});

// ─── AgentPreview ────────────────────────────────────────────────────────────

const AGENT_FULL = {
  name: 'sales_copilot',
  label: 'Sales Copilot',
  role: 'Account assistant',
  instructions: 'Be kind.',
  model: { provider: 'openai', model: 'gpt-x', temperature: 0.2, maxTokens: 1000 },
  skills: [],
  planning: { maxIterations: 5 },
  memory: { shortTerm: {} },
  guardrails: { maxCost: 3 },
  permissions: ['ai.use'],
};

function mountAgent(lang: Lang, draft: Record<string, unknown>) {
  return inLang(
    lang,
    <MemoryRouter>
      <AgentPreview type="agent" name={String(draft.name ?? '')} draft={draft} locale={LOCALE[lang]} />
    </MemoryRouter>,
  );
}

describe('AgentPreview — the designer words read engine.agentPreview.* (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: the persona strip, sections, side rail and the Try in chat link`, () => {
      mountAgent(lang, AGENT_FULL);
      expectSites(lang, [
        { key: 'engine.agentPreview.tryInChat' },
        { key: 'engine.agentPreview.tryInChatTitle', in: 'title' },
        { key: 'engine.agentPreview.active' },
        { key: 'engine.agentPreview.temperature', vars: { value: '0.2' } },
        { key: 'engine.agentPreview.maxTokens', vars: { count: '1000' } },
        { key: 'engine.agentPreview.instructions' },
        { key: 'engine.agentPreview.capabilities' },
        { key: 'engine.agentPreview.skills' },
        { key: 'engine.agentPreview.noSkills' },
        { key: 'engine.agentPreview.toolsNote' },
        { key: 'engine.agentPreview.planning' },
        { key: 'engine.agentPreview.memory' },
        { key: 'engine.agentPreview.noValues' },
        { key: 'engine.agentPreview.guardrails' },
        { key: 'engine.agentPreview.permissions' },
      ]);
      expectAsWritten(['Sales Copilot', 'Account assistant', 'Be kind.', 'openai · gpt-x', 'maxIterations', 'maxCost', 'ai.use']);
    });

    it(`${lang}: a disabled agent with no prompt and nothing on the rail`, () => {
      mountAgent(lang, { name: 'helper', active: false, skills: ['summarize'] });
      expectSites(lang, [
        { key: 'engine.agentPreview.disabled' },
        { key: 'engine.agentPreview.noInstructions' },
        { key: 'engine.agentPreview.defaults' },
      ]);
      expectAsWritten(['summarize']);
    });

    it(`${lang}: an empty draft shows the empty prompt`, () => {
      mountAgent(lang, {});
      expectSites(lang, [{ key: 'engine.agentPreview.empty' }]);
    });
  }
});

// ─── SkillPreview ────────────────────────────────────────────────────────────

describe('SkillPreview — the designer words read engine.skillPreview.* (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: the header, instructions, wildcard tools and the trigger-condition table`, () => {
      inLang(
        lang,
        <SkillPreview
          type="skill"
          name="triage"
          locale={LOCALE[lang]}
          draft={{
            name: 'triage',
            label: 'Triage',
            model: 'gpt-x',
            instructions: 'Sort it.',
            tools: ['crm.*', 'mail.send'],
            triggerConditions: [
              { field: 'objectName', operator: 'eq', value: 'case' },
              { field: 'channel', value: 'web' },
            ],
          }}
        />,
      );
      expectSites(lang, [
        { key: 'engine.skillPreview.active' },
        { key: 'engine.skillPreview.model', vars: { model: 'gpt-x' } },
        { key: 'engine.skillPreview.instructions' },
        { key: 'engine.skillPreview.tools', vars: { count: 2 } },
        { key: 'engine.skillPreview.wildcardNote' },
        { key: 'engine.skillPreview.triggerConditions', vars: { count: 2 } },
        { key: 'engine.skillPreview.col.field' },
        { key: 'engine.skillPreview.col.operator' },
        { key: 'engine.skillPreview.col.value' },
        { key: 'engine.skillPreview.allMustHold' },
        { key: 'engine.skillPreview.missing' },
        { key: 'engine.skillPreview.missingTitle', in: 'title' },
      ]);
      expectAsWritten(['Triage', 'Sort it.', 'crm.*', 'objectName', 'eq', 'case']);
    });

    it(`${lang}: a disabled skill with no instructions and no tools`, () => {
      inLang(lang, <SkillPreview type="skill" name="idle" locale={LOCALE[lang]} draft={{ name: 'idle', active: false }} />);
      expectSites(lang, [
        { key: 'engine.skillPreview.disabled' },
        { key: 'engine.skillPreview.noInstructions' },
        { key: 'engine.skillPreview.tools', vars: { count: 0 } },
        { key: 'engine.skillPreview.noTools' },
      ]);
    });

    it(`${lang}: a nameless draft shows the empty prompt`, () => {
      inLang(lang, <SkillPreview type="skill" name="" locale={LOCALE[lang]} draft={{}} />);
      expectSites(lang, [{ key: 'engine.skillPreview.empty' }]);
    });
  }
});

// ─── ToolPreview ─────────────────────────────────────────────────────────────

describe('ToolPreview — the designer words read engine.toolPreview.* (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: the parameter and output tables, the example call and the API Console link`, () => {
      inLang(
        lang,
        <MemoryRouter initialEntries={['/apps/crm/metadata/tool/find_orders']}>
          <Routes>
            <Route
              path="/apps/:appName/*"
              element={
                <ToolPreview
                  type="tool"
                  name="find_orders"
                  locale={LOCALE[lang]}
                  draft={{
                    name: 'find_orders',
                    label: 'Find Orders',
                    description: 'Finds orders.',
                    objectName: 'order',
                    parameters: {
                      type: 'object',
                      required: ['status'],
                      properties: {
                        status: { type: 'string', description: 'Order status', enum: ['open', 'closed'], default: 'open', format: 'slug' },
                      },
                    },
                    outputSchema: { type: 'object', properties: { count: { type: 'number' } } },
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      );
      expectSites(lang, [
        { key: 'engine.toolPreview.openApiConsole' },
        { key: 'engine.toolPreview.openApiConsoleTitle', in: 'title' },
        { key: 'engine.toolPreview.inputParameters' },
        { key: 'engine.toolPreview.exampleCall' },
        { key: 'engine.toolPreview.outputSchema' },
        { key: 'engine.toolPreview.col.name' },
        { key: 'engine.toolPreview.col.type' },
        { key: 'engine.toolPreview.col.description' },
        { key: 'engine.toolPreview.required' },
        { key: 'engine.toolPreview.enum', vars: { values: '"open" | "closed"' } },
        { key: 'engine.toolPreview.default', around: (r) => `${r} "open"` },
        { key: 'engine.toolPreview.format', vars: { format: 'slug' } },
      ]);
      expectAsWritten(['Find Orders', 'Finds orders.', 'order', 'Order status', 'string', 'number']);
    });

    it(`${lang}: a tool with no parameters`, () => {
      inLang(lang, <ToolPreview type="tool" name="ping" locale={LOCALE[lang]} draft={{ name: 'ping', description: 'Pings.' }} />);
      expectSites(lang, [{ key: 'engine.toolPreview.inputParameters' }, { key: 'engine.toolPreview.noParameters' }]);
    });

    it(`${lang}: an empty draft shows the empty prompt`, () => {
      inLang(lang, <ToolPreview type="tool" name="" locale={LOCALE[lang]} draft={{}} />);
      expectSites(lang, [{ key: 'engine.toolPreview.empty' }]);
    });
  }
});

// ─── JobPreview ──────────────────────────────────────────────────────────────

function mountJob(lang: Lang, draft: Record<string, unknown>) {
  return inLang(lang, <JobPreview type="job" name={String(draft.name ?? '')} draft={draft} locale={LOCALE[lang]} />);
}

describe('JobPreview — the designer words read engine.jobPreview.* (objectui#10862)', () => {
  for (const lang of LANGS) {
    it(`${lang}: an interval job with retries, timeout, concurrency and its next five runs`, () => {
      mountJob(lang, {
        name: 'nightly',
        label: 'Nightly',
        schedule: { type: 'interval', intervalMs: 300_000 },
        handler: 'jobs.nightly',
        retryPolicy: { maxRetries: 3, backoffMs: 5000 },
        timeout: 30_000,
        concurrency: 2,
      });
      expectSites(lang, [
        { key: 'engine.jobPreview.active' },
        { key: 'engine.jobPreview.retriesBackoff', vars: { count: '3', backoff: '5s' } },
        { key: 'engine.jobPreview.timeout', vars: { duration: '30s' } },
        { key: 'engine.jobPreview.concurrency', vars: { count: '2' } },
        { key: 'engine.jobPreview.schedule' },
        { key: 'engine.jobPreview.every', around: colon },
        { key: 'engine.jobPreview.nextRunOther', vars: { count: 5 } },
        // Five fires `intervalMs` apart, each measured from the same `now`.
        { key: 'engine.jobPreview.inDelta', vars: { delta: '5m' } },
        { key: 'engine.jobPreview.inDelta', vars: { delta: '25m' } },
        { key: 'engine.jobPreview.handler' },
      ]);
      expectAsWritten(['Nightly', 'jobs.nightly', '5m']);
    });

    it(`${lang}: a paused one-shot whose time has passed, with plain retries and no handler`, () => {
      mountJob(lang, { name: 'once', active: false, schedule: { type: 'once', at: '2000-01-01T00:00:00Z' }, maxRetries: 2 });
      expectSites(lang, [
        { key: 'engine.jobPreview.paused' },
        { key: 'engine.jobPreview.retries', vars: { count: '2' } },
        { key: 'engine.jobPreview.at', around: colon },
        { key: 'engine.jobPreview.nextRunOne', vars: { count: 1 } },
        { key: 'engine.jobPreview.inNow' },
        { key: 'engine.jobPreview.noHandler' },
      ]);
    });

    it(`${lang}: a cron that parses to nothing; "Cron" is the syntax's name and reads the same`, () => {
      mountJob(lang, { name: 'bad', schedule: { type: 'cron', expression: 'bogus' }, handler: 'h' });
      expectSites(lang, [
        { key: 'engine.jobPreview.nextRunOther', vars: { count: 1 } },
        { key: 'engine.jobPreview.noFireTime' },
      ]);
      expectAsWritten(['Cron:', 'bogus']);
    });

    it(`${lang}: a one-shot whose time does not parse`, () => {
      mountJob(lang, { name: 'x', schedule: { type: 'once', at: 'not-a-date' }, handler: 'h' });
      expectSites(lang, [{ key: 'engine.jobPreview.noUpcoming' }]);
    });

    it(`${lang}: an interval that does not parse`, () => {
      mountJob(lang, { name: 'y', every: 'soon', handler: 'h' });
      expectSites(lang, [{ key: 'engine.jobPreview.unparseable' }]);
    });

    it(`${lang}: a job with no schedule and no handler`, () => {
      mountJob(lang, { name: 'z' });
      expectSites(lang, [{ key: 'engine.jobPreview.noSchedule' }, { key: 'engine.jobPreview.noHandler' }]);
    });

    it(`${lang}: an empty draft shows the empty prompt`, () => {
      mountJob(lang, {});
      expectSites(lang, [{ key: 'engine.jobPreview.empty' }]);
    });
  }
});
