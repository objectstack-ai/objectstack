// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ValidationPreview — read-only summary of a Validation rule draft.
 *
 * `ValidationRuleSchema` is a discriminated union on `type` with exactly
 * SIX members, each rendered with its own vocabulary rather than a
 * generic "field dump":
 *
 *   • script         → CEL condition block
 *   • state_machine  → from→to transitions matrix (+ initial states)
 *   • format         → regex / built-in format name
 *   • cross_field    → involved fields + cross-field condition
 *   • json_schema    → target field + JSON Schema
 *   • conditional    → `when` predicate + nested `then` / `otherwise`
 *
 * The shared envelope (target, message, severity, active, events,
 * priority, tags) is rendered above the type body. Severity drives the
 * accent color (error=red, warning=amber, info=blue) the same way
 * runtime UI surfaces it.
 *
 * WHAT THIS FILE DELIBERATELY NO LONGER RENDERS (objectui#3275/#3281).
 * Three branches — `unique`, `async`, `custom` — were removed from the
 * spec by one paragraph of `validation.zod.ts` ("Deliberately NOT
 * validation rules"): a rule is a deterministic, synchronous,
 * side-effect-free predicate over one record, and none of the three can
 * be. Uniqueness is a DB unique index (a SELECT-then-INSERT rule is
 * racy — TOCTOU); async/remote validation is a form-layer concern and an
 * SSRF hazard on the write path; a custom handler is a `beforeInsert` /
 * `beforeUpdate` lifecycle hook. Drawing those editors taught authors a
 * rule type that can never be saved, so each now redirects to the layer
 * that does the job correctly.
 *
 * Two alias fallbacks went with them: `condition ?? expression` and
 * `pattern ?? regex`. Neither `expression` nor `pattern` has EVER been a
 * key on any branch — they are not even retired keys, which would at
 * least have been legal once. `expression` is exactly why a bogus key sat
 * unnoticed in the console sample for so long (objectui#3276): the
 * preview rendered either spelling, so nothing ever surfaced the
 * mistake, while a publish strips the key and the rule silently does
 * nothing. That is the second de-facto contract AGENTS.md #0.1 forbids.
 *
 * `object` WAS read here, on the strength of one fact that has since gone:
 * `anchors.ts` registered a standalone `validation` resource matched by
 * `anchorByField('object')`, so a standalone rule was assumed to carry the
 * key. ADR-0088 / objectstack#4509 retired the kind and objectui#4132 removed
 * that registration, which leaves the read with no producer — and it never had
 * one on the governed path either: `ValidationRuleSchema` rejects `object` BY
 * NAME. Measured against the installed `@objectstack/spec` 17.0.0-rc.6:
 *
 *   ValidationRuleSchema.safeParse({ type: 'script', …, object: 'account' })
 *   → unrecognized_keys: ['object']
 *
 * So the pill could only ever paint a key that makes the rule unsaveable — the
 * AGENTS.md #0.1 shape this file already deleted `expression` and `pattern`
 * for. Where the object name comes from now: the parent. A rule is edited
 * inside its object (`object.validations`), and the drawer header names it.
 */

import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Code2,
  Info,
  Power,
  Regex,
  ShieldAlert,
  Sigma,
  Workflow,
  XOctagon,
} from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { t as tr, tFormat } from '../i18n.js';
import { withNodes } from './row-nodes.js';

type Severity = 'error' | 'warning' | 'info';

function celText(c: unknown): string | undefined {
  if (!c) return undefined;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && typeof (c as any).source === 'string') return (c as any).source;
  return undefined;
}

function severityTone(s: Severity) {
  switch (s) {
    case 'error':
      return {
        ring: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
        text: 'text-red-700 dark:text-red-300',
        icon: XOctagon,
      };
    case 'warning':
      return {
        ring: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
        text: 'text-amber-800 dark:text-amber-300',
        icon: AlertTriangle,
      };
    case 'info':
    default:
      return {
        ring: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40',
        text: 'text-blue-800 dark:text-blue-300',
        icon: Info,
      };
  }
}

export function ValidationPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const ruleName = String(d.name ?? name ?? '');
  const label = String(d.label ?? ruleName);
  const description = (d.description as string | undefined) ?? '';
  const type = (d.type as string | undefined) ?? 'script';
  const message = (d.message as string | undefined) ?? '';
  const severity: Severity = ((d.severity as Severity | undefined) ?? 'error');
  const active = d.active !== false;
  const events = Array.isArray(d.events) ? (d.events as string[]) : [];
  const priority = d.priority as number | undefined;
  const tags = Array.isArray(d.tags) ? (d.tags as string[]) : [];
  const tone = severityTone(severity);

  if (!ruleName) {
    return (
      <PreviewShell hint="validation">
        <PreviewMessage>{tr('engine.validationPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint={`validation · ${type}`}>
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="rounded border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium truncate">{label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{ruleName}</span>
                  <span className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-mono">{type}</span>
                </div>
                {description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <Pill
                    icon={Power}
                    label={tr(active ? 'engine.validationPreview.active' : 'engine.validationPreview.disabled', locale)}
                    tone={active ? 'green' : 'gray'}
                  />
                  {priority != null && <Pill label={tFormat('engine.validationPreview.priority', locale, { priority })} />}
                  {events.length > 0 && (
                    <Pill label={tFormat('engine.validationPreview.on', locale, { events: events.join(', ') })} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Message + severity callout */}
          <div className={`rounded border p-2.5 text-xs ${tone.ring}`}>
            <div className={`flex items-start gap-1.5 ${tone.text}`}>
              <tone.icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium uppercase tracking-wider text-[10px]">{severity}</div>
                <div className="font-normal mt-0.5 text-foreground">
                  {message || <span className="italic text-muted-foreground">{tr('engine.validationPreview.noMessage', locale)}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Type-specific body */}
          <TypeBody type={type} d={d} locale={locale} />

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {tr('engine.validationPreview.tags', locale)}
              </div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

/**
 * The three rule types the spec removed, each with the layer that owns
 * the job instead. Rendered as a redirect, not as an editor: an author
 * looking at a `unique` draft needs to know where uniqueness actually
 * lives, not a prettier view of a rule that cannot be saved. Each value is
 * the designer catalogue row of the redirect sentence (objectui#10862).
 */
const REMOVED_TYPES: Record<string, string> = {
  unique: 'engine.validationPreview.removed.unique',
  async: 'engine.validationPreview.removed.async',
  custom: 'engine.validationPreview.removed.custom',
};

function TypeBody({ type, d, locale }: { type: string; d: Record<string, unknown>; locale?: string }) {
  const removed = REMOVED_TYPES[type];
  if (removed) {
    return (
      <Section title={tr('engine.validationPreview.notARule', locale)} icon={ShieldAlert}>
        <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="font-medium">
            {withNodes(tr('engine.validationPreview.removedType', locale), {
              type: <code className="font-mono">{type}</code>,
            })}
          </div>
          <div className="mt-1">{tr(removed, locale)}</div>
        </div>
      </Section>
    );
  }

  switch (type) {
    case 'script':
      return (
        <Section title={tr('engine.validationPreview.condition', locale)} icon={Code2}>
          {/* `condition` only. A CEL predicate that FAILS the record when
              TRUE — never `expression`, which no branch has ever declared. */}
          <CelBlock value={celText(d.condition)} locale={locale} />
        </Section>
      );

    case 'conditional': {
      // `when` gates a nested `then` (and optional `otherwise`) — this used
      // to be lumped in with `script` and read `condition`, a key the branch
      // does not have, so a valid conditional rule showed "No expression set".
      const nested = d.then as Record<string, unknown> | undefined;
      const otherwise = d.otherwise as Record<string, unknown> | undefined;
      return (
        <>
          <Section title={tr('engine.validationPreview.when', locale)} icon={Code2}>
            <CelBlock value={celText(d.when)} locale={locale} />
          </Section>
          <Section title={tr('engine.validationPreview.thenApply', locale)} icon={ShieldAlert}>
            <NestedRule rule={nested} emptyHint={tr('engine.validationPreview.noNested', locale)} locale={locale} />
          </Section>
          {otherwise && (
            <Section title={tr('engine.validationPreview.otherwiseApply', locale)} icon={ShieldAlert}>
              <NestedRule rule={otherwise} emptyHint="—" locale={locale} />
            </Section>
          )}
        </>
      );
    }

    case 'state_machine': {
      // ADR-0020 shape: transitions is a `{ fromState: [allowedToStates] }` map.
      const transitionMap =
        d.transitions && typeof d.transitions === 'object' && !Array.isArray(d.transitions)
          ? (d.transitions as Record<string, string[]>)
          : {};
      const entries = Object.entries(transitionMap);
      const field = d.field as string | undefined;
      const initialStates = Array.isArray(d.initialStates) ? (d.initialStates as string[]) : [];
      return (
        <>
          <Section
            title={
              field
                ? tFormat('engine.validationPreview.transitionsOn', locale, { field })
                : tr('engine.validationPreview.transitions', locale)
            }
            icon={Workflow}
          >
            {entries.length === 0 ? (
              <div className="text-xs text-amber-700 dark:text-amber-400">{tr('engine.validationPreview.noTransitions', locale)}</div>
            ) : (
              <ul className="rounded border bg-background divide-y text-xs">
                {entries.map(([from, tos]) => (
                  <li key={from} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="font-mono">{from}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                      {Array.isArray(tos) && tos.length > 0 ? tos.join(' | ') : tr('engine.validationPreview.deadEnd', locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {/* `initialStates` gates which states a record may be CREATED in —
              `transitions` only governs UPDATE, so without this a record can
              be born mid-flow (objectstack#3165). */}
          {initialStates.length > 0 && (
            <Section title={tr('engine.validationPreview.createdIn', locale)} icon={Sigma}>
              <div className="flex flex-wrap gap-1">
                {initialStates.map((s) => (
                  <span key={s} className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono">
                    {s}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </>
      );
    }

    case 'format': {
      // `regex` only — `pattern` is not a key on this branch (or any other).
      const regex = d.regex as string | undefined;
      const format = d.format as string | undefined;
      const field = d.field as string | undefined;
      return (
        <Section
          title={
            field
              ? tFormat('engine.validationPreview.formatOn', locale, { field })
              : tr('engine.validationPreview.format', locale)
          }
          icon={Regex}
        >
          <div className="rounded border bg-background p-2.5 text-xs space-y-1">
            {format && (
              <div>
                <span className="text-muted-foreground">{tr('engine.validationPreview.builtIn', locale)}</span>{' '}
                <code className="font-mono">{format}</code>
              </div>
            )}
            {regex && (
              <div>
                <span className="text-muted-foreground">{tr('engine.validationPreview.regex', locale)}</span>{' '}
                <code className="font-mono break-all">{regex}</code>
              </div>
            )}
            {!format && !regex && (
              <span className="text-amber-700 dark:text-amber-400">{tr('engine.validationPreview.noFormat', locale)}</span>
            )}
          </div>
        </Section>
      );
    }

    case 'cross_field': {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : [];
      const condition = celText(d.condition);
      return (
        <>
          <Section title={tr('engine.validationPreview.fieldsInvolved', locale)} icon={Sigma}>
            <div className="flex flex-wrap gap-1">
              {fields.map((f) => (
                <span key={f} className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono">
                  {f}
                </span>
              ))}
              {/*
                * Empty COLLECTION (`fields.length`), not an absent scalar: the
                * populated arm above is a chip list. The shared carrier renders
                * a <div> and this row is `display: flex` — which blockifies
                * every child, so the <span> it replaces already computed to
                * `display: block`. Measured in Chromium against real Tailwind
                * output: container and marker boxes are identical either way
                * (the same swap in a NON-flex block container does move them,
                * which is what proves the comparison was live).
                */}
              {fields.length === 0 && (
                <EmptyDescription className="text-xs italic">{tr('engine.validationPreview.none', locale)}</EmptyDescription>
              )}
            </div>
          </Section>
          <Section title={tr('engine.validationPreview.crossFieldCondition', locale)} icon={Code2}>
            <CelBlock value={condition} locale={locale} />
          </Section>
        </>
      );
    }

    case 'json_schema': {
      // The sixth union member. It had no branch at all, so a spec-valid
      // json_schema rule fell through to "Unknown rule type" — the inverse
      // of the same bug: valid metadata rendered as broken.
      const field = d.field as string | undefined;
      const schema = d.schema;
      const json =
        schema && typeof schema === 'object' ? JSON.stringify(schema, null, 2) : undefined;
      // A bare `JSON Schema` names the standard and reads the same in every locale.
      return (
        <Section
          title={field ? tFormat('engine.validationPreview.jsonSchemaOn', locale, { field }) : 'JSON Schema'}
          icon={Braces}
        >
          {json ? (
            <pre className="m-0 rounded border bg-background p-2.5 text-xs font-mono overflow-auto max-h-[240px]">
              {json}
            </pre>
          ) : (
            <div className="text-xs text-amber-700 dark:text-amber-400">{tr('engine.validationPreview.noJsonSchema', locale)}</div>
          )}
        </Section>
      );
    }

    default:
      return (
        <Section title={tr('engine.validationPreview.rule', locale)} icon={ShieldAlert}>
          <div className="rounded border bg-background p-2.5 text-xs text-muted-foreground italic">
            {tFormat('engine.validationPreview.unknownType', locale, { type })}
          </div>
        </Section>
      );
  }
}

/**
 * A `conditional` rule's nested `then` / `otherwise` — itself a full
 * ValidationRule. Summarised (type + message + its own predicate) rather
 * than recursed, so a deeply nested rule cannot blow the preview up.
 */
function NestedRule({
  rule,
  emptyHint,
  locale,
}: {
  rule: Record<string, unknown> | undefined;
  emptyHint: string;
  locale?: string;
}) {
  if (!rule || typeof rule !== 'object') {
    return <div className="text-xs text-amber-700 dark:text-amber-400">{emptyHint}</div>;
  }
  const nestedType = String(rule.type ?? '');
  const predicate = celText(rule.condition) ?? celText(rule.when);
  return (
    <div className="rounded border bg-background p-2.5 text-xs space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono">
          {nestedType || tr('engine.validationPreview.noType', locale)}
        </span>
        {typeof rule.name === 'string' && (
          <span className="font-mono text-[10px] text-muted-foreground">{rule.name}</span>
        )}
      </div>
      {typeof rule.message === 'string' && rule.message && (
        <div className="text-foreground">{rule.message}</div>
      )}
      {predicate && (
        <pre className="m-0 rounded border bg-muted/30 p-2 font-mono whitespace-pre-wrap break-words">
          {predicate}
        </pre>
      )}
    </div>
  );
}

function CelBlock({ value, locale }: { value: string | undefined; locale?: string }) {
  if (!value) {
    return <div className="text-xs text-amber-700 dark:text-amber-400">{tr('engine.validationPreview.noExpression', locale)}</div>;
  }
  return (
    <pre className="rounded border bg-background p-2.5 text-xs font-mono whitespace-pre-wrap break-words">
      {value}
    </pre>
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
  tone?: 'gray' | 'green';
  mono?: boolean;
}) {
  const cls = tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`${cls} ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}
