// Hook parameters are annotated explicitly: Vite types each hook as
// `ObjectHook<Fn>` (a function-or-object union), and TypeScript cannot
// contextually infer parameters across such a union — the same reason
// `scripts/vite-types-zod-lazy.ts` spells its types out.
import type { Plugin, Rollup } from 'vite';

/**
 * Every chunk a console page load needs is requested in ONE wave; the build
 * fails when it stops being so. Why: objectstack#35455.
 *
 * A wave: a file the page names (the entry script, a modulepreload tag) is
 * requested while the HTML parses; a file named only by another chunk's
 * `import` statements is requested one wave after that chunk has arrived.
 * Each wave is a round trip before the page can ask for its data.
 *
 * Reads the EMITTED output as the browser does: `index.html`'s tags and each
 * chunk's code. Static edges parsed from the code are cross-checked against
 * rolldown's `chunk.imports`; an `import()`'s preload deps are read from
 * Vite's `__vite__mapDeps` rewrite. "Max wave 1" is also what a blind walk
 * says, so the verdict is refused unless the walk reached the eager closure,
 * found an `import()` with something to preload, and measured
 * {@link REQUIRED_DYNAMIC_TARGETS}.
 */

/** Route chunks the #35455 measurement was taken on; each must be measured, or the verdict is refused. */
export const REQUIRED_DYNAMIC_TARGETS = ['ObjectView', 'RecordDetailView'] as const;

type ResolveDependencies = (filename: string, deps: string[], context: { hostId: string; hostType: 'html' | 'js' }) => string[];

/**
 * `build.modulePreload.resolveDependencies`, given the eager closure:
 *
 *   - HTML host: every dep is kept. They are the entry's static closure, so
 *     `index.html` names the whole eager closure.
 *   - `import()`: the imported chunk's static closure, minus the eager
 *     closure (always loaded before any code runs) and the target itself (the
 *     `import()` requests it). Repeating eager files at every site would only
 *     add bytes to the chunks holding the sites, the eager ones among them.
 *
 * ⛔ Dropping anything else moves a file back to a later wave; the guard reds.
 */
export function preloadStaticClosure(eager: ReadonlySet<string>): ResolveDependencies {
  return (filename, deps, context) =>
    context.hostType === 'html' ? deps : deps.filter((dep) => dep !== filename && !eager.has(dep));
}

/** The eager closure of an output bundle: the entries and everything they import statically. */
export function eagerClosureOf(bundle: Rollup.OutputBundle): Set<string> {
  const chunks = new Map<string, Rollup.OutputChunk>();
  for (const output of Object.values(bundle)) if (output.type === 'chunk') chunks.set(output.fileName, output);
  const eager = new Set<string>();
  const stack = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName);
  while (stack.length) {
    const f = stack.pop() as string;
    if (eager.has(f) || !chunks.has(f)) continue;
    eager.add(f);
    stack.push(...(chunks.get(f) as Rollup.OutputChunk).imports);
  }
  return eager;
}

/** One emitted JS chunk, as the browser sees it. */
export interface EmittedChunk {
  /** Output path, e.g. `assets/ObjectView-De_mlWAp.js`. */
  fileName: string;
  /** Rolldown's chunk name (the group or facade name), e.g. `ObjectView`. */
  name: string;
  isEntry: boolean;
  code: string;
  /** Rolldown's static import list, when known; the cross-check for the parser. */
  imports?: readonly string[];
}

export interface DynamicSiteHops {
  importer: string;
  target: string;
  /** The target chunk's rolldown name. */
  targetName: string;
  /** Non-eager files in the target's static closure, the target included. */
  closure: number;
  /** Highest wave in that closure, counted from the `import()` call (1 = all at once). */
  maxWave: number;
  /** The files that arrive after wave 1. */
  late: string[];
}

export interface PreloadHops {
  entry: string;
  eagerFiles: number;
  /** Highest wave among the eager files (1 = the HTML names them all). */
  eagerMaxWave: number;
  eagerLate: string[];
  dynamicSites: DynamicSiteHops[];
  /** Static edges the code parser found that rolldown did not list, or the reverse. */
  parserMismatch: string[];
}

const posixDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** `./X.js` from `assets/Y.js` → `assets/X.js` (also `../`, and a bare `assets/X.js` from the HTML). */
export function resolveRelative(fromFile: string, spec: string): string {
  const parts = (spec.startsWith('.') ? `${posixDir(fromFile)}/${spec}` : spec).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Static import specifiers of a minified ES chunk: `import"./a.js"`,
 * `import{x}from"./a.js"`, `export*from"./a.js"`. `import("./a.js")` (dynamic)
 * has a parenthesis and is not matched.
 */
export function staticImportsOf(fileName: string, code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/\bfrom\s*["'](\.{1,2}\/[^"']+\.js)["']|\bimport\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    found.add(resolveRelative(fileName, m[1] ?? m[2]));
  }
  return [...found];
}

/**
 * Each `import()` site of a chunk with the preload deps Vite wrote for it:
 * `__vitePreload(()=>import("./T.js"),__vite__mapDeps([0,1]),import.meta.url)`,
 * the indices pointing into the chunk's `__vite__mapDeps` file list. A site
 * Vite gave no deps (`[]`, `void 0`, or no wrapper at all) reports none.
 */
export function dynamicSitesOf(fileName: string, code: string): { target: string; deps: string[] }[] {
  const list = /__vite__mapDeps=\([^)]*?m\.f=(\[[^\]]*\])/.exec(code);
  let files: string[] = [];
  if (list) {
    try {
      files = (JSON.parse(list[1]) as string[]).map((f) => resolveRelative(fileName, f));
    } catch {
      files = [];
    }
  }
  const sites: { target: string; deps: string[] }[] = [];
  const opener = /\bimport\(\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]\s*\)/g;
  const found = [...code.matchAll(opener)];
  found.forEach((m, i) => {
    // Vite wraps the site as `__vitePreload(FN, DEPS, import.meta.url)` and
    // FN may run on after the import (`.then(…)`, `;return{…}`), so DEPS is
    // read up to the wrapper's `import.meta.url`. Stopping at the next
    // `import(` too keeps an unwrapped site from borrowing a later site's deps;
    // the cost is a false red on two imports in one wrapper — loud, never quiet.
    const from = (m.index as number) + m[0].length;
    const nextSite = i + 1 < found.length ? (found[i + 1].index as number) : code.length;
    const metaUrl = code.indexOf('import.meta.url', from);
    const tail = code.slice(from, Math.min(nextSite, metaUrl === -1 ? code.length : metaUrl, from + 20_000));
    const deps = /__vite__mapDeps\(\[([\d,\s]*)\]\)/.exec(tail);
    const indices = deps ? deps[1].split(',').map((x) => x.trim()).filter(Boolean).map(Number) : [];
    sites.push({ target: resolveRelative(fileName, m[1]), deps: indices.map((n) => files[n]).filter(Boolean) });
  });
  return sites;
}

/** Files `index.html` names as module scripts or modulepreload links. */
export function htmlNamedScripts(html: string): Set<string> {
  const named = new Set<string>();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const isModuleScript = /^<script/i.test(tag) && /\btype\s*=\s*["']module["']/i.test(tag);
    const isPreload = /^<link/i.test(tag) && /\brel\s*=\s*["']modulepreload["']/i.test(tag);
    if (!isModuleScript && !isPreload) continue;
    const url = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (url && url.endsWith('.js')) named.add(resolveRelative('index.html', url.replace(/^\//, '')));
  }
  return named;
}

/**
 * Waves of a static closure. `seeds` are requested in wave 1; every other
 * file is requested one wave after the earliest of its importers.
 */
function waves(roots: readonly string[], seeds: ReadonlySet<string>, edges: ReadonlyMap<string, readonly string[]>, skip: ReadonlySet<string>): Map<string, number> {
  const wave = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    wave.set(root, 1);
    queue.push(root);
  }
  for (const seed of seeds) {
    if (!skip.has(seed) && !wave.has(seed)) {
      wave.set(seed, 1);
      queue.push(seed);
    }
  }
  // Breadth first over the edges, wave 1 first: the first visit is the earliest wave.
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    for (const dep of edges.get(file) ?? []) {
      if (skip.has(dep) || wave.has(dep)) continue;
      wave.set(dep, (wave.get(file) as number) + 1);
      queue.push(dep);
    }
  }
  // Seeds the closure never reaches are preload noise, not members.
  const members = new Set<string>();
  const walk = [...roots];
  while (walk.length) {
    const f = walk.pop() as string;
    if (members.has(f)) continue;
    members.add(f);
    for (const dep of edges.get(f) ?? []) if (!skip.has(dep)) walk.push(dep);
  }
  for (const f of [...wave.keys()]) if (!members.has(f)) wave.delete(f);
  return wave;
}

function staticClosure(root: string, edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const dep of edges.get(f) ?? []) stack.push(dep);
  }
  return seen;
}

