// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ActionPreview — read-only summary of an Action metadata draft.
 *
 * Actions are the configurable buttons / menu items / shortcuts a
 * record or list surfaces. The preview shows:
 *
 *   1. A faux button rendered using the action's `variant`, `icon`,
 *      and `label` so authors can see the visual weight before they
 *      ship it (primary buttons are highlighted, danger turns red,
 *      icon-only actions render a compact icon button).
 *   2. A metadata strip: type, target, locations, the
 *      `requiredPermissions` capability gate, AI exposure,
 *      refreshAfter, confirmText.
 *   3. A params table when the action prompts the user — this is the
 *      modal/drawer it would open on click. We render it as a static
 *      preview, not an interactive form, because previews must be
 *      side-effect free.
 *   4. A "what happens on click" callout that describes the resolved
 *      handler in plain language (e.g. "POST ${target}", "open form
 *      ${target}", "run script ${target}").
 *   5. A resultDialog mock when configured (TOTP / backup-codes-style
 *      reveal dialogs).
 */

import * as React from 'react';
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  Code2,
  Eye,
  Globe,
  LayoutGrid,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Workflow,
} from 'lucide-react';
import {
  EmptyDescription,
  resolveIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import type { ActionParam } from '@object-ui/types';
import { paramDegradesWithoutTarget } from '../../../utils/paramToField.js';
import { resolveParamWidgetType } from '@object-ui/fields';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr, tFormat } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';

/*
 * No local `ActionParam` here (objectui#6329). `@object-ui/types` publishes the
 * authoring shape, derived from the spec's `ActionParamSchema` input, and this
 * package already read it by reference elsewhere. The copy that used to sit
 * here restated ten of its members and got two of them wrong in a way that
 * only ever narrowed the DECLARATION, never the code:
 *
 *   - `label?: string | { en?: string }` admitted the `en` tag and no other,
 *     while `localize` below has always read `Object.values(o)[0]`. An inline
 *     locale map keyed `fr-FR` rendered fine and failed `tsc`.
 *   - `type?: string` admitted every string, which is how the two dead
 *     branches in `renderFieldMock` survived — see the note there.
 */

interface ResultDialogField {
  path: string;
  label?: string | { en?: string };
  format?: 'qrcode' | 'code-list' | 'secret' | 'text' | 'json';
}

interface ResultDialog {
  title?: string | { en?: string };
  description?: string | { en?: string };
  acknowledge?: string | { en?: string };
  format?: 'qrcode' | 'code-list' | 'secret' | 'text' | 'json';
  fields?: ResultDialogField[];
}

function localize(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, string>;
    return o.en ?? o['en-US'] ?? Object.values(o)[0] ?? '';
  }
  return String(v);
}

function typeIcon(type: string) {
  switch (type) {
    case 'url':
      return Link2;
    case 'modal':
      return LayoutGrid;
    case 'flow':
      return Workflow;
    case 'api':
      return Globe;
    case 'form':
      return Pencil;
    case 'script':
    default:
      return Code2;
  }
}

function variantClasses(variant?: string): string {
  switch (variant) {
    case 'primary':
    case 'default':
    case undefined:
      // Shadcn-native default button is a solid primary, not an outline.
      return 'bg-primary text-primary-foreground hover:opacity-90';
    case 'danger':
    case 'destructive':
      return 'bg-red-600 text-white hover:bg-red-700';
    case 'secondary':
      return 'bg-secondary text-secondary-foreground hover:opacity-90';
    case 'ghost':
      return 'bg-transparent text-foreground hover:bg-accent';
    case 'link':
      return 'bg-transparent text-primary underline-offset-2 hover:underline px-0';
    default:
      // 'outline' and any unrecognized variant fall back to a bordered button.
      return 'border bg-background text-foreground hover:bg-accent';
  }
}

/**
 * The "On click" sentence, in the designer `locale` (objectui#10862). The
 * target is author data and shows as written; `String(target)` keeps the text
 * a template literal gave for a body-only action with no target.
 */
