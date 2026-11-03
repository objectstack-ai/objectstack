import { test, expect, type Page } from '@playwright/test';
import { compile } from 'tailwindcss';
import { build, type Plugin, type Rollup } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uiRoot } from '../scripts/ui-root.mjs';

/**
 * GEOMETRY pin for objectstack#29677: in the permission matrix, an expanded
 * object's field Read and Edit boxes stay in view and clickable while the
 * matrix scrolls sideways, at any pane width, and the field name beside them
 * stays readable.
 *
 * ## The defect
 *
 * The matrix has a 1304 px floor, so a narrower pane scrolls sideways. The
 * field sub-table under an expanded object sits in one cell spanning the whole
 * matrix, and its name column was the table's flexible one: it took all the
 * width the other three columns left (697 px at the floor). objectstack#26846
 * pinned that column to the pane's left edge, so from a scroll of about 80 px
 * on it covered both boxes (`elementFromPoint` at a box centre answered the
 * name cell), and below 1304 px of pane the boxes could not be reached at all.
 * The whole field panel is now pinned at the cell's inset and no wider than
 * the pane shows (`FIELD_PANEL` in `PermissionMatrixEditor.tsx`).
 *
 * ## Why a Playwright spec and not a vitest test
 *
 * jsdom and happy-dom have no layout engine: no rect, no sticky offset, no
 * `elementFromPoint`. The claims here are what a browser hits at a point after
 * a scroll. The bundling follows `e2e/studio-item-header-title-width.spec.ts`.
 *
 * ## What is real here and what is a fixture
 *
 * REAL: `PermissionMatrixEditPage` and everything it imports (the scroll pane,
 * both matrix renderings, the field sub-table, `@object-ui/components`),
 * bundled by Vite from their source files and mounted in Chromium with React's
 * client renderer. The stylesheet is real Tailwind:
 * `packages/components/src/index.css` (its `@theme` included), compiled for
 * exactly the classes the mounted page carries.
 *
 * FIXTURES, declared so nobody reads more into a green run than it says:
 *
 *   - The metadata client is a stub (`useMetadata` is replaced at bundle time,
 *     the way the jsdom tests `vi.mock` it): a writable set granting read on
 *     one object with eight fields, the Studio Access rendering
 *     (`studio`, package scope) and the metadata-admin one (environment scope).
 *     `AssignedUsersSection` renders nothing.
 *   - The pane's width is set by the frame around the page, not by the
 *     console's rail and aside. Fonts are Chromium's fallbacks; the assertions
 *     are hits and containment, not pixels, and the readings go to the report.
 */

const REPO_ROOT = uiRoot();
const source = (rel: string) => path.join(REPO_ROOT, rel);

const EDITOR = source('packages/app-shell/src/views/metadata-admin/PermissionMatrixEditor.tsx');
const THEME_CSS = source('packages/components/src/index.css');

const OBJECT = 'a_project';
/** Eight fields, so the sub-table's filter renders (it shows above six). */
const FIELDS = ['amount', 'email', 'name', 'notes', 'phone', 'region', 'revenue', 'status'];
/** The matrix floor (`min-w-[1304px]` on both tables). */
const FLOOR = 1304;
/** The card's reading: scroll offsets around the one it broke at (80 px). */
const OFFSETS = [0, 40, 57, 80, 120, 200, 320, 480];

type Host = 'studio' | 'environment';

interface Case {
  name: string;
  host: Host;
  /** The frame's width: the pane's, the page having no rail or aside here. */
  width: number;
}

const ENTRY = '\0permission-field-panel:entry';
const STUB_METADATA = '\0permission-field-panel:useMetadata';
const STUB_ASSIGNED = '\0permission-field-panel:AssignedUsersSection';
const REAL_SUFFIX = '?permission-field-panel-real';

/** `@object-ui/<pkg>` to `packages/<pkg>/src`, and a subpath into that `src/`. */
function workspaceSources(): Plugin {
  return {
    name: 'permission-field-panel-workspace-src',
    enforce: 'pre',
    async resolveId(id, importer) {
      const m = /^@object-ui\/([a-z0-9-]+)(?:\/(.+))?$/.exec(id);
      if (!m) return null;
      const [, pkg, sub] = m;
      const target =
        pkg === 'types' && sub === 'zod'
          ? source('packages/types/src/zod/index.zod.ts')
          : source(`packages/${pkg}/src${sub ? `/${sub}` : ''}`);
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (!resolved) throw new Error(`${id} did not resolve to a source file under ${target}`);
      return resolved;
    },
  };
}

