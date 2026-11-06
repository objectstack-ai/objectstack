// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The screenshot step without a browser: which views {@link planShots} picks
 * from the card's tags and the build, and {@link captureScreenshots} driving a
 * browser double against a booted-app double — booted the runner's way,
 * seeded the runner's way, stopped afterwards.
 *
 * NOT MEASURED here: a real Console page. Booting a generated app locally
 * needs the app (a model writes it) and `create-objectstack` from npm; the
 * Playwright adapter (`playwrightBrowser`) is exercised by the PR's manual
 * reading, not by this suite.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, readCapabilityAreas, type LoadedScenario } from '../../src/loader.js';
import { captureScreenshots, declaredListViews, planShots, taggedViewKinds, type ScreenshotBrowser } from '../../src/export/screenshots.js';
import { AREAS_DIR, CARDS_DIR, FakeApp, tempDir } from './fixture.js';

function load(id: string): LoadedScenario {
  const { card, refusals } = loadScenarioFile(join(CARDS_DIR, `${id}.json`), { areas: readCapabilityAreas(AREAS_DIR) });
  if (!card) throw new Error(refusals.map(formatRefusal).join('\n'));
  return card;
}

/** The order-to-cash card, with extra capability tags (a card that TAGS a view kind). */
const orderCard = (extraTags: string[] = []): LoadedScenario => {
  const s = load('order_to_cash');
  return { ...s, card: { ...s.card, capabilities: [...s.card.capabilities, ...extraTags] } };
};

const KANBAN_TAG = 'records-forms.kanban-drag-persistence';
const CALENDAR_TAG = 'records-forms.calendar-interactions';

const orderBuild = (over: { views?: unknown[]; dashboards?: unknown[]; apps?: unknown[] } = {}) => ({
  manifest: { id: 'com.example.demoorder', namespace: 'demoorder' },
  apps: over.apps ?? [{ name: 'demoorder_order_to_cash', label: 'Order to cash' }],
  objects: [{ name: 'demoorder_employee' }, { name: 'demoorder_account' }, { name: 'demoorder_invoice' }, { name: 'demoorder_activity' }],
  views: over.views ?? [
    { object: 'demoorder_invoice', list: { type: 'grid', columns: ['name'] }, listViews: { board: { type: 'kanban', columns: ['name'], kanban: { groupByField: 'status' } } } },
    { object: 'demoorder_activity', listViews: { schedule: { type: 'calendar', columns: ['subject'] } } },
  ],
  dashboards: over.dashboards ?? [{ name: 'demoorder_overview' }, { name: 'demoorder_receivables_aging_report' }],
});

describe('taggedViewKinds — kanban and calendar only where the card tags them', () => {
  it('reads the tag names, not the area', () => {
    expect(taggedViewKinds({ capabilities: ['records-forms.lookup'] })).toEqual([]);
    expect(taggedViewKinds({ capabilities: [KANBAN_TAG] })).toEqual(['kanban']);
    expect(taggedViewKinds({ capabilities: [CALENDAR_TAG, KANBAN_TAG] })).toEqual(['kanban', 'calendar']);
  });

  it('no card of the open library tags either today', () => {
    for (const id of ['order_to_cash', 'service_desk', 'crm_account_with_contacts']) expect(taggedViewKinds(load(id).card)).toEqual([]);
  });
});

