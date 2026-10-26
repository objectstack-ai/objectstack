// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BuildDebugDrawer — self-serve "what actually landed?" panel for a build
 * conversation. Opens a right-side sheet, calls the admin build-debug endpoint
 * (see buildDebugApi.ts), and renders the reconciliation: agent-CLAIMED vs LIVE
 * `sys_metadata`. The headline is the verdict + the two failure modes the chat
 * can't show — PROPOSED-BUT-ORPHANED (a confirm card no turn applied) and
 * CLAIMED-BUT-MISSING (said applied, isn't live). Read-only; no DB credentials.
 *
 * Distinct from `useReconcileOnError` (ADR-0013 D2 stream-failure recovery) —
 * this reconciles the BUILD against live metadata, not a transport drop.
 */

import React, { useEffect, useState } from 'react';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@object-ui/components';
import { Bug, CheckCircle2, AlertTriangle, XCircle, Loader2, CircleSlash } from 'lucide-react';
import { fetchBuildDebug, type BuildDebugReport, type MutationFinding } from './buildDebugApi.js';

interface BuildDebugDrawerProps {
  apiBase: string;
  conversationId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuildDebugDrawer({ apiBase, conversationId, open, onOpenChange }: BuildDebugDrawerProps) {
  // Dates and numbers on this surface read the display locale; a bare
  // `toLocale*()` call used the MACHINE's locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  const { t } = useObjectTranslation();
  const [report, setReport] = useState<BuildDebugReport | null>(null);
  const [loading, setLoading] = useState(false);
  // `notFound` is kept apart from a transport error's own message so its
  // sentence is read from the pack at render time, in the current language.
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setReport(null);
    fetchBuildDebug(apiBase, conversationId)
      .then((r) => {
        if (cancelled) return;
        if (!r) setNotFound(true);
        else setReport(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, apiBase]);

  const rec = report?.reconciliation;
  const problems = rec ? rec.orphaned.length + rec.missing.length + rec.errors.length : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> {t('console.ai.buildDoctor')}
          </SheetTitle>
          <SheetDescription>{t('console.ai.buildDoctorDrawer.description')}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('console.ai.buildDoctorDrawer.reconciling')}
            </div>
          )}
          {(error || notFound) && !loading && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              {notFound ? t('console.ai.buildDoctorDrawer.notAvailable') : error}
            </div>
          )}

          {report && !loading && (
            <>
              {/* Summary line */}
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">
                  {report.title ?? t('console.ai.buildDoctorDrawer.untitled')}
                </div>
                <div className="mt-1">
                  {t('console.ai.buildDoctorDrawer.summary', {
                    turns: report.summary.userTurns,
                    messages: report.summary.messages,
                    tokens: report.summary.totalTokens.toLocaleString(displayLocale),
                    seconds: (report.summary.llmMs / 1000).toFixed(1),
                  })}
                  {report.summary.models.length ? ` · ${report.summary.models.join(', ')}` : ''}
                </div>
              </div>

              {/* Verdict */}
              {rec && (
                <div
                  className={
                    rec.ok
                      ? 'flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-400'
                      : 'flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive'
                  }
                >
                  {rec.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  <span className="font-medium">
                    {rec.ok
                      ? t('console.ai.buildDoctorDrawer.allLive', { count: rec.liveCount })
                      : t('console.ai.buildDoctorDrawer.discrepancies', { count: problems })}
                  </span>
                </div>
              )}

              {/* Orphaned — the headline failure */}
              {rec && rec.orphaned.length > 0 && (
                <FindingSection
                  icon={<CircleSlash className="h-4 w-4 text-destructive" />}
                  title={t('console.ai.buildDoctorDrawer.orphanedTitle')}
                  hint={t('console.ai.buildDoctorDrawer.orphanedHint')}
                  findings={rec.orphaned}
                  tone="destructive"
                />
              )}
              {rec && rec.missing.length > 0 && (
                <FindingSection
                  icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                  title={t('console.ai.buildDoctorDrawer.missingTitle')}
                  hint={t('console.ai.buildDoctorDrawer.missingHint')}
                  findings={rec.missing}
                  tone="amber"
                />
              )}
              {rec && rec.errors.length > 0 && (
                <FindingSection
                  icon={<XCircle className="h-4 w-4 text-destructive" />}
                  title={t('console.ai.buildDoctorDrawer.toolErrorsTitle')}
                  hint={t('console.ai.buildDoctorDrawer.toolErrorsHint')}
                  findings={rec.errors}
                  tone="destructive"
                />
              )}

              {/* verify_build, de-noised */}
              {report.verify && (
                <div className="rounded-md border p-3 text-xs">
                  <div className="font-medium text-foreground">{t('console.ai.buildDoctorDrawer.verifyTitle')}</div>
                  <div className="mt-1 text-muted-foreground">
                    {t('console.ai.buildDoctorDrawer.yourApp')}{' '}
                    {report.verify.userIssues.length === 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {t('console.ai.buildDoctorDrawer.noIssues')}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        {t('console.ai.buildDoctorDrawer.issueCount', { count: report.verify.userIssues.length })}
                      </span>
                    )}
                    {report.verify.platformNoise > 0
                      ? ` · ${t('console.ai.buildDoctorDrawer.platformNoise', { count: report.verify.platformNoise })}`
                      : ''}
                  </div>
                  {report.verify.userIssues.map((is, i) => (
                    <div key={i} className="mt-1 text-destructive">
                      [{is.severity}] {is.code} {is.artifact ? `${is.artifact.type}:${is.artifact.name}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* Pending actions */}
              {report.pendingActions.length > 0 && (
                <div className="rounded-md border p-3 text-xs">
                  <div className="font-medium text-foreground">{t('console.ai.buildDoctorDrawer.pendingActions')}</div>
                  {report.pendingActions.map((p, i) => (
                    <div key={i} className="mt-1 text-muted-foreground">
                      {p.tool ?? '?'} · {p.object ?? '-'} · <span className="font-mono">{p.status ?? '-'}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Timeline (collapsed) */}
              <details className="rounded-md border p-3 text-xs">
                <summary className="cursor-pointer font-medium text-foreground">
                  {t('console.ai.buildDoctorDrawer.timeline', { count: report.timeline.length })}
                </summary>
                <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed">
                  {report.timeline.map((e, i) => (
                    <TimelineRow key={i} entry={e} />
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FindingSection({
  icon,
  title,
  hint,
  findings,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  findings: MutationFinding[];
  tone: 'destructive' | 'amber';
}) {
  const border = tone === 'destructive' ? 'border-destructive/30' : 'border-amber-500/30';
  return (
    <div className={`rounded-md border ${border} p-3`}>
      <div className="flex items-center gap-2 font-medium text-foreground">
        {icon} {title} ({findings.length})
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      <div className="mt-2 space-y-1">
        {findings.map((f, i) => (
          <div key={i} className="font-mono text-xs">
            {f.t ? `${f.t} · ` : ''}
            {f.tool} → {f.artifact.type}:{f.artifact.name}
            <span className="text-muted-foreground"> ({f.status})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ entry }: { entry: BuildDebugReport['timeline'][number] }) {
  if (entry.kind === 'user') {
    return (
      <div>
        <span className="text-muted-foreground">{entry.t}</span> 👤 {entry.text}
      </div>
    );
  }
  if (entry.kind === 'assistant-text') {
    return (
      <div>
        <span className="text-muted-foreground">{entry.t}</span> 🤖 {entry.text}
      </div>
    );
  }
  if (entry.kind === 'assistant-calls') {
    return (
      <div>
        <span className="text-muted-foreground">{entry.t}</span> 🤖 →{' '}
        {entry.calls.map((c) => c.name).join(', ')}
      </div>
    );
  }
  return (
    <div className={entry.isError ? 'text-destructive' : ''}>
      <span className="text-muted-foreground">{entry.t}</span> ↳ {entry.name}
      {entry.status ? ` (${entry.status})` : ''}
    </div>
  );
}
