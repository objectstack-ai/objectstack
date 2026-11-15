// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A component registered BY REFERENCE to its module, loaded the first time it
 * is drawn (objectstack#33293, objectstack#33582).
 *
 * The package entry imports its registration modules for their side effects
 * (`services/builtinComponents.tsx`, `views/metadata-admin/register-builtins.ts`,
 * `views/studio-design/studio-canvas-preview.tsx`), so a component one of them
 * registers BY VALUE is, with everything it imports, in the console's EAGER
 * closure: every route downloads it before it asks for data, though only the
 * page that draws it reads it. Registering the value this returns instead keeps
 * the module behind a dynamic `import()` until the component first renders.
 *
 * The `Suspense` boundary lives INSIDE the returned component, so the registry
 * that receives it still receives a component, and no render site learns about
 * pending. ⛔ It only defers anything while nothing else in the package's eager
 * graph names the module statically: measure from
 * `apps/console/dist/eager-closure.json` and the emitted chunks' module lists,
 * never from a source search (see the trap note in `builtinComponents.tsx`).
 *
 * One wrapper for every such registration; ⛔ do not grow a second one.
 */

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

/** The default while a page's module loads: one muted line naming the page. */
export function LazyPageFallback({ label }: { label: string }) {
  return <div className="p-6 text-sm text-muted-foreground">Loading {label}…</div>;
}

/**
 * Wrap `load` as a component that loads its module on first render.
 *
 * `fallback` replaces the page-sized loading line where the component is not a
 * page, e.g. a list cell, which draws nothing until its module lands.
 */
export function lazyPage<P extends object>(
  label: string,
  load: () => Promise<ComponentType<P>>,
  fallback?: ReactNode,
): ComponentType<P> {
  const Page = lazy(() => load().then((component) => ({ default: component })));
  const shown = fallback === undefined ? <LazyPageFallback label={label} /> : fallback;
  function LazyPage(props: P) {
    return (
      <Suspense fallback={shown}>
        <Page {...props} />
      </Suspense>
    );
  }
  return LazyPage;
}
