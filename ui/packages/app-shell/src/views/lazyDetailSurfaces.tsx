/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The detail components the console shell draws outside a record page — the
 * record pointer card's key fields and the approval decision's child tables —
 * loaded the first time one is drawn.
 *
 * `@object-ui/plugin-detail`'s entry registers the detail and record-page
 * renderers when it is evaluated and reaches every detail surface, so a static
 * import of `HeaderHighlight` or `RelatedList` from an always-eager shell
 * module keeps the whole package (and the grid it draws with) in every first
 * load. These wrappers import the entry on first draw instead; its
 * registrations run then, once. The pure helpers the shell needs on every page
 * come from `@object-ui/plugin-detail/core`, which registers nothing.
 *
 * A surface that is about to read the record it draws calls
 * `preloadDetailEntry()` beside that read, so the chunk and the data arrive
 * together rather than one after the other.
 *
 * ⛔ No static value import of `@object-ui/plugin-detail` here: the `import
 * type` below is erased, and that is the only reason this module may name the
 * entry.
 */

import { lazy, Suspense, useState, type ComponentProps } from 'react';
import type {
  HeaderHighlight as HeaderHighlightComponent,
  RelatedList as RelatedListComponent,
} from '@object-ui/plugin-detail';

type DetailEntry = typeof import('@object-ui/plugin-detail');

let detailEntry: Promise<DetailEntry> | undefined;
/** The entry once it has loaded: a surface mounted after that renders it without suspending. */
let loadedEntry: DetailEntry | undefined;

/** Starts loading the detail entry (once); the lazy components below share it. */
export function preloadDetailEntry(): Promise<DetailEntry> {
  // A failed load is forgotten, so the next draw asks again.
  detailEntry ??= import('@object-ui/plugin-detail').then(
    (entry) => {
      loadedEntry = entry;
      return entry;
    },
    (error: unknown) => {
      detailEntry = undefined;
      throw error;
    },
  );
  return detailEntry;
}

const HeaderHighlightChunk = lazy(() => preloadDetailEntry().then((m) => ({ default: m.HeaderHighlight })));
const RelatedListChunk = lazy(() => preloadDetailEntry().then((m) => ({ default: m.RelatedList })));

/**
 * `HeaderHighlight`, loaded on first draw. Nothing shows until the detail chunk
 * is in; once it is, the component draws in the same render.
 */
export function LazyHeaderHighlight(props: ComponentProps<typeof HeaderHighlightComponent>) {
  // Decided once per mount, so a draw never switches between the two element
  // types (which would remount the component and drop its state).
  const [entry] = useState(() => loadedEntry);
  if (entry) return <entry.HeaderHighlight {...props} />;
  return (
    <Suspense fallback={null}>
      <HeaderHighlightChunk {...props} />
    </Suspense>
  );
}

/**
 * `RelatedList`, loaded on first draw. Nothing shows until the detail chunk is
 * in; once it is, the component draws in the same render.
 */
export function LazyRelatedList(props: ComponentProps<typeof RelatedListComponent>) {
  const [entry] = useState(() => loadedEntry);
  if (entry) return <entry.RelatedList {...props} />;
  return (
    <Suspense fallback={null}>
      <RelatedListChunk {...props} />
    </Suspense>
  );
}
