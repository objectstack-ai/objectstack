// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's Slack page: an organization administrator installs the
 * organization's own Slack app (its bot token), sets the token again, or
 * removes the install, and lists and removes people's Slack links — through
 * the administrator doors of the Slack link routes (`slackDoors.ts`).
 *
 * Gated by the capability those doors ask, `setup.write` in the caller's
 * current organization (`hasCapabilities`, which fails open on an unreported
 * answer: the doors still refuse). Without it the page reads nothing.
 *
 * ⛔ It never shows a token: no door answers one, and the token input starts
 * empty whatever is installed. A link is listed as served: its person's id,
 * the Slack user only once confirmed, and when it was confirmed. The list is
 * read unpaged; at the door's cap the page says it may be incomplete.
 */

import { useCallback, useContext, useEffect, useState, type FormEvent } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { SchemaRendererContext } from '@object-ui/react';
import { PageHeader } from '../../layout/PageHeader.js';
import {
  installSlack,
  listSlackLinks,
  readSlackAccount,
  removeSlackLink,
  SLACK_ADMIN_CAPABILITY,
  SLACK_LINKS_SERVED_CAP,
  uninstallSlack,
  type SlackAccount,
  type SlackAnswer,
  type SlackLink,
} from '../../console/notification-settings/slackDoors.js';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Loaded<T> = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'read'; value: T };
/** What the confirm dialog removes: the whole install, or one link. */
type Removal = { kind: 'install' } | { kind: 'link'; link: SlackLink };

const loaded = <T,>(out: SlackAnswer<T>): Loaded<T> =>
  out.ok ? { state: 'read', value: out.data } : { state: 'failed', message: out.refusal.message };

export function SlackSetupPage() {
  const { t } = useObjectTranslation();
  const { hasCapabilities } = usePermissions();
  const apiFetch = useContext(SchemaRendererContext)?.apiFetch as Fetch | undefined;
  const allowed = hasCapabilities([SLACK_ADMIN_CAPABILITY]);

  const header = (
    <PageHeader
      title={t('slackSetup.title')}
      subtitle={t('slackSetup.subtitle')}
      icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
    />
  );
  return (
    <div data-testid="slack-setup-page">
      {header}
      <div className="space-y-4 p-4 sm:p-6">
        {!allowed || !apiFetch ? (
          <Alert data-testid="slack-setup-not-allowed">
            <AlertDescription>{t('slackSetup.notAllowed', { capability: SLACK_ADMIN_CAPABILITY })}</AlertDescription>
          </Alert>
        ) : (
          <SlackSetupBody apiFetch={apiFetch} />
        )}
      </div>
    </div>
  );
}

