/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * bundledMonaco — serve Monaco from the host's own build, never from a CDN.
 *
 * `@monaco-editor/react` mounts through `@monaco-editor/loader`, whose default
 * config (read at 1.7.0) injects Monaco's AMD build from `cdn.jsdelivr.net` the
 * first time anything calls `loader.init()`. A deployment with no route to that
 * host, or one whose content-security-policy lists no CDN in `script-src` (the
 * Console's does not), never gets an editor that way.
 *
 * So the editor comes from the `monaco-editor` package instead, bundled by the
 * host: its ESM core is a lazy chunk, and each language worker is imported
 * through Vite's `?worker`, which emits it as its own file beside the build's
 * other assets and starts it from that same-origin URL. The loader is then
 * handed that instance with `loader.config({ monaco })`; once it holds one,
 * `loader.init()` resolves with it and injects no script at all.
 *
 * The config has to land BEFORE the first `loader.init()` on the page, so every
 * caller awaits {@link configureBundledMonaco} before it mounts an `<Editor>` or
 * probes the loader. Each copy of `@monaco-editor/react` keeps its own loader
 * state, so a caller passes the `loader` it imported: whichever copy a package
 * resolves, it is the one that gets configured, and the Monaco they all receive
 * is this one import.
 *
 * Everything heavy is behind a dynamic `import()`, so the cost is paid only by a
 * screen that opens an editor. A failed import (the chunk could not be fetched)
 * rejects, and the next call tries again; callers render their plain-text
 * fallback for it.
 */

import type * as MonacoApi from 'monaco-editor';

export type BundledMonaco = typeof MonacoApi;

/** The one `@monaco-editor/loader` method this module calls. */
export interface MonacoLoaderConfig {
  config(options: { monaco: BundledMonaco }): void;
}

type WorkerConstructor = new (options?: { name?: string }) => Worker;

let pending: Promise<BundledMonaco> | null = null;
let loaded: BundledMonaco | null = null;

/** The worker Monaco asks for, by the label its language service names. */
function workerFor(
  label: string,
  workers: Record<'editor' | 'json' | 'css' | 'html' | 'ts', WorkerConstructor>,
): WorkerConstructor {
  switch (label) {
    case 'json':
      return workers.json;
    case 'css':
    case 'scss':
    case 'less':
      return workers.css;
    case 'html':
    case 'handlebars':
    case 'razor':
      return workers.html;
    case 'typescript':
    case 'javascript':
      return workers.ts;
    default:
      return workers.editor;
  }
}

function importBundledMonaco(): Promise<BundledMonaco> {
  if (!pending) {
    pending = Promise.all([
      import('monaco-editor'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ]).then(
      ([monaco, editor, json, css, html, ts]) => {
        const workers = {
          editor: editor.default,
          json: json.default,
          css: css.default,
          html: html.default,
          ts: ts.default,
        };
        self.MonacoEnvironment = {
          getWorker: (_workerId: string, label: string) => new (workerFor(label, workers))(),
        };
        loaded = monaco;
        return monaco;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
  }
  return pending;
}

/**
 * Load the bundled Monaco and hand it to `loader`. Resolves once a following
 * `loader.init()` will answer with it; rejects when the editor chunk could not
 * be loaded.
 */
export async function configureBundledMonaco(loader: MonacoLoaderConfig): Promise<void> {
  loader.config({ monaco: await importBundledMonaco() });
}

/** Whether the bundled Monaco has already loaded on this page. */
export function isBundledMonacoLoaded(): boolean {
  return loaded !== null;
}
