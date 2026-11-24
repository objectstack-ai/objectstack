// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Notification Settings page's Slack section: the signed-in person
 * connects or disconnects their own Slack user, in their current organization,
 * through the Slack link doors (`slackDoors.ts`).
 *
 * The page draws it only while the preference door lists `slack` as a
 * channel, which it does only where connector-slack is composed. It shows the
 * state the door answers and nothing else:
 *
 *  - no install, or an install whose token Slack refused: says so, offers nothing;
 *  - no link: "Connect Slack", which asks for a proposal;
 *  - a proposal: what the door answers of it (that a match was found, never
 *    whom), with Confirm and Cancel;
 *  - a confirmed link: the Slack user it names, with Disconnect.
 *
 * After every action, refused or not, it reads the door again, so what it
 * draws is what is stored. A refusal is shown in the server's own words.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, Card, CardContent } from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import {
  confirmSlackLink,
  proposeSlackLink,
  readOwnSlackLink,
  removeOwnSlackLink,
  type OwnSlackLink,
  type SlackAccount,
  type SlackAnswer,
} from './slackDoors.js';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

type Read =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'read'; readonly account: SlackAccount | null; readonly link: OwnSlackLink | null };

const toRead = (out: Awaited<ReturnType<typeof readOwnSlackLink>>): Read =>
  out.ok ? { state: 'read', ...out.data } : { state: 'failed', message: out.refusal.message };

export function SlackLinkSection({ apiFetch }: { apiFetch: Fetch }) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const [read, setRead] = useState<Read>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [noMatch, setNoMatch] = useState(false);

  const reread = useCallback(async () => setRead(toRead(await readOwnSlackLink(apiFetch))), [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    void readOwnSlackLink(apiFetch).then((out) => {
      if (!cancelled) setRead(toRead(out));
    });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  /** Run one door call, show its refusal if any, then read the door again. */
  const act = async <T,>(call: () => Promise<SlackAnswer<T>>, after?: (data: T) => void) => {
    setBusy(true);
    setRefusal(null);
    setNoMatch(false);
    const out = await call();
    if (out.ok) after?.(out.data);
    else setRefusal(out.refusal.message);
    await reread();
    setBusy(false);
  };

  const formatAt = (at: string | null) => {
    if (!at) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };

  let body;
  if (read.state === 'loading') {
    body = <p className="text-sm text-muted-foreground">{t('slackLink.loading')}</p>;
  } else if (read.state === 'failed') {
    body = (
      <Alert variant="destructive" data-testid="slack-link-load-failed">
        <AlertDescription>{t('slackLink.loadFailed', { reason: read.message })}</AlertDescription>
      </Alert>
    );
  } else if (!read.account) {
    body = <p className="text-sm text-muted-foreground" data-testid="slack-link-not-installed">{t('slackLink.notInstalled')}</p>;
  } else {
    const { account, link } = read;
    const workspace = account.workspace;
    body = (
      <div className="space-y-3">
        {account.status === 'revoked' && (
          <Alert data-testid="slack-link-revoked">
            <AlertDescription>{t('slackLink.revoked', { workspace })}</AlertDescription>
          </Alert>
        )}
        {link?.state === 'confirmed' ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="slack-link-linked">
            <div className="space-y-1 text-sm">
              <p>{t('slackLink.linked', { workspace, slackUser: link.slackUserName ?? link.slackUserId ?? '' })}</p>
              {link.confirmedAt && (
                <p className="text-xs text-muted-foreground">{t('slackLink.linkedAt', { at: formatAt(link.confirmedAt) })}</p>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={busy} data-testid="slack-link-disconnect"
              onClick={() => void act(() => removeOwnSlackLink(apiFetch))}>
              {t('slackLink.disconnect')}
            </Button>
          </div>
        ) : link?.state === 'proposed' ? (
          <div className="space-y-3" data-testid="slack-link-proposal">
            <p className="text-sm">{t('slackLink.proposed', { workspace })}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} data-testid="slack-link-confirm" onClick={() => void act(() => confirmSlackLink(apiFetch))}>
                {t('slackLink.confirm')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} data-testid="slack-link-cancel"
                onClick={() => void act(() => removeOwnSlackLink(apiFetch))}>
                {t('slackLink.cancel')}
              </Button>
              {refusal !== null && (
                <Button variant="ghost" size="sm" disabled={busy} data-testid="slack-link-propose-again"
                  onClick={() => void act(() => proposeSlackLink(apiFetch), (l) => setNoMatch(l === null))}>
                  {t('slackLink.proposeAgain')}
                </Button>
              )}
            </div>
          </div>
        ) : account.status === 'active' ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t('slackLink.notLinked', { workspace })}</p>
            <Button size="sm" disabled={busy} data-testid="slack-link-connect"
              onClick={() => void act(() => proposeSlackLink(apiFetch), (l) => setNoMatch(l === null))}>
              {t('slackLink.connect')}
            </Button>
          </div>
        ) : null}
        {noMatch && <p className="text-sm text-muted-foreground" data-testid="slack-link-no-match">{t('slackLink.noMatch', { workspace })}</p>}
      </div>
    );
  }

  return (
    <Card data-testid="slack-link-section">
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-base font-semibold">{t('slackLink.title')}</h2>
        {refusal !== null && (
          <Alert variant="destructive" data-testid="slack-link-refused">
            <AlertDescription>{refusal}</AlertDescription>
          </Alert>
        )}
        {body}
      </CardContent>
    </Card>
  );
}
