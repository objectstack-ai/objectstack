// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DeploymentNotice — the standing notice a production deployment's
 * administrators see when the server keeps their data and secrets on its own
 * disk (objectstack#30120, ruling A3).
 *
 * Drawn on the Console home page and at the top of Setup's System Overview.
 * No dialog: a banner that stays until the deployment is fixed or an
 * administrator hides it. It names each finding in business terms, offers the
 * variables to hand to whoever runs the server (the copy button), and can be
 * hidden; the hide is written to the audit log by the server.
 *
 * Who sees it is the server's decision: the state is served behind the
 * settings door and the `manage_platform_settings` capability, so a member's
 * read is refused and draws nothing. The workspace-admin check here only
 * spares a member's browser that refused request.
 *
 * After a hide, the home page draws nothing and System Overview keeps one
 * small line, with a way to show the notice again in this browser.
 *
 * @module
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { Check, Copy, HardDrive, Info } from 'lucide-react';
import {
  deploymentVariablesText,
  fetchDeploymentNotice,
  forgetHidden,
  hiddenFingerprint,
  hideDeploymentNotice,
  rememberHidden,
  type DeploymentFinding,
  type DeploymentNoticeState,
  type HideAnswer,
} from './deploymentNotice.js';

export interface DeploymentNoticeProps {
  /** `home`: nothing once hidden. `system-overview`: one small line once hidden. */
  placement: 'home' | 'system-overview';
}

function findingText(f: DeploymentFinding, t: (key: string, opts?: Record<string, unknown>) => string): string {
  switch (f.id) {
    case 'database_local_file':
      return t('deploymentNotice.finding.databaseLocalFile', {
        defaultValue: 'Your business data is a file on this server ({{file}}). Replacing the server or its disk loses it.',
        file: f.file ?? '',
      });
    case 'auth_secret_generated':
      return t('deploymentNotice.finding.authSecretGenerated', {
        defaultValue: 'The sign-in secret was generated on this server. If it is lost, everyone is signed out.',
      });
    case 'data_key_file':
      return t('deploymentNotice.finding.dataKeyFile', {
        defaultValue:
          'The key that encrypts saved passwords and API keys is a file on this server ({{file}}). If it is lost, they can no longer be read.',
        file: f.file ?? '',
      });
    case 'file_storage_local':
      return t('deploymentNotice.finding.fileStorageLocal', {
        defaultValue: "Uploaded files are kept on this server's disk.",
      });
    case 'email_not_configured':
      return t('deploymentNotice.finding.emailNotConfigured', {
        defaultValue: 'No email service is set up, so invitations and password resets are not sent by email.',
      });
  }
}

export function DeploymentNotice({ placement }: DeploymentNoticeProps) {
  const { t } = useObjectTranslation();
  const { user } = useAuth();
  const { isAdmin, isResolved } = useWorkspaceAdminStatus();
  const userId = typeof user?.id === 'string' ? user.id : undefined;
  const [state, setState] = useState<DeploymentNoticeState | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [hideAnswer, setHideAnswer] = useState<HideAnswer | null>(null);

  const load = useCallback(async () => {
    const next = await fetchDeploymentNotice();
    setState(next);
  }, []);

  useEffect(() => {
    if (!isResolved || !isAdmin || !userId) return;
    let cancelled = false;
    setHidden(hiddenFingerprint(userId));
    fetchDeploymentNotice().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isResolved, isAdmin, userId]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  if (!isResolved || !isAdmin || !userId || !state || !state.production || state.findings.length === 0) return null;

  const isHidden = hidden === state.fingerprint;
  if (isHidden) {
    if (placement === 'home') return null;
    return (
      <div className="px-4 sm:px-6 lg:px-8 pt-3" data-testid="deployment-notice-hidden">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t('deploymentNotice.hiddenLine', {
              defaultValue: 'The deployment notice is hidden. What it states still applies.',
            })}
          </span>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              forgetHidden(userId);
              setHidden(null);
            }}
            data-testid="deployment-notice-show"
          >
            {t('deploymentNotice.showAgain', { defaultValue: 'Show again' })}
          </button>
        </p>
      </div>
    );
  }

  const high = state.findings.filter((f) => f.severity === 'high');
  const low = state.findings.filter((f) => f.severity === 'low');
  const variables = deploymentVariablesText(high, t);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(variables);
      setCopied(true);
    } catch {
      // Denied or unavailable: the findings name every variable on screen.
    }
  };

  const hide = async () => {
    setHiding(true);
    const answer = await hideDeploymentNotice(state.fingerprint);
    setHiding(false);
    setHideAnswer(answer);
    if (answer === 'hidden') {
      rememberHidden(userId, state.fingerprint);
      setHidden(state.fingerprint);
    } else if (answer === 'changed') {
      void load();
    }
  };

  const tone =
    high.length > 0
      ? 'border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
      : 'border-border bg-muted/40 text-foreground';

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-4">
      <div className={placement === 'home' ? 'max-w-7xl mx-auto' : undefined}>
        <section
          className={`rounded-xl border px-4 py-3 ${tone}`}
          aria-labelledby="deployment-notice-title"
          data-testid="deployment-notice"
          data-fingerprint={state.fingerprint}
        >
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <h2 id="deployment-notice-title" className="font-medium">
                {high.length > 0
                  ? t('deploymentNotice.title', {
                      defaultValue: 'This server keeps your data and secrets on its own disk',
                    })
                  : t('deploymentNotice.titleLow', { defaultValue: 'Finish setting up this deployment' })}
              </h2>
              {high.length > 0 && (
                <p>
                  {t('deploymentNotice.intro', {
                    defaultValue:
                      'Nobody set where this production deployment keeps them. Hand the settings below to whoever runs the server, so that replacing it loses nothing.',
                  })}
                </p>
              )}
              <ul className="list-disc space-y-1 pl-5" data-testid="deployment-notice-findings">
                {high.map((f) => (
                  <li key={f.id} data-finding={f.id}>
                    {findingText(f, t)}{' '}
                    {f.variable && <code className="rounded bg-background/70 px-1 text-xs">{f.variable}</code>}
                  </li>
                ))}
                {low.map((f) => (
                  <li key={f.id} data-finding={f.id} className="opacity-80">
                    {findingText(f, t)}
                  </li>
                ))}
              </ul>
              {hideAnswer === 'no-audit-log' && (
                <p className="text-xs" role="status">
                  {t('deploymentNotice.hideNoAuditLog', {
                    defaultValue: 'This deployment keeps no audit log, so the notice cannot be hidden.',
                  })}
                </p>
              )}
              {hideAnswer === 'failed' && (
                <p className="text-xs" role="status">
                  {t('deploymentNotice.hideFailed', { defaultValue: 'The notice could not be hidden. Try again.' })}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {variables && (
                  <Button size="sm" variant="outline" onClick={copy} data-testid="deployment-notice-copy">
                    {copied ? (
                      <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    )}
                    {copied
                      ? t('deploymentNotice.copied', { defaultValue: 'Copied' })
                      : t('deploymentNotice.copy.button', { defaultValue: 'Copy the settings' })}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={hide} disabled={hiding} data-testid="deployment-notice-hide">
                  {t('deploymentNotice.hide', { defaultValue: 'Hide' })}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
