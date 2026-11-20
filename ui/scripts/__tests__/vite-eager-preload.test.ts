import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUIRED_DYNAMIC_TARGETS,
  dynamicSitesOf,
  eagerClosureOf,
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
 * `eagerPreload()` in `apps/console/vite.config.ts`.
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

// What `preloadStaticClosure` hands Vite for each site: the target's static
// closure without the target itself and without eager files.
const LIST_CLOSURE = [CRUD, PERSIST, SLUG];
const RECORD_CLOSURE = [ACTIONS];

function build(opts: { htmlPreloads: string[]; listDeps: string[] | null; recordDeps: string[] | null; base?: string }): {
  html: string;
  chunks: EmittedChunk[];
} {
  // Vite writes index.html's URLs under the build's `base`: `./assets/…` for
  // the default relative base, `/console/assets/…` for the E2E and hosted one.
  const at = opts.base ?? './';
  const html =
    `<html><head><script type="module" crossorigin src="${at}${ENTRY}"></script>` +
    opts.htmlPreloads.map((f) => `<link rel="modulepreload" crossorigin href="${at}${f}">`).join('') +
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
  it('reads index.html under an absolute base, as the E2E build writes it (VITE_BASE_PATH=/console/)', () => {
    const preloaded = build({ base: '/console/', htmlPreloads: [VENDOR, SHELL], listDeps: LIST_CLOSURE, recordDeps: RECORD_CLOSURE });
    const hops = measurePreloadHops(preloaded.html, preloaded.chunks, '/console/');
    expect(hops).toMatchObject({ entry: ENTRY, eagerFiles: 3, eagerMaxWave: 1 });
    expect(judgePreloadHops(hops).ok).toBe(true);
    // The CONTROL holds under that base too: a missing preload tag is a late eager file.
    const bare = build({ base: '/console/', htmlPreloads: [VENDOR], listDeps: LIST_CLOSURE, recordDeps: RECORD_CLOSURE });
    expect(measurePreloadHops(bare.html, bare.chunks, '/console/')).toMatchObject({ eagerMaxWave: 2, eagerLate: [`${SHELL} (wave 2)`] });
    expect(judgePreloadHops(measurePreloadHops(bare.html, bare.chunks, '/console/')).ok).toBe(false);
  });

  it('refuses to judge an index.html read under the wrong base, instead of walking from a guessed entry', () => {
    // The reader that ignored `base` read every /console/ URL as an unknown
    // file, walked from the first entry it was handed, and reported each
    // preloaded eager file as wave 2.
    const { html, chunks } = build({ base: '/console/', htmlPreloads: [VENDOR, SHELL], listDeps: LIST_CLOSURE, recordDeps: RECORD_CLOSURE });
    const hops = measurePreloadHops(html, chunks, './');
    expect(hops.entry).toBe('');
    const verdict = judgePreloadHops(hops);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/^cannot judge: index\.html names none of the entry chunks/);
  });

  it('does not count a URL outside the base as one of the build\'s files', () => {
    const html = `<script type="module" src="/console/${ENTRY}"></script><link rel="modulepreload" href="/other/${VENDOR}"><link rel="modulepreload" href="https://cdn.example/${SHELL}">`;
    expect([...htmlNamedScripts(html, '/console/')]).toEqual([ENTRY]);
    expect([...htmlNamedScripts(`<script type="module" src="/${ENTRY}"></script>`, './')]).toEqual([]);
  });

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
    const { html, chunks } = build({ htmlPreloads: [VENDOR, SHELL], listDeps: [CRUD, PERSIST], recordDeps: RECORD_CLOSURE });
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
      `import{c}from"${rel(CRUD)}";import{u}from"${rel(ACTIONS)}";` +
      `const R=H(()=>import(\`${rel(RECORD)}\`),[],import.meta.url);export const ObjectView=c;`;
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
    const html = `<html><head><script type="module" src="./${ENTRY}"></script></head></html>`;
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

  it('sets modulePreload to the shared policy, and runs its guard', () => {
    expect(config).toMatch(/const consolePreload = eagerPreload\(\);/);
    expect(config).toMatch(/modulePreload:\s*\{\s*polyfill:\s*false,\s*resolveDependencies:\s*consolePreload\.resolveDependencies\s*\}/);
    expect(config).not.toMatch(/modulePreload:\s*false/);
    expect(config).toMatch(/^\s*consolePreload\.plugin,/m);
  });

  it('preloadStaticClosure keeps the HTML deps whole and drops eager files and the target from an import()', () => {
    const resolve = preloadStaticClosure(new Set([ENTRY, VENDOR, SHELL]));
    const html = [VENDOR, SHELL];
    expect(resolve(ENTRY, html, { hostId: 'index.html', hostType: 'html' })).toEqual(html);
    expect(resolve(LIST, [LIST, VENDOR, CRUD, SHELL, PERSIST], { hostId: ENTRY, hostType: 'js' })).toEqual([CRUD, PERSIST]);
  });

  it('eagerClosureOf walks static imports from the entries and not dynamic ones', () => {
    const out = (fileName: string, imports: string[], isEntry = false) =>
      ({ type: 'chunk', fileName, imports, dynamicImports: [], isEntry }) as unknown;
    const bundle = Object.fromEntries(
      [out(ENTRY, [VENDOR], true), out(VENDOR, [SHELL]), out(SHELL, []), out(LIST, [CRUD]), out(CRUD, [])].map((c) => [
        (c as { fileName: string }).fileName,
        c,
      ]),
    );
    expect([...eagerClosureOf(bundle as never)].sort()).toEqual([SHELL, VENDOR, ENTRY].sort());
  });
});
