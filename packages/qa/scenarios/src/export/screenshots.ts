// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Screenshots of the exported app, taken by a real browser against the app
 * booted the way the runner boots it (`bootDev`, `objectstack dev --fresh`),
 * seeded the way the runner seeds it (`seedApp`, as the admin), in the Console
 * at `/_console/`.
 *
 * Which views, decided by {@link planShots} from the card and the build alone
 * (pure, so it is tested without a browser):
 *
 *   - `list`: the app's first object the card puts in the app's navigation
 *     (`expect.appNavTargets`), else the card's first object —
 *     `apps/<app>/<object>`;
 *   - `kanban` / `calendar`: only where the card TAGS one (a capability tag
 *     whose name says `kanban` or `calendar`, e.g.
 *     `records-forms.kanban-drag-persistence`), showing a view of that type the
 *     build declares (`apps/<app>/<object>/view/<object>.<key>`), the list
 *     object's own first; a tagged view the build does not declare is a
 *     skipped shot with the reason, never a silent omission;
 *   - `record`: the list object's first seed row — `apps/<app>/<object>/record/<id>`
 *     (the seed keeps the card's row ids verbatim); skipped when the app
 *     refused that row;
 *   - `dashboard`: a dashboard the card expects, else the build's first —
 *     `apps/<app>/dashboard/<name>`; skipped when the build declares none.
 *
 * A page the Console did not show is never proof: a navigation that answers
 * no response or a status outside 2xx (304, a revalidation, is the page), or a page that draws one of the
 * Console's own not-found views ({@link CONSOLE_NOT_FOUND}), refuses that shot
 * ({@link pageRefusal}). It is reported as a skipped shot with the reason, and
 * no file of it is kept.
 *
 * The browser is a seam ({@link ScreenshotBrowser}): {@link playwrightBrowser}
 * drives Chromium through `playwright-core`; the exporter's tests pass a
 * double. The exporter runs this step only when asked (`--no-screenshots`
 * skips it), so everything else is testable without a browser.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveStackCollection } from '@objectstack/core';
import { deriveViewContainerObject, expandViewContainer } from '@objectstack/spec/ui';

import type { LoadedScenario } from '../loader.js';
import { scenarioNamespace } from '../schema.js';
import type { AppHarness } from '../runner/app.js';
import { namespacedScenario } from '../runner/namespace.js';
import { seedApp, type BootedApp, type RunHalf } from '../runner/orchestrate.js';
import type { ShotKind } from './manifest.js';

/** Where `objectstack dev` serves the Console. */
export const CONSOLE_BASE = '/_console';

export interface PlannedShot {
  kind: ShotKind;
  /** Relative to the app's export directory: `screenshots/<kind>.png`. */
  file: string;
  /** The Console path to open, under the booted app's origin. */
  path: string;
  object?: string;
  view?: string;
  /** For a record shot: the seed row it shows. */
  row?: string;
}

export interface SkippedShot {
  kind: ShotKind;
  reason: string;
}

export interface ShotPlan {
  /** The app the Console opens, `undefined` when the build declares none. */
  app?: string;
  shots: PlannedShot[];
  skipped: SkippedShot[];
}

/** The view types a card can tag, and the tag names that tag them. */
export const TAGGED_VIEW_KINDS = { kanban: /kanban/, calendar: /calendar/ } as const satisfies Partial<Record<ShotKind, RegExp>>;

/** The view kinds the card's capability tags name, in {@link TAGGED_VIEW_KINDS} order. */
export function taggedViewKinds(card: Pick<LoadedScenario['card'], 'capabilities'>): Array<keyof typeof TAGGED_VIEW_KINDS> {
  const names = card.capabilities.map((t) => t.slice(t.indexOf('.') + 1));
  return (Object.keys(TAGGED_VIEW_KINDS) as Array<keyof typeof TAGGED_VIEW_KINDS>).filter((k) => names.some((n) => TAGGED_VIEW_KINDS[k].test(n)));
}

