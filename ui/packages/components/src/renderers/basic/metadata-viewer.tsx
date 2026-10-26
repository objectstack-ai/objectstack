/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:metadata_viewer` — a read-only, live-resolved view of a metadata
 * item, embedded inline in content (ADR-0051). This is the SDUI component a
 * ```` ```metadata ```` doc fence compiles to: the inline form of ADR-0046 §3.5
 * ("derived content is rendered, never written"). It resolves the target
 * metadata by name at render time (so it never goes stale) and renders a
 * read-only projection — it carries no expressions or actions, staying on the
 * data side of the §3.4 trust boundary.
 *
 * Spec: `framework/packages/spec/src/ui/component.zod.ts`
 *   ElementMetadataViewerPropsSchema → { type, name, object?, mode?, detail? }
 *   type ∈ state_machine | flow | permission   (`object` embeds deferred)
 */

import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { useMetadataItem, resolveInlineAriaProps } from '@object-ui/react';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import type { AriaProps } from '@object-ui/types';
import {
  ArrowRight,
  CircleDot,
  Flag,
  Workflow,
  GitBranch,
  ShieldCheck,
  Check,
  Minus,
  AlertTriangle,
} from 'lucide-react';
import type { SelectOption as SpecSelectOption } from '@objectstack/spec/data';
import { cn } from '../../lib/utils';
import { readProps } from './readProps';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface ViewerProps {
  type?: 'state_machine' | 'flow' | 'permission';
  name?: string;
  object?: string;
  mode?: 'diagram' | 'matrix' | 'summary';
  detail?: 'business' | 'technical';
}

/** Tolerate `fields` as either an object map or an array of `{name,...}`. */
function getField(obj: any, name?: string): any {
  if (!obj || !name) return undefined;
  const f = obj.fields;
  if (!f) return undefined;
  if (Array.isArray(f)) return f.find((x: any) => x?.name === name);
  return f[name];
}