function describeHandler(type: string, target: string | undefined, hasBody: boolean, locale?: string): string {
  if (!target && !hasBody) return tr('engine.actionPreview.handler.none', locale);
  const vars = { target: String(target) };
  switch (type) {
    case 'url':
      return tFormat('engine.actionPreview.handler.url', locale, vars);
    case 'flow':
      return tFormat('engine.actionPreview.handler.flow', locale, vars);
    case 'modal':
      return tFormat('engine.actionPreview.handler.modal', locale, vars);
    case 'api':
      return tFormat('engine.actionPreview.handler.api', locale, vars);
    case 'form':
      return tFormat('engine.actionPreview.handler.form', locale, { ...vars, path: target ?? '?' });
    case 'script':
      return hasBody
        ? tr('engine.actionPreview.handler.scriptBody', locale)
        : tFormat('engine.actionPreview.handler.scriptNamed', locale, vars);
    default:
      return tFormat('engine.actionPreview.handler.invoke', locale, vars);
  }
}

/**
 * Render a row whose `{token}` holes carry a node rather than text (a
 * monospace capability list, a `reference` code span), keeping the sentence
 * order of the row in every locale.
 */
function withNodes(template: string, nodes: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const hole = /^\{(\w+)\}$/.exec(part);
    return <React.Fragment key={i}>{hole && hole[1] in nodes ? nodes[hole[1]] : part}</React.Fragment>;
  });
}

