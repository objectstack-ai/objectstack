// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "What can act as me" — the list under the Connect an Agent setup steps: the
 * AI assistants the signed-in person authorized on the OAuth consent page, and
 * the API keys they created. The consent page tells the person they can manage
 * that access from their account; Connect an Agent sits in Account's AI
 * Assistant group, so this list is where that promise lands.
 *
 * Two reads, both scoped to the session's own person:
 *
 *  - assistants: `oauth.authorizedClients.list()` (`GET /auth/authorized-clients`,
 *    newest first). `lastUsedAt` is the START of an hour, so it is shown as
 *    "in the hour from …", never as a moment. Revoke withdraws the grant
 *    through `oauth.authorizedClients.withdraw(id)` after a confirm naming the
 *    assistant: the server deletes the consent and its refresh grant, so the
 *    assistant's token is refused on its next call. The list is read again
 *    after every withdraw, answered or refused, so a grant already withdrawn
 *    elsewhere (the server answers 404 for it) leaves the list too;
 *  - API keys: the data API's `sys_api_key` rows filtered to `user_id` = the
 *    signed-in person (a platform administrator reads every person's keys, so
 *    the filter is what keeps this list "mine"). Revoke writes `revoked: true`
 *    through the adapter after a confirm naming the key, which is what ends a
 *    key's access; the adapter's mutation event refreshes the list in place.
 *
 * Renders nothing without an adapter or a signed-in person.
 *
 * `AuthorizedAssistantsSection` is the assistants half on its own. Given
 * `forUserId` it is the administrator's view over that person instead:
 * `listForUser(userId)` and `withdrawForUser(userId, id)`, the platform-admin
 * doors (anyone else is refused 403, which the section shows as a failed read).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@object-ui/components';
