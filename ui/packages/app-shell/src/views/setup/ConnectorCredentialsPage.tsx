// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Integrations → Connector Credentials (ruling A on objectstack#27230).
 *
 * One row per `credentialRef` the installed apps' connectors declare, plus any
 * stored credential nothing declares any more: the reference, the connectors
 * that use it with their package, its status (`set` / `missing` / `rejected`
 * with the upstream's message) and where it comes from, when and by whom it was
 * last set — and a masked input to set or replace it, and Clear with a confirm.
 *
 * The entry that opens it is contributed by the automation service's UI
 * bundle, never declared by the shell (cloud ADR-0009 shape); this component is
 * what its ref (`automation:connector-credentials`) resolves to.
 *
 * ⛔ It never displays a value. None of the door's answers carries one, and the
 * input starts empty whatever is stored (see `CredentialValueForm`).
 *
 * Honesty: a runtime without the door, or one whose configuration refuses it
 * (a walled tenancy posture, an automation service without it), is drawn as
 * that configuration conclusion in the server's own words — never as a red
 * "failed to load". Only a real failure is drawn as one.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Info, KeyRound } from 'lucide-react';
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
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';
import { PageHeader } from '../../layout/PageHeader.js';
import { CredentialValueForm } from './CredentialValueForm.js';
import {
  clearConnectorCredential,
  fetchCredentialListing,
  type CredentialListing,
} from './connectorCredentials.js';

/** The status badge's look per status — green, amber, red. */
const STATUS_CLASS: Record<ConnectorCredentialRef['status'], string> = {
  set: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
  missing: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function CredentialStatusBadge({ status }: { status: ConnectorCredentialRef['status'] }) {
  const { t } = useObjectTranslation();
  const label = status === 'set'
    ? t('connectorCredentials.statusSet', { defaultValue: 'Set' })
    : status === 'missing'
      ? t('connectorCredentials.statusMissing', { defaultValue: 'Missing' })
      : t('connectorCredentials.statusRejected', { defaultValue: 'Rejected' });
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]} data-status={status}>
      {label}
    </Badge>
  );
}

