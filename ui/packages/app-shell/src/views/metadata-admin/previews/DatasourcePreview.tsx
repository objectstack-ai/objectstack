// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasourcePreview — read-only summary of a Datasource draft.
 *
 * Datasources hold connection material, so the preview's most
 * important contract is "show enough to verify the binding, never
 * leak secrets". Concretely:
 *
 *   • Header: driver pill (postgres/mysql/mongo/…), name, label,
 *     active flag.
 *   • Connection card: a redacted config table where any key whose
 *     name matches /pass|secret|key|token|credential/i is replaced
 *     with `••••••` and a "redacted" badge. Other primitives render
 *     verbatim; nested objects render as their key count.
 *   • Pool and SSL pills derived from optional sibling blocks.
 *
 * Three reads were deleted in objectui#3275 because `DatasourceSchema` is
 * `.strict()` and rejects every one of them, so each made an unsaveable
 * draft look correct: `driver ?? d.type` (the alias hint is `type` →
 * `driver`), the `default` pill behind `isDefault ?? default` (routing is
 * declared at stack level via `datasourceMapping`, never on the
 * datasource), and `Array.isArray(capabilities)` — which had it exactly
 * backwards, lighting up only for the array form the schema refuses and
 * staying dark for the object form it requires.
 *
 * A second wave went the same way in objectui#4131, for keys the spec
 * itself dropped rather than ones this file spelled wrong: the `Retry
 * Policy` and `Health Check` SideBlocks, the `Capabilities` chip strip and
 * the `enabledCapabilities()` helper behind it, with their reads at
 * `d.retryPolicy` / `d.healthCheck` / `d.capabilities`. All three key
 * groups were removed from `DatasourceSchema` by objectstack#4583 (the
 * 11-flag `capabilities` block, the 4-key `retryPolicy` block, the 3-key
 * `healthCheck` block) under ADR-0049 enforce-or-remove — declared,
 * strict-guarded and read by nobody: connection retry and health probing
 * belong to the runtime driver, and pushdown is decided by that driver's
 * own `supports.*`, never by datasource metadata. `.strict()` now rejects
 * each of them by name, so every one of those blocks was again painting a
 * draft that cannot be saved. `pool` and `ssl` are still declared and stay.
 *
 * A read-replica count pill used to sit in that strip. It is gone with
 * `datasource.readReplicas` itself (objectstack#4468): nothing in the
 * platform ever opened a replica connection, so the pill reported a
 * configuration that did not exist — and, being the only surface that
 * acknowledged the key at all, it was the strongest signal an author had
 * that it worked. A preview echoes what was typed; it can never stand in
 * for a runtime consumer (`packages/spec/liveness/README.md`).
 *
 * Three waves of the same defect on one file is why the read set is now
 * PINNED rather than merely corrected: `DatasourcePreview.spec-keys.test.ts`
 * derives the keys this file reads off the draft from its own AST and the
 * keys `DatasourceSchema` accepts from the schema object, and fails on any
 * read the schema would reject. A fourth wave lands as a red test, not as
 * another issue eight days later.
 *
 * The preview never attempts a live "test connection" — it runs
 * inside the editor sandbox and must remain side-effect free.
 */

import * as React from 'react';
import { Activity, Database, HardDrive, Lock, Power, ShieldCheck } from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { ExternalDatasourcePanel } from '../external/ExternalDatasourcePanel.js';

const SECRET_RE = /pass|secret|key|token|credential|auth/i;

function isSecretKey(k: string): boolean {
  return SECRET_RE.test(k);
}

function redactValue(v: unknown): string {
  if (v == null || v === '') return '∅';
  return '••••••';
}

/** A config value as the preview shows it; a nested object's key count reads in `locale`. */
function renderValue(v: unknown, locale: string | undefined): string {
  if (v == null) return '∅';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return tFormat('engine.datasourcePreview.keyCount', locale, { count: Object.keys(v).length });
  return String(v);
}

export function DatasourcePreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const dsName = String(d.name ?? name ?? '');
  const label = String(d.label ?? dsName);
  const description = (d.description as string | undefined) ?? '';
  // `driver` only. `DatasourceSchema` is `.strict()` and rejects `type`
  // outright (with a `type` → `driver` alias hint), so the old
  // `?? d.type` fallback rendered a driver pill for a draft that cannot
  // be saved — and, worse, made the wrong spelling look correct.
  const driver = (d.driver as string | undefined) ?? tr('engine.datasourcePreview.unknownDriver', locale);
  const active = d.active !== false;
  const config = (d.config as Record<string, unknown> | undefined) ?? {};
  const pool = d.pool as Record<string, unknown> | undefined;
  const ssl = d.ssl as Record<string, unknown> | boolean | undefined;

  // External Datasource Federation (ADR-0015): a non-'managed' schemaMode
  // marks this datasource as federated. The panel keys off the *saved* item
  // name (`name`) so its REST calls hit a persisted datasource.
  const schemaMode = (d.schemaMode as string | undefined) ?? 'managed';
  const isFederated = schemaMode !== 'managed';
  const external = (d.external as Record<string, unknown> | undefined) ?? undefined;
  const allowWrites = !!external?.allowWrites;

  const configEntries = Object.entries(config);

  if (!dsName && configEntries.length === 0) {
    return (
      <PreviewShell hint="datasource">
        <PreviewMessage>{tr('engine.datasourcePreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint={`datasource · ${driver}`}>
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <Database className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{dsName}</span>
                </div>
                {description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 font-mono">
                    <HardDrive className="h-3 w-3 text-muted-foreground" /> {driver}
                  </span>
                  <Pill
                    icon={Power}
                    label={tr(active ? 'engine.datasourcePreview.active' : 'engine.datasourcePreview.disabled', locale)}
                    tone={active ? 'green' : 'gray'}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* External Datasource Federation surfaces (browse / validate).
              Keyed off the saved PK (`name`) — an unsaved draft has no
              persisted datasource for the REST routes to introspect. */}
          {isFederated && (
            <ExternalDatasourcePanel
              datasource={String(name ?? '')}
              schemaMode={schemaMode}
              allowWrites={allowWrites}
              locale={locale}
            />
          )}

          {/* Connection config */}
          <Section title={tr('engine.datasourcePreview.connection', locale)} icon={Lock}>
            {configEntries.length === 0 ? (
              <EmptyDescription className="text-xs italic">{tr('engine.datasourcePreview.noConfig', locale)}</EmptyDescription>
            ) : (
              <div className="rounded border bg-background overflow-hidden">
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {configEntries.map(([k, v]) => {
                      const secret = isSecretKey(k);
                      return (
                        <tr key={k}>
                          <td className="px-2.5 py-1.5 align-top w-40 font-mono text-muted-foreground">
                            {k}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono break-all">
                            {secret ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span>{redactValue(v)}</span>
                                <span className="rounded bg-amber-50 border border-amber-200 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber-800">
                                  {tr('engine.datasourcePreview.redacted', locale)}
                                </span>
                              </span>
                            ) : (
                              renderValue(v, locale)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Side rail blocks */}
          <div className="grid gap-2 sm:grid-cols-2">
            <SideBlock title={tr('engine.datasourcePreview.pool', locale)} icon={Activity} value={pool} locale={locale} />
            {/* "SSL" is the protocol's name, the same in every locale. */}
            <SideBlock
              title="SSL"
              icon={ShieldCheck}
              value={typeof ssl === 'boolean' ? { enabled: ssl } : ssl}
              locale={locale}
            />
          </div>
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function SideBlock({
  title,
  icon: Icon,
  value,
  locale,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  value: Record<string, unknown> | undefined;
  locale?: string;
}) {
  const present = value && typeof value === 'object' && Object.keys(value).length > 0;
  return (
    <div className={`rounded border bg-background ${present ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      <div className="px-2.5 py-1.5 text-[11px]">
        {!present ? (
          // An empty-COLLECTION statement (`Object.keys(value).length`), whose
          // populated arm is the block-level <dl> below — so it takes the
          // family's block-level text slot, exactly like "No config keys set."
          // 66 lines up. `text-[11px]`, not that site's `text-xs`: this body
          // renders at 11px and the shared base ships `text-sm/relaxed`, so
          // without a size the word would grow 11px → 14px (measured).
          <EmptyDescription className="text-[11px] italic">{tr('engine.datasourcePreview.notConfigured', locale)}</EmptyDescription>
        ) : (
          <dl className="space-y-0.5">
            {Object.entries(value).slice(0, 6).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2 truncate">
                <dt className="text-muted-foreground font-mono shrink-0">{k}:</dt>
                <dd className="font-mono truncate">
                  {isSecretKey(k) ? redactValue(v) : renderValue(v, locale)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  tone = 'gray',
  mono = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: 'gray' | 'green' | 'amber';
  mono?: boolean;
}) {
  const cls =
    tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`${cls} ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}
