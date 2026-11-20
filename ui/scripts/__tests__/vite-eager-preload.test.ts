import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUIRED_DYNAMIC_TARGETS,
  dynamicSitesOf,
  htmlNamedScripts,
  judgePreloadHops,
  measurePreloadHops,
  preloadStaticClosure,
  staticImportsOf,
  type EmittedChunk,
} from '../vite-eager-preload.ts';

/**
 * objectstack#35455 — the hop pin. The POLICY half: which emitted shapes are
 * one wave, which are more, and which are refused as blind. The GRAPH half —
 * what Vite and rolldown actually emit — runs on every console build through
 * `viteEagerPreload()` in `apps/console/vite.config.ts`.
 *
 * The fixtures are written in the shape the console build emits: minified
 * static imports (`import{a}from"./x.js"`), and `import()` sites wrapped as
 * `PRELOAD(FN,__vite__mapDeps([..]),import.meta.url)` with the file list at the
 * top of the importing chunk.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const VITE_CONFIG = path.join(REPO_ROOT, 'apps/console/vite.config.ts');

const ENTRY = 'assets/index-AAAAAAAA.js';
const VENDOR = 'assets/vendor-react-BBBBBBBB.js';
const SHELL = 'assets/framework-CCCCCCCC.js';
const LIST = 'assets/ObjectView-DDDDDDDD.js';
const CRUD = 'assets/objectViewViewCrud-EEEEEEEE.js';
const PERSIST = 'assets/runtime-metadata-persistence-FFFFFFFF.js';
const SLUG = 'assets/createDerive-GGGGGGGG.js';
const RECORD = 'assets/RecordDetailView-HHHHHHHH.js';
const ACTIONS = 'assets/useObjectActions-IIIIIIII.js';

const rel = (file: string) => `./${file.replace('assets/', '')}`;
const mapDeps = (files: string[]) =>
  `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(files.map(rel))})))=>i.map(i=>d[i]);\n`;

/** The entry, with its two route imports wrapped as the console build wraps them. */
function entryCode(listDeps: string[] | null, recordDeps: string[] | null): string {
  const files = [...(listDeps ?? []), ...(recordDeps ?? [])];
  const at = (deps: string[] | null, offset: number) =>
    deps === null ? 'void 0' : `__vite__mapDeps([${deps.map((_, i) => i + offset).join(',')}])`;
  return (
    (files.length ? mapDeps(files) : '') +
    `import{a as e}from"${rel(VENDOR)}";import"${rel(SHELL)}";` +
    `const L=e(()=>H(()=>import(\`${rel(LIST)}\`).then(e=>e.ObjectView),${at(listDeps, 0)},import.meta.url));` +
    `const R=e(()=>H(async()=>{let{RecordDetailView:t}=await import(\`${rel(RECORD)}\`);return{RecordDetailView:t}},${at(recordDeps, listDeps?.length ?? 0)},import.meta.url));`
  );
}

function chunk(fileName: string, code: string, isEntry = false): EmittedChunk {
  const name = fileName.replace('assets/', '').replace(/-[A-Z]{8}\.js$/, '');
  return { fileName, name, isEntry, code, imports: staticImportsOf(fileName, code) };
}

const LIST_CLOSURE = [LIST, CRUD, PERSIST, SLUG];
const RECORD_CLOSURE = [RECORD, ACTIONS];

function build(opts: { htmlPreloads: string[]; listDeps: string[] | null; recordDeps: string[] | null }): {
  html: string;
  chunks: EmittedChunk[];
} {
  const html =
    `<html><head><script type="module" crossorigin src="./${ENTRY}"></script>` +
    opts.htmlPreloads.map((f) => `<link rel="modulepreload" crossorigin href="./${f}">`).join('') +
    `</head><body></body></html>`;
  const chunks = [
    chunk(ENTRY, entryCode(opts.listDeps, opts.recordDeps), true),
    chunk(VENDOR, 'export const a=1;'),
    chunk(SHELL, `import{a}from"${rel(VENDOR)}";export const s=a;`),
    chunk(LIST, `import{c}from"${rel(CRUD)}";import{a}from"${rel(VENDOR)}";export const ObjectView=c;`),
    chunk(CRUD, `import{p}from"${rel(PERSIST)}";export const c=p;`),
    chunk(PERSIST, `import{slugify as s}from"${rel(SLUG)}";export const p=s;`),
    chunk(SLUG, 'export const slugify=1;'),
    chunk(RECORD, `import{u}from"${rel(ACTIONS)}";export const RecordDetailView=u;`),
    chunk(ACTIONS, 'export const u=1;'),
  ];
  return { html, chunks };
}

