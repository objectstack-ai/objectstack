// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → Connector Connections (ADR-0143 D5, item 7 of
 * objectstack#26702).
 *
 * One row per declared `oauth2` `authorization_code` connector instance: the
 * instance's registry state (a `degraded` one with the server's reason beside
 * the connection that caused it), this organization's connection — `Not
 * connected`, `Connected` or `Reconnect required` with the reason the server
 * recorded — its scopes and dates, and Connect / Reconnect / Disconnect.
 *
 * Connect opens the vendor's sign-in in its own window: the window is opened
 * on the click (a window opened after an await is blocked), detached from this
 * page (`opener` cleared), then sent to the `authorizationUrl` the server
 * answered. The vendor redirects that window to the server's callback, which
 * stores the connection; this page re-reads the status until the connect
 * lands, the window is closed, or the begun connect expires.
 *
 * ⛔ It never displays a token, a code or the authorization URL: none of the
 * door's status answers carries a token, and the URL goes only to the window.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Info, Plug } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import type { ConnectorConnectionState } from '@objectstack/spec/contracts';
import { PageHeader } from '../../layout/PageHeader.js';
import {
  beginConnection,
  fetchConnection,
  fetchConnectionListing,
  revokeConnection,
  type ConnectionListing,
  type ConnectionRead,
} from './connectorConnections.js';

const STATUS_CLASS: Record<ConnectorConnectionState['status'], string> = {
  connected: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  not_connected: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  reconnect_required: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/** The sign-in window's name: a second Connect reuses it rather than stacking windows. */
const SIGN_IN_WINDOW = 'objectstack-connector-connect';
const SIGN_IN_FEATURES = 'popup,width=560,height=720';

interface Waiting {
  name: string;
  window: Window;
  /** The connect being waited for has landed once `connectedAt` moves off this. */
  before?: string;
  until: number;
}

interface RevokeDraft {
  name: string;
  busy: boolean;
  refusal: string | null;
}

export interface ConnectorConnectionsPageProps {
  /** How often a begun connect re-reads the status, in milliseconds. */
  pollMs?: number;
}

export function ConnectorConnectionsPage({ pollMs = 2000 }: ConnectorConnectionsPageProps) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const [nonce, setNonce] = useState(0);
  const [listing, setListing] = useState<ConnectionListing | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [revokeDraft, setRevokeDraft] = useState<RevokeDraft | null>(null);
  const waitingRef = useRef<Waiting | null>(null);
  waitingRef.current = waiting;

  const reload = () => {
    setListing(null);
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchConnectionListing(controller.signal).then(
      (next) => setListing(next),
      () => { /* aborted: a newer read owns the page */ },
    );
    return () => controller.abort();
  }, [nonce]);

  const applyConnection = (name: string, connection: ConnectionRead) => {
    setListing((cur) => (cur?.kind === 'listed'
      ? { kind: 'listed', rows: cur.rows.map((r) => (r.instance.name === name ? { ...r, connection } : r)) }
      : cur));
  };

  // A begun connect: re-read until it lands, its window closes, or it expires.
  useEffect(() => {
    if (!waiting) return;
    let busy = false;
    const timer = setInterval(() => {
      const current = waitingRef.current;
      if (busy || !current) return;
      busy = true;
      const closed = current.window.closed;
      void fetchConnection(current.name).then((read) => {
        busy = false;
        if (waitingRef.current !== current) return;
        const landed = read.ok && read.state.status === 'connected' && read.state.connectedAt !== current.before;
        const expired = Date.now() > current.until;
        if (!landed && !closed && !expired) return;
        applyConnection(current.name, read);
        if (!current.window.closed) current.window.close();
        setWaiting(null);
        if (landed) {
          setNotice({ tone: 'ok', text: t('connectorConnections.connected', { defaultValue: 'Connected {{name}}.', name: current.name }) });
        } else if (expired) {
          setNotice({
            tone: 'error',
            text: t('connectorConnections.expired', {
              defaultValue: 'The sign-in for {{name}} was not completed in time. Connect again.',
              name: current.name,
            }),
          });
        }
      }, () => { busy = false; });
    }, pollMs);
    return () => clearInterval(timer);
  }, [waiting, pollMs]);

  const connect = async (name: string, before?: string) => {
    if (waiting) return;
    setNotice(null);
    const signIn = window.open('about:blank', SIGN_IN_WINDOW, SIGN_IN_FEATURES);
    if (!signIn) {
      setNotice({
        tone: 'error',
        text: t('connectorConnections.popupBlocked', {
          defaultValue: 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
        }),
      });
      return;
    }
    // Detach the window before it reaches the vendor: the vendor's page gets no handle on this one.
    signIn.opener = null;
    const begun = await beginConnection(name);
    if (!begun.ok) {
      signIn.close();
      setNotice({ tone: 'error', text: begun.message });
      return;
    }
    signIn.location.href = begun.authorizationUrl;
    const expiresAt = Date.parse(begun.expiresAt);
    setWaiting({ name, window: signIn, before, until: Number.isNaN(expiresAt) ? Date.now() + 10 * 60_000 : expiresAt });
  };

  const confirmRevoke = async () => {
    if (!revokeDraft || revokeDraft.busy) return;
    const name = revokeDraft.name;
    setRevokeDraft({ ...revokeDraft, busy: true, refusal: null });
    const out = await revokeConnection(name);
    if (!out.ok) {
      setRevokeDraft({ name, busy: false, refusal: out.message });
      return;
    }
    applyConnection(name, out);
    setRevokeDraft(null);
    setNotice({ tone: 'ok', text: t('connectorConnections.disconnected', { defaultValue: 'Disconnected {{name}}.', name }) });
  };

  const formatAt = (at: string | undefined): string | null => {
    if (!at) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };

  const statusLabel = (status: ConnectorConnectionState['status']) => (status === 'connected'
    ? t('connectorConnections.statusConnected', { defaultValue: 'Connected' })
    : status === 'reconnect_required'
      ? t('connectorConnections.statusReconnect', { defaultValue: 'Reconnect required' })
      : t('connectorConnections.statusNotConnected', { defaultValue: 'Not connected' }));

  let body: ReactNode;
  if (listing === null) {
    body = (
      <div className="space-y-2" data-testid="connector-connections-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (listing.kind === 'failed') {
    body = (
      <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-2">
          <p className="font-medium text-destructive">
            {t('connectorConnections.loadFailed', { defaultValue: 'Could not load connector connections.' })}
          </p>
          <p className="text-muted-foreground">{listing.message}</p>
          <Button size="sm" variant="outline" onClick={reload}>
            {t('connectorConnections.retry', { defaultValue: 'Try again' })}
          </Button>
        </div>
      </div>
    );
  } else if (listing.rows.length === 0) {
    body = (
      <Empty data-testid="connector-connections-empty">
        <EmptyTitle>{t('connectorConnections.emptyTitle', { defaultValue: 'No connector needs connecting' })}</EmptyTitle>
        <EmptyDescription>
          {t('connectorConnections.emptyBody', {
            defaultValue: 'None of the installed apps has a connector that an administrator signs in to with OAuth.',
          })}
        </EmptyDescription>
      </Empty>
    );
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connectorConnections.colConnector', { defaultValue: 'Connector' })}</TableHead>
            <TableHead>{t('connectorConnections.colConnection', { defaultValue: 'Connection' })}</TableHead>
            <TableHead>{t('connectorConnections.colDetails', { defaultValue: 'Details' })}</TableHead>
            <TableHead>{t('connectorConnections.colActions', { defaultValue: 'Actions' })}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listing.rows.map(({ instance, descriptor, connection }) => {
            const name = instance.name;
            const state = connection.ok ? connection.state : undefined;
            const connectedAt = formatAt(state?.connectedAt);
            const expiresAt = formatAt(state?.expiresAt);
            const isWaiting = waiting?.name === name;
            return (
              <TableRow key={name} id={`connection-${name}`} data-testid={`connection-row-${name}`}>
                <TableCell className="align-top">
                  <p className="text-sm font-medium">{instance.label}</p>
                  <code className="font-mono text-xs text-muted-foreground">{name}</code>
                  {descriptor?.state === 'degraded' ? (
                    <div className="mt-1 space-y-0.5" data-testid={`connection-degraded-${name}`}>
                      <Badge variant="outline" className={STATUS_CLASS.not_connected}>
                        {t('connectorConnections.instanceDegraded', { defaultValue: 'Degraded' })}
                      </Badge>
                      {descriptor.degradedReason ? (
                        <p className="max-w-sm text-xs text-muted-foreground">{descriptor.degradedReason}</p>
                      ) : null}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  {state ? (
                    <div className="space-y-1">
                      <Badge variant="outline" className={STATUS_CLASS[state.status]} data-status={state.status}>
                        {statusLabel(state.status)}
                      </Badge>
                      {state.statusReason ? (
                        <p className="max-w-sm text-xs text-destructive" data-testid={`connection-reason-${name}`}>
                          {state.statusReason}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="max-w-sm text-xs text-muted-foreground" data-testid={`connection-refused-${name}`}>
                      {connection.ok ? null : connection.message}
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {connectedAt ? (
                    <p>
                      {state?.connectedBy
                        ? t('connectorConnections.connectedBy', { defaultValue: 'Connected {{at}} by {{user}}', at: connectedAt, user: state.connectedBy })
                        : t('connectorConnections.connectedAt', { defaultValue: 'Connected {{at}}', at: connectedAt })}
                    </p>
                  ) : null}
                  {state?.scopes ? (
                    <p>{t('connectorConnections.scopes', { defaultValue: 'Scopes: {{scopes}}', scopes: state.scopes })}</p>
                  ) : null}
                  {expiresAt ? (
                    <p>{t('connectorConnections.tokenExpires', { defaultValue: 'Access token renews by {{at}}', at: expiresAt })}</p>
                  ) : null}
                  {!connectedAt && !state?.scopes && !expiresAt ? <p aria-hidden="true">{'—'}</p> : null}
                </TableCell>
                <TableCell className="align-top">
                  {state ? (
                    <div className="flex flex-wrap gap-2">
                      {isWaiting ? (
                        <p role="status" className="text-xs text-muted-foreground">
                          {t('connectorConnections.waiting', { defaultValue: 'Finish signing in in the window that opened.' })}
                        </p>
                      ) : (
                        <Button
                          size="sm"
                          variant={state.status === 'connected' ? 'outline' : 'default'}
                          disabled={waiting !== null}
                          onClick={() => void connect(name, state.connectedAt)}
                        >
                          {state.status === 'not_connected'
                            ? t('connectorConnections.connect', { defaultValue: 'Connect' })
                            : t('connectorConnections.reconnect', { defaultValue: 'Reconnect' })}
                        </Button>
                      )}
                      {state.status !== 'not_connected' && !isWaiting ? (
                        <Button size="sm" variant="outline" onClick={() => setRevokeDraft({ name, busy: false, refusal: null })}>
                          {t('connectorConnections.disconnect', { defaultValue: 'Disconnect' })}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('connectorConnections.title', { defaultValue: 'Connector connections' })}
        subtitle={t('connectorConnections.subtitle', {
          defaultValue:
            'Sign in once to each vendor your connectors call on this organization\'s behalf. The platform renews access by itself; reconnect when a vendor stops accepting the grant.',
        })}
        icon={<Plug className="h-4 w-4" />}
        refresh={{
          onRefresh: reload,
          label: t('connectorConnections.refresh', { defaultValue: 'Refresh' }),
          busy: listing === null,
        }}
      />
      <div className="space-y-4 p-6">
        {notice ? (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={notice.tone === 'error'
              ? 'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'
              : 'flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400'}
          >
            {notice.tone === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <div className="flex-1">{notice.text}</div>
            <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>
              {t('connectorConnections.dismiss', { defaultValue: 'Dismiss' })}
            </button>
          </div>
        ) : null}
        {body}
      </div>

      <Dialog open={revokeDraft !== null} onOpenChange={(open) => { if (!open && !revokeDraft?.busy) setRevokeDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('connectorConnections.disconnectTitle', { defaultValue: 'Disconnect {{name}}?', name: revokeDraft?.name ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('connectorConnections.disconnectBody', {
                defaultValue:
                  'The connection is removed here and the connector stops calling the vendor for this organization until it is connected again. The grant stays valid at the vendor until it expires or is revoked there.',
              })}
            </DialogDescription>
          </DialogHeader>
          {revokeDraft?.refusal ? (
            <p role="alert" className="text-sm text-destructive">{revokeDraft.refusal}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeDraft(null)} disabled={revokeDraft?.busy}>
              {t('connectorConnections.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button variant="destructive" onClick={() => void confirmRevoke()} disabled={revokeDraft?.busy}>
              {t('connectorConnections.disconnectConfirm', { defaultValue: 'Disconnect' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