const nameOf = (v: unknown): string | undefined => (typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : undefined);

/** Every list view the build declares: `{ object, name: '<object>.<key>', type }`, in declaration order, containers expanded by the spec's own composer. */
export function declaredListViews(artifact: unknown): Array<{ object: string; name: string; type: string }> {
  const out: Array<{ object: string; name: string; type: string }> = [];
  for (const raw of resolveStackCollection(artifact, 'views')) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if ('list' in item || 'listViews' in item) {
      // The platform's one spelling of a container's binding (a built container usually carries no `object` of its own).
      const object = deriveViewContainerObject(item);
      if (!object) continue;
      for (const v of expandViewContainer(object, item)) {
        if (v.viewKind !== 'list') continue;
        const type = (v.config as { type?: unknown } | undefined)?.type;
        out.push({ object, name: v.name, type: typeof type === 'string' ? type : 'grid' });
      }
    } else if (typeof item.type === 'string' && typeof item.name === 'string' && typeof item.object === 'string') {
      out.push({ object: item.object, name: item.name.includes('.') ? item.name : `${item.object}.${item.name}`, type: item.type });
    }
  }
  return out;
}

const seg = (s: string) => encodeURIComponent(s);

/** Decide the screenshots for one app. Pure over the card and the build. */
export function planShots(original: LoadedScenario, artifact: unknown): ShotPlan {
  const ns = scenarioNamespace(original.card);
  const card = namespacedScenario(original).card;
  const apps = resolveStackCollection(artifact, 'apps').map(nameOf).filter((n): n is string => !!n);
  const app = apps.find((a) => a.startsWith(`${ns}_`)) ?? apps[0];
  const tagged = taggedViewKinds(original.card);
  const kinds: ShotKind[] = ['list', ...tagged, 'record', 'dashboard'];
  if (!app) return { shots: [], skipped: kinds.map((kind) => ({ kind, reason: 'the build declares no app for the Console to open' })) };

  const shots: PlannedShot[] = [];
  const skipped: SkippedShot[] = [];
  const base = `${CONSOLE_BASE}/apps/${seg(app)}`;
  const objects = new Set(resolveStackCollection(artifact, 'objects').map(nameOf).filter((n): n is string => !!n));
  const expected = [...(card.expect.appNavTargets ?? []).filter((t) => card.expect.objects.includes(t)), ...card.expect.objects];
  const object = expected.find((o) => objects.has(o));

  if (object) shots.push({ kind: 'list', file: 'screenshots/list.png', path: `${base}/${seg(object)}`, object });
  else skipped.push({ kind: 'list', reason: 'the build declares none of the objects the card expects' });

  const views = declaredListViews(artifact);
  for (const kind of tagged) {
    const ofType = views.filter((v) => v.type === kind);
    const view = ofType.find((v) => v.object === object) ?? ofType[0];
    if (view) shots.push({ kind, file: `screenshots/${kind}.png`, path: `${base}/${seg(view.object)}/view/${seg(view.name)}`, object: view.object, view: view.name });
    else skipped.push({ kind, reason: `the card tags ${kind}, and the build declares no ${kind} view` });
  }

  const row = object ? card.run.seed[object]?.[0]?.id : undefined;
  if (object && row !== undefined) shots.push({ kind: 'record', file: 'screenshots/record.png', path: `${base}/${seg(object)}/record/${seg(row)}`, object, row });
  else skipped.push({ kind: 'record', reason: object ? `the card seeds no ${object} row to open` : 'no list object to open a record of' });

  const dashboards = resolveStackCollection(artifact, 'dashboards').map(nameOf).filter((n): n is string => !!n);
  const wanted = [...(card.expect.dashboards ?? []), ...(card.iterate.expectDelta.dashboards ?? [])];
  const dashboard = wanted.find((d) => dashboards.includes(d)) ?? dashboards[0];
  if (dashboard) shots.push({ kind: 'dashboard', file: 'screenshots/dashboard.png', path: `${base}/dashboard/${seg(dashboard)}`, view: dashboard });
  else skipped.push({ kind: 'dashboard', reason: 'the build declares no dashboard' });

  return { app, shots, skipped };
}