/**
 * The metadata client and the holders list, stubbed where the editor imports
 * them. Every other export of either module is the real one.
 */
function stubs(): Plugin {
  return {
    name: 'permission-field-panel-stubs',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id.endsWith(REAL_SUFFIX)) {
        const resolved = await this.resolve(id.slice(0, -REAL_SUFFIX.length), importer, { skipSelf: true });
        return resolved?.id ?? null;
      }
      if (importer === STUB_METADATA || importer === STUB_ASSIGNED) return null;
      if (!/(^|\/)(useMetadata|AssignedUsersSection)(\.js|\.tsx?)?$/.test(id)) return null;
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved) return null;
      if (/metadata-admin\/useMetadata\.tsx?$/.test(resolved.id)) return STUB_METADATA;
      if (/metadata-admin\/AssignedUsersSection\.tsx?$/.test(resolved.id)) return STUB_ASSIGNED;
      return null;
    },
    load(id) {
      if (id === STUB_METADATA) {
        const real = source('packages/app-shell/src/views/metadata-admin/useMetadata.ts') + REAL_SUFFIX;
        return `
export * from ${JSON.stringify(real)};
export function useMetadataClient() { return window.__client; }
export function useMetadataTypes() {
  return { loading: false, error: null, entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }] };
}`;
      }
      if (id === STUB_ASSIGNED) {
        const real = source('packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx') + REAL_SUFFIX;
        return `export * from ${JSON.stringify(real)};\nexport function AssignedUsersSection() { return null; }`;
      }
      return null;
    },
  };
}

/** The page: the case named by `window.__case`, mounted with the client renderer. */
function entry(): Plugin {
  const code = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PermissionMatrixEditPage } from ${JSON.stringify(EDITOR)};

const h = React.createElement;
const c = window.__case;
const FIELDS = ${JSON.stringify(FIELDS)};
window.__client = {
  layered: async () => ({
    effective: { name: 'project_editor', label: 'Project editor', objects: { ${OBJECT}: { allowRead: true } }, fields: {} },
    code: null,
    overlay: null,
    overlayScope: null,
  }),
  getDraft: async () => null,
  withPreviewDrafts() { return this; },
  list: async (type) => (type === 'object' ? [{ item: { name: '${OBJECT}', label: 'Project' } }] : []),
  get: async (type) => (type === 'object' ? { fields: FIELDS.map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })) } : null),
  save: async (_type, _name, payload) => payload,
  listTypes: async () => [{ type: 'permission' }],
};

