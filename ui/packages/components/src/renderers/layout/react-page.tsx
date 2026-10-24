/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `kind:'react'` page renderer — the TRUSTED execution tier.
 *
 * Unlike `kind:'html'` (constrained JSX parsed, never executed), a react page's
 * `source` is real JavaScript/JSX: hooks, event handlers, `.map`, arbitrary
 * expressions. It is transpiled (Sucrase) and evaluated directly in the main
 * React tree by `@object-ui/react-runtime` — NO sandbox. The platform trusts
 * its (reviewed, draft-gated) page authors, so the host capability
 * `CAP_REACT_PAGES` defaults ON; a deployment that does not trust its authors
 * turns it OFF server-side (the runtime injects the disable global when
 * `OS_PAGE_REACT=off`). The transpiler is lazy-loaded — fetched in a
 * separate chunk only when a react page actually renders with the capability on.
 *
 * Scope injected into the source:
 *   - `React`                — so authors can call hooks.
 *   - the PUBLIC data blocks — `<ObjectGrid>`, `<ObjectForm>`, charts, metrics…
 *     each as a prop-driven wrapper that renders via SchemaRenderer. Layout is
 *     left to plain HTML (React's strength); only the data blocks that can't be
 *     expressed in HTML are injected.
 *   - `Block`                — escape hatch: `<Block type="object-grid" .../>`.
 *   - `useAdapter`            — live data hook: query/create/update objects.
 *   - `useDataInvalidation`   — the data-invalidation bus reader: a nonce that
 *     moves when a write to the named object is reported on the bus. A page
 *     names it in the effect that reads through `useAdapter`, so that read
 *     re-runs in place (objectui#10887).
 *   - `data` / `variables`   — page data + local variables, for convenience.
 *
 * Styling — page source is metadata, not build input. A react page styles with
 * inline `style` objects using `hsl(var(--token))` theme colors; overlays render
 * through `<ObjectForm formType="drawer"|"modal">` rather than a hand-rolled
 * `fixed inset-0` backdrop. Do NOT author Tailwind utility classes in page
 * `source`: `source` is runtime metadata, the console's Tailwind is compiled at
 * build time by scanning the console's own `src`, and there is no safelist — an
 * authored utility class silently produces no CSS. `os validate` reports it as
 * `page-source-className-tailwind`. (ADR-0065; ADR-0080's 2026-06-30 amendment;
 * see `content/docs/guide/react-pages.md`.)
 */

import * as React from 'react';
import { ComponentRegistry, isCapabilityEnabled, CAP_REACT_PAGES } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider, useAdapter, useDataInvalidation } from '@object-ui/react';

type RuntimeModule = typeof import('@object-ui/react-runtime');

// kebab/snake tag -> PascalCase identifier authors write in JSX.
function toPascal(tag: string): string {
  return tag
    .split(/[-_:]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// Build the component scope from the curated PUBLIC contract. We inject the
// data/leaf blocks (non-containers) as prop-driven wrappers; layout containers
// are intentionally left out — in react mode the author composes layout with
// real HTML and inline `style` objects, not our schema-children renderers (and
// not Tailwind classes — see the styling note in this file's header).
//
// Lazily-registered blocks (`object-kanban`, `object-map`, `markdown`, … — see
// apps/console/src/main.tsx) are in here too: `getPublicConfigs()` resolves
// `registerLazy` stubs, so the scope is complete at build time regardless of
// which plugin chunks have been imported (objectui#2953). Each wrapper defers
// to SchemaRenderer, which triggers the loader and renders the placeholder, so
// the scope itself never has to change once built — which is exactly what lets
// it stay identity-stable and keeps the page from remounting (objectui#2954).
//
// The host ADAPTER reaches the blocks through ONE channel: the
// `SchemaRendererProvider` the page is wrapped in below. It is NOT written onto
// the node. `dataSource` on a node is the spec's per-element BINDING
// (`PageComponentSchema.dataSource`, `{ object, view, filter, sort, limit }`),
// which the gate-wrapped blocks read off `schema` (`ElementDataSourceGate`), so
// an adapter (or `null`) stamped there was a pun on an authored key
// (objectui#11070). It carried nothing the provider does not: `SchemaRenderer`
// strips `dataSource` from the props it spreads, the gate ignores a value that
// is not a binding, and the one widget family that looks for an adapter on its
// node (`LookupField`, and `UserField` through it, reached by `<Block>`) falls
// through to that same context. An author who writes
// `dataSource={{ object: 'x' }}` on a block gets exactly that binding on the
// node.
function buildComponentScope(): Record<string, React.ComponentType<any>> {
  const scope: Record<string, React.ComponentType<any>> = {};
  const seen = new Set<string>();
  for (const cfg of ComponentRegistry.getPublicConfigs() as Array<{ type: string; isContainer?: boolean; tier?: string }>) {
    const tag = cfg.type;
    // The html tier's intrinsic elements ride `getPublicConfigs()` stamped
    // `tier: 'html'` so the published manifest can whitelist them for
    // `kind:'html'` pages (objectui#10735). They are NOT curated blocks and
    // they are DOM intrinsics in real JSX already — a lowercase `<p>` on this
    // tier is React's own — so injecting `P` / `A` / `Img` wrappers would widen
    // this scope for nothing. Skipped by the stamp, not by name.
    if (!tag || cfg.isContainer || cfg.tier === 'html') continue;
    const name = toPascal(tag);
    if (seen.has(name)) continue;
    seen.add(name);
    // `type` is the SDUI envelope's component discriminator, but it is ALSO a
    // legitimate prop name in a block's own spec schema — `ChartConfig.type` is
    // the chart family. Flattening props into the schema bag collides the two:
    // spreading last let an author's `type="bar"` replace `object-chart` and
    // the block stopped resolving; stamping the discriminator last silently ate
    // the author's value instead. Neither is acceptable (ADR-0078), so the
    // discriminator wins the `type` slot and the author's value is preserved
    // beside it under `specType` for the block to read
    // (objectui#2880 / framework#3729).
    const Wrapper: React.FC<any> = ({ children: _children, ...props }) => {
      const specType = typeof props.type === 'string' && props.type !== tag ? props.type : undefined;
      return React.createElement(SchemaRenderer as any, {
        schema: { ...props, ...(specType ? { specType } : {}), type: tag },
      });
    };
    Wrapper.displayName = name;
    scope[name] = Wrapper;
  }
  // Escape hatch: render any registered component by type.
  const Block: React.FC<{ type: string; [k: string]: unknown }> = ({ type, children: _c, ...props }) =>
    React.createElement(SchemaRenderer as any, { schema: { type, ...props } });
  Block.displayName = 'Block';
  scope.Block = Block;
  return scope;
}

/**
 * "No adapter yet" — the window before the host's AdapterProvider finishes
 * connecting, and any surface that renders a react page without one — is now
 * expressed by handing the seam the absent adapter ITSELF (objectui#7912).
 *
 * This replaced a module-level stand-in constant holding an empty object. That
 * constant existed for a real reason and the reason still holds:
 * `SchemaRendererProvider` memoises its context value on the identity of what
 * it is handed, so a fresh empty object per render defeated that memo for every
 * block inside the page — re-cloning each block's schema and re-running its
 * expressions on every render (objectui#2954). `useAdapter()` returns
 * `ObjectStackAdapter | null`, and both arms are render-stable: the adapter is
 * the host's own context value, and `null` is a primitive. So the memo keeps
 * what it had.
 *
 * What is gained is that an empty object is TRUTHY: every reader downstream
 * asks `if (!dataSource)` before it reaches for `find`, so it walked past the
 * one guard written to catch "no adapter" and failed later, at the call. The
 * seam declares `DataSource | null | undefined`, so the absence is now stated
 * in the type instead of being smuggled through `any` as a value that is not
 * an adapter.
 */

/**
 * The scope a react page's `source` is compiled against. Everything in it is
 * either module-level (the block wrappers resolve through the registry when
 * they render, the hooks are module functions) or read off `schema`, so equal
 * schema content yields an equivalent scope.
 */
function buildPageScope(schema: { data?: unknown; variables?: unknown } | null | undefined): Record<string, unknown> {
  return {
    ...buildComponentScope(),
    // Live data access — `const adapter = useAdapter()` inside the page, then
    // adapter.find('object', {...}) / .create / .update. Hooks injected as
    // closure vars; the page calls them from its own component body.
    useAdapter,
    // The data-invalidation bus reader (objectui#10887), the same hook
    // `ListView` reads to refresh its rows. `useDataInvalidation('object')`
    // returns a nonce that moves when the bus reports a write to that object
    // (or `'*'`); a page names it in the dependency list of the effect that
    // reads through `useAdapter`, and the read re-runs in place, with no
    // remount. A module-level function, so it leaves the scope's identity
    // exactly as stable as before.
    useDataInvalidation,
    data: schema?.data ?? schema?.variables ?? {},
    variables: schema?.variables ?? {},
    page: schema ?? {},
  };
}

/**
 * Structural equality for page metadata: plain objects and arrays compare by
 * their own enumerable keys, everything else by `Object.is`. A value that is
 * not plain data (a function, a `Date`, a class instance) is equal only to
 * itself, so a host that hands over a new one recompiles the page, which is
 * the conservative answer. `seen` keeps a cyclic value from recursing forever.
 */
function sameContent(a: unknown, b: unknown, seen: Map<object, object> = new Map()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b)) return false;
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!sameContent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen)) return false;
  }
  return true;
}

