// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReferencesPanel — what in the metadata graph points at one item, read by
 * `client.references(type, name)`. One of the item tools Setup's item page
 * and Studio's item header both open (objectstack#28239).
 */

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge, Button, Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import type { MetadataReference } from '@object-ui/data-objectstack';
import { t } from '../metadata-admin/i18n.js';
import type { useMetadataClient } from '../metadata-admin/useMetadata.js';

/**
 * References panel data — one discriminated union, not a `refs` / `refsLoading`
 * pair (objectui#5110).
 *
 * The pair could only spell two of the three facts this panel has to tell
 * apart. `refs == null` was already overloaded as "still loading", so a failed
 * `client.references()` call had nowhere to go: the catch wrote `setRefs([])`,
 * which is byte-identical to a *successful* scan that found nothing — and the
 * panel renders that state as "Nothing in the metadata graph points at this
 * item. Safe to delete." A refused request, a dropped connection, an expired
 * session and a `501 NOT_IMPLEMENTED` were therefore all shown to the operator
 * as an affirmative, measured all-clear, with a `console.error` nobody reads as
 * the only trace. The operator is on this panel precisely because they are
 * about to delete something.
 *
 * `status` makes the third fact representable, and makes the wrong combination
 * unrepresentable: no value of this type is both `error` and `loaded`, so no
 * render path can read a failure as a measurement. The `error` arm carries the
 * cause and asserts NOTHING about deletion safety — the honest answer when the
 * question was never answered — and the panel offers a retry so the operator
 * can ask it again.
 *
 * `idle` is deliberately distinct from `loading`: the sheet is lazy, and
 * "never asked" is what re-enables a retry after a failure (see
 * `useReferencesScan`'s re-entry guard).
 *
 * ADR-0110 D3 — a miss and a fault are different facts.
 */
export type ReferencesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; items: MetadataReference[] }
  | { status: 'error'; message: string };

/**
 * The references scan for one item, run lazily: nothing is asked until `load`
 * is called (the first time the References sheet opens).
 *
 * Re-entry guard: a request already in flight is not duplicated, and a
 * completed scan is not re-run when the sheet is reopened. `idle` and
 * `error` both fall through — which is what makes the panel's Retry work
 * without a second code path: it calls this same loader (objectui#5110).
 */
export function useReferencesScan(
  client: ReturnType<typeof useMetadataClient>,
  type: string,
  name: string,
): { state: ReferencesState; load: () => Promise<void> } {
  const [state, setState] = React.useState<ReferencesState>({ status: 'idle' });
  async function load() {
    if (state.status === 'loading' || state.status === 'loaded') return;
    setState({ status: 'loading' });
    try {
      const r = await client.references(type, name);
      setState({ status: 'loaded', items: r });
    } catch (err: any) {
      // NOT `{ status: 'loaded', items: [] }`: an unanswered question is not
      // an answer of "nothing". The panel renders this arm as a failed check
      // with a retry and says nothing about whether deleting is safe.
      setState({ status: 'error', message: String(err?.message ?? err) });
    }
  }
  return { state, load };
}

/**
 * Renders exactly one arm of `ReferencesState` — the union is the whole point
 * (objectui#5110), so the error arm is checked FIRST and there is no path from
 * a failure to the empty state's "Safe to delete."
 */
export function ReferencesPanel({
  state,
  locale,
  onRetry,
}: {
  state: ReferencesState;
  locale?: string;
  onRetry: () => void;
}) {
  if (state.status === 'error') {
    return (
      <Empty data-testid="refs-error">
        <EmptyTitle className="flex items-center justify-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {t('engine.edit.refsErrorTitle', locale)}
        </EmptyTitle>
        <EmptyDescription>
          {t('engine.edit.refsErrorDesc', locale)}
        </EmptyDescription>
        {state.message ? (
          <p
            data-testid="refs-error-cause"
            className="mt-2 max-w-full break-words font-mono text-xs text-muted-foreground"
          >
            {state.message}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          data-testid="refs-retry"
          onClick={onRetry}
        >
          {t('engine.edit.refsRetry', locale)}
        </Button>
      </Empty>
    );
  }
  if (state.status !== 'loaded') {
    return (
      <div
        data-testid="refs-scanning"
        className="text-sm text-muted-foreground flex items-center gap-2"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.edit.refsScanning', locale)}
      </div>
    );
  }
  const refs = state.items;
  if (refs.length === 0) {
    return (
      <Empty data-testid="refs-empty">
        <EmptyTitle>{t('engine.edit.refsEmptyTitle', locale)}</EmptyTitle>
        <EmptyDescription>
          {t('engine.edit.refsEmptyDesc', locale)}
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t('engine.edit.refsColFromType', locale)}</th>
            <th className="px-3 py-2 text-left">{t('engine.edit.refsColFromName', locale)}</th>
            <th className="px-3 py-2 text-left">{t('engine.edit.refsColPath', locale)}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {refs.map((r, i) => (
            <tr key={i} className="hover:bg-accent/50">
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {r.fromType}
                </Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.fromName}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.path}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
