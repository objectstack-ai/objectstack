// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27585 — the data source a report or dashboard preview hands the
 * runtime renderer, and the world its dataset queries read.
 *
 * In the Studio, a dataset the author binds is a draft until the package
 * publishes (objectstack#27518), and the pickers beside the canvas read the
 * draft-overlaid catalog. The canvas runs the same binding in the same world:
 * every `queryDataset` the renderers make (a report, a dataset widget, a
 * dataset-bound chart, a filter bar's options) carries `previewDrafts`, the
 * request's draft flag the draft preview sends as `?preview=draft`, and the
 * server resolves the named dataset from the draft overlay. The query still
 * names the dataset; nothing here looks a draft up a second way. Every other
 * member is the adapter's own.
 *
 * The signal is the one the pickers read: the Studio's
 * {@link StudioDatasetAuthoringContext}. Without it (Setup's editors) the
 * adapter is handed back as it is, and so is every runtime page, which never
 * renders these previews: both query the published world, or the one the page
 * URL asks for.
 *
 * Internal to app-shell: not exported from the package root.
 */

import { useAdapter } from '../../../providers/AdapterProvider.js';
import { useStudioDatasetAuthoring } from '../../studio-design/datasetCreate.js';

/**
 * One draft source per adapter, kept outside React so its identity is the
 * adapter's (ui/AGENTS.md #10): the renderers key their dataset fetches on the
 * data source they are handed.
 */
const draftSources = new WeakMap<object, object>();

/**
 * `adapter`, with its `queryDataset` asking for the draft world. The answer is
 * the adapter itself for every other member, bound to it, so the adapter's own
 * state (its connection, its caches) is the one read and written.
 */
export function datasetDraftsSource<T extends object>(adapter: T): T {
  let source = draftSources.get(adapter);
  if (!source) {
    source = new Proxy(adapter, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        if (prop === 'queryDataset') {
          return (dataset: unknown, selection: unknown, options?: Record<string, unknown>) =>
            value.call(target, dataset, selection, { ...options, previewDrafts: true });
        }
        return value.bind(target);
      },
    });
    draftSources.set(adapter, source);
  }
  return source as T;
}

/** The data source a report or dashboard preview renders through (see the file header). */
export function useCanvasDataSource(): unknown {
  const adapter: unknown = useAdapter();
  const inStudio = useStudioDatasetAuthoring() !== null;
  return inStudio && adapter && typeof adapter === 'object' ? datasetDraftsSource(adapter) : adapter;
}