function SlackSetupBody({ apiFetch }: { apiFetch: Fetch }) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const [account, setAccount] = useState<Loaded<SlackAccount | null>>({ state: 'loading' });
  const [links, setLinks] = useState<Loaded<SlackLink[]>>({ state: 'loading' });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);

  const reread = useCallback(async () => {
    const [a, l] = await Promise.all([readSlackAccount(apiFetch), listSlackLinks(apiFetch)]);
    setAccount(loaded(a));
    setLinks(loaded(l));
  }, [apiFetch]);

  useEffect(() => {
    void reread();
  }, [reread]);

  /** Run one door call; on success show `done`, else the refusal; then read both doors again. */
  const act = async <T,>(call: () => Promise<SlackAnswer<T>>, done: (data: T) => string): Promise<boolean> => {
    setBusy(true);
    setRefusal(null);
    setNotice(null);
    const out = await call();
    if (out.ok) setNotice(done(out.data));
    else setRefusal(out.refusal.message);
    await reread();
    setBusy(false);
    return out.ok;
  };

  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || token.trim() === '') return;
    const sent = token;
    setToken('');
    await act(() => installSlack(apiFetch, sent), (a) => t('slackSetup.installed', { workspace: a.workspace }));
  };

  const confirmRemoval = async () => {
    if (!removal) return;
    const target = removal;
    setRemoval(null);
    if (target.kind === 'install') await act(() => uninstallSlack(apiFetch), () => t('slackSetup.uninstalled'));
    else await act(() => removeSlackLink(apiFetch, target.link.id), () => t('slackSetup.linkRemoved', { person: target.link.userId }));
  };

  const formatAt = (at: string | null) => {
    if (!at) return '—';
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };

  const installed = account.state === 'read' ? account.value : null;

  return (
    <>
      {notice !== null && (
        <Alert data-testid="slack-setup-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {refusal !== null && (
        <Alert variant="destructive" data-testid="slack-setup-refused">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-base font-semibold">{t('slackSetup.install')}</h2>
          {account.state === 'loading' ? (
            <p className="text-sm text-muted-foreground">{t('slackSetup.loading')}</p>
          ) : account.state === 'failed' ? (
            <p className="text-sm text-destructive" data-testid="slack-setup-account-failed">{account.message}</p>
          ) : installed ? (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="slack-setup-account">
              <span>{t('slackSetup.workspace', { workspace: installed.workspace, workspaceId: installed.workspaceId })}</span>
              <Badge variant={installed.status === 'active' ? 'secondary' : 'destructive'}>
                {installed.status === 'active' ? t('slackSetup.statusActive') : t('slackSetup.statusRevoked')}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="slack-setup-not-installed">{t('slackSetup.notInstalled')}</p>
          )}
          {installed?.status === 'revoked' && (
            <p className="text-sm text-muted-foreground">{t('slackSetup.revokedHint')}</p>
          )}
          <form onSubmit={(e) => void submitToken(e)} className="space-y-1">
            <Label htmlFor="slack-setup-token">{installed ? t('slackSetup.tokenReplace') : t('slackSetup.token')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="slack-setup-token"
                data-testid="slack-setup-token"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={busy}
                placeholder="xoxb-"
                className="font-mono sm:max-w-sm"
              />
              <Button type="submit" size="sm" disabled={busy || token.trim() === ''} data-testid="slack-setup-save">
                {installed ? t('slackSetup.saveToken') : t('slackSetup.installAction')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('slackSetup.tokenHint')}</p>
          </form>
          {installed && (
            <Button variant="outline" size="sm" disabled={busy} data-testid="slack-setup-uninstall" onClick={() => setRemoval({ kind: 'install' })}>
              {t('slackSetup.uninstall')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-base font-semibold">{t('slackSetup.links')}</h2>
          {links.state === 'loading' ? (
            <p className="text-sm text-muted-foreground">{t('slackSetup.loading')}</p>
          ) : links.state === 'failed' ? (
            <p className="text-sm text-destructive" data-testid="slack-setup-links-failed">{links.message}</p>
          ) : links.value.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="slack-setup-no-links">{t('slackSetup.noLinks')}</p>
          ) : (
            <>
              {links.value.length >= SLACK_LINKS_SERVED_CAP && (
                <p className="text-sm text-muted-foreground" data-testid="slack-setup-links-capped">
                  {t('slackSetup.linksCapped', { cap: SLACK_LINKS_SERVED_CAP })}
                </p>
              )}
              <div className="overflow-x-auto">
                <Table data-testid="slack-setup-links">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('slackSetup.colPerson')}</TableHead>
                      <TableHead>{t('slackSetup.colSlackUser')}</TableHead>
                      <TableHead>{t('slackSetup.colLinkedAt')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {links.value.map((link) => (
                      <TableRow key={link.id} data-testid={`slack-setup-link-${link.id}`}>
                        <TableCell className="font-mono text-xs">{link.userId}</TableCell>
                        <TableCell className="text-sm">
                          {link.state === 'confirmed'
                            ? [link.slackUserName, link.slackUserId].filter(Boolean).join(' · ')
                            : t('slackSetup.proposedLink')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatAt(link.confirmedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" disabled={busy} data-testid={`slack-setup-remove-${link.id}`}
                            onClick={() => setRemoval({ kind: 'link', link })}>
                            {t('slackSetup.remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={removal !== null} onOpenChange={(open) => { if (!open) setRemoval(null); }}>
        <DialogContent data-testid="slack-setup-confirm">
          <DialogHeader>
            <DialogTitle>{removal?.kind === 'install' ? t('slackSetup.uninstallTitle') : t('slackSetup.removeTitle')}</DialogTitle>
            <DialogDescription>
              {removal?.kind === 'install'
                ? t('slackSetup.uninstallBody', { workspace: installed?.workspace ?? '' })
                : t('slackSetup.removeBody', { person: removal?.kind === 'link' ? removal.link.userId : '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoval(null)}>{t('slackSetup.cancel')}</Button>
            <Button variant="destructive" data-testid="slack-setup-confirm-remove" onClick={() => void confirmRemoval()}>
              {removal?.kind === 'install' ? t('slackSetup.uninstall') : t('slackSetup.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