/** What the console emits with `modulePreload: { resolveDependencies: preloadStaticClosure }`. */
const ONE_WAVE = () => build({ htmlPreloads: [VENDOR, SHELL], listDeps: LIST_CLOSURE, recordDeps: RECORD_CLOSURE });

describe('vite-eager-preload: the hop pin (objectstack#35455)', () => {
  it('reads one wave when index.html names the eager closure and each import() preloads its static closure', () => {
    const { html, chunks } = ONE_WAVE();
    const hops = measurePreloadHops(html, chunks);
    expect(hops.eagerFiles).toBe(3);
    expect(hops.eagerMaxWave).toBe(1);
    const byTarget = new Map(hops.dynamicSites.map((s) => [s.targetName, s]));
    expect(byTarget.get('ObjectView')).toMatchObject({ closure: 4, maxWave: 1, late: [] });
    expect(byTarget.get('RecordDetailView')).toMatchObject({ closure: 2, maxWave: 1, late: [] });
    expect(judgePreloadHops(hops).ok).toBe(true);
  });

  it('CONTROL: the shape `modulePreload: false` emitted is red — eager files and route imports arrive wave by wave', () => {
    // The build on origin/main before #35455: five prefix-chosen preload tags
    // (here: one) and every import() wrapped with `void 0` deps.
    const { html, chunks } = build({ htmlPreloads: [VENDOR], listDeps: null, recordDeps: null });
    const hops = measurePreloadHops(html, chunks);
    expect(hops.eagerMaxWave).toBe(2);
    expect(hops.eagerLate).toEqual([`${SHELL} (wave 2)`]);
    const list = hops.dynamicSites.find((s) => s.targetName === 'ObjectView');
    // ObjectView -> objectViewViewCrud -> runtime-metadata-persistence -> createDerive
    expect(list?.maxWave).toBe(4);
    expect(hops.dynamicSites.find((s) => s.targetName === 'RecordDetailView')?.maxWave).toBe(2);
    const verdict = judgePreloadHops(hops);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('more than one wave');
  });

  it('is red when a resolveDependencies filter drops one file of a route closure', () => {
    const { html, chunks } = build({ htmlPreloads: [VENDOR, SHELL], listDeps: [LIST, CRUD, PERSIST], recordDeps: RECORD_CLOSURE });
    const hops = measurePreloadHops(html, chunks);
    expect(hops.dynamicSites.find((s) => s.targetName === 'ObjectView')?.late).toEqual([`${SLUG} (wave 2)`]);
    expect(judgePreloadHops(hops).ok).toBe(false);
  });

  it('is red when index.html stops naming an eager file', () => {
    const { html, chunks } = build({ htmlPreloads: [VENDOR], listDeps: LIST_CLOSURE, recordDeps: RECORD_CLOSURE });
    expect(judgePreloadHops(measurePreloadHops(html, chunks)).ok).toBe(false);
  });

  it('counts the importer and its static closure as loaded when its import() runs', () => {
    // RecordDetailView imported from ObjectView: useObjectActions is already
    // loaded if ObjectView imports it statically, and Vite leaves it out.
    const { html, chunks } = ONE_WAVE();
    const list = chunks.find((c) => c.fileName === LIST) as EmittedChunk;
    list.code =
      mapDeps([RECORD]) +
      `import{c}from"${rel(CRUD)}";import{u}from"${rel(ACTIONS)}";` +
      `const R=H(()=>import(\`${rel(RECORD)}\`),__vite__mapDeps([0]),import.meta.url);export const ObjectView=c;`;
    list.imports = staticImportsOf(LIST, list.code);
    const site = measurePreloadHops(html, chunks).dynamicSites.find((s) => s.importer === LIST);
    expect(site).toMatchObject({ targetName: 'RecordDetailView', maxWave: 1 });
  });
});

