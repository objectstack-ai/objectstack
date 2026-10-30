// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The "Credentials" step after a marketplace install (ruling A on
 * objectstack#27230): the connector credentials the just-installed package
 * declares that still need an administrator, each with a masked input and
 * "Skip for now". Skipped references stay listed with a link to Setup →
 * Integrations → Connector Credentials, where they can be set later.
 *
 * AFTER the install, not before it: the credential door refuses a reference no
 * installed package declares (`404`), so nothing typed before the install
 * could be stored. The package's connectors install degraded and materialize
 * the moment their credential is set, with no restart.
 *
 * It reads the door's own listing (`GET …/credential-refs`), filtered to the
 * package by `connectors[].packageId` — the route the Setup page reads — rather
 * than the install answer. So it appears after ANY install that lands in this
 * environment: install-local, and a cloud install once its app is served,
 * whose answer comes from the control plane and carries no references.
 *
 * Where the listing cannot be read (a walled tenancy posture, a runtime
 * without the door) the step draws no inputs: `fallbackNote`, the install
 * door's own sentence when it sent one, says where the credentials go instead.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ConnectorCredentialRef } from '@objectstack/spec/contracts';
import { CredentialValueForm } from '../../views/setup/CredentialValueForm.js';
import {
  connectorCredentialsPagePath,
  fetchCredentialListing,
  refsAwaitingPackage,
} from '../../views/setup/connectorCredentials.js';

export interface ConnectorCredentialsStepProps {
  /** The installed package's id — the `packageId` its connector instances carry. */
  packageId: string;
  /** The install answer's `credentialNote`, shown when the listing cannot be read. */
  fallbackNote?: string;
  className?: string;
}

type StepRead =
  | { kind: 'reading' }
  | { kind: 'unreadable' }
  | { kind: 'read'; refs: ConnectorCredentialRef[] };

/** What the administrator did with one reference in this step. */
type Outcome = 'set' | 'skipped';

export function ConnectorCredentialsStep({ packageId, fallbackNote, className }: ConnectorCredentialsStepProps) {
  const { t } = useObjectTranslation();
  const [read, setRead] = useState<StepRead>({ kind: 'reading' });
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'reading' });
    setOutcomes({});
    fetchCredentialListing(controller.signal).then(
      (listing) => {
        setRead(listing.kind === 'listed'
          ? { kind: 'read', refs: refsAwaitingPackage(listing.refs, packageId) }
          : { kind: 'unreadable' });
      },
      () => { /* aborted: the package changed */ },
    );
    return () => controller.abort();
  }, [packageId]);

  if (read.kind === 'reading') return null;
  if (read.kind === 'unreadable') {
    return fallbackNote ? (
      <p className={`whitespace-normal text-sm text-muted-foreground ${className ?? ''}`} data-testid="install-credentials-note">
        {fallbackNote}
      </p>
    ) : null;
  }
  if (read.refs.length === 0) return null;

  /** The door's answer after a set: `set` closes the row, anything else keeps it open with its new status. */
  const onWritten = (entry: ConnectorCredentialRef) => {
    if (entry.status === 'set') {
      setOutcomes((o) => ({ ...o, [entry.ref]: 'set' }));
    }
    setRead((cur) => (cur.kind === 'read'
      ? { kind: 'read', refs: cur.refs.map((r) => (r.ref === entry.ref ? entry : r)) }
      : cur));
  };

  const open = read.refs.filter((r) => outcomes[r.ref] === undefined);
  const set = read.refs.filter((r) => outcomes[r.ref] === 'set');
  const skipped = read.refs.filter((r) => outcomes[r.ref] === 'skipped');
  const pagePath = connectorCredentialsPagePath();

  return (
    <section
      data-testid="install-credentials-step"
      aria-labelledby="install-credentials-title"
      className={`space-y-3 whitespace-normal rounded-md border bg-background p-3 text-sm text-foreground ${className ?? ''}`}
    >
      <h3 id="install-credentials-title" className="flex items-center gap-1.5 font-medium">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {t('connectorCredentials.stepTitle', { defaultValue: 'Credentials' })}
      </h3>
      {open.length > 0 ? (
        <>
          <p className="text-muted-foreground">
            {t('connectorCredentials.stepIntro', {
              defaultValue: 'The connectors of this app need these credentials. Enter each one now, or skip it and set it later.',
            })}
          </p>
          <ul className="space-y-3">
            {open.map((entry) => (
              <li key={entry.ref} className="space-y-1.5" data-testid={`install-credential-${entry.ref}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-mono">{entry.ref}</code>
                  <span className="text-xs text-muted-foreground">
                    {entry.connectors.filter((c) => c.packageId === packageId).map((c) => c.name).join(', ')}
                  </span>
                </div>
                {entry.status === 'rejected' && entry.statusReason ? (
                  <p className="text-xs text-destructive">
                    {t('connectorCredentials.rejectedReason', {
                      defaultValue: 'The upstream refused it: {{reason}}',
                      reason: entry.statusReason,
                    })}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-start gap-2">
                  <CredentialValueForm credentialRef={entry.ref} hasValue={entry.source !== null} onWritten={onWritten} />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setOutcomes((o) => ({ ...o, [entry.ref]: 'skipped' }))}
                  >
                    {t('connectorCredentials.skip', { defaultValue: 'Skip for now' })}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {set.length > 0 ? (
        <ul className="space-y-1" data-testid="install-credentials-set">
          {set.map((entry) => (
            <li key={entry.ref} className="flex items-center gap-2">
              <code className="font-mono">{entry.ref}</code>
              <span className="text-xs text-green-700 dark:text-green-400">
                {t('connectorCredentials.statusSet', { defaultValue: 'Set' })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {skipped.length > 0 ? (
        <div className="space-y-1.5" data-testid="install-credentials-skipped">
          <p className="font-medium">{t('connectorCredentials.skippedTitle', { defaultValue: 'Skipped for now' })}</p>
          <ul className="space-y-0.5">
            {skipped.map((entry) => (
              <li key={entry.ref}>
                <code className="font-mono">{entry.ref}</code>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            {t('connectorCredentials.skippedBody', {
              defaultValue: 'The connectors that use them stay disconnected until each one is set.',
            })}
          </p>
          <Link to={pagePath} className="font-medium underline underline-offset-2">
            {t('connectorCredentials.openPage', { defaultValue: 'Set them in Connector credentials' })}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