createRoot(document.getElementById('root')).render(
  h('div', { id: 'frame', className: 'bg-background', style: { width: c.width + 'px', height: '760px', display: 'flex', flexDirection: 'column' } },
    h(MemoryRouter, null,
      h(PermissionMatrixEditPage, {
        type: 'permission',
        name: 'project_editor',
        packageId: c.host === 'studio' ? 'app.a' : undefined,
        studio: c.host === 'studio' ? { tab: 'objects', onTabChange: () => {} } : undefined,
      }))),
);
`;
  return {
    name: 'permission-field-panel-entry',
    resolveId: (id) => (id === 'permission-field-panel:entry' ? ENTRY : null),
    load: (id) => (id === ENTRY ? code : null),
  };
}

/** Bundle the page once, from source, to one ES module held in memory. */
async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    root: REPO_ROOT,
    // Out of the tree: this run must leave nothing behind in the checkout.
    cacheDir: path.join(os.tmpdir(), 'objectui-permission-field-panel'),
    logLevel: 'error',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [stubs(), workspaceSources(), entry()],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: 'permission-field-panel:entry',
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  const chunks = outputs.flatMap((o) => o.output).filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`expected one bundled chunk, got ${chunks.length}`);
  return chunks[0].code;
}

/** The real theme sheet, compiled for the given class candidates. */
async function tailwindFor(candidates: string[]): Promise<string> {
  const requireFromComponents = createRequire(source('packages/components/package.json'));
  const twEntry = requireFromComponents.resolve('tailwindcss/index.css');
  const compiler = await compile(readFileSync(THEME_CSS, 'utf8'), {
    base: path.dirname(THEME_CSS),
    loadStylesheet: async (id: string, base: string) => {
      const file = id === 'tailwindcss' ? twEntry : path.resolve(base, id);
      return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
    },
    loadModule: async (id: string) => {
      const file = requireFromComponents.resolve(id);
      const mod = await import(pathToFileURL(file).href);
      return { path: file, base: path.dirname(file), module: mod.default ?? mod };
    },
  });
  const css = compiler.build(candidates);
  // A stylesheet missing the rules under test would measure an unstyled matrix
  // and could pass for the wrong reason: the floor and the pins must be there.
  for (const needle of ['min-width: 1304px', 'position: sticky', 'overflow: auto']) {
    if (!css.includes(needle)) throw new Error(`Tailwind emitted nothing for ${needle}; the matrix would be unstyled.`);
  }
  return css;
}

let bundle = '';

/** Compile the stylesheet until the page's class set stops growing. */
async function styleUntilStable(page: Page, compiled: Set<string>): Promise<void> {
  const classesOnPage = () =>
    page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[class]')].flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)).filter(Boolean),
      ),
    ]);
  for (let round = 0; ; round++) {
    const candidates = await classesOnPage();
    if (round > 0 && candidates.every((cls) => compiled.has(cls))) break;
    if (round === 5) throw new Error('the page kept adding classes; the stylesheet never caught up');
    candidates.forEach((cls) => compiled.add(cls));
    const css = await tailwindFor([...compiled]);
    await page.evaluate((text) => {
      let sheet = document.getElementById('tailwind');
      if (!sheet) {
        sheet = document.createElement('style');
        sheet.id = 'tailwind';
        document.head.appendChild(sheet);
      }
      sheet.textContent = text;
    }, css);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
}

/** Mount the case and expand the object, so its field panel shows. */
async function mount(page: Page, c: Case): Promise<void> {
  await page.setViewportSize({ width: c.width, height: 800 });
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __case: Case }).__case = value;
  }, c);
  await page.addScriptTag({ content: bundle, type: 'module' });
  const compiled = new Set<string>();
  const expand = page.getByRole('button', { name: new RegExp(`^Project\\W*${OBJECT}\\W*$`) });
  await expand.waitFor({ state: 'attached', timeout: 30_000 });
  await styleUntilStable(page, compiled);
  await expand.click();
  await page.getByLabel(`${OBJECT}.notes readable`).waitFor({ state: 'attached', timeout: 10_000 });
  await styleUntilStable(page, compiled);
  await page.evaluate(() => document.fonts?.ready);
}

interface Hit {
  field: string;
  /** The Read box answers `elementFromPoint` at its centre. */
  read: boolean;
  edit: boolean;
  /** The box's centre lies inside the pane's visible box. */
  readInPane: boolean;
  editInPane: boolean;
  /** The name cell answers at its first characters, inside the pane. */
  name: boolean;
  /** What answered at the Read box's centre, when not the box. */
  readHitBy: string | null;
}

interface Reading {
  scrollLeft: number;
  pane: { clientWidth: number; scrollWidth: number };
  panel: { left: number; width: number };
  cellContentWidth: number;
  hits: Hit[];
}

/** Scroll the pane to `left` and read what each field's boxes and name answer. */
async function readAt(page: Page, left: number): Promise<Reading> {
  return page.evaluate(
    async ({ left, object, fields }) => {
      const pane = document.querySelector<HTMLElement>('[data-testid="perm-matrix-pane"]')!;
      pane.scrollLeft = left;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const paneRect = pane.getBoundingClientRect();
      const visible = {
        left: paneRect.left,
        right: paneRect.left + pane.clientWidth,
        top: paneRect.top,
        bottom: paneRect.top + pane.clientHeight,
      };
      const inPane = (x: number, y: number) => x >= visible.left && x < visible.right && y >= visible.top && y < visible.bottom;
      const describe = (el: Element | null) =>
        el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}` : null;
      const centreHit = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const at = document.elementFromPoint(x, y);
        return { ok: !!at && (at === el || el.contains(at)), inPane: inPane(x, y), at };
      };
      const hits = fields.map((field) => {
        const read = centreHit(document.querySelector<HTMLElement>(`[aria-label="${object}.${field} readable"]`)!);
        const edit = centreHit(document.querySelector<HTMLElement>(`[aria-label="${object}.${field} editable"]`)!);
        const nameCell = document.querySelector<HTMLElement>(`[data-testid="perm-field-name-${object}-${field}"]`)!;
        const nr = nameCell.getBoundingClientRect();
        const nx = nr.left + 4;
        const ny = nr.top + nr.height / 2;
        const nameAt = document.elementFromPoint(nx, ny);
        return {
          field,
          read: read.ok,
          edit: edit.ok,
          readInPane: read.inPane,
          editInPane: edit.inPane,
          name: inPane(nx, ny) && !!nameAt && (nameAt === nameCell || nameCell.contains(nameAt)),
          readHitBy: read.ok ? null : describe(read.at),
        };
      });
      const panel = document.querySelector<HTMLElement>(`[data-testid="perm-field-panel-${object}"]`);
      const cell = (panel ?? document.querySelector(`[data-testid="perm-field-count-${object}"]`))!.closest('td')!;
      const cs = getComputedStyle(cell);
      const pr = panel?.getBoundingClientRect();
      return {
        scrollLeft: Math.round(pane.scrollLeft),
        pane: { clientWidth: pane.clientWidth, scrollWidth: pane.scrollWidth },
        panel: { left: pr ? Math.round(pr.left - paneRect.left) : -1, width: pr ? Math.round(pr.width) : -1 },
        cellContentWidth: Math.round(cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
        hits,
      };
    },
    { left, object: OBJECT, fields: FIELDS },
  );
}