// ── Capture ─────────────────────────────────────────────────────────────────

/**
 * The Console's own "nothing here" views, as a page shows them: the
 * `data-testid`s of the object, record and form not-found states, and the
 * title the app router's catch-all route draws (in the `en-US` locale the
 * browser runs in). Read from the Console source (`ui/packages/app-shell`,
 * `ui/apps/console`); a Console that drew a new one under another name would
 * pass this check, so the HTTP status is checked first and alone suffices for
 * a server error.
 */
export const CONSOLE_NOT_FOUND = {
  testIds: ['object-not-found', 'object-package-disabled', 'record-page-not-found', 'form-not-found'],
  titles: ['Page not found'],
} as const;

/** What a page showed, as {@link pageRefusal} judges it. */
export interface PageReading {
  /** The navigation's HTTP status; `null` when the navigation answered no response. */
  status: number | null;
  /** Which of {@link CONSOLE_NOT_FOUND}'s test ids and titles the page draws. */
  notFound: string[];
}

/** Why a page is not a screenshot of the app, or `undefined` when it is one. */
export function pageRefusal(page: PageReading): string | undefined {
  if (page.status === null) return 'the navigation answered no response';
  // 304: the browser revalidated a page it holds (each shot's page is visited twice), which is the page shown.
  if ((page.status < 200 || page.status > 299) && page.status !== 304) return `the navigation answered HTTP ${page.status}`;
  if (page.notFound.length > 0) return `the Console drew its not-found view (${page.notFound.join(', ')})`;
  return undefined;
}

/** A capture's outcome: the page was shot, or it was not the app and nothing of it is proof. */
export type CaptureOutcome = { shown: true } | { shown: false; reason: string };

/** One signed-in browser page against a booted app. */
export interface ScreenshotSession {
  /** Open `path` under the app's origin; when the page is the app ({@link pageRefusal}), write a PNG to `file`. */
  capture(path: string, file: string): Promise<CaptureOutcome>;
  close(): Promise<void>;
}

export interface ScreenshotBrowser {
  open(baseUrl: string, admin: { email: string; password: string }): Promise<ScreenshotSession>;
}

export interface CaptureInput {
  scenario: LoadedScenario;
  /** The run's scratch project, booted as the runner boots it. */
  projectDir: string;
  /** Its `dist/objectstack.json`. */
  artifact: unknown;
  /** The app's export directory; shots land at `<dir>/<shot.file>`. */
  dir: string;
}

export interface CaptureDeps {
  boot(dir: string): Promise<BootedApp>;
  harness(url: string): AppHarness;
  browser: ScreenshotBrowser;
  admin: { email: string; password: string };
}

export interface ScreenshotResult {
  shots: PlannedShot[];
  skipped: SkippedShot[];
  /** What the seed loaded, when the app was booted. */
  seed?: RunHalf['seed'];
}

export type CaptureScreenshots = (input: CaptureInput) => Promise<ScreenshotResult>;