/** The hop reading of an emitted console build. Pure. */
export function measurePreloadHops(html: string, chunks: readonly EmittedChunk[]): PreloadHops {
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const edges = new Map<string, string[]>();
  const parserMismatch: string[] = [];
  for (const c of chunks) {
    const parsed = staticImportsOf(c.fileName, c.code).filter((f) => byFile.has(f));
    edges.set(c.fileName, parsed);
    if (c.imports) {
      const known = c.imports.filter((f) => byFile.has(f));
      const a = new Set(parsed);
      const b = new Set(known);
      for (const f of a) if (!b.has(f)) parserMismatch.push(`${c.fileName}: parsed ${f}, rolldown did not list it`);
      for (const f of b) if (!a.has(f)) parserMismatch.push(`${c.fileName}: rolldown lists ${f}, the parser missed it`);
    }
  }
  const entries = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  const entry = entries.find((e) => htmlNamedScripts(html).has(e)) ?? entries[0] ?? '';
  const named = htmlNamedScripts(html);
  const eagerWave = entry ? waves([entry], named, edges, new Set()) : new Map<string, number>();
  const eager = new Set(eagerWave.keys());
  const eagerMaxWave = Math.max(0, ...eagerWave.values());
  const eagerLate = [...eagerWave].filter(([, w]) => w > 1).map(([f, w]) => `${f} (wave ${w})`);

  const dynamicSites: DynamicSiteHops[] = [];
  for (const c of chunks) {
    for (const site of dynamicSitesOf(c.fileName, c.code)) {
      if (!byFile.has(site.target) || eager.has(site.target)) continue;
      // Loaded when the import() runs: the eager closure, and the importer with
      // its own static closure (Vite leaves those out of the deps, rightly).
      const loaded = new Set([...eager, ...staticClosure(c.fileName, edges)]);
      loaded.delete(site.target);
      const w = waves([site.target], new Set(site.deps), edges, loaded);
      dynamicSites.push({
        importer: c.fileName,
        target: site.target,
        targetName: (byFile.get(site.target) as EmittedChunk).name,
        closure: w.size,
        maxWave: Math.max(0, ...w.values()),
        late: [...w].filter(([, n]) => n > 1).map(([f, n]) => `${f} (wave ${n})`),
      });
    }
  }
  return { entry, eagerFiles: eager.size, eagerMaxWave, eagerLate, dynamicSites, parserMismatch };
}

export interface PreloadVerdict {
  ok: boolean;
  message: string;
}