function Shell({
  hint,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      <div className="flex items-start gap-2.5 border-b bg-muted/40 px-3.5 py-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold leading-tight">{title}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</span>
          </div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
        </div>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

/**
 * objectui#12910 — the viewer's copy reads `element.metadataViewer.*`, so a
 * zh-CN page draws its own language where every line of this block used to be
 * an English literal. Each inline `defaultValue` is the `en` pack's value, held
 * byte-identical to it by `pnpm check:i18n-keys`.
 *
 * Several sentences carry a metadata name drawn as a `<code>` chip. The chip
 * cannot be interpolated as text, and splitting the sentence around it would
 * fix the word order to English's. So each chip's slot is interpolated with a
 * private-use mark ({@link CHIP}), and {@link withChips} splits the translated
 * sentence on those marks: the language decides where the chip sits.
 */
const CHIP = ['\uE000', '\uE001', '\uE002'] as const;

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono">{children}</code>;
}

/** The translated `text` with `chips[i]` drawn where `CHIP[i]` was interpolated. */
function withChips(text: string, chips: React.ReactNode[]): React.ReactNode {
  return text.split(/([\uE000-\uE002])/u).map((part, i) => {
    const at = (CHIP as readonly string[]).indexOf(part);
    return at === -1 ? part : <React.Fragment key={i}>{chips[at]}</React.Fragment>;
  });
}

/** The lines every view shares: a missing key, loading, a failed load, not found. */
function useViewStates() {
  const { t } = useObjectTranslation();
  return {
    t,
    missing: (key: string) => (
      <Placeholder tone="warn">
        {withChips(
          t('element.metadataViewer.missingKey', { defaultValue: 'Missing {{key}} for this view.', key: CHIP[0] }),
          [<Code key="k">{key}</Code>],
        )}
      </Placeholder>
    ),
    loading: (name: string) => (
      <Placeholder>
        {withChips(t('element.metadataViewer.loading', { defaultValue: 'Loading {{name}}…', name: CHIP[0] }), [
          <Code key="n">{name}</Code>,
        ])}
      </Placeholder>
    ),
    failed: (name: string, message: string) => (
      <Placeholder tone="warn">
        {withChips(
          t('element.metadataViewer.loadFailed', {
            defaultValue: 'Failed to load {{name}}: {{message}}',
            name: CHIP[0],
            message,
          }),
          [<Code key="n">{name}</Code>],
        )}
      </Placeholder>
    ),
    notFound: (name: string) => (
      <Placeholder tone="warn">
        {withChips(t('element.metadataViewer.notFound', { defaultValue: '{{name}} not found.', name: CHIP[0] }), [
          <Code key="n">{name}</Code>,
        ])}
      </Placeholder>
    ),
  };
}

function Placeholder({ tone = 'muted', children }: { tone?: 'muted' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs',
        tone === 'warn'
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
          : 'bg-muted/30 text-muted-foreground',
      )}
    >
      {tone === 'warn' && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// state_machine — live transition graph from a `state_machine` validation rule
// ---------------------------------------------------------------------------

/**
 * One declared option of the object field a state machine runs on — DERIVED
 * from the spec's own `SelectOption` (`@objectstack/spec/data`), with the one
 * narrowing this projection needs named in the `Omit` below (`5c09cca27`).
 *
 * It was a hand-written `{ label?; value; color?; default? }` quadruple: four of
 * the spec's five keys, with the fifth dropped by SILENCE — no `Omit` naming it,
 * no comment saying the drop was deliberate. Nothing type-checks author-written
 * metadata against this declaration (the value arrives from `useMetadataItem`
 * as `any`), so unlike the authoring-side copies this one could not mis-accept
 * anything; what it could do is go on compiling while the spec's option shape
 * moved, and silently answer an older question. Deriving is what stops that,
 * and it is the same form `form-spec.ts` uses one package over for
 * `FormFieldSpec.options` (objectui#6247 / PR #6618).
 *
 *   - `visibleWhen` is DROPPED, and now says so. This view draws the DECLARED
 *     state set — every option the field declares becomes a chip, and the
 *     transition graph is read from the `state_machine` rule, not from who is
 *     looking. Per-option `visibleWhen` withdraws an option from a PICKER for
 *     one record and one `current_user` (ADR-0068); a diagram of the machine
 *     has no such subject, so there is nothing here to evaluate it against.
 *     Carrying the key would advertise a gate this projection does not apply.
 *
 *   - `default` is KEPT, and is read at `initial` below. That is deliberate and
 *     is the whole reason this is a spec derivation rather than a narrower
 *     local shape: `default` on the OBJECT-field face is ruled `enforce`
 *     (objectstack#7246, implemented by PR objectstack-ai/objectstack#7388) — the engine seeds the insert
 *     path from the option marked `default: true` — so the state this view
 *     calls "initial" is the same one the platform actually writes.
 *
 * `SelectOption` (`z.input`) rather than `SelectOptionParsed` (`z.infer`) even
 * though this is a read model: on the four retained keys the two are the SAME
 * type — none of `label` / `value` / `color` / `default` carries a `.default()`
 * or a transform — and the entire input/output difference lives on
 * `visibleWhen`, the key omitted above.
 *
 * ⚠️ Structurally this admits one shape LESS than the quadruple it replaces:
 * the spec makes `label` REQUIRED and the hand copy had relaxed it to optional,
 * by silence, the same way it dropped `visibleWhen`. Nothing turned on the
 * relaxation — `labelOf` falls back to the raw value for any state the option
 * list does not describe at all, which is the case that fallback exists for
 * (transition sources and targets are not required to be declared options).
 */
type StateOption = Omit<SpecSelectOption, 'visibleWhen'>;

function StateMachineView({ object, name }: ViewerProps) {
  const { item: obj, loading, error } = useMetadataItem('object', object ?? null);
  const { t, ...view } = useViewStates();

  const rule = React.useMemo(() => {
    const rules: any[] = obj?.validations ?? obj?.validationRules ?? [];
    if (!Array.isArray(rules)) return undefined;
    return rules.find(
      (r) => r?.type === 'state_machine' && (!name || r?.name === name),
    );
  }, [obj, name]);

  if (!object) return view.missing('object');
  if (loading) return view.loading(object);
  if (error) return view.failed(object, error.message);
  if (!obj) return view.notFound(object);
  if (!rule) {
    return (
      <Placeholder tone="warn">
        {name
          ? withChips(
              t('element.metadataViewer.noStateMachineNamed', {
                defaultValue: 'No state machine named “{{name}}” on {{object}}.',
                name,
                object: CHIP[0],
              }),
              [<Code key="o">{object}</Code>],
            )
          : withChips(
              t('element.metadataViewer.noStateMachine', {
                defaultValue: 'No state machine on {{object}}.',
                object: CHIP[0],
              }),
              [<Code key="o">{object}</Code>],
            )}
      </Placeholder>
    );
  }

  const transitions: Record<string, string[]> =
    rule.transitions && typeof rule.transitions === 'object' && !Array.isArray(rule.transitions)
      ? rule.transitions
      : {};
  const field = getField(obj, rule.field);
  const options: StateOption[] = Array.isArray(field?.options) ? field.options : [];
  const optByValue = new Map(options.map((o) => [o.value, o]));
  const labelOf = (v: string) => optByValue.get(v)?.label ?? v;
  const colorOf = (v: string) => optByValue.get(v)?.color;
  const initial = options.find((o) => o.default)?.value;

  // All states = union of declared options, transition sources, and targets —
  // ordered: initial first, then option order, then any extras.
  const ordered = new Set<string>();
  if (initial) ordered.add(initial);
  for (const o of options) ordered.add(o.value);
  for (const [from, tos] of Object.entries(transitions)) {
    ordered.add(from);
    for (const t of tos) ordered.add(t);
  }
  const states = [...ordered];

  const Chip = ({ value }: { value: string }) => {
    const color = colorOf(value);
    return (
      <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs font-medium">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color ?? 'var(--muted-foreground)' }} />
        {labelOf(value)}
      </span>
    );
  };

  const kind = t('element.metadataViewer.stateMachine', { defaultValue: 'State machine' });
  return (
    <Shell
      hint={kind}
      icon={Workflow}
      title={rule.label ?? rule.name ?? kind}
      subtitle={
        <>
          {withChips(
            t('element.metadataViewer.lifecycle', { defaultValue: 'Lifecycle of {{object}}', object: CHIP[0] }),
            [<Code key="o">{object}</Code>],
          )}
          {rule.field ? (
            <>
              {' · '}
              {withChips(
                t('element.metadataViewer.field', { defaultValue: 'field {{field}}', field: CHIP[0] }),
                [<Code key="f">{rule.field}</Code>],
              )}
            </>
          ) : null}
        </>
      }
    >
      <ol className="space-y-1.5">
        {states.map((s) => {
          const tos = transitions[s] ?? [];
          const isInitial = s === initial;
          const isFinal = tos.length === 0;
          return (
            <li
              key={s}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border bg-muted/20 px-2.5 py-2"
            >
              <Chip value={s} />
              {isInitial && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <CircleDot className="h-3 w-3" /> {t('element.metadataViewer.initial', { defaultValue: 'initial' })}
                </span>
              )}
              {isFinal ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Flag className="h-3 w-3" /> {t('element.metadataViewer.final', { defaultValue: 'final' })}
                </span>
              ) : (
                <>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex flex-wrap gap-1.5">
                    {tos.map((t) => (
                      <Chip key={t} value={t} />
                    ))}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// flow — ordered step summary of a flow's nodes (read-only)
// ---------------------------------------------------------------------------

// Node-action families that are infrastructure, not business steps. With
// `detail: business` (the default), these are folded away so a non-technical
// reader sees the process, not the plumbing (ADR-0051 §3.4 altitude projection).
const TECHNICAL_NODE_TYPES = new Set([
  'script',
  'http',
  'connector_action',
  'assignment',
  'get_record',
  'create_record',
  'update_record',
  'delete_record',
  'boundary_event',
]);

function FlowView({ name, detail }: ViewerProps) {
  const { item: flow, loading, error } = useMetadataItem('flow', name ?? null);
  const { t, ...view } = useViewStates();

  if (!name) return view.missing('name');
  if (loading) return view.loading(name);
  if (error) return view.failed(name, error.message);
  if (!flow) return view.notFound(name);

  const allNodes: any[] = Array.isArray(flow.nodes) ? flow.nodes : [];
  const business = (detail ?? 'business') === 'business';
  const nodes = business ? allNodes.filter((n) => !TECHNICAL_NODE_TYPES.has(n?.type)) : allNodes;
  const hiddenCount = allNodes.length - nodes.length;

  return (
    <Shell
      hint={t('element.metadataViewer.flow', { defaultValue: 'Flow' })}
      icon={GitBranch}
      title={flow.label ?? flow.name ?? name}
      subtitle={
        flow.description ??
        t('element.metadataViewer.steps', { defaultValue: 'Steps: {{count}}', count: allNodes.length })
      }
    >
      {nodes.length === 0 ? (
        <Placeholder>{t('element.metadataViewer.noSteps', { defaultValue: 'No steps to show.' })}</Placeholder>
      ) : (
        <ol className="space-y-1.5">
          {nodes.map((n, i) => (
            <li key={n?.id ?? i} className="flex items-center gap-2.5 rounded-md border bg-muted/20 px-2.5 py-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-sm">
                {n?.label ?? n?.id ?? t('element.metadataViewer.untitledStep', { defaultValue: '(step)' })}
              </span>
              {n?.type && (
                <span className="ml-auto rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {n.type}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {business && hiddenCount > 0 && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {withChips(
            t('element.metadataViewer.hiddenSteps', {
              defaultValue: 'Technical steps hidden: {{count}} · set {{setting}} to show all',
              count: hiddenCount,
              setting: CHIP[0],
            }),
            [<Code key="s">detail: technical</Code>],
          )}
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// permission — compact object-level CRUD matrix (read-only)
// ---------------------------------------------------------------------------

const CRUD: Array<{ key: string; label: string }> = [
  { key: 'allowCreate', label: 'C' },
  { key: 'allowRead', label: 'R' },
  { key: 'allowEdit', label: 'U' },
  { key: 'allowDelete', label: 'D' },
];

function PermissionView({ name }: ViewerProps) {
  const { item: perm, loading, error } = useMetadataItem('permission', name ?? null);
  const { t, ...view } = useViewStates();

  if (!name) return view.missing('name');
  if (loading) return view.loading(name);
  if (error) return view.failed(name, error.message);
  if (!perm) return view.notFound(name);

  const objects: Record<string, any> = perm.objects && typeof perm.objects === 'object' ? perm.objects : {};
  const entries = Object.entries(objects);

  return (
    <Shell
      hint={t('element.metadataViewer.permission', { defaultValue: 'Permission' })}
      icon={ShieldCheck}
      title={perm.label ?? perm.name ?? name}
      subtitle={t('element.metadataViewer.objectAccess', { defaultValue: 'Object access: {{count}}', count: entries.length })}
    >
      {entries.length === 0 ? (
        <Placeholder>
          {t('element.metadataViewer.noPermissions', { defaultValue: 'No object permissions declared.' })}
        </Placeholder>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="border-b px-2 py-1.5 text-left font-medium">
                {t('element.metadataViewer.object', { defaultValue: 'Object' })}
              </th>
              {CRUD.map((c) => (
                <th key={c.key} className="border-b px-2 py-1.5 text-center font-mono font-medium" title={c.key}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(([objName, perms]) => (
              <tr key={objName}>
                <td className="border-b px-2 py-1.5 font-mono">{objName}</td>
                {CRUD.map((c) => (
                  <td key={c.key} className="border-b px-2 py-1.5 text-center">
                    {perms?.[c.key] ? (
                      <Check className="mx-auto h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Minus className="mx-auto h-3.5 w-3.5 text-muted-foreground/40" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher + registration
// ---------------------------------------------------------------------------

/**
 * The view for the authored `type`, the part of the block below its root.
 */
function MetadataView(props: ViewerProps) {
  const { t } = useObjectTranslation();
  switch (props.type) {
    case 'state_machine':
      return <StateMachineView {...props} />;
    case 'flow':
      return <FlowView {...props} />;
    case 'permission':
      return <PermissionView {...props} />;
    default:
      // The three accepted values are `type` identifiers, drawn as chips in
      // the order the language puts its slots in.
      return (
        <Placeholder tone="warn">
          {withChips(
            props.type
              ? t('element.metadataViewer.unknownTypeNamed', {
                  defaultValue: 'Unknown metadata view type “{{type}}”. Expected {{a}}, {{b}} or {{c}}.',
                  type: props.type,
                  a: CHIP[0],
                  b: CHIP[1],
                  c: CHIP[2],
                })
              : t('element.metadataViewer.unknownType', {
                  defaultValue: 'Unknown metadata view type. Expected {{a}}, {{b}} or {{c}}.',
                  a: CHIP[0],
                  b: CHIP[1],
                  c: CHIP[2],
                }),
            [<Code key="a">state_machine</Code>, <Code key="b">flow</Code>, <Code key="c">permission</Code>],
          )}
        </Placeholder>
      );
  }
}

export function ElementMetadataViewerRenderer({ schema }: { schema: any }) {
  const { aria, ...props } = readProps<ViewerProps & { aria?: AriaProps }>(schema);
  // The block's `aria` bag (objectui#11083). The spec declares `aria`
  // (`AriaPropsSchema`) on `element:metadata_viewer`, and nothing read it, so a
  // declared accessible name reached no element. It goes through
  // `resolveInlineAriaProps` from `@object-ui/react`, the one reader of that
  // bag.
  //
  // Each view returns its own root (a loading line, a warning, or the card), so
  // the block had no one element to carry the bag. This `div` is that element,
  // and it is always rendered: a wrapper that came and went with the bag would
  // remount the view whenever the bag resolved differently. It adds no default
  // role, and with nothing authored it carries no attribute.
  const locale = useDisplayLocale();
  return (
    <div {...resolveInlineAriaProps(aria, locale)}>
      <MetadataView {...props} />
    </div>
  );
}

ComponentRegistry.register('metadata_viewer', ElementMetadataViewerRenderer, {
  namespace: 'element',
  skipFallback: true,
  label: 'Metadata Viewer',
  category: 'content',
});