function CapabilityDisabledNotice(): React.ReactElement {
  return (
    <div className="m-4 rounded-md border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="font-semibold">React pages are disabled on this deployment</div>
      <p className="mt-1 leading-relaxed">
        <code>kind:&apos;react&apos;</code> pages execute author JavaScript directly in the
        application. This deployment has turned the capability off
        (<code>OS_PAGE_REACT=off</code> / <code>disableCapability(&apos;react-pages&apos;)</code>).
        It is ON by default; re-enable it if your page authors are trusted.
      </p>
    </div>
  );
}

export const ReactKindPage: React.FC<{ schema: any }> = ({ schema }) => {
  const source: string = typeof schema?.source === 'string' ? schema.source : '';
  // The live data source for the injected data blocks (and the page's own
  // `useAdapter()` calls). Same object the rest of the app renders against.
  const adapter = useAdapter();
  // Gate: default-closed. Off in OSS / untrusted builds. Read here so the hooks
  // below stay unconditional; the disabled notice is returned after them, and
  // the effect never loads the gated runtime when disabled.
  const capabilityEnabled = isCapabilityEnabled(CAP_REACT_PAGES);

  const [runtime, setRuntime] = React.useState<RuntimeModule | null>(null);
  const [loadError, setLoadError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!capabilityEnabled) return;
    let alive = true;
    import('@object-ui/react-runtime')
      .then((m) => alive && setRuntime(m))
      .catch((e) => alive && setLoadError(e as Error));
    return () => {
      alive = false;
    };
  }, [capabilityEnabled]);

  // Keep this identity STABLE. ReactRunner recompiles the page whenever the
  // scope identity changes, and every compile mints a fresh `Page` function —
  // i.e. a new element type — which remounts the subtree and wipes the page's
  // own `useState` (objectui#2954). That's why this deliberately does not
  // subscribe to ComponentRegistry changes the way SchemaRenderer does: a lazy
  // plugin finishing its registration notifies the registry, and rebuilding the
  // scope there would reset every interactive page on the screen. It doesn't
  // need to — `buildComponentScope` already sees lazy blocks (objectui#2953).
  //
  // The scope is rebuilt only when what it is compiled FROM changes: the
  // schema's CONTENT (`page` carries all of it, `data` / `variables` are read
  // off it) or the adapter. Not the schema object's identity — the console's
  // `PageView` hands a fresh spread of the page on every render, and any host
  // may, so keying on identity remounted the page on every host re-render
  // (objectui#13268). The scope is held in state, not in a `useMemo`: React
  // may discard a memo and hand back a new object, and here a new object IS a
  // remount (AGENTS.md #10). When the content does change, the new scope is
  // stored during render, React's pattern for state derived from props.
  //
  // `adapter` stays a rebuild trigger although the scope no longer carries it
  // (objectui#11070). The blocks follow a swapped adapter through the
  // provider below without a recompile. The page's OWN code may not: an effect
  // that reads through `useAdapter()` and omits `adapter` from its dependencies
  // ran once, against the absent adapter, and the recompile on a swap (the
  // host connecting one) is what re-runs it. Dropping the trigger would keep
  // the page's state across a swap, but it would also leave such a page empty.
  // That is a separate behaviour change, not made here.
  const [compiled, setCompiled] = React.useState(() => ({ schema, adapter, scope: buildPageScope(schema) }));
  let scope = compiled.scope;
  if (compiled.adapter !== adapter || !sameContent(compiled.schema, schema)) {
    const next = { schema, adapter, scope: buildPageScope(schema) };
    setCompiled(next);
    scope = next.scope;
  }

  // Capability gate — returned after all hooks above so hook order stays stable.
  if (!capabilityEnabled) {
    return <CapabilityDisabledNotice />;
  }

  if (loadError) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="font-semibold">Failed to load the react runtime</div>
        <pre className="mt-1 whitespace-pre-wrap">{String(loadError)}</pre>
      </div>
    );
  }
  if (!source.trim()) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        A <code>kind:&apos;react&apos;</code> page requires a non-empty <code>source</code>.
      </div>
    );
  }
  if (!runtime) {
    return <div className="m-4 text-sm text-muted-foreground">Loading react runtime…</div>;
  }

  const { ReactRunner } = runtime;
  return (
    <SchemaRendererProvider dataSource={adapter}>
      <ReactRunner
        code={source}
        scope={scope}
        fallback={(error) => (
          <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="font-semibold">React page error</div>
            <pre className="mt-1 whitespace-pre-wrap">{String(error)}</pre>
          </div>
        )}
      />
    </SchemaRendererProvider>
  );
};
