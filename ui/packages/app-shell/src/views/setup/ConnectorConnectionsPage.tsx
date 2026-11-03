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
 * An instance declaring `clientSource: 'installer'` (ADR-0143 D2.1, the
 * 2026-11-02 amendment) first asks for the OAuth client the administrator
 * registered with the vendor: its client id and, when the vendor issued one,
 * its secret. The form shows the redirect URI to register with that client,
 * exactly as the status read answers it (`redirectUri`, derived by the server
 * and never guessed here), with a copy button; when the read answers none,
 * the form says the deployment has no redirect URI. Continue opens the window
 * on that click and begins the connect with the client. The secret input is
 * masked, starts empty on every opening (the stored secret is never read
 * back, only whether one is kept), and is cleared the moment the begin is
 * sent. A reconnect of a connection that keeps a client keeps it by default:
 * the begin then sends no body, and the server reuses the kept client.
 * Replacing it shows the client fields again. Every other instance connects
 * with no form.
 *
 * ⛔ It never displays a token, a code, a client secret or the authorization
 * URL: none of the door's status answers carries a token or a secret, and
 * the URL goes only to the window.
 */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
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
  Input,
  Label,
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
  type InstallerClientInput,
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
  /** When the begun connect stops being completable, as the server answered it. */
  until?: number;
}

/** What the notice line says: a message this page words, or the server's own sentence. */
type Notice =
  | { tone: 'ok'; kind: 'connected' | 'disconnected'; name: string }
  | { tone: 'error'; kind: 'expired'; name: string }
  | { tone: 'error'; kind: 'popupBlocked' }
  | { tone: 'error'; kind: 'refusal'; text: string };

/**
 * The OAuth client form of an installer-client instance. The secret lives
 * here only while it is typed: cleared when the begin is sent, and the whole
 * draft is dropped when the form closes.
 */