/** Who uses a reference: each connector instance, with its package when the registry names one. */
export function CredentialConnectors({ entry }: { entry: ConnectorCredentialRef }) {
  if (entry.connectors.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {entry.connectors.map((c) => (
        <li key={c.name}>
          <code className="font-mono">{c.name}</code>
          {c.packageId ? <span> · {c.packageId}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A server sentence in an informational notice: the configuration conclusion, not a failure. */
function Conclusion({ title, body, testId }: { title: string; body: string; testId: string }) {
  return (
    <div role="status" data-testid={testId} className="flex items-start gap-3 rounded-md border bg-muted/40 p-4 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

interface ClearDraft {
  ref: string;
  busy: boolean;
  refusal: string | null;
}

export function ConnectorCredentialsPage() {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const [nonce, setNonce] = useState(0);
  const [listing, setListing] = useState<CredentialListing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clearDraft, setClearDraft] = useState<ClearDraft | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setListing(null);
    fetchCredentialListing(controller.signal).then(
      (next) => setListing(next),
      () => { /* aborted: a newer read owns the page */ },
    );
    return () => controller.abort();
  }, [nonce]);

  /** Put the door's answer for one reference in place; drop a row that no longer exists anywhere. */
  const applyEntry = (entry: ConnectorCredentialRef) => {
    setListing((cur) => {
      if (cur?.kind !== 'listed') return cur;
      const gone = !entry.declared && entry.source !== 'object';
      const refs = gone
        ? cur.refs.filter((r) => r.ref !== entry.ref)
        : cur.refs.map((r) => (r.ref === entry.ref ? entry : r));
      return { kind: 'listed', refs };
    });
  };

  const confirmClear = async () => {
    if (!clearDraft || clearDraft.busy) return;
    const ref = clearDraft.ref;
    setClearDraft({ ...clearDraft, busy: true, refusal: null });
    const out = await clearConnectorCredential(ref);
    if (!out.ok) {
      setClearDraft({ ref, busy: false, refusal: out.message });
      return;
    }
    applyEntry(out.entry);
    setClearDraft(null);
    setNotice(t('connectorCredentials.cleared', { defaultValue: 'Cleared {{ref}}.', ref }));
  };

  const formatAt = (at: string | undefined): string | null => {
    if (!at) return null;
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };

  let body: ReactNode;
  if (listing === null) {
    body = (
      <div className="space-y-2" data-testid="connector-credentials-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (listing.kind === 'not-served') {
    body = (
      <Conclusion
        testId="connector-credentials-not-served"
        title={t('connectorCredentials.notServedTitle', { defaultValue: 'This server does not manage connector credentials' })}
        body={t('connectorCredentials.notServedBody', {
          defaultValue:
            'It has no connector credential routes. Set each credential as a server environment variable of the same name, or upgrade the server.',
        })}
      />
    );
  } else if (listing.kind === 'unavailable') {
    body = (
      <Conclusion
        testId="connector-credentials-unavailable"
        title={t('connectorCredentials.unavailableTitle', { defaultValue: 'Connector credentials are not managed here' })}
        body={listing.message}
      />
    );
  } else if (listing.kind === 'failed') {
    body = (
      <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-2">
          <p className="font-medium text-destructive">
            {t('connectorCredentials.loadFailed', { defaultValue: 'Could not load connector credentials.' })}
          </p>
          <p className="text-muted-foreground">{listing.message}</p>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
            {t('connectorCredentials.retry', { defaultValue: 'Try again' })}
          </Button>
        </div>
      </div>
    );
  } else if (listing.refs.length === 0) {
    body = (
      <Empty data-testid="connector-credentials-empty">
        <EmptyTitle>{t('connectorCredentials.emptyTitle', { defaultValue: 'No connector credentials' })}</EmptyTitle>
        <EmptyDescription>
          {t('connectorCredentials.emptyBody', {
            defaultValue: 'None of the installed apps has a connector that needs a credential.',
          })}
        </EmptyDescription>
      </Empty>
    );
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connectorCredentials.colCredential', { defaultValue: 'Credential' })}</TableHead>
            <TableHead>{t('connectorCredentials.colStatus', { defaultValue: 'Status' })}</TableHead>
            <TableHead>{t('connectorCredentials.colLastChanged', { defaultValue: 'Last changed' })}</TableHead>
            <TableHead>{t('connectorCredentials.colValue', { defaultValue: 'Value' })}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listing.refs.map((entry) => {
            const changedAt = formatAt(entry.updatedAt);
            const verifiedAt = formatAt(entry.lastVerifiedAt);
            return (
              <TableRow key={entry.ref} data-testid={`credential-row-${entry.ref}`}>
                <TableCell className="align-top">
                  <code className="font-mono text-sm">{entry.ref}</code>
                  <CredentialConnectors entry={entry} />
                  {!entry.declared ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('connectorCredentials.undeclared', { defaultValue: 'No installed app declares it any more.' })}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1">
                    <CredentialStatusBadge status={entry.status} />
                    {entry.source === 'env' ? (
                      <p className="text-xs text-muted-foreground">
                        {t('connectorCredentials.sourceEnv', { defaultValue: 'From the server environment' })}
                      </p>
                    ) : entry.source === 'vault' ? (
                      <p className="text-xs text-muted-foreground">
                        {t('connectorCredentials.sourceVault', { defaultValue: 'From the host credential resolver' })}
                      </p>
                    ) : null}
                    {entry.status === 'rejected' && entry.statusReason ? (
                      <p className="max-w-sm text-xs text-destructive" data-testid={`credential-reason-${entry.ref}`}>
                        {t('connectorCredentials.rejectedReason', {
                          defaultValue: 'The upstream refused it: {{reason}}',
                          reason: entry.statusReason,
                        })}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {changedAt ? (
                    <p>
                      {entry.updatedBy
                        ? t('connectorCredentials.changedBy', { defaultValue: '{{at}} by {{user}}', at: changedAt, user: entry.updatedBy })
                        : changedAt}
                    </p>
                  ) : (
                    <p aria-hidden="true">{'\u2014'}</p>
                  )}
                  {verifiedAt ? (
                    <p>{t('connectorCredentials.verifiedAt', { defaultValue: 'Last seen working {{at}}', at: verifiedAt })}</p>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  {entry.source === 'env' ? (
                    <p className="max-w-xs text-xs text-muted-foreground" data-testid={`credential-env-${entry.ref}`}>
                      {t('connectorCredentials.envReadOnly', {
                        defaultValue:
                          'Supplied by the server environment variable of the same name, which takes precedence. Change it on the server.',
                      })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {entry.writable && entry.declared ? (
                        <CredentialValueForm
                          credentialRef={entry.ref}
                          hasValue={entry.source !== null}
                          onWritten={(next) => {
                            applyEntry(next);
                            setNotice(t('connectorCredentials.saved', {
                              defaultValue: 'Saved {{ref}}. The connectors that use it reconnect with it now.',
                              ref: entry.ref,
                            }));
                          }}
                        />
                      ) : null}
                      {entry.source === 'object' && entry.writable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setClearDraft({ ref: entry.ref, busy: false, refusal: null })}
                        >
                          {t('connectorCredentials.clear', { defaultValue: 'Clear' })}
                        </Button>
                      ) : null}
                    </div>
                  )}
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
        title={t('connectorCredentials.title', { defaultValue: 'Connector credentials' })}
        subtitle={t('connectorCredentials.subtitle', {
          defaultValue:
            'The credentials the connectors of your installed apps need. A value is stored encrypted and never shown again; leave the field empty to keep the current one.',
        })}
        icon={<KeyRound className="h-4 w-4" />}
        refresh={{
          onRefresh: () => setNonce((n) => n + 1),
          label: t('connectorCredentials.refresh', { defaultValue: 'Refresh' }),
          busy: listing === null,
        }}
      />
      <div className="space-y-4 p-6">
        {notice ? (
          <div role="status" className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700 dark:text-green-400">
            <div className="flex-1">{notice}</div>
            <button type="button" className="text-xs underline opacity-60 hover:opacity-100" onClick={() => setNotice(null)}>
              {t('connectorCredentials.dismiss', { defaultValue: 'Dismiss' })}
            </button>
          </div>
        ) : null}
        {body}
      </div>

      <Dialog open={clearDraft !== null} onOpenChange={(open) => { if (!open && !clearDraft?.busy) setClearDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('connectorCredentials.clearTitle', { defaultValue: 'Clear {{ref}}?', ref: clearDraft?.ref ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('connectorCredentials.clearBody', {
                defaultValue:
                  'The stored value is removed, and every connector that uses it stops working until a value is set again.',
              })}
            </DialogDescription>
          </DialogHeader>
          {clearDraft?.refusal ? (
            <p role="alert" className="text-sm text-destructive">{clearDraft.refusal}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDraft(null)} disabled={clearDraft?.busy}>
              {t('connectorCredentials.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button variant="destructive" onClick={() => void confirmClear()} disabled={clearDraft?.busy}>
              {t('connectorCredentials.clearConfirm', { defaultValue: 'Clear credential' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