describe('planShots', () => {
  it('an untagged card: list, record and dashboard — never a kanban or calendar the build happens to declare', () => {
    const plan = planShots(orderCard(), orderBuild());
    expect(plan.app).toBe('demoorder_order_to_cash');
    expect(plan.shots).toEqual([
      { kind: 'list', file: 'screenshots/list.png', path: '/_console/apps/demoorder_order_to_cash/demoorder_account', object: 'demoorder_account' },
      { kind: 'record', file: 'screenshots/record.png', path: '/_console/apps/demoorder_order_to_cash/demoorder_account/record/a01', object: 'demoorder_account', row: 'a01' },
      // The card expects `receivables_aging_report`; that one is chosen over the build's first.
      { kind: 'dashboard', file: 'screenshots/dashboard.png', path: '/_console/apps/demoorder_order_to_cash/dashboard/demoorder_receivables_aging_report', view: 'demoorder_receivables_aging_report' },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('a card tagging kanban and calendar gets a shot of each view of that type the build declares', () => {
    const plan = planShots(orderCard([KANBAN_TAG, CALENDAR_TAG]), orderBuild());
    expect(plan.shots.map((s) => s.kind)).toEqual(['list', 'kanban', 'calendar', 'record', 'dashboard']);
    expect(plan.shots.find((s) => s.kind === 'kanban')).toMatchObject({ path: '/_console/apps/demoorder_order_to_cash/demoorder_invoice/view/demoorder_invoice.board', view: 'demoorder_invoice.board' });
    expect(plan.shots.find((s) => s.kind === 'calendar')).toMatchObject({ object: 'demoorder_activity', view: 'demoorder_activity.schedule' });
  });

  it('a tagged view the build does not declare, and a build with no dashboard, are skipped with the reason', () => {
    const plan = planShots(orderCard([KANBAN_TAG]), orderBuild({ views: [], dashboards: [] }));
    expect(plan.shots.map((s) => s.kind)).toEqual(['list', 'record']);
    expect(plan.skipped).toEqual([
      { kind: 'kanban', reason: 'the card tags kanban, and the build declares no kanban view' },
      { kind: 'dashboard', reason: 'the build declares no dashboard' },
    ]);
  });

  it('a build with no app has nothing for the Console to open', () => {
    const plan = planShots(orderCard(), orderBuild({ apps: [] }));
    expect(plan.shots).toEqual([]);
    expect(plan.skipped.map((s) => s.kind)).toEqual(['list', 'record', 'dashboard']);
  });

  it('reads a container as `os build` writes it: no `object` of its own, the binding in `list.data.object`', () => {
    // The shape measured from a create-objectstack 18.3 project's dist/objectstack.json.
    const built = {
      list: { label: 'All accounts', type: 'grid', data: { provider: 'object', object: 'demoorder_account' }, columns: [{ field: 'name' }] },
      listViews: { board: { label: 'By industry', type: 'kanban', data: { provider: 'object', object: 'demoorder_account' }, columns: ['name'], kanban: { groupByField: 'industry' } } },
    };
    expect(declaredListViews(orderBuild({ views: [built] }))).toEqual([
      { object: 'demoorder_account', name: 'demoorder_account.board', type: 'kanban' },
      { object: 'demoorder_account', name: 'demoorder_account.default', type: 'grid' },
    ]);
  });

  it('reads a container through the spec composer: the default list is `<object>.default`, a standalone view keeps its name', () => {
    expect(declaredListViews(orderBuild({ views: [{ object: 'demoorder_invoice', list: { type: 'grid' } }, { name: 'demoorder_account.board', object: 'demoorder_account', type: 'kanban' }] }))).toEqual([
      { object: 'demoorder_invoice', name: 'demoorder_invoice.default', type: 'grid' },
      { object: 'demoorder_account', name: 'demoorder_account.board', type: 'kanban' },
    ]);
  });
});

describe('captureScreenshots — boot, seed, shoot, stop', () => {
  function doubles(app: FakeApp) {
    const events: string[] = [];
    const browser: ScreenshotBrowser = {
      async open(baseUrl, admin) {
        events.push(`open ${baseUrl} as ${admin.email}`);
        return {
          async capture(path, file) {
            events.push(`shoot ${path}`);
            writeFileSync(file, 'png');
          },
          async close() {
            events.push('close');
          },
        };
      },
    };
    return {
      events,
      deps: {
        boot: async (dir: string) => {
          events.push(`boot ${dir}`);
          return { url: 'http://localhost:4567', stop: async () => void events.push('stop'), log: () => '' };
        },
        harness: () => app,
        browser,
        admin: { email: 'admin@objectos.ai', password: 'admin123' },
      },
    };
  }

  it('boots the project, seeds it as the admin, takes every planned shot, then closes and stops', async () => {
    const app = new FakeApp();
    const { events, deps } = doubles(app);
    const dir = tempDir('shots');
    const r = await captureScreenshots({ scenario: orderCard(), projectDir: '/work/order-to-cash-scratch/demoorder', artifact: orderBuild(), dir }, deps);
    expect(events).toEqual([
      'boot /work/order-to-cash-scratch/demoorder',
      'open http://localhost:4567 as admin@objectos.ai',
      'shoot /_console/apps/demoorder_order_to_cash/demoorder_account',
      'shoot /_console/apps/demoorder_order_to_cash/demoorder_account/record/a01',
      'shoot /_console/apps/demoorder_order_to_cash/dashboard/demoorder_receivables_aging_report',
      'close',
      'stop',
    ]);
    expect(app.signedIn).toBe(1);
    expect(app.rows.demoorder_account!.map((row) => row.id)).toContain('a01');
    expect(r.seed!.refused).toEqual([]);
    for (const s of r.shots) expect(existsSync(join(dir, s.file))).toBe(true);
  });

  it('a record shot whose seed row the app refused is skipped with the reason', async () => {
    const app = new FakeApp();
    app.refuse.add('demoorder_account/a01');
    const { deps } = doubles(app);
    const r = await captureScreenshots({ scenario: orderCard(), projectDir: '/p', artifact: orderBuild(), dir: tempDir('shots') }, deps);
    expect(r.shots.map((s) => s.kind)).toEqual(['list', 'dashboard']);
    expect(r.skipped).toEqual([{ kind: 'record', reason: 'the app refused seed row demoorder_account a01' }]);
  });

  it('a browser that writes no file is an error, and the app is still stopped', async () => {
    const app = new FakeApp();
    const { events, deps } = doubles(app);
    deps.browser = { open: async () => ({ capture: async () => {}, close: async () => void events.push('close') }) };
    await expect(captureScreenshots({ scenario: orderCard(), projectDir: '/p', artifact: orderBuild(), dir: tempDir('shots') }, deps)).rejects.toThrow(/the browser wrote no screenshot for list/);
    expect(events.slice(-2)).toEqual(['close', 'stop']);
  });

  it('nothing planned: nothing is booted', async () => {
    const { events, deps } = doubles(new FakeApp());
    const r = await captureScreenshots({ scenario: orderCard(), projectDir: '/p', artifact: orderBuild({ apps: [] }), dir: tempDir('shots') }, deps);
    expect(r.shots).toEqual([]);
    expect(events).toEqual([]);
  });
});