interface ClientDraft {
  name: string;
  label: string;
  /** The status's `connectedAt` before this connect, as the wait compares it. */
  before?: string;
  /** The client the connection keeps (`client` on the status), shown on a reconnect. */
  stored?: { clientId: string; hasSecret: boolean };
  /** Whether the administrator replaces the stored client; always `true` when none is stored. */
  replacing: boolean;
  /** The redirect URI the status read answered (`redirectUri`); absent when the server derives none. */
  redirectUri?: string;
  /** Whether the redirect URI was copied since the form opened. */
  copied: boolean;
  clientId: string;
  clientSecret: string;
  busy: boolean;
  refusal: string | null;
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [revokeDraft, setRevokeDraft] = useState<RevokeDraft | null>(null);
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(null);
  const clientIdInput = useId();
  const clientSecretInput = useId();

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
    const current = waiting;
    const deadline = current.until ?? Date.now() + 10 * 60_000;
    let busy = false;
    let cancelled = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      const closed = current.window.closed;
      void fetchConnection(current.name).then((read) => {
        busy = false;
        if (cancelled) return;
        const landed = read.ok && read.state.status === 'connected' && read.state.connectedAt !== current.before;
        const expired = Date.now() > deadline;
        if (!landed && !closed && !expired) return;
        applyConnection(current.name, read);
        if (!current.window.closed) current.window.close();
        setWaiting(null);
        if (landed) setNotice({ tone: 'ok', kind: 'connected', name: current.name });
        else if (expired && !closed) setNotice({ tone: 'error', kind: 'expired', name: current.name });
      }, () => { busy = false; });
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, pollMs]);

  /**
   * Begin a connect: open the sign-in window (on the click), begin, and wait.
   * Answers the server's refusal when the begin is refused, `null` otherwise
   * (a blocked window included: that notice is the page's).
   */
  const connect = async (name: string, before?: string, client?: InstallerClientInput): Promise<string | null> => {
    if (waiting) return null;
    setNotice(null);
    const signIn = window.open('about:blank', SIGN_IN_WINDOW, SIGN_IN_FEATURES);
    if (!signIn) {
      setNotice({ tone: 'error', kind: 'popupBlocked' });
      return null;
    }
    // Detach the window before it reaches the vendor: the vendor's page gets no handle on this one.
    signIn.opener = null;
    const begun = await beginConnection(name, client);
    if (!begun.ok) {
      signIn.close();
      return begun.message;
    }
    signIn.location.href = begun.authorizationUrl;
    const until = Date.parse(begun.expiresAt);
    setWaiting({ name, window: signIn, before, ...(Number.isNaN(until) ? {} : { until }) });
    return null;
  };

  /** Connect / Reconnect: an installer-client instance asks for its client first; every other one connects at once. */
  const startConnect = (instance: { name: string; label: string; installerClient?: true }, state: ConnectorConnectionState) => {
    if (!instance.installerClient) {
      void connect(instance.name, state.connectedAt).then((refusal) => {
        if (refusal !== null) setNotice({ tone: 'error', kind: 'refusal', text: refusal });
      });
      return;
    }
    setNotice(null);
    setClientDraft({
      name: instance.name,
      label: instance.label,
      before: state.connectedAt,
      ...(state.client ? { stored: { clientId: state.client.clientId, hasSecret: state.client.hasSecret } } : {}),
      replacing: !state.client,
      ...(state.redirectUri ? { redirectUri: state.redirectUri } : {}),
      copied: false,
      clientId: '',
      clientSecret: '',
      busy: false,
      refusal: null,
    });
  };

  const submitClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientDraft || clientDraft.busy) return;
    let client: InstallerClientInput | undefined;
    if (clientDraft.replacing) {
      const clientId = clientDraft.clientId.trim();
      if (clientId.length === 0) return;
      client = {
        clientId,
        ...(clientDraft.clientSecret.length > 0 ? { clientSecret: clientDraft.clientSecret } : {}),
      };
    }
    // The secret leaves the form with this begin: clear it before anything is awaited.
    // Keeping the stored client sends no client at all: the server reuses the one it keeps.
    setClientDraft({ ...clientDraft, clientSecret: '', busy: true, refusal: null });
    const refusal = await connect(clientDraft.name, clientDraft.before, client);
    if (refusal === null) {
      setClientDraft(null);
      return;
    }
    setClientDraft((cur) => (cur ? { ...cur, busy: false, refusal } : cur));
  };

  const copyRedirectUri = async () => {
    const uri = clientDraft?.redirectUri;
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setClientDraft((cur) => (cur ? { ...cur, copied: true } : cur));
    } catch {
      // Denied or unavailable: the URI is on screen and selectable.
    }
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
    // The revoke answer carries the status alone; the status read also answers
    // the deployment's redirect URI, which the next Connect shows. Re-read it.
    const read = await fetchConnection(name);
    applyConnection(name, read.ok ? read : out);
    setRevokeDraft(null);
    setNotice({ tone: 'ok', kind: 'disconnected', name });
  };

  const formatAt = (at: string | undefined): string | null => {
    if (!at) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };

  const noticeText = (n: Notice): string => {
    switch (n.kind) {
      case 'connected':
        return t('connectorConnections.connected', { defaultValue: 'Connected {{name}}.', name: n.name });
      case 'disconnected':
        return t('connectorConnections.disconnected', { defaultValue: 'Disconnected {{name}}.', name: n.name });
      case 'expired':
        return t('connectorConnections.expired', {
          defaultValue: 'The sign-in for {{name}} was not completed in time. Connect again.',
          name: n.name,
        });
      case 'popupBlocked':
        return t('connectorConnections.popupBlocked', {
          defaultValue: 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
        });
      default:
        return n.text;
    }
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
                  {state?.client ? (
                    <p data-testid={`connection-client-${name}`}>
                      {state.client.hasSecret
                        ? t('connectorConnections.clientKeptWithSecret', {
                          defaultValue: 'OAuth client {{clientId}}, secret stored',
                          clientId: state.client.clientId,
                        })
                        : t('connectorConnections.clientKept', {
                          defaultValue: 'OAuth client {{clientId}}, no secret',
                          clientId: state.client.clientId,
                        })}
                    </p>
                  ) : null}
                  {expiresAt ? (
                    <p>{t('connectorConnections.tokenExpires', { defaultValue: 'Access token renews by {{at}}', at: expiresAt })}</p>
                  ) : null}
                  {!connectedAt && !state?.scopes && !expiresAt && !state?.client ? <p aria-hidden="true">{'—'}</p> : null}
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
                          onClick={() => startConnect(instance, state)}
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
            <div className="flex-1">{noticeText(notice)}</div>
            <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>
              {t('connectorConnections.dismiss', { defaultValue: 'Dismiss' })}
            </button>
          </div>
        ) : null}
        {body}
      </div>

      <Dialog open={clientDraft !== null} onOpenChange={(open) => { if (!open && !clientDraft?.busy) setClientDraft(null); }}>
        <DialogContent data-testid="connector-client-form">
          <form onSubmit={(e) => void submitClient(e)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {t('connectorConnections.clientTitle', { defaultValue: 'OAuth client for {{name}}', name: clientDraft?.label ?? '' })}
              </DialogTitle>
              <DialogDescription>
                {t('connectorConnections.clientIntro', {
                  defaultValue:
                    'This connector signs in with an OAuth client your organization registers with the vendor for this deployment, using the redirect URI below. Enter the client\'s ID, and its secret if the vendor issued one, then continue to the vendor\'s sign-in.',
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5" data-testid="connector-client-redirect">
              <p className="text-sm font-medium">{t('connectorConnections.redirectUriLabel', { defaultValue: 'Redirect URI' })}</p>
              {clientDraft?.redirectUri ? (
                <>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs" data-testid="connector-client-redirect-uri">
                      {clientDraft.redirectUri}
                    </code>
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyRedirectUri()}>
                      {clientDraft.copied
                        ? t('connectorConnections.redirectUriCopied', { defaultValue: 'Copied' })
                        : t('connectorConnections.redirectUriCopy', { defaultValue: 'Copy' })}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('connectorConnections.redirectUriHint', {
                      defaultValue: 'Register this exact URI with the vendor\'s OAuth client before you continue.',
                    })}
                  </p>
                </>
              ) : (
                <p role="alert" className="text-xs text-destructive" data-testid="connector-client-redirect-missing">
                  {t('connectorConnections.redirectUriMissing', {
                    defaultValue:
                      'This deployment has no fixed public address, so it has no redirect URI and a connect is refused. Set OS_BASE_URL (or OS_AUTH_URL) on the server.',
                  })}
                </p>
              )}
            </div>
            {clientDraft?.stored ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="connector-client-stored">
                <p className="font-medium text-foreground">
                  {t('connectorConnections.clientStored', { defaultValue: 'Stored client: {{clientId}}', clientId: clientDraft.stored.clientId })}
                </p>
                <p>
                  {clientDraft.stored.hasSecret
                    ? t('connectorConnections.clientStoredSecret', { defaultValue: 'A client secret is stored with it. It is never shown.' })
                    : t('connectorConnections.clientStoredNoSecret', { defaultValue: 'No client secret is stored with it.' })}
                </p>
                <p className="mt-1">
                  {clientDraft.replacing
                    ? t('connectorConnections.clientResend', {
                      defaultValue:
                        'Replacing it sends a new client: enter its client ID, and its secret if the vendor issued one.',
                    })
                    : t('connectorConnections.clientKeepHint', {
                      defaultValue: 'Reconnecting keeps this client and its stored secret; nothing is entered here.',
                    })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="mt-1 h-auto p-0 text-xs"
                  disabled={clientDraft.busy}
                  onClick={() => setClientDraft((cur) => (cur ? { ...cur, replacing: !cur.replacing, clientId: cur.replacing ? '' : (cur.stored?.clientId ?? ''), clientSecret: '' } : cur))}
                >
                  {clientDraft.replacing
                    ? t('connectorConnections.clientKeep', { defaultValue: 'Keep the stored client' })
                    : t('connectorConnections.clientReplace', { defaultValue: 'Replace the stored client' })}
                </Button>
              </div>
            ) : null}
            {clientDraft?.replacing ? (
              <>
              <div className="space-y-1.5">
                <Label htmlFor={clientIdInput}>{t('connectorConnections.clientId', { defaultValue: 'Client ID' })}</Label>
                <Input
                  id={clientIdInput}
                  autoComplete="off"
                  spellCheck={false}
                  value={clientDraft?.clientId ?? ''}
                  onChange={(e) => setClientDraft((cur) => (cur ? { ...cur, clientId: e.target.value } : cur))}
                  disabled={clientDraft?.busy}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={clientSecretInput}>{t('connectorConnections.clientSecret', { defaultValue: 'Client secret' })}</Label>
                <Input
                  id={clientSecretInput}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={clientDraft?.clientSecret ?? ''}
                  onChange={(e) => setClientDraft((cur) => (cur ? { ...cur, clientSecret: e.target.value } : cur))}
                  disabled={clientDraft?.busy}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {t('connectorConnections.clientSecretHint', {
                    defaultValue: 'Leave it empty for a public client. The secret is stored encrypted with the connection and never shown again.',
                  })}
                </p>
              </div>
              </>
            ) : null}
            {clientDraft?.refusal ? (
              <p role="alert" className="text-sm text-destructive">{clientDraft.refusal}</p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClientDraft(null)} disabled={clientDraft?.busy}>
                {t('connectorConnections.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button type="submit" disabled={clientDraft?.busy || (clientDraft?.replacing === true && clientDraft.clientId.trim().length === 0)}>
                {t('connectorConnections.clientContinue', { defaultValue: 'Continue to sign-in' })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