async function sweep(page: Page, c: Case, testInfo: import('@playwright/test').TestInfo): Promise<Reading[]> {
  await mount(page, c);
  const max = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('[data-testid="perm-matrix-pane"]')!;
    return pane.scrollWidth - pane.clientWidth;
  });
  const offsets = [...new Set([...OFFSETS.filter((o) => o < max), max])];
  const readings: Reading[] = [];
  for (const o of offsets) readings.push(await readAt(page, o));
  const summary = readings.map((r) => ({
    scrollLeft: r.scrollLeft,
    pane: r.pane,
    panel: r.panel,
    covered: r.hits.filter((h) => !h.read || !h.edit).map((h) => `${h.field}:${h.readHitBy}`),
  }));
  testInfo.annotations.push({ type: `permission-field-panel@${c.name}`, description: JSON.stringify(summary) });
  process.stdout.write(`[permission-field-panel ${c.name}] ${JSON.stringify(summary)}\n`);
  return readings;
}

/** Every box answers at its centre, inside the pane, and every name is readable. */
function expectAllReachable(readings: Reading[]): void {
  for (const r of readings) {
    for (const h of r.hits) {
      const where = `${h.field} at scrollLeft ${r.scrollLeft} (pane ${r.pane.clientWidth}/${r.pane.scrollWidth})`;
      expect(h.read, `Read box of ${where} is covered by ${h.readHitBy}`).toBe(true);
      expect(h.edit, `Edit box of ${where} is covered`).toBe(true);
      expect(h.readInPane && h.editInPane, `boxes of ${where} lie outside the pane`).toBe(true);
      expect(h.name, `the name of ${where} is not readable`).toBe(true);
    }
  }
}

test.beforeAll(async () => {
  // Bundling the editor's module graph is the slow part; once per worker.
  test.setTimeout(300_000);
  bundle = await bundlePage();
});

test.describe('an expanded object’s field boxes stay reachable while the matrix scrolls sideways (objectstack#29677)', () => {
  test.setTimeout(120_000);

  for (const host of ['studio', 'environment'] as const) {
    for (const width of [1000, 720]) {
      test(`${host} rendering, ${width} px pane: every Read and Edit box answers at its centre at every scroll offset`, async ({
        page,
      }, testInfo) => {
        const readings = await sweep(page, { name: `${host}-${width}`, host, width }, testInfo);
        // The pane really scrolls, and far past the card's 80 px.
        expect(readings[0].pane.scrollWidth).toBeGreaterThanOrEqual(FLOOR);
        expect(readings.at(-1)!.scrollLeft).toBeGreaterThan(80);
        expectAllReachable(readings);
        // The panel holds its place at the cell's inset whatever the offset.
        const lefts = new Set(readings.map((r) => r.panel.left));
        expect([...lefts], 'the field panel moved with the scroll').toHaveLength(1);
      });
    }
  }

  test('CONTROL: where the pane holds the whole floor, nothing scrolls and every box answers, as before', async ({ page }, testInfo) => {
    const readings = await sweep(page, { name: 'studio-1600', host: 'studio', width: 1600 }, testInfo);
    expect(readings).toHaveLength(1);
    expect(readings[0].scrollLeft).toBe(0);
    expect(readings[0].pane.scrollWidth).toBeLessThanOrEqual(readings[0].pane.clientWidth);
    expectAllReachable(readings);
    // The panel spans the cell as the table did: the pin binds only when the
    // pane is narrower than the matrix (the Studio cell's right inset is 24 px
    // less than the panel reserves).
    expect(readings[0].cellContentWidth - readings[0].panel.width).toBeLessThanOrEqual(24);
  });
});
