import React, { createContext, useContext, useMemo } from 'react';
import type { DebugFlags } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
import { usePredicateScope } from '../hooks/useExpression.js';

/**
 * Host-provided fetch the renderers use for their own reads of the host's API
 * (a chart's metadata reads, dataset dimension labels, record-permission
 * probes), so those reads carry the same credentials (Authorization, tenant,
 * locale headers) as the native data channel. Optional — when absent, those
 * reads fall back to the bare global fetch (cookies only). A view does not
 * reach it: a view binds `provider: 'object'` or `provider: 'value'`, and a
 * code-built `ApiDataSource` takes its own `fetch` in its config.
 */
export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SchemaRendererContextType {
  /**
   * The adapter the host injected, as the published `DataSource` contract
   * declares it (objectui#7912).
   *
   * Typed, not `any`: this is the injection point for the ENTIRE renderer tree,
   * and `useSchemaContext()` hands whatever is declared here to every consumer
   * that reads it back. While it was `any`, a bare string passed where the
   * host's adapter belongs raised nothing at compile time and failed at runtime
   * on the first `find()` — the shape of a config value read from the wrong
   * place. The type was never unknown: `@object-ui/types` exports `DataSource`,
   * `useSettledSchema` in this same package already declares its parameter as
   * `DataSource<any> | null | undefined`, and `app-shell`'s README writes
   * `DataSource` against this very seam.
   *
   * `null | undefined` are part of the contract, not a weakening of it: a host
   * renders with no adapter bound (a Studio preview, a react page before the
   * AdapterProvider connects, a widget test that drives `apiFetch` alone), and
   * every reader in the tree already guards for it. The union states the three
   * states that actually occur and refuses everything else — a string, `{}`, a
   * plain data bag, a partial adapter missing a required member. It is spelled
   * exactly as `useSettledSchema` spells it, one hop away.
   */
  dataSource: DataSource | null | undefined;
  debug?: boolean;
  debugFlags?: DebugFlags;
  apiFetch?: ApiFetch;
}

const SchemaRendererContext = createContext<SchemaRendererContextType | null>(null);

export { SchemaRendererContext };

export const SchemaRendererProvider = ({
  children,
  dataSource,
  debug,
  debugFlags,
  apiFetch,
}: {
  children: React.ReactNode;
  /** The host's adapter — see {@link SchemaRendererContextType.dataSource}. */
  dataSource: DataSource | null | undefined;
  debug?: boolean;
  debugFlags?: DebugFlags;
  apiFetch?: ApiFetch;
}) => {
  // Nested providers (react-page, studio preview surfaces) re-wrap with their
  // own dataSource but rarely know about the host's authenticated fetch —
  // inherit it from the parent context so the host's auth survives nesting.
  const parent = useContext(SchemaRendererContext);
  const effectiveApiFetch = apiFetch ?? parent?.apiFetch;
  const value = useMemo(
    () => ({ dataSource, debug, debugFlags, apiFetch: effectiveApiFetch }),
    [dataSource, debug, debugFlags, effectiveApiFetch],
  );
  return (
    <SchemaRendererContext.Provider value={value}>
      {children}
    </SchemaRendererContext.Provider>
  );
};

export const useSchemaContext = () => {
  const context = useContext(SchemaRendererContext);
  if (!context) {
    throw new Error('useSchemaContext must be used within a SchemaRendererProvider');
  }
  return context;
};

/**
 * Resolve a `bind` path against the ambient predicate scope.
 *
 * ## What it reads, and what it deliberately does not (objectui#9308)
 *
 * The scope a host publishes through `PredicateScopeProvider` — the same
 * channel `useCondition` / `useExpression` merge under a locally-passed
 * context, and the one app-shell's `ExpressionProvider` already feeds. It is
 * NOT `SchemaRendererContext.dataSource`.
 *
 * `dataSource` is the host's injected ADAPTER, declared as the published
 * `DataSource` contract (objectui#7912). An adapter has no `users` member, no
 * `value` member, no member a `bind` path names — so walking it resolved
 * `undefined` for every conformant host, and the nine production readers of
 * this hook have all been running their fallback (`boundData || schema.items`,
 * `|| schema.nodes`, or a fall-through to their own fetch chain) ever since.
 * The only hosts it answered were ones injecting a data bag through a key the
 * contract says is an adapter, which has been a compile error since
 * objectui#7912.
 *
 * Maintainer ruling 2026-09-13 (option B) points it at the channel that can
 * actually answer it. No published key is added: the provider, the hook and
 * the host wiring all already exist.
 *
 * Returns `undefined` for an absent or empty path, and for any path the scope
 * does not carry — the readers' fallbacks are what run then, exactly as
 * before.
 */
export const useDataScope = (path?: string) => {
  const scope = usePredicateScope();
  if (!path) return undefined;
  if (!scope) return undefined;
  // Simple path resolution for now. In real app might be more complex.
  //
  // The accumulator is `any` BY DECLARATION: this walk addresses arbitrary
  // member names on a host-published bag, and `Record<string, any>` declares
  // none of them beyond the first segment. The hook's published return type is
  // unchanged — `any` before and after — so no reader of `useDataScope` moves.
  return path.split('.').reduce<any>((acc, part) => acc && acc[part], scope);
}