describe('vite-eager-preload: refuses a verdict it cannot see', () => {
  it('refuses when the code parser disagrees with rolldown on a static edge', () => {
    const { html, chunks } = ONE_WAVE();
    (chunks.find((c) => c.fileName === CRUD) as EmittedChunk).imports = [PERSIST, SLUG];
    const verdict = judgePreloadHops(measurePreloadHops(html, chunks));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/^cannot judge: the static-import parser/);
  });

  it('refuses when no import() target has a closure to preload', () => {
    const { html, chunks } = ONE_WAVE();
    const entry = chunks[0];
    entry.code = `import{a as e}from"${rel(VENDOR)}";import"${rel(SHELL)}";`;
    entry.imports = staticImportsOf(ENTRY, entry.code);
    expect(judgePreloadHops(measurePreloadHops(html, chunks)).message).toMatch(/^cannot judge: no import\(\) target/);
  });

  it(`refuses when a measured route chunk (${REQUIRED_DYNAMIC_TARGETS.join(', ')}) is missing`, () => {
    const { html, chunks } = ONE_WAVE();
    for (const c of chunks) if (c.name === 'RecordDetailView') c.name = 'SomethingElse';
    expect(judgePreloadHops(measurePreloadHops(html, chunks)).message).toMatch(/^cannot judge: the route chunk\(s\) RecordDetailView/);
  });

  it('refuses when the eager walk reaches the entry alone', () => {
    const { chunks } = ONE_WAVE();
    const html = '<html><head></head></html>';
    const lone = chunks.map((c) => (c.isEntry ? { ...c, code: '', imports: [] } : c));
    expect(judgePreloadHops(measurePreloadHops(html, lone)).message).toMatch(/^cannot judge: the eager walk/);
  });
});

describe('vite-eager-preload: readers', () => {
  it('reads static imports and not dynamic ones', () => {
    expect(staticImportsOf('assets/a.js', 'import"./b.js";import{x}from"./c.js";export*from"../d.js";import(`./e.js`)')).toEqual([
      'assets/b.js',
      'assets/c.js',
      'd.js',
    ]);
  });

  it('reads the deps of a site past a `.then` chain and past an async body', () => {
    const code = entryCode(LIST_CLOSURE, RECORD_CLOSURE);
    expect(dynamicSitesOf(ENTRY, code)).toEqual([
      { target: LIST, deps: LIST_CLOSURE },
      { target: RECORD, deps: RECORD_CLOSURE },
    ]);
  });

  it('does not let a site without deps borrow the next site\'s', () => {
    expect(dynamicSitesOf(ENTRY, entryCode(null, RECORD_CLOSURE))).toEqual([
      { target: LIST, deps: [] },
      { target: RECORD, deps: RECORD_CLOSURE },
    ]);
  });

  it('reads module scripts and modulepreload links from index.html, nothing else', () => {
    const html =
      '<script type="module" src="./assets/index-X.js"></script><link rel="modulepreload" href="./assets/a.js">' +
      '<link rel="stylesheet" href="./assets/a.css"><script src="./legacy.js"></script>';
    expect([...htmlNamedScripts(html)]).toEqual(['assets/index-X.js', 'assets/a.js']);
  });
});

describe('vite-eager-preload: the console build wires it', () => {
  const config = fs.readFileSync(VITE_CONFIG, 'utf8');

  it('sets modulePreload to keep each dependency list whole, and runs the guard', () => {
    expect(config).toMatch(/modulePreload:\s*\{\s*polyfill:\s*false,\s*resolveDependencies:\s*preloadStaticClosure\s*\}/);
    expect(config).not.toMatch(/modulePreload:\s*false/);
    expect(config).toMatch(/^\s*viteEagerPreload\(\),/m);
  });

  it('preloadStaticClosure keeps every dep, for both hosts', () => {
    const deps = ['assets/a.js', 'assets/b.js'];
    expect(preloadStaticClosure('assets/index.js', deps, { hostId: 'index.html', hostType: 'html' })).toEqual(deps);
    expect(preloadStaticClosure('assets/x.js', deps, { hostId: 'assets/y.js', hostType: 'js' })).toEqual(deps);
  });
});