/** Boot, seed, sign in, and take every planned shot. Throws when a shot writes no file. */
export async function captureScreenshots(input: CaptureInput, deps: CaptureDeps): Promise<ScreenshotResult> {
  const plan = planShots(input.scenario, input.artifact);
  if (plan.shots.length === 0) return { shots: [], skipped: plan.skipped };
  const booted = await deps.boot(input.projectDir);
  try {
    const app = deps.harness(booted.url);
    await app.signInAdmin();
    const seed = await seedApp(namespacedScenario(input.scenario), app, []);
    const refused = new Set(seed.refused.map((r) => `${r.object}/${r.id}`));
    const shots: PlannedShot[] = [];
    const skipped = [...plan.skipped];
    for (const shot of plan.shots) {
      if (shot.kind === 'record' && refused.has(`${shot.object}/${shot.row}`)) skipped.push({ kind: 'record', reason: `the app refused seed row ${shot.object} ${shot.row}` });
      else shots.push(shot);
    }
    const session = await deps.browser.open(booted.url, deps.admin);
    try {
      for (const shot of [...shots]) {
        const file = join(input.dir, shot.file);
        mkdirSync(dirname(file), { recursive: true });
        const outcome = await session.capture(shot.path, file);
        if (!outcome.shown) {
          rmSync(file, { force: true });
          shots.splice(shots.indexOf(shot), 1);
          skipped.push({ kind: shot.kind, reason: `the Console did not show ${shot.path}: ${outcome.reason}` });
          continue;
        }
        if (!existsSync(file)) throw new Error(`the browser wrote no screenshot for ${shot.kind} (${shot.path})`);
      }
    } finally {
      await session.close();
    }
    return { shots, skipped, seed };
  } finally {
    await booted.stop();
  }
}

// ── The real browser ────────────────────────────────────────────────────────

export interface PlaywrightBrowserOptions {
  /** A Chromium executable; default `$PLAYWRIGHT_BROWSERS_PATH/chromium` when it exists, else playwright-core's own. */
  executablePath?: string;
  viewport?: { width: number; height: number };
  /** How long a page may take to go quiet before it is shot anyway; default 30 s. */
  settleTimeoutMs?: number;
}

/** Chromium through `playwright-core`, signed in by the Console's own sign-in door so the session cookie is the browser's. */
export function playwrightBrowser(opts: PlaywrightBrowserOptions = {}): ScreenshotBrowser {
  return {
    async open(baseUrl, admin) {
      const { chromium } = await import('playwright-core');
      const fallback = process.env.PLAYWRIGHT_BROWSERS_PATH ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined;
      const executablePath = opts.executablePath ?? (fallback && existsSync(fallback) ? fallback : undefined);
      const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      try {
        const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, locale: 'en-US' });
        const signIn = await context.request.post(`${baseUrl}/api/v1/auth/sign-in/email`, { data: admin });
        if (!signIn.ok()) throw new Error(`the browser's admin sign-in was refused: ${signIn.status()}`);
        const page = await context.newPage();
        const visit = async (path: string): Promise<PageReading> => {
          const response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' });
          // A page that never goes quiet (a stream, a poll) is shot after the budget, not skipped.
          await page.waitForLoadState('networkidle', { timeout: opts.settleTimeoutMs ?? 30_000 }).catch(() => undefined);
          await page.waitForTimeout(1_000);
          const notFound: string[] = [];
          for (const id of CONSOLE_NOT_FOUND.testIds) if ((await page.locator(`[data-testid="${id}"]`).count()) > 0) notFound.push(id);
          for (const title of CONSOLE_NOT_FOUND.titles) if ((await page.getByText(title, { exact: true }).count()) > 0) notFound.push(`"${title}"`);
          return { status: response ? response.status() : null, notFound };
        };
        // An administrator's first visit to an app page can open first-run UI over it (measured on
        // 18.3: a default-currency dialog over the first app page, once per browser session; the
        // Console's landing page does not take it). So the first shot's page is visited once
        // unshot, and nothing is shot under that dialog.
        let warmed = false;
        return {
          async capture(path, file) {
            if (!warmed) {
              await visit(path);
              warmed = true;
            }
            const refusal = pageRefusal(await visit(path));
            if (refusal !== undefined) return { shown: false, reason: refusal };
            await page.screenshot({ path: file });
            return { shown: true };
          },
          close: () => browser.close(),
        };
      } catch (e) {
        await browser.close();
        throw e;
      }
    },
  };
}
