// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { useEffect, useState } from 'react';
import { ShieldBan, ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { toast } from 'sonner';
import {
  listSuggestedBindings,
  confirmSuggestedBinding,
  dismissSuggestedBinding,
  type SuggestedBinding,
} from '../services/suggestedBindingsApi.js';

/**
 * SuggestedBindingsPanel — a package's suggested audience bindings
 * (ADR-0090 D5/D9) and the deployment's decision on each.
 *
 * A package permission set shipped with `isDefault: true` suggests giving the
 * set to the built-in `everyone` position (default grants for signed-in
 * users). The server NEVER auto-binds: a `manage_metadata` holder (under a
 * wall, the platform operator) accepts it ONCE for the whole deployment, and
 * the accept takes effect (objectstack#22801 → A). This panel shows each
 * row's state as the server records it:
 *
 *  - pending — Accept / Dismiss;
 *  - pending on the `guest` anchor — no Accept (the server refuses it `409`:
 *    the `guest` anchor's sets are not derived from acceptances), the reason
 *    in its place, and Dismiss;
 *  - accepted (`confirmed` by a deployment decision) — Revoke, which is the
 *    dismiss call on an accepted row;
 *  - accepted but NOT in force — an accept that answered `200` with
 *    `bindingCreated: false`: recorded, but the `everyone` definition did not
 *    change. The list does not carry this, so it lasts until the panel
 *    re-reads; after that the row reads as accepted, which claims the
 *    decision only, never that the set is in force;
 *  - dismissed or revoked — the server records both as `dismissed`.
 *
 * A `confirmed` row WITHOUT a deployment decision is one the baseline already
 * names; this surface does not decide the baseline (the server refuses its
 * dismiss `409`), so it is not drawn.
 *
 * Every refusal (403 / 409) is surfaced with the server's own message, and
 * the panel then re-reads the list so it shows what the server holds.
 *
 * Renders nothing while loading, when the package has no suggestion, or when
 * the list is refused — a caller without `manage_metadata` gets 403 — so it
 * is safe to mount unconditionally in the install dialog and the Studio
 * Access pillar.
 */
export interface SuggestedBindingsStrings {
  /** One-line prompt per pending suggestion, e.g. `CRM suggests granting 'crm_readonly' to everyone`. */
  describe: (s: SuggestedBinding) => string;
  confirm: string;
  dismiss: string;
  confirming: string;
  confirmedToast: (s: SuggestedBinding) => string;
  dismissedToast: (s: SuggestedBinding) => string;
  /** Why a pending `guest` row offers no accept. */
  guestUnsupported: string;
  /** State line of an accepted row. Claims the decision, not that the set is in force. */
  acceptedState: (s: SuggestedBinding) => string;
  /** State line (and warning toast) of an accept answered `bindingCreated: false`. */
  notInForceState: (s: SuggestedBinding) => string;
  /** State line of a dismissed — or revoked — row. */
  dismissedState: (s: SuggestedBinding) => string;
  revoke: string;
  revoking: string;
  revokedToast: (s: SuggestedBinding) => string;
}

type RowState = 'pending' | 'guest' | 'accepted' | 'notInForce' | 'dismissed';

/** The state a row is drawn in, or `null` for one this surface does not decide. */
function rowState(s: SuggestedBinding, notInForce: ReadonlySet<string>): RowState | null {
  if (s.status === 'pending') return s.anchor === 'guest' ? 'guest' : 'pending';
  if (s.status === 'dismissed') return 'dismissed';
  if (s.status === 'confirmed' && s.deployment_decision === true) {
    return notInForce.has(s.id) ? 'notInForce' : 'accepted';
  }
  return null;
}

export function SuggestedBindingsPanel({
  packageId,
  strings,
  className,
  onResolved,
}: {
  /** Limit to one package's suggestions (install dialog); omit for all (Access pillar). */
  packageId?: string;
  strings: SuggestedBindingsStrings;
  className?: string;
  /** Called after any suggestion is accepted, dismissed or revoked. */
  onResolved?: (s: SuggestedBinding) => void;
}) {
  const [rows, setRows] = useState<SuggestedBinding[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Accepts answered `bindingCreated: false` in this session, by row id.
  const [notInForce, setNotInForce] = useState<ReadonlySet<string>>(() => new Set());

  // Keyed on the `packageId` primitive, never on a memoised function's
  // identity (AGENTS.md #10).
  useEffect(() => {
    let cancelled = false;
    listSuggestedBindings(packageId ? { packageId } : {})
      .then((next) => { if (!cancelled) setRows(next); })
      .catch(() => { /* refused (403) or surface unavailable → render nothing */ });
    return () => { cancelled = true; };
  }, [packageId]);

  const reread = () => {
    listSuggestedBindings(packageId ? { packageId } : {})
      .then((next) => setRows(next))
      .catch(() => setRows([]));
  };

  const put = (next: SuggestedBinding) =>
    setRows((current) => current.map((r) => (r.id === next.id ? next : r)));

  const act = async (s: SuggestedBinding, action: 'confirm' | 'dismiss' | 'revoke') => {
    setBusyId(s.id);
    try {
      let resolved: SuggestedBinding;
      if (action === 'confirm') {
        const { suggestion, bindingCreated } = await confirmSuggestedBinding(s.id);
        resolved = suggestion;
        setNotInForce((ids) => {
          const next = new Set(ids);
          if (bindingCreated) next.delete(suggestion.id);
          else next.add(suggestion.id);
          return next;
        });
        if (bindingCreated) toast.success(strings.confirmedToast(s));
        else toast.warning(strings.notInForceState(s));
      } else {
        resolved = await dismissSuggestedBinding(s.id);
        toast.success(action === 'revoke' ? strings.revokedToast(s) : strings.dismissedToast(s));
      }
      put(resolved);
      onResolved?.(resolved);
    } catch (err: unknown) {
      // The server's message is the explanation ("carries view-all…", "is
      // observed, not accepted…") — show it, then show what the server holds.
      toast.error(err instanceof Error ? err.message : String(err));
      reread();
    } finally {
      setBusyId(null);
    }
  };

  const drawn = rows
    .map((s) => ({ s, state: rowState(s, notInForce) }))
    .filter((r): r is { s: SuggestedBinding; state: RowState } => r.state !== null);
  if (drawn.length === 0) return null;
  const awaitsDecision = drawn.some((r) => r.state === 'pending' || r.state === 'guest');

  return (
    <div
      data-testid="suggested-bindings-panel"
      className={cn(
        'rounded-lg border px-3 py-2 space-y-2',
        awaitsDecision
          ? 'border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30'
          : 'border-border bg-muted/40',
        className,
      )}
    >
      {drawn.map(({ s, state }) => {
        const busy = busyId === s.id;
        return (
          <div
            key={s.id}
            className="flex items-center gap-2"
            data-testid={`suggested-binding-${s.permission_set_name}`}
            data-state={state}
          >
            <StateIcon state={state} />
            <div className="flex-1 min-w-0 text-sm">
              {state === 'pending' || state === 'guest' ? (
                <p className="text-amber-900 dark:text-amber-200">{strings.describe(s)}</p>
              ) : (
                <p className={state === 'notInForce' ? 'text-amber-900 dark:text-amber-200' : 'text-foreground'}>
                  {state === 'accepted'
                    ? strings.acceptedState(s)
                    : state === 'notInForce'
                      ? strings.notInForceState(s)
                      : strings.dismissedState(s)}
                </p>
              )}
              {state === 'guest' && (
                <p className="text-xs text-muted-foreground">{strings.guestUnsupported}</p>
              )}
            </div>
            {state === 'pending' && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act(s, 'confirm')}
                data-testid={`suggested-binding-confirm-${s.permission_set_name}`}
              >
                {busy ? strings.confirming : strings.confirm}
              </Button>
            )}
            {(state === 'pending' || state === 'guest') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => act(s, 'dismiss')}
                data-testid={`suggested-binding-dismiss-${s.permission_set_name}`}
              >
                {strings.dismiss}
              </Button>
            )}
            {(state === 'accepted' || state === 'notInForce') && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act(s, 'revoke')}
                data-testid={`suggested-binding-revoke-${s.permission_set_name}`}
              >
                {busy ? strings.revoking : strings.revoke}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateIcon({ state }: { state: RowState }) {
  const cls = 'h-4 w-4 shrink-0';
  switch (state) {
    case 'pending':
      return <ShieldQuestion className={cn(cls, 'text-amber-600 dark:text-amber-400')} />;
    case 'guest':
      return <ShieldBan className={cn(cls, 'text-muted-foreground')} />;
    case 'accepted':
      return <ShieldCheck className={cn(cls, 'text-emerald-600 dark:text-emerald-400')} />;
    case 'notInForce':
      return <ShieldAlert className={cn(cls, 'text-amber-600 dark:text-amber-400')} />;
    case 'dismissed':
      return <ShieldOff className={cn(cls, 'text-muted-foreground')} />;
  }
}