import { AlertCircle, Bot, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@object-ui/auth';
import { formatDate, formatDateTime, useObjectTranslation } from '@object-ui/i18n';
import { notifyDataChanged, useAdapter, useDataInvalidation } from '@object-ui/react';
import {
  API_KEY_LIST_FIELDS,
  isExpired,
  type ApiKeyRow,
  type AuthorizedClient,
  type AuthorizedClientsList,
} from './accessRecords.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A granted scope in the words the consent page used to ask for it, so the
 * person reads the same sentence they agreed to. A scope the page cannot name
 * is still shown, as unrecognised, never dropped.
 */
const SCOPE_KEYS: Record<string, string> = {
  openid: 'oauth.consent.scope.openid',
  profile: 'oauth.consent.scope.profile',
  email: 'oauth.consent.scope.email',
  offline_access: 'oauth.consent.scope.offlineAccess',
  'data:read': 'oauth.consent.scope.dataRead',
  'data:write': 'oauth.consent.scope.dataWrite',
  'actions:execute': 'oauth.consent.scope.actionsExecute',
  'metadata:write': 'oauth.consent.scope.metadataWrite',
};

function describeGrantedScope(scope: string, t: Translate): string {
  const key = SCOPE_KEYS[scope];
  return key ? t(key) : t('oauth.consent.scope.unrecognised', { scope });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function assistantName(c: AuthorizedClient, t: Translate): string {
  return c.name ?? t('connectAgent.access.unnamed');
}

function AssistantRows({
  clients,
  truncated,
  managed,
  activeOrganizationId,
  organizationNames,
  withdrawingId,
  onWithdraw,
}: {
  clients: AuthorizedClient[];
  truncated: boolean;
  /** Another person's grants, read by an administrator: the empty and truncated lines speak of "this person". */
  managed: boolean;
  activeOrganizationId: string | null;
  organizationNames: Map<string, string>;
  /** The grant a withdraw is in flight for; its Revoke waits for the answer. */
  withdrawingId: string | null;
  onWithdraw: (client: AuthorizedClient) => void;
}) {
  const { t, language } = useObjectTranslation();
  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(managed ? 'connectAgent.access.managedEmpty' : 'connectAgent.access.assistantsEmpty')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-md border">
        {clients.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm" data-testid="authorized-assistant">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{assistantName(c, t)}</span>
                {c.name ? null : (
                  <span className="font-mono text-xs text-muted-foreground">{c.clientId}</span>
                )}
                {/* The organization says something only when it is not the one the person is in now. */}
                {c.organizationId && c.organizationId !== activeOrganizationId ? (
                  <Badge variant="outline">
                    {t('connectAgent.access.inOrganization', {
                      name: organizationNames.get(c.organizationId) ?? c.organizationId,
                    })}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {c.authorizedAt ? (
                  <span>
                    {t('connectAgent.access.authorized', {
                      date: formatDate(c.authorizedAt, { locale: language }),
                    })}
                  </span>
                ) : null}
                <span>
                  {c.lastUsedAt
                    ? t('connectAgent.access.lastUsedHour', {
                        time: formatDateTime(c.lastUsedAt, { locale: language }),
                      })
                    : t('connectAgent.access.notRecorded')}
                </span>
              </div>
              {c.scopes.length > 0 ? (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {c.scopes.map((s) => (
                    <li key={s}>{describeGrantedScope(s, t)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={withdrawingId !== null}
              onClick={() => onWithdraw(c)}
            >
              {t('connectAgent.access.revoke')}
            </Button>
          </li>
        ))}
      </ul>
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          {t(managed ? 'connectAgent.access.managedTruncated' : 'connectAgent.access.truncated')}
        </p>
      ) : null}
    </div>
  );
}

function KeyRows({
  keys,
  readAt,
  onRevoke,
}: {
  keys: ApiKeyRow[];
  /** When the rows were read: expiry is judged against the read, not against each render. */
  readAt: number;
  onRevoke: (row: ApiKeyRow) => void;
}) {
  const { t, language } = useObjectTranslation();
  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('connectAgent.access.keysEmpty')}</p>;
  }
  return (
    <ul className="divide-y rounded-md border">
      {keys.map((k) => {
        const expired = isExpired(k, readAt);
        return (
          <li key={k.id} className="flex items-start gap-3 px-3 py-2 text-sm" data-testid="api-key-row">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{k.name || k.id}</span>
                {k.prefix ? (
                  <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
                ) : null}
                {k.revoked ? (
                  <Badge variant="secondary">{t('connectAgent.access.revoked')}</Badge>
                ) : expired ? (
                  <Badge variant="secondary">{t('connectAgent.access.expired')}</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {k.created_at ? (
                  <span>
                    {t('connectAgent.access.created', {
                      date: formatDate(k.created_at, { locale: language }),
                    })}
                  </span>
                ) : null}
                <span>
                  {k.last_used_at
                    ? t('connectAgent.access.keyLastUsed', {
                        time: formatDateTime(k.last_used_at, { locale: language }),
                      })
                    : t('connectAgent.access.neverUsed')}
                </span>
              </div>
            </div>
            {k.revoked || expired ? null : (
              <Button variant="outline" size="sm" onClick={() => onRevoke(k)}>
                {t('connectAgent.access.revoke')}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

/**
 * The assistants half: the list, its confirm-first Revoke and the re-read
 * after it. Without `forUserId` it is the signed-in person's own grants; with
 * it, an administrator's view over that person's.
 */
export function AuthorizedAssistantsSection({ forUserId }: { forUserId?: string }) {
  const { t } = useObjectTranslation();
  const adapter = useAdapter();
  const { user, activeOrganization, organizations } = useAuth();
  const userId = user?.id ?? null;
  const managed = forUserId !== undefined;

  const [assistants, setAssistants] = useState<Load<AuthorizedClientsList>>({ state: 'loading' });
  const [readNonce, setReadNonce] = useState(0);
  const [confirmClient, setConfirmClient] = useState<AuthorizedClient | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const organizationNames = useMemo(
    () => new Map((organizations ?? []).map((o) => [o.id, o.name] as const)),
    [organizations],
  );

  useEffect(() => {
    if (!adapter || !userId) return;
    let live = true;
    const doors = adapter.getClient().oauth.authorizedClients;
    (forUserId !== undefined ? doors.listForUser(forUserId) : doors.list()).then(
      (value) => live && setAssistants({ state: 'ready', value }),
      (e: unknown) => live && setAssistants({ state: 'error', message: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [adapter, userId, forUserId, readNonce]);

  if (!adapter || !userId) return null;

  const withdraw = async (client: AuthorizedClient) => {
    setWithdrawingId(client.id);
    setWithdrawError(null);
    try {
      const doors = adapter.getClient().oauth.authorizedClients;
      await (forUserId !== undefined ? doors.withdrawForUser(forUserId, client.id) : doors.withdraw(client.id));
    } catch (e) {
      setWithdrawError(errorText(e));
    } finally {
      setWithdrawingId(null);
      // Read again either way: a refused withdraw is most often a grant that is already gone.
      setReadNonce((n) => n + 1);
      // The withdraw bypasses the adapter, so tell every other reader of the
      // person's grants (the "Connected" line, `useConnectedAccess`) it changed.
      notifyDataChanged({ objectName: 'sys_oauth_consent', recordId: client.id });
    }
  };

  return (
    <section className="space-y-2" aria-labelledby={managed ? 'managed-assistants-heading' : 'authorized-assistants-heading'}>
      <h4
        id={managed ? 'managed-assistants-heading' : 'authorized-assistants-heading'}
        className="flex items-center gap-2 text-sm font-medium"
      >
        <Bot className="h-3.5 w-3.5" />
        {t('connectAgent.access.assistants')}
      </h4>
      {assistants.state === 'loading' ? (
        <Skeleton className="h-12 w-full" />
      ) : assistants.state === 'error' ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {t('connectAgent.access.loadFailed', { message: assistants.message })}
        </p>
      ) : (
        <AssistantRows
          clients={assistants.value.clients}
          truncated={assistants.value.truncated}
          managed={managed}
          activeOrganizationId={activeOrganization?.id ?? null}
          organizationNames={organizationNames}
          withdrawingId={withdrawingId}
          onWithdraw={setConfirmClient}
        />
      )}
      {withdrawingId ? (
        <p className="text-xs text-muted-foreground">{t('connectAgent.access.revoking')}</p>
      ) : null}
      {withdrawError ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {withdrawError}
        </p>
      ) : null}

      <AlertDialog
        open={confirmClient !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmClient(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('connectAgent.access.withdrawTitle', { name: confirmClient ? assistantName(confirmClient, t) : '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('connectAgent.access.withdrawBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const client = confirmClient;
                setConfirmClient(null);
                if (client) void withdraw(client);
              }}
            >
              {t('connectAgent.access.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function AuthorizedAccessList() {
  const { t } = useObjectTranslation();
  const adapter = useAdapter();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [keys, setKeys] = useState<Load<{ rows: ApiKeyRow[]; readAt: number }>>({ state: 'loading' });
  const [confirmKey, setConfirmKey] = useState<ApiKeyRow | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const keysNonce = useDataInvalidation('sys_api_key');

  useEffect(() => {
    if (!adapter || !userId) return;
    let live = true;
    adapter
      .find('sys_api_key', {
        $filter: { user_id: userId },
        $select: [...API_KEY_LIST_FIELDS],
        $orderby: [{ field: 'created_at', order: 'desc' }],
      })
      .then(
        (res) =>
          live && setKeys({ state: 'ready', value: { rows: (res?.data ?? []) as ApiKeyRow[], readAt: Date.now() } }),
        (e: unknown) => live && setKeys({ state: 'error', message: errorText(e) }),
      );
    return () => {
      live = false;
    };
  }, [adapter, userId, keysNonce]);

  if (!adapter || !userId) return null;

  const revoke = async (row: ApiKeyRow) => {
    setRevokingId(row.id);
    setRevokeError(null);
    try {
      // The adapter's mutation event reaches `useDataInvalidation('sys_api_key')`,
      // which re-reads the list in place.
      await adapter.update('sys_api_key', row.id, { revoked: true });
    } catch (e) {
      setRevokeError(errorText(e));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {t('connectAgent.access.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('connectAgent.access.body')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuthorizedAssistantsSection />

        <section className="space-y-2" aria-labelledby="api-keys-heading">
          <h4 id="api-keys-heading" className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-3.5 w-3.5" />
            {t('connectAgent.access.keys')}
          </h4>
          {keys.state === 'loading' ? (
            <Skeleton className="h-12 w-full" />
          ) : keys.state === 'error' ? (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('connectAgent.access.loadFailed', { message: keys.message })}
            </p>
          ) : (
            <KeyRows keys={keys.value.rows} readAt={keys.value.readAt} onRevoke={setConfirmKey} />
          )}
          {revokingId ? (
            <p className="text-xs text-muted-foreground">{t('connectAgent.access.revoking')}</p>
          ) : null}
          {revokeError ? (
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {revokeError}
            </p>
          ) : null}
        </section>

        <AlertDialog
          open={confirmKey !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmKey(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('connectAgent.access.revokeTitle', { name: confirmKey?.name || confirmKey?.id || '' })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('connectAgent.access.revokeBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const row = confirmKey;
                  setConfirmKey(null);
                  if (row) void revoke(row);
                }}
              >
                {t('connectAgent.access.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