/** Pass, refusal, or a refused verdict (blind walk). Pure. */
export function judgePreloadHops(hops: PreloadHops): PreloadVerdict {
  if (hops.parserMismatch.length > 0) {
    return {
      ok: false,
      message:
        `cannot judge: the static-import parser disagrees with rolldown's chunk graph on ` +
        `${hops.parserMismatch.length} edge(s), so its wave count is not a reading of this build. ` +
        `First: ${hops.parserMismatch.slice(0, 3).join('; ')}. Fix staticImportsOf before trusting a wave count.`,
    };
  }
  if (hops.eagerFiles < 2) {
    return { ok: false, message: `cannot judge: the eager walk from ${hops.entry || 'NO ENTRY'} reached ${hops.eagerFiles} file(s); a walk that finds nothing reports one wave.` };
  }
  const measured = hops.dynamicSites.filter((s) => s.closure > 1);
  if (measured.length === 0) {
    return { ok: false, message: 'cannot judge: no import() target has a static closure to preload, so "one wave" would be vacuous. Is the dynamic-import parser blind?' };
  }
  const targets = new Set(measured.map((s) => s.targetName));
  const missing = REQUIRED_DYNAMIC_TARGETS.filter((t) => !targets.has(t));
  if (missing.length > 0) {
    return { ok: false, message: `cannot judge: the route chunk(s) ${missing.join(', ')} were not found as import() targets with a static closure, and the #35455 measurement is about them.` };
  }
  const lateSites = hops.dynamicSites.filter((s) => s.maxWave > 1);
  if (hops.eagerMaxWave > 1 || lateSites.length > 0) {
    const worst = lateSites.slice().sort((a, b) => b.maxWave - a.maxWave)[0];
    return {
      ok: false,
      message:
        `a page load fetches its code in more than one wave (objectstack#35455). ` +
        `Eager closure: ${hops.eagerFiles} files, max wave ${hops.eagerMaxWave}` +
        (hops.eagerLate.length ? ` (${hops.eagerLate.length} not named by index.html, e.g. ${hops.eagerLate.slice(0, 3).join(', ')})` : '') +
        `. import() sites with a late static import: ${lateSites.length} of ${hops.dynamicSites.length}` +
        (worst ? ` (worst: ${worst.importer} -> ${worst.target}, wave ${worst.maxWave}: ${worst.late.slice(0, 4).join(', ')})` : '') +
        `. Each extra wave is one more round trip before the page can ask for its data. ` +
        `Check build.modulePreload in apps/console/vite.config.ts (preloadStaticClosure).`,
    };
  }
  return {
    ok: true,
    message:
      `every file a load needs is requested in one wave: ${hops.eagerFiles} eager files all named by index.html, ` +
      `${hops.dynamicSites.length} import() sites each preloading their static closure ` +
      `(${measured.length} with a closure to preload, ${REQUIRED_DYNAMIC_TARGETS.join(' and ')} among them). ` +
      `Why: scripts/vite-eager-preload.ts`,
  };
}

/** Chunks and HTML of an output bundle, as written. */
export function emittedFrom(bundle: Rollup.OutputBundle): { html: string; chunks: EmittedChunk[] } {
  let html = '';
  const chunks: EmittedChunk[] = [];
  for (const output of Object.values(bundle)) {
    if (output.type === 'asset' && output.fileName === 'index.html') html = String(output.source);
    if (output.type === 'chunk') {
      chunks.push({
        fileName: output.fileName,
        name: output.name,
        isEntry: output.isEntry,
        code: output.code,
        imports: output.imports,
      });
    }
  }
  return { html, chunks };
}

/**
 * The console's preload policy and its guard, sharing one reading of the
 * eager closure: `plugin` records it in `generateBundle` (before Vite's
 * import analysis, a post plugin, asks `resolveDependencies`) and judges the
 * written output in `writeBundle`.
 */
export function eagerPreload(): { plugin: Plugin; resolveDependencies: ResolveDependencies } {
  const eager = new Set<string>();
  let recorded = false;
  let askedEarly = 0;
  const policy = preloadStaticClosure(eager);
  const resolveDependencies: ResolveDependencies = (filename, deps, context) => {
    // Asked before the closure was read (a plugin-order change): keep every
    // dep, which costs bytes, not waves, and fail the build in writeBundle.
    if (!recorded) {
      askedEarly++;
      return deps;
    }
    return policy(filename, deps, context);
  };
  const plugin: Plugin = {
    name: 'assert-eager-preload',
    generateBundle(_options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) {
      eager.clear();
      for (const f of eagerClosureOf(bundle)) eager.add(f);
      recorded = true;
    },
    // writeBundle: after Vite has rewritten the `import()` preload markers and
    // injected the HTML tags, so this reads what the browser will read.
    writeBundle(_options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) {
      const { html, chunks } = emittedFrom(bundle);
      if (!html) return; // a build without the console page (a library build) has nothing to judge
      if (!recorded || askedEarly > 0) {
        this.error(
          `[assert-eager-preload] resolveDependencies was asked ${askedEarly} time(s) before the eager closure was ` +
            `recorded, so those import() sites repeat eager files: generateBundle must run before Vite's import analysis.`,
        );
      }
      const verdict = judgePreloadHops(measurePreloadHops(html, chunks));
      if (!verdict.ok) this.error(`[assert-eager-preload] ${verdict.message}`);
      this.info(`[assert-eager-preload] ${verdict.message}`);
    },
  };
  return { plugin, resolveDependencies };
}