export function ActionPreview({ name, draft, locale }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  const actionName = String(d.name ?? name ?? '');
  const label = localize(d.label) || actionName;
  const icon = (d.icon as string | undefined) || undefined;
  const type = String(d.type ?? 'script');
  // `target` only: the `execute` alias was removed in @objectstack/spec 17
  // (objectstack-ai/objectstack#3855, objectstack-ai/objectstack#3856). Reading it here would preview a draft as bound when the
  // spec rejects it at save, which is the opposite of what a preview is for.
  const target = d.target as string | undefined;
  const variant = (d.variant as string | undefined) || undefined;
  const component = String(d.component ?? '');
  const locations = Array.isArray(d.locations) ? (d.locations as string[]) : [];
  /* [objectui#7234] `requiredPermissions` (ADR-0066 D4) is the reason a
     correctly-placed action can be absent from every surface at once, with no
     error and no message. Until this line the preview was silent about it while
     "Where it appears" below drew the button in every declared frame — the
     exact shape the `global_nav` note in `PlacementPreview` rules against: a
     designer promising a surface the running app does not draw. Maintainer
     ruling 2026-09-08 keeps the hide for end users and puts the reason here,
     where the author looks. Declaration-side only — whether THIS session holds
     the capability is answered in the inspector beside this preview, which
     reads the live held set. */
  const requiredPermissions = Array.isArray(d.requiredPermissions)
    ? (d.requiredPermissions as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  // No `shortcut` / `bulkEnabled` here: both are spec-17 `retiredKey()`
  // tombstones, so a preview of them could only ever render for metadata the
  // platform now refuses to parse. See ActionDefaultInspector's RETIRED_FIELDS.
  const refreshAfter = !!d.refreshAfter;
  const aiExposed = d.aiExposed;
  const confirmText = localize(d.confirmText);
  const successMessage = localize(d.successMessage);
  const params: ActionParam[] = Array.isArray(d.params) ? (d.params as ActionParam[]) : [];
  const resultDialog = d.resultDialog as ResultDialog | undefined;
  const body = d.body as { language?: string; source?: string } | undefined;
  const objectName = (d.objectName as string | undefined) || undefined;
  const visible = d.visible as unknown;
  const disabled = d.disabled as unknown;
  const method = (d.method as string | undefined) || 'POST';
  const bodyExtra = d.bodyExtra;

  const TypeIcon = typeIcon(type);
  const iconOnly = component === 'action:icon';

  if (!actionName && !label) {
    return (
      <PreviewShell hint="action">
        <PreviewMessage>{tr('engine.actionPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint="action">
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          {/* Faux button mock */}
          <div className="rounded border bg-muted/30 p-4 flex items-center justify-center min-h-[80px]">
            <FauxButton label={label} icon={icon} variant={variant} iconOnly={iconOnly} disabled={!!disabled && typeof disabled === 'boolean'} />
          </div>

          {/* Metadata strip */}
          <div className="rounded border bg-background p-3 text-xs space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{actionName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <Pill icon={TypeIcon} label={tFormat('engine.actionPreview.pill.type', locale, { type })} />
              {objectName && (
                <Pill icon={Square} label={tFormat('engine.actionPreview.pill.object', locale, { object: objectName })} mono />
              )}
              {variant && <Pill label={tFormat('engine.actionPreview.pill.variant', locale, { variant })} />}
              {component && <Pill icon={MoreHorizontal} label={component} />}
              {refreshAfter && <Pill icon={RefreshCw} label={tr('engine.actionPreview.pill.refreshAfter', locale)} />}
              {aiExposed === false && (
                <Pill icon={Bot} label={tr('engine.actionPreview.pill.aiOptedOut', locale)} tone="amber" />
              )}
              {aiExposed === true && <Pill icon={Sparkles} label={tr('engine.actionPreview.pill.aiExposed', locale)} />}
            </div>
            {locations.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                <span className="text-muted-foreground">{tr('engine.actionPreview.locations', locale)}</span>
                {locations.map((l) => (
                  <span key={l} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                    {l}
                  </span>
                ))}
              </div>
            )}
            {requiredPermissions.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1 pt-1"
                data-testid="action-preview-required-permissions"
              >
                <Lock className="h-3 w-3 text-amber-700" />
                <span className="text-muted-foreground">{tr('engine.actionPreview.requires', locale)}</span>
                {requiredPermissions.map((c) => (
                  <span key={c} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                    {c}
                  </span>
                ))}
              </div>
            )}
            {Boolean(typeof visible === 'string' || (visible && typeof visible === 'object')) && (
              <ConditionLine label={tr('engine.actionPreview.visibleWhen', locale)} value={visible} icon={Eye} />
            )}
            {disabled != null && typeof disabled !== 'boolean' && (
              <ConditionLine label={tr('engine.actionPreview.disabledWhen', locale)} value={disabled} icon={Lock} />
            )}
          </div>

          {/* On-click description */}
          <div className="rounded border border-blue-200 bg-blue-50 p-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-medium text-blue-900 mb-0.5">
              {/* eslint-disable-next-line react-hooks/static-components -- typeIcon returns a stable icon component from a static registry, not one created during render */}
              <TypeIcon className="h-3.5 w-3.5" /> {tr('engine.actionPreview.onClick', locale)}
            </div>
            <div className="text-blue-950 font-mono break-all">
              {describeHandler(type, target, !!body?.source, locale)}
            </div>
            {confirmText && (
              <div className="mt-1.5 flex items-start gap-1.5 text-amber-900">
                <AlertTriangle className="h-3 w-3 mt-0.5" />
                <span>{tr('engine.actionPreview.firstAsks', locale)} <em>{confirmText}</em></span>
              </div>
            )}
            {successMessage && (
              <div className="mt-1.5 text-blue-950">
                {tr('engine.actionPreview.onSuccess', locale)} <em>{successMessage}</em>
              </div>
            )}
          </div>

          {/* Placement simulation — where this action surfaces */}
          {locations.length > 0 && (
            <Section title={tr('engine.actionPreview.section.placement', locale)}>
              {requiredPermissions.length > 0 && (
                <div className="text-[11px] text-amber-700" data-testid="action-preview-capability-gate-note">
                  {withNodes(tr('engine.actionPreview.capabilityGateNote', locale), {
                    capabilities: <span className="font-mono">{requiredPermissions.join(' + ')}</span>,
                  })}
                </div>
              )}
              <PlacementPreview
                locations={locations}
                label={label}
                icon={icon}
                variant={variant}
                iconOnly={iconOnly}
                locale={locale}
              />
            </Section>
          )}

          {/* Test request — api type */}
          {type === 'api' && !!target && (
            <Section title={tr('engine.actionPreview.section.testRequest', locale)} icon={Globe}>
              <ApiTestPanel target={target} method={method} bodyExtra={bodyExtra} params={params} locale={locale} />
            </Section>
          )}

          {/* Param dialog mock */}
          {params.length > 0 && (
            <Section title={tr('engine.actionPreview.section.inputDialog', locale)} count={params.length}>
              <DialogMock title={label} params={params} variant={variant} locale={locale} />
            </Section>
          )}

          {/* Result dialog mock */}
          {resultDialog && (
            <Section title={tr('engine.actionPreview.section.resultDialog', locale)} icon={Eye}>
              <ResultDialogMock dialog={resultDialog} locale={locale} />
            </Section>
          )}

          {/* Body excerpt (script type) */}
          {body?.source && (
            <Section
              title={tFormat('engine.actionPreview.section.scriptBody', locale, { language: body.language ?? 'expression' })}
              icon={Code2}
            >
              <pre className="m-0 rounded border bg-background p-2.5 text-xs font-mono whitespace-pre-wrap max-h-[200px] overflow-auto">
                {body.source}
              </pre>
            </Section>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function FauxButton({
  label,
  icon,
  variant,
  iconOnly,
  disabled,
}: {
  label: string;
  icon?: string;
  variant?: string;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const cls = `inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium pointer-events-none ${variantClasses(variant)} ${disabled ? 'opacity-50' : ''}`;
  return (
    <button type="button" className={cls} aria-disabled disabled>
      {icon && <IconHint name={icon} />}
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

/**
 * Render the action's bound Lucide icon by name (kebab- or PascalCase).
 * Falls back to a compact name chip when the icon can't be resolved, so
 * the author still sees that an icon binding is in place.
 */
function IconHint({ name }: { name: string }) {
  // objectui#5935: the normalisation moved to the ONE seam. This site's own
  // copy was the WIDEST of the three tokenisers in the tree, so the seam adopts
  // its behaviour rather than replacing it — nothing this preview resolved
  // before stops resolving now.
  //
  // ⛔ The seam does not decide the fallback. The name chip below stays here,
  // unchanged: an author looking at an action preview needs to see that an icon
  // binding is in place even when the glyph does not resolve (maintainer
  // ruling 2026-09-03, objectui#5935, option C).
  const Glyph = resolveIcon(name);

  if (Glyph) {
    // The same annotation the other five seam call sites carry: `resolveIcon`
    // returns a STABLE component out of lucide's static record, it does not
    // create one during render. The rule cannot see that through a call, where
    // it could through the record index this line replaced.
    // eslint-disable-next-line react-hooks/static-components
    return <Glyph className="h-4 w-4" aria-hidden />;
  }

  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-white/30 px-1 text-[9px] uppercase font-mono">
      {name.slice(0, 3)}
    </span>
  );
}

function DialogMock({
  title,
  params,
  variant,
  locale,
}: {
  title: string;
  params: ActionParam[];
  variant?: string;
  locale?: string;
}) {
  return (
    <div className="rounded border bg-background shadow-sm">
      <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium">{title}</div>
      <div className="p-3 space-y-2">
        {params.map((p, i) => {
          const fieldName = p.name ?? p.field ?? `param_${i}`;
          const fieldLabel = localize(p.label) || fieldName;
          return (
            <div key={i} className="space-y-0.5">
              <label className="text-xs flex items-center gap-1">
                {fieldLabel}
                {p.required && <span className="text-red-600 text-[10px]">*</span>}
                <span className="ml-1 font-mono text-[9px] text-muted-foreground">{fieldName}</span>
                {p.type && <span className="font-mono text-[9px] text-muted-foreground">{p.type}</span>}
              </label>
              {renderFieldMock(p, fieldLabel, locale)}
              {p.helpText && <div className="text-[10px] text-muted-foreground">{p.helpText}</div>}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-3 py-2">
        <button type="button" disabled className="text-xs px-2.5 py-1 rounded border bg-background pointer-events-none">
          {tr('engine.cancel', locale)}
        </button>
        <button
          type="button"
          disabled
          className={`text-xs px-2.5 py-1 rounded pointer-events-none ${variantClasses(variant || 'primary')}`}
        >
          {tr('engine.actionPreview.dialog.ok', locale)}
        </button>
      </div>
    </div>
  );
}

/**
 * Stand-in target for a FIELD-BACKED picker. Not a real object name — only a
 * non-empty value, so `paramDegradesWithoutTarget` answers "a target exists".
 * The real one arrives from the bound field at runtime
 * (`resolveActionParams`: `referenceTo: param.reference ?? field.reference`).
 */
const INHERITED_TARGET = '(inherited from the bound field)';

/**
 * The widget key `ActionParamDialog` will render this param through, and
 * whether that widget DEGRADED to a text box for want of a target.
 *
 * Asked of the adapter that PERFORMS the mapping (`paramToField`'s
 * `resolveParamWidgetType` / `paramDegradesWithoutTarget`), never restated
 * here. The preview's declared job is to show what will render, so "what will
 * render" has to be one question with one answer — the same discipline
 * objectui#5654 imposed on the dialog's own hint logic.
 *
 * Before objectui#6538 this function did not exist: `renderFieldMock` switched
 * on the RAW authored spelling over a private table of five, while
 * `PARAM_TYPE_OPTS` offered eight. Three of the eight previewed as something
 * the runtime does not draw — `datetime` and `lookup` as plain text boxes, and
 * a `select` whose options were not authored yet as a text box too — and a
 * `text` param that happened to carry `options` previewed as a select the
 * runtime never renders (it resolves `text`, and `TextField` reads no options).
 *
 * Two crossings this function owns, and nothing else:
 *
 *  1. **`reference` → `referenceTo`.** `reference` is the AUTHORING spelling
 *     (`ActionParamSchema`); `referenceTo` is the RESOLVED one the predicate
 *     reads. `resolveActionParams()` performs exactly that copy before the
 *     dialog sees a param, and this preview reads the UNRESOLVED draft, so the
 *     rename happens here. The membership tables stay where they are.
 *  2. **A field-backed param is never previewed as degraded.** Its target is
 *     inherited from the bound field at runtime; the designer has not resolved
 *     that field here, so claiming the degradation would be the same lie
 *     pointing the other way.
 *
 * `widget: undefined` means the draft declares no `type` at all — a field-backed
 * param whose type the runtime inherits from object metadata this preview does
 * not load. Genuinely unresolvable here, which is why the caller may fall back
 * to the only other evidence it has; see there.
 */
function runtimeWidgetFor(p: ActionParam): { widget: string | undefined; degraded: boolean } {
  if (!p.type) return { widget: undefined, degraded: false };
  const referenceTo = p.reference ?? (p.field ? INHERITED_TARGET : undefined);
  const degraded = paramDegradesWithoutTarget({ name: p.name ?? '', label: '', type: p.type, referenceTo });
  return { widget: degraded ? 'text' : resolveParamWidgetType(p.type), degraded };
}

/**
 * @param fieldLabel The label `DialogMock` already derived for this param, and
 * renders directly above this control. Passed in rather than re-derived: the
 * param-name chain behind it -- the one `DialogMock` computes as `fieldName` --
 * is the ONE reader this file is allowed (objectui#3104's ratchet inventory
 * records this file at a single `two-layer` read, "Action param name, same
 * layering as resolveActionParams"), and re-deriving it here was a second
 * open-coding of one concept: the shape objectui#3174 removed from
 * `resolveActionParams` itself by routing every call site in that file through
 * one named reader. Note for the next editor: that ratchet's scanner is a
 * LINE-level heuristic and is blind to comments, so do not spell the chain out
 * in prose here -- a comment quoting it counts as a second read.
 *
 * NOT converged onto `columnIdentity()`, and deliberately: that reader is
 * canonical-first because a column IS the object field it shows, whereas a
 * param merely BINDS one. The inventory's `resolveActionParams` entry refuses
 * the same borrowing in the same words -- it would invert the param-name
 * precedence and rename every field-backed param that also names itself.
 *
 * Passing it also makes the mock's placeholders name the param the way the
 * visible label right above them does, instead of by a near-copy of it.
 */
function renderFieldMock(p: ActionParam, fieldLabel: string, locale?: string): React.ReactElement {
  const cls = 'w-full text-xs px-2 py-1 border rounded bg-background pointer-events-none';
  // A declared carry-over (objectui#6246) is not collected: `ActionParamDialog`
  // builds NO widget for it and shows a collapsed read-only summary of the row
  // value instead. Drawing its widget here would preview an input the dialog
  // never offers — so this answers before `runtimeWidgetFor` is asked.
  if (p.carryOver) {
    return (
      <div className={`${cls} flex items-center gap-1.5 text-muted-foreground`} data-testid="action-preview-carry-over">
        <Lock className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{tr('engine.actionPreview.param.carryOver', locale)}</span>
      </div>
    );
  }
  const placeholder = p.placeholder || (p.defaultFromRow ? tr('engine.actionPreview.param.fromRow', locale) : '');
  const def = p.defaultValue;
  const value = def != null ? String(def) : '';
  const options = Array.isArray(p.options) ? p.options : [];
  const { widget, degraded } = runtimeWidgetFor(p);

  const inputMock = (type: string) => (
    <input type={type} className={cls} placeholder={placeholder} value={value} readOnly />
  );
  // objectui#11865 — the shared `Select`, the primitive `SelectField` draws
  // the dialog's picker with, where this mock used to be a browser-native
  // select element. It stays a disabled control that shows the placeholder and
  // writes nothing. Items carry their option's INDEX, because an authored
  // option's value may be `''`, which `SelectItem` refuses.
  const selectMock = (
    <Select disabled value="">
      <SelectTrigger className={`${cls} h-auto`}>
        <SelectValue
          placeholder={placeholder || tFormat('engine.actionPreview.param.selectPlaceholder', locale, { label: fieldLabel })}
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) => (
          <SelectItem key={i} value={String(i)}>
            {localize(o.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const note = (text: React.ReactNode) => <div className="text-[10px] text-amber-700">{text}</div>;

  // No declared `type`: a field-backed param inherits its type from the object
  // field, and this preview resolves no object metadata. Authored `options` are
  // then the only evidence of what the dialog will draw, so they still decide —
  // the one place in this function where they may. Everywhere below, the
  // resolved WIDGET decides and options are read only where the widget reads
  // them, because that is what the runtime does.
  if (widget === undefined) return options.length > 0 ? selectMock : inputMock('text');

  // A targetless picker collapses to a record-id text box in the dialog, with
  // its own placeholder and help text (objectstack-ai/objectstack#3405). The box alone would be honest
  // about the control and silent about the reason, which is the state that
  // help text was added for.
  if (degraded) {
    return (
      <div className="space-y-0.5">
        <input
          type="text"
          className={cls}
          placeholder={placeholder || tFormat('engine.actionPreview.param.recordIdPlaceholder', locale, { label: fieldLabel })}
          value={value}
          readOnly
        />
        {note(
          withNodes(tr('engine.actionPreview.param.noReference', locale), {
            reference: <code className="font-mono">reference</code>,
          }),
        )}
      </div>
    );
  }

  switch (widget) {
    case 'boolean':
      return (
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" disabled className="pointer-events-none" /> {tr('engine.actionPreview.param.toggle', locale)}
        </label>
      );
    // `html` is NOT one of the eight spellings `PARAM_TYPE_OPTS` offers, and
    // objectui#6538 scoped this preview's population to exactly those eight. It
    // rides along with `textarea` because that is what this function already
    // drew for it; dropping it while narrowing to the population would be a
    // regression wearing a narrowing's clothes.
    //
    // No `long_text` / `integer` branches (objectui#6329). Both are spellings
    // from OTHER vocabularies — `long_text` from the console's form-builder
    // dialect (`apps/console/src/components/FormPage.tsx`), `integer` from JSON
    // Schema (`ToolPreview.tsx`, `json-schema-to-fields.ts`) — and neither is in
    // `ResolvableParamFieldType`. `ActionParamSchema` is `.strict()` with a
    // `FieldType` enum on `type`, so a param spelled either way is a parse
    // rejection on the server and can never reach this preview.
    case 'textarea':
    case 'html':
      return <textarea className={`${cls} min-h-[48px]`} placeholder={placeholder} value={value} readOnly />;
    case 'select':
      // `SelectField` renders a picker either way — an EMPTY one when no
      // choices are authored. Drawing a text box there was the preview
      // disagreeing with the dialog about the control; drawing a silent empty
      // picker would disagree with it about whether anything is missing.
      return options.length > 0 ? (
        selectMock
      ) : (
        <div className="space-y-0.5">
          {selectMock}
          {note(tr('engine.actionPreview.param.noChoices', locale))}
        </div>
      );
    case 'number':
      return inputMock('number');
    case 'date':
    case 'datetime':
      // The dialog draws the platform date picker for both (objectui#12642):
      // a text box with a calendar button, not the browser's native input.
      return (
        <div className="relative" data-slot="date-picker">
          <input type="text" className={`${cls} pr-6`} placeholder={placeholder} value={value} readOnly />
          <CalendarDays className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
      );
    case 'lookup':
      // `LookupField` is a combobox that opens a record picker — mocked with
      // the same disabled-combobox shape the designer's other pickers use, so
      // an author can tell a record picker from a text box at a glance.
      return (
        <button
          type="button"
          disabled
          role="combobox"
          aria-expanded={false}
          aria-haspopup="dialog"
          className={`${cls} flex items-center gap-1.5 text-left text-muted-foreground`}
        >
          <Search className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            {placeholder ||
              (p.reference != null
                ? tFormat('engine.actionPreview.param.searchObject', locale, { object: p.reference })
                : tr('engine.actionPreview.param.searchRecords', locale))}
          </span>
        </button>
      );
    default:
      // Every remaining widget key is outside the eight this designer offers: a
      // param can only carry one by hand-editing the JSON source, and the text
      // box is what this preview has always drawn for them. Extending the mock
      // vocabulary past `PARAM_TYPE_OPTS` is deliberately not this card.
      return inputMock('text');
  }
}

function ResultDialogMock({ dialog, locale }: { dialog: ResultDialog; locale?: string }) {
  const title = localize(dialog.title) || tr('engine.actionPreview.result.title', locale);
  const description = localize(dialog.description);
  const acknowledge = localize(dialog.acknowledge) || tr('engine.actionPreview.result.acknowledge', locale);
  const fields = dialog.fields ?? [];
  return (
    <div className="rounded border bg-background shadow-sm">
      <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium">{title}</div>
      <div className="p-3 space-y-2 text-xs">
        {description && <div className="text-muted-foreground">{description}</div>}
        {fields.length === 0 ? (
          <EmptyDescription className="text-xs italic">{tr('engine.actionPreview.result.fullJson', locale)}</EmptyDescription>
        ) : (
          <ul className="space-y-1.5">
            {fields.map((f, i) => (
              <li key={i} className="rounded border bg-muted/20 p-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{localize(f.label) || f.path}</span>
                  <span className="font-mono text-[9px] text-muted-foreground">{f.path}</span>
                  <span className="ml-auto font-mono text-[9px] uppercase text-muted-foreground">
                    {f.format ?? dialog.format ?? 'json'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end border-t bg-muted/20 px-3 py-2">
        <button type="button" disabled className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground pointer-events-none">
          {acknowledge}
        </button>
      </div>
    </div>
  );
}

function ConditionLine({ label, value, icon: Icon }: { label: string; value: unknown; icon: React.ComponentType<{ className?: string }> }) {
  const src = typeof value === 'string' ? value : (value as { source?: string })?.source ?? JSON.stringify(value);
  return (
    <div className="flex items-start gap-1.5 pt-0.5">
      <Icon className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <code className="font-mono break-all">{src}</code>
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        <span>{title}</span>
        {count != null && <span className="opacity-70">({count})</span>}
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
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className={`${cls} ${mono ? 'font-mono' : ''}`}>{label}</span>
    </span>
  );
}


/* ─────────────── Placement simulation (where it appears) ─────────────── */

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">{label}</div>
      {children}
    </div>
  );
}

function PlacementPreview({ locations, label, icon, variant, iconOnly, locale }: {
  locations: string[]; label: string; icon?: string; variant?: string; iconOnly?: boolean; locale?: string;
}) {
  const btn = <FauxButton label={label} icon={icon} variant={variant} iconOnly={iconOnly} />;
  // The row frame: the action on each row of a list. Drawn for both locations
  // that place an action on a list's rows — `list_item` (every list of the
  // object) and `record_related` (the rows of a related list inside a parent
  // record, objectui#11270) — each under its own caption.
  const rows = (
    <div className="divide-y rounded border bg-background">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-[11px]">{tFormat('engine.actionPreview.placement.row', locale, { n: i + 1 })}</span>
          <div className="origin-right scale-90">{btn}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-2.5">
      {locations.includes('record_header') && (
        <Frame label="record_header">
          <div className="rounded border bg-background">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded bg-muted" />
                <div>
                  <div className="text-xs font-medium">{tr('engine.actionPreview.placement.sampleRecord', locale)}</div>
                  <div className="text-[10px] text-muted-foreground">{tr('engine.actionPreview.placement.recordDetail', locale)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">{btn}</div>
            </div>
            <div className="p-3 text-[10px] text-muted-foreground">{tr('engine.actionPreview.placement.recordBody', locale)}</div>
          </div>
        </Frame>
      )}
      {locations.includes('list_toolbar') && (
        <Frame label="list_toolbar">
          <div className="rounded border bg-background">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="text-xs font-medium">{tr('engine.actionPreview.placement.records', locale)}</div>
              <div className="flex items-center gap-1.5">{btn}</div>
            </div>
            <div className="px-3 py-2 text-[10px] text-muted-foreground">{tr('engine.actionPreview.placement.rows', locale)}</div>
          </div>
        </Frame>
      )}
      {locations.includes('list_item') && <Frame label="list_item">{rows}</Frame>}
      {locations.includes('record_section') && (
        <Frame label="record_section">
          <div className="rounded border bg-background">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium">{tr('engine.actionPreview.placement.section', locale)}</span>
              {btn}
            </div>
            <div className="p-3 text-[10px] text-muted-foreground">{tr('engine.actionPreview.placement.sectionBody', locale)}</div>
          </div>
        </Frame>
      )}
      {/* `record_related` is ROW placement inside a parent record
          (objectstack-ai/objectstack#20937, triage `5919625056`), which is
          where the console's related lists put it (objectui#11270). It used
          to share the `record_section` frame above and draw a button in a
          section HEADER — the reading the ruling replaced — so the designer
          showed the author a placement the product does not use. Pinned in
          `__tests__/ActionPreview.recordRelatedRow-11270.test.tsx`. */}
      {locations.includes('record_related') && <Frame label="record_related">{rows}</Frame>}
      {locations.includes('record_more') && (
        <Frame label="record_more">
          <div className="w-52 rounded border bg-background">
            <div className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
              <MoreHorizontal className="h-3.5 w-3.5" /> {tr('engine.actionPreview.placement.more', locale)}
            </div>
            <div className="px-2 py-1.5 text-xs"><div className="rounded px-1 py-0.5 hover:bg-accent">{label}</div></div>
          </div>
        </Frame>
      )}
      {/* No `global_nav` frame. The location was retired from the spec's
          `ACTION_LOCATIONS` in @objectstack/spec 17.0.0-rc.6 (objectstack#6888,
          maintainer ruling 2026-08-09 direction 2) because no running-app
          surface ever rendered it: the console's ⌘K palette
          (`chrome/CommandPalette.tsx`) builds its groups from nav items,
          objects, dashboards, pages, reports, recent items, record search and
          theme, and reads no action metadata at all. The frame that used to
          stand here drew the author a mock "⌘K · Command palette" preview, so
          the designer promised a surface the product does not have — the
          ADR-0078 "declares, 'renders', reports success, and does nothing"
          shape, which is the sharpest harm the ruling names. Pinned negatively
          in `__tests__/ActionPreview.locations.test.tsx`. */}
    </div>
  );
}

/* ─────────────── Test request runner (api type) ─────────────── */

function ApiTestPanel({ target, method, bodyExtra, params, locale }: {
  target: string; method?: string; bodyExtra?: unknown; params: ActionParam[]; locale?: string;
}) {
  const m = (method || 'POST').toUpperCase();
  const [resp, setResp] = React.useState<{ status: number; ok: boolean; body?: unknown; error?: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const reqBody = (bodyExtra && typeof bodyExtra === 'object') ? (bodyExtra as Record<string, unknown>) : {};

  const run = async () => {
    setLoading(true);
    setResp(null);
    try {
      const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('auth-session-token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const init: RequestInit = { method: m, headers, credentials: 'include' };
      if (m !== 'GET' && m !== 'HEAD') init.body = JSON.stringify(reqBody);
      const r = await fetch(target, init);
      const text = await r.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      setResp({ status: r.status, ok: r.ok, body: parsed });
    } catch (e) {
      setResp({ status: 0, ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="rounded border bg-background p-2 font-mono text-[11px] break-all">
        <span className="font-semibold">{m}</span> {target}
      </div>
      {Object.keys(reqBody).length > 0 && (
        <pre className="m-0 rounded border bg-muted/30 p-2 text-[10px] font-mono whitespace-pre-wrap">{JSON.stringify(reqBody, null, 2)}</pre>
      )}
      {params.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {tFormat(params.length > 1 ? 'engine.actionPreview.api.paramsOther' : 'engine.actionPreview.api.paramsOne', locale, {
            count: params.length,
          })}
        </div>
      )}
      {m !== 'GET' && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{tFormat('engine.actionPreview.api.liveWarning', locale, { method: m })}</span>
        </div>
      )}
      <button type="button" onClick={run} disabled={loading}
        className="inline-flex items-center gap-1.5 rounded border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
        <Globe className="h-3.5 w-3.5" />{' '}
        {loading ? tr('engine.actionPreview.api.sending', locale) : tr('engine.actionPreview.api.send', locale)}
      </button>
      {resp && (
        <div className={'rounded border p-2 ' + (resp.ok ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50')}>
          <div className="mb-1 text-[11px] font-medium">
            {resp.error ? tr('engine.actionPreview.api.networkError', locale) : 'HTTP ' + resp.status + (resp.ok ? ' OK' : '')}
          </div>
          <pre className="m-0 max-h-[200px] overflow-auto text-[10px] font-mono whitespace-pre-wrap">{resp.error ?? (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body, null, 2))}</pre>
        </div>
      )}
    </div>
  );
}
