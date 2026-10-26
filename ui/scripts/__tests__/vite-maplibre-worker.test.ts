import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  MAPLIBRE_DEV_WORKER_ENTRY,
  MAPLIBRE_WORKER_ENTRY,
  auditWorkerReferences,
  collectRelativeImports,
  collectWorkerAssets,
  collectWorkerReferences,
  findMaplibreDistDir,
} from '../vite-maplibre-worker';

/**
 * objectui#3297: maplibre-gl resolves its worker as a sibling of its own script
 * URL (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`), which no bundler
 * can follow. Vite bundled maplibre into `assets/maplibre-gl-<hash>.js` and
 * emitted nothing beside it, so `/_console/assets/maplibre-gl-worker.mjs` 404'd
 * in every deployment.
 *
 * The copy step is only half the fix; the other half is that it must keep
 * describing maplibre. These tests pin the drift audit that fails the BUILD
 * when a maplibre upgrade renames the worker or changes its dist layout —
 * the failure mode the original bug had no signal for at all.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('findMaplibreDistDir', () => {
  it('derives the dist dir from any module id inside it', () => {
    expect(
      findMaplibreDistDir('/repo/packages/plugin-map/node_modules/maplibre-gl/dist/maplibre-gl.mjs'),
    ).toBe('/repo/packages/plugin-map/node_modules/maplibre-gl/dist');
    // CSS, or any other dist file, answers the same question.
    expect(findMaplibreDistDir('/repo/node_modules/maplibre-gl/dist/maplibre-gl.css')).toBe(
      '/repo/node_modules/maplibre-gl/dist',
    );
  });

  it('ignores the query suffix Vite appends to module ids', () => {
    expect(findMaplibreDistDir('/repo/node_modules/maplibre-gl/dist/maplibre-gl.css?used')).toBe(
      '/repo/node_modules/maplibre-gl/dist',
    );
  });

  it('returns null for unrelated modules', () => {
    expect(findMaplibreDistDir('/repo/packages/plugin-map/src/MapRenderer.tsx')).toBeNull();
    // A lookalike outside maplibre's own dist must not answer.
    expect(findMaplibreDistDir('/repo/node_modules/react-map-gl/dist/maplibre.js')).toBeNull();
  });
});

describe('collectWorkerReferences', () => {
  it('finds both branches of maplibre’s minified worker-name ternary', () => {
    // Verbatim from the built chunk quoted in objectui#3297.
    const chunk =
      'function di(){let e=import.meta.url;if(!/^https?:/.test(e))return``;' +
      'let t=e.endsWith(`-dev.mjs`)?`maplibre-gl-worker-dev.mjs`:`maplibre-gl-worker.mjs`;' +
      'return new URL(`./${t}`,e).href}';
    expect(collectWorkerReferences(chunk)).toEqual([
      MAPLIBRE_DEV_WORKER_ENTRY,
      MAPLIBRE_WORKER_ENTRY,
    ]);
  });

  it('picks up a renamed worker rather than silently matching nothing', () => {
    expect(collectWorkerReferences('new URL(`./maplibre-gl-worker.v2.mjs`,e)')).toEqual([
      'maplibre-gl-worker.v2.mjs',
    ]);
  });

  it('returns nothing for a chunk with no worker reference', () => {
    expect(collectWorkerReferences('export const a = 1;')).toEqual([]);
  });
});

describe('collectRelativeImports', () => {
  it('reads minified static imports, side-effect imports and re-exports', () => {
    const code = [
      'import{$ as e,Ai as t}from"./maplibre-gl-shared.mjs";',
      "import'./side-effect.mjs';",
      'export{a}from"./re-export.mjs";',
      'const lazy=await import("./dynamic.mjs");',
    ].join('\n');
    expect(collectRelativeImports(code)).toEqual([
      './dynamic.mjs',
      './maplibre-gl-shared.mjs',
      './re-export.mjs',
      './side-effect.mjs',
    ]);
  });

  it('ignores bare specifiers — only siblings need copying', () => {
    expect(collectRelativeImports('import x from "maplibre-gl";')).toEqual([]);
  });
});

describe('collectWorkerAssets', () => {
  const fakeDist: Record<string, string> = {
    'maplibre-gl-worker.mjs': 'import{a}from"./maplibre-gl-shared.mjs";export default a;',
    'maplibre-gl-shared.mjs': 'export const a=1;',
  };
  const read = (dist: Record<string, string>) => (name: string) => dist[name] ?? null;

  it('walks the worker’s sibling closure — the worker alone is not enough', () => {
    const assets = collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, read(fakeDist));
    expect([...assets.keys()]).toEqual(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']);
    expect(assets.get('maplibre-gl-shared.mjs')).toBe('export const a=1;');
  });

  it('throws when the worker itself is gone (an upgrade renamed it)', () => {
    expect(() => collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, () => null)).toThrow(
      /maplibre-gl-worker\.mjs' does not exist/,
    );
  });

  it('throws when a sibling the worker imports is missing', () => {
    const broken = { 'maplibre-gl-worker.mjs': fakeDist['maplibre-gl-worker.mjs'] };
    expect(() => collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, read(broken))).toThrow(
      /maplibre-gl-shared\.mjs' does not exist/,
    );
  });

  it('throws when the dist layout stops being flat', () => {
    const nested = {
      'maplibre-gl-worker.mjs': 'import"./sub/shared.mjs";',
      'sub/shared.mjs': 'export const a=1;',
    };
    // A nested path would land outside assetsDir at a URL maplibre's worker
    // cannot reach — fail the build instead of shipping a half-copy.
    expect(() => collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, read(nested))).toThrow(
      /not a flat sibling/,
    );
  });

  it('terminates on a circular sibling graph', () => {
    const circular = {
      'maplibre-gl-worker.mjs': 'import"./maplibre-gl-shared.mjs";',
      'maplibre-gl-shared.mjs': 'import"./maplibre-gl-worker.mjs";export const a=1;',
    };
    expect([...collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, read(circular)).keys()]).toEqual([
      'maplibre-gl-worker.mjs',
      'maplibre-gl-shared.mjs',
    ]);
  });
});

describe('auditWorkerReferences', () => {
  const emitted = [MAPLIBRE_WORKER_ENTRY, 'maplibre-gl-shared.mjs'];

  it('passes when the bundle asks only for what the build emitted', () => {
    expect(auditWorkerReferences([MAPLIBRE_WORKER_ENTRY], emitted)).toBeNull();
  });

  it('tolerates the -dev branch, which a hashed chunk can never select', () => {
    expect(
      auditWorkerReferences([MAPLIBRE_DEV_WORKER_ENTRY, MAPLIBRE_WORKER_ENTRY], emitted),
    ).toBeNull();
  });

  it('fails when an upgrade renames the worker the bundle requests', () => {
    const message = auditWorkerReferences(['maplibre-gl-worker.v2.mjs'], emitted);
    expect(message).toMatch(/does not emit: maplibre-gl-worker\.v2\.mjs/);
  });

  it('fails when the bundle stops referencing a sibling worker at all', () => {
    // Either maplibre changed mechanism or chunking hid it; both need a human.
    expect(auditWorkerReferences([], emitted)).toMatch(/No 'maplibre-gl-worker\*\.mjs' reference/);
  });
});

describe('the installed maplibre-gl still matches these assumptions', () => {
  // Reading the real dist keeps the constants above honest: an upgrade that
  // renames the worker or drops the sibling convention turns this red in
  // `pnpm test`, not in a browser tab.
  const distDir = (() => {
    try {
      const require_ = createRequire(path.join(repoRoot, 'packages/plugin-map/package.json'));
      return path.dirname(require_.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
    } catch {
      return null;
    }
  })();

  it('resolves maplibre-gl from the package that depends on it', () => {
    expect(distDir).not.toBeNull();
  });

  it('computes its worker URL as a sibling of its own script URL', () => {
    const entry = fs.readFileSync(path.join(distDir!, 'maplibre-gl.mjs'), 'utf8');
    expect(collectWorkerReferences(entry)).toContain(MAPLIBRE_WORKER_ENTRY);
    expect(entry).toContain('import.meta.url');
  });

  it('ships a worker whose sibling closure is on disk beside it', () => {
    const assets = collectWorkerAssets(MAPLIBRE_WORKER_ENTRY, (name) => {
      const file = path.join(distDir!, name);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    });
    // The worker is a *module* worker: shipping it without the shared module
    // it imports would trade the 404 in #3297 for a 404 one hop deeper.
    expect([...assets.keys()]).toContain('maplibre-gl-shared.mjs');
    expect(auditWorkerReferences([MAPLIBRE_WORKER_ENTRY], [...assets.keys()])).toBeNull();
  });
});
