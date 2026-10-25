/**
 * <SettingsField> — one row of a settings page. Translates a single
 * Specifier into the matching shadcn primitive.
 *
 * Pure UI: receives `value`, `onChange`, `locked`, and `resolved`
 * (which carries provenance and lock state).
 */

import { cloneElement, isValidElement, lazy, Suspense, useId, type ReactElement } from 'react';
import {
  Input,
  Textarea,
  Switch,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  RadioGroup,
  RadioGroupItem,
  Checkbox,
  Alert,
  AlertTitle,
  AlertDescription,
  Separator,
  Badge,
  Button,
  cn,
  getLazyIcon,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { AlertTriangle, ChevronRight, Info, RotateCcw } from 'lucide-react';
import { EnvLockBadge } from './EnvLockBadge';
import { resolveLabel, type Specifier, type ResolvedSettingValue } from './types';
import type { SettingsLabelHelpers } from './useSettingsLabel';

/**
 * An `info_banner`'s body is a Markdown body: the spec declares `bannerText`
 * with `.describe('Markdown body (info_banner)')` in `settings-manifest.zod.ts`
 * (objectui#12671). It is drawn by the docs portal's renderer, the
 * `MarkdownRenderer` that `DocPage` renders a package doc with: the same kind
 * of text (an installed package's own words) through the same unconditional
 * `rehype-sanitize` pass, used as it is.
 *
 * Lazy on purpose. This module is in the EAGER closure (`AppContent` imports
 * `WorkspaceTimezonePrompt`, which imports it), and a static import would put
 * `plugin-markdown`'s whole chunk, its syntax highlighter included, on every
 * console page load. Until the chunk arrives the body shows as its own plain
 * text.
 */
const BannerMarkdown = lazy(() =>
  import('@object-ui/plugin-markdown').then((m) => ({ default: m.MarkdownRenderer })),
);

/**
 * `bannerSeverity: 'warning'` draws the amber callout (objectui#12610 target 2,
 * objectui#12671). The `Alert` primitive declares only `default` and
 * `destructive`, and `packages/components/src/ui/` is not edited here, so the
 * warning is the shell's existing amber callout spelling laid over `default`
 * (the colours `PermissionMatrixEditor`'s and `SuggestedBindingsPanel`'s
 * notices use), with the icon in the amber of the shell's warning glyphs.
 */
const WARNING_BANNER_CLASSES =
  'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400';

/**
 * An emptied text-like box means UNSET (objectui#13145): the key goes into the
 * draft as `null`, never `""`. The settings door reads `null` as "clear this
 * layer's value", so the row falls back to what the layer above carries, while
 * `""` is a stored value like any other — which a required key refuses as
 * incomplete, leaving a saved value with no way back to unset. The `number`
 * control has mapped an empty box to `null` all along; this is the same rule
 * for the controls that hold a string.
 */
function textOrUnset(raw: string): string | null {
  return raw === '' ? null : raw;
}

export interface SettingsFieldProps {
  spec: Specifier;
  resolved?: ResolvedSettingValue;
  value: unknown;
  onChange: (next: unknown) => void;
  onAction?: () => void;
  /** Whether the whole page is in a saving state. */
  saving?: boolean;
  /** True when the specifier should appear disabled (env-locked or saving). */
  locked?: boolean;
  /** i18n helpers bound to the parent settings namespace. */
  labels?: SettingsLabelHelpers;
  /**
   * Server-side rejection for THIS field, from the last failed save
   * (objectstack#4224). Already localized by the server — rendered verbatim,
   * not re-worded here.
   *
   * Replaces the help text while present, rather than stacking below it: the
   * two occupy the same slot and say the same kind of thing, and a description
   * sitting under a red error reads as if the field has two states at once.
   */
  error?: string;
}

type SourceBadge =
  | { kind: 'inherited'; scope: ResolvedSettingValue['source'] }
  | { kind: 'overrides'; scope: ResolvedSettingValue['source'] };

/**
 * Which source badge a row carries, read off the server's `cascadeChain` alone:
 * the console never invents a source state.
 */
function sourceBadgeOf(resolved: ResolvedSettingValue): SourceBadge | null {
  const chain = resolved.cascadeChain;
  if (!chain || chain.length === 0) return null;

  const effective = chain.find((e) => e.effective) ?? chain[chain.length - 1];
  const upperWithValue = chain.find(
    (e) => e !== effective && e.value !== null && e.value !== undefined,
  );

  // "Inherited from <upper>" — effective value came from an upper scope.
  if (
    effective.scope !== 'default' &&
    effective.scope !== 'user' &&
    effective.scope !== 'tenant'
  ) {
    // global/env: show as inherited for downstream scopes
    return { kind: 'inherited', scope: effective.scope };
  }

  // "Overrides <upper>" — local value shadows an upper-scope value.
  if (upperWithValue) return { kind: 'overrides', scope: upperWithValue.scope };

  return null;
}

function InheritanceBadge({
  badge,
  labels,
}: {
  badge: SourceBadge;
  labels?: SettingsLabelHelpers;
}) {
  const { t } = useObjectTranslation();
  const source = labels?.sourceLabel?.(badge.scope) ?? badge.scope;

  // Each badge is ONE sentence with the layer's label interpolated as
  // `{{source}}` (objectui#12694): a pack puts the layer where its grammar
  // wants it, never a translated verb beside a translated noun.
  if (badge.kind === 'inherited') {
    return (
      <Badge variant="outline" className="text-blue-700 border-blue-300 text-[10px]">
        {t('console.settingsView.sourceBadgeInherited', { source })}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px]">
      {t('console.settingsView.sourceBadgeOverrides', { source })}
    </Badge>
  );
}

/**
 * The row's label, bound to its control (objectui#11690): `htmlFor` names a
 * control that carries the row's `id`, and `labelId` lets a control with no
 * single labelable element (a radio group, a checkbox group, the colour row's
 * hex input) point back with `aria-labelledby`. Unbound, the label was text
 * beside an input that every screen reader announced as nameless.
 */
function FieldHeader({
  spec,
  resolved,
  labelText,
  labels,
  labelId,
  htmlFor,
  onReset,
  resetDisabled,
}: {
  spec: Specifier;
  resolved?: ResolvedSettingValue;
  labelText: string;
  labels?: SettingsLabelHelpers;
  labelId?: string;
  htmlFor?: string;
  /**
   * Clears this layer's value (objectui#13145). Offered only beside an
   * `Overrides` badge, the one state where clearing hands the row back to a
   * value the layer above carries.
   */
  onReset?: () => void;
  resetDisabled?: boolean;
}) {
  const { t } = useObjectTranslation();
  const badge = resolved && !resolved.locked ? sourceBadgeOf(resolved) : null;
  return (
    <div className="flex items-center gap-2">
      <Label id={labelId} htmlFor={htmlFor} className="text-sm font-medium">
        {labelText}
        {spec.required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {spec.deprecated ? (
        <Badge variant="outline" className="text-amber-700 border-amber-300">
          {spec.replacedBy
            ? t('console.settingsView.deprecatedBadgeReplacedBy', { replacedBy: spec.replacedBy })
            : t('console.settingsView.deprecatedBadge')}
        </Badge>
      ) : null}
      {resolved?.locked ? <EnvLockBadge reason={resolved.lockedReason} /> : null}
      {badge ? <InheritanceBadge badge={badge} labels={labels} /> : null}
      {badge?.kind === 'overrides' && onReset ? (
        // Sets the key to `null` in the draft; the page's Save sends it, and
        // the badge then follows the server's answer for the row.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[11px] text-muted-foreground"
          onClick={onReset}
          disabled={resetDisabled}
        >
          <RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />
          {t('console.settingsView.resetToDefault')}
        </Button>
      ) : null}
      {resolved?.source && resolved.source !== 'default' && !resolved.locked ? (
        <span className="text-[11px] text-muted-foreground">
          {labels?.sourceLabel?.(resolved.source) ?? resolved.source}
        </span>
      ) : null}
    </div>
  );
}

function FieldDescription({ description }: { description?: string }) {
  if (!description) return null;
  return <p className="text-xs text-muted-foreground mt-1">{description}</p>;
}

/**
 * The server's rejection for this field, in the slot the help text normally
 * occupies (objectstack#4224).
 *
 * `role="alert"` so a screen reader announces it when it appears after a save
 * attempt — the sighted cue is colour, which is not a cue at all for everyone.
 * The `id` is what the input points `aria-describedby` at, so the association
 * survives for assistive tech rather than being purely visual adjacency.
 */
function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="text-xs text-destructive mt-1">
      {message}
    </p>
  );
}

/**
 * <DomainCombobox> — the control a `select` gets when its specifier declares a
 * `valueDomain` (objectstack#5712 / PR objectstack#6581).
 *
 * Such a key is judged against a STANDARD, not against the manifest's table:
 * `PUT /api/settings/localization` takes any IANA zone or ISO 4217 code, so the
 * 17 curated timezones and 9 currencies are a convenience list, not the domain.
 * A closed dropdown therefore advertises a narrower contract than the server
 * enforces, and leaves every legal value outside the table reachable only by
 * API or env.
 *
 * Native `<datalist>` gives exactly suggest-but-allow-anything, with zero extra
 * dependencies and built-in accessibility — the same reason the flow designer's
 * `FlowReferenceField` uses it. The curated `options` stay visible as
 * suggestions; free text is committed verbatim, and an out-of-domain value is
 * refused by the server with `invalid_value` + `constraint: { valueDomain }`,
 * which lands in the field-error slot the wrapper already owns.
 *
 * Props beyond its own are forwarded to the `<input>` so `wrapper`'s
 * `aria-invalid` / `aria-describedby` reach the focusable control rather than a
 * wrapping node (same seam as Combobox's trigger pass-through, objectui#3318).
 */
function DomainCombobox({
  id,
  value,
  options,
  disabled,
  onChange,
  ...inputProps
}: {
  id: string;
  value: unknown;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (next: unknown) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  const listId = `${id}-domain`;
  return (
    <>
      <Input
        id={id}
        type="text"
        // `list` only when there is something to suggest: an empty <datalist>
        // renders a dead dropdown affordance on some browsers.
        list={options.length > 0 ? listId : undefined}
        value={value == null ? '' : String(value)}
        disabled={disabled}
        onChange={(e) => onChange(textOrUnset(e.target.value))}
        {...inputProps}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </datalist>
      ) : null}
    </>
  );
}

export function SettingsField(props: SettingsFieldProps) {
  const { spec, resolved, value, onChange, onAction, locked, saving, labels, error } = props;
  const id = useId();
  const { t } = useObjectTranslation();
  const disabled = Boolean(locked || saving);
  const literalLabel = resolveLabel(spec.label);
  // Field-scoped label/help/placeholder/option resolution. Falls back to the
  // manifest literal when no translation is registered, so a host that did not
  // ship a TranslationBundle still renders correctly.
  const fieldLabel = spec.key && labels
    ? labels.fieldLabel(spec.key, literalLabel)
    : literalLabel;
  const fieldHelp = spec.key && labels
    ? labels.fieldHelp(spec.key, spec.description)
    : spec.description;

  // -------- Layout-only --------

  if (spec.type === 'group') {
    const groupTitle = spec.id && labels ? labels.groupTitle(spec.id, literalLabel) : literalLabel;
    const groupDesc = spec.id && labels
      ? labels.groupDescription(spec.id, spec.description)
      : spec.description;
    return (
      <div className="pt-6 pb-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground/90">
          {groupTitle}
        </h3>
        {groupDesc ? (
          <p className="text-xs text-muted-foreground mt-1">{groupDesc}</p>
        ) : null}
        <Separator className="mt-3" />
      </div>
    );
  }

  if (spec.type === 'info_banner') {
    // objectui#12671 — the title and body read the platform's
    // `settings.<namespace>.banners.<id>` slot, keyed by `id` exactly as the
    // `group` arm above keys `groups.<id>`; a miss is the manifest literal.
    const bannerTitle = spec.id && labels ? labels.bannerTitle(spec.id, literalLabel) : literalLabel;
    const bannerText = spec.id && labels
      ? labels.bannerText(spec.id, spec.bannerText)
      : spec.bannerText;
    const warning = spec.bannerSeverity === 'warning';
    const BannerIcon = warning ? AlertTriangle : Info;
    return (
      <Alert
        variant={spec.bannerSeverity === 'error' ? 'destructive' : 'default'}
        className={cn('my-2', warning && WARNING_BANNER_CLASSES)}
      >
        <BannerIcon className="h-4 w-4" />
        <AlertTitle>{bannerTitle}</AlertTitle>
        {bannerText ? (
          <AlertDescription>
            <Suspense fallback={bannerText}>
              <BannerMarkdown schema={{ type: 'markdown', content: bannerText }} />
            </Suspense>
          </AlertDescription>
        ) : null}
      </Alert>
    );
  }

  if (spec.type === 'child_pane') {
    return (
      <a
        href={`#/settings/${spec.childNamespace}`}
        className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 hover:bg-accent transition-colors"
      >
        <div>
          <div className="text-sm font-medium">{literalLabel}</div>
          {spec.description ? (
            <div className="text-xs text-muted-foreground">{spec.description}</div>
          ) : null}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </a>
    );
  }

  if (spec.type === 'title_value') {
    return (
      <div className="flex items-center justify-between py-2">
        <FieldHeader spec={spec} resolved={resolved} labelText={fieldLabel} labels={labels} />
        <span className="text-sm text-muted-foreground">{String(value ?? '—')}</span>
      </div>
    );
  }

  if (spec.type === 'action_button') {
    const Icon = spec.icon ? getLazyIcon(spec.icon) : null;
    const actionId = spec.id ?? spec.key ?? 'test';
    const actionLabel = labels
      ? labels.actionLabel(actionId, literalLabel)
      : literalLabel;
    // One label per action row (objectui#12610): the button carries it. The
    // row's left side holds the manifest's one-line `description` when it
    // declares one, and nothing otherwise — the label is never drawn twice.
    return (
      <div
        className={`flex items-center gap-4 py-3 ${spec.description ? 'justify-between' : 'justify-end'}`}
      >
        {spec.description ? (
          <p className="text-sm text-muted-foreground">{spec.description}</p>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onAction} disabled={saving}>
          {Icon ? (
            // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
            <Icon className="h-4 w-4 mr-1.5" />
          ) : null}
          {actionLabel}
        </Button>
      </div>
    );
  }

  // -------- Inputs --------

  // Wired onto the control itself, not just rendered beside it: `aria-invalid`
  // is what announces "this one was rejected", and `aria-describedby` is what
  // ties the message to the input for a screen reader. Every input type goes
  // through `wrapper`, so marking it here covers all of them at once instead of
  // per-case (objectstack#4224).
  const errorId = `${id}-error`;
  const labelId = `${id}-label`;
  // `labelFor` is the id of the labelable control the row renders — `id`, the
  // one every single-control case puts on it — or `undefined` for a case whose
  // control is a group that names itself from `labelId` instead.
  // A value already cleared in the draft has nothing left to reset.
  const onReset = value === null ? undefined : () => onChange(null);
  // `data-settings-key` lets the page find this row to focus it when a save is
  // blocked on it (objectui#13239).
  const wrapper = (children: React.ReactNode, labelFor: string | undefined = id) => (
    <div className="space-y-1.5 py-2" data-settings-key={spec.key}>
      <FieldHeader
        spec={spec}
        resolved={resolved}
        labelText={fieldLabel}
        labels={labels}
        labelId={labelId}
        htmlFor={labelFor}
        onReset={onReset}
        resetDisabled={disabled}
      />
      {error && isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            'aria-invalid': true,
            'aria-describedby': errorId,
          })
        : children}
      {error ? (
        <FieldError id={errorId} message={error} />
      ) : (
        <FieldDescription description={fieldHelp} />
      )}
    </div>
  );

  const renderOptionLabel = (opt: { value: string | number | boolean; label: any }): string => {
    const literal = typeof opt.label === 'string' ? opt.label : opt.label?.defaultValue ?? String(opt.value);
    if (!spec.key || !labels) return literal;
    return labels.optionLabel(spec.key, String(opt.value), literal);
  };

  switch (spec.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'phone':
      return wrapper(
        <Input
          id={id}
          type={spec.type === 'email' ? 'email' : spec.type === 'url' ? 'url' : 'text'}
          value={(value as string | undefined) ?? ''}
          minLength={spec.minLength}
          maxLength={spec.maxLength}
          pattern={spec.pattern}
          disabled={disabled}
          onChange={(e) => onChange(textOrUnset(e.target.value))}
        />,
      );
    case 'password':
      return wrapper(
        <Input
          id={id}
          type="password"
          autoComplete="new-password"
          placeholder={value ? '••••••••' : ''}
          disabled={disabled}
          onChange={(e) => onChange(textOrUnset(e.target.value))}
        />,
      );
    case 'textarea':
      return wrapper(
        <Textarea
          id={id}
          rows={spec.rows ?? 4}
          value={(value as string | undefined) ?? ''}
          minLength={spec.minLength}
          maxLength={spec.maxLength}
          disabled={disabled}
          onChange={(e) => onChange(textOrUnset(e.target.value))}
        />,
      );
    case 'number':
      return wrapper(
        <Input
          id={id}
          type="number"
          value={value as any}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />,
      );
    case 'toggle':
      return (
        <div className="flex items-center justify-between py-3" data-settings-key={spec.key}>
          <div>
            <FieldHeader
              spec={spec}
              resolved={resolved}
              labelText={fieldLabel}
              labels={labels}
              labelId={labelId}
              htmlFor={id}
              onReset={onReset}
              resetDisabled={disabled}
            />
            {error ? (
              <FieldError id={errorId} message={error} />
            ) : (
              <FieldDescription description={fieldHelp} />
            )}
          </div>
          <Switch
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      );
    case 'select': {
      // Keyed off the DECLARATION, never off the key: a key that gains a
      // domain server-side gets the right control here with no edit.
      //
      // Declared → the standard is the enforcement boundary, so an editable
      // combobox (objectstack#5712). ABSENT → ⛔ the closed dropdown stays
      // exactly as it was: those `options` are still exhaustive (objectstack
      // #5131 semantics — the sms/mail provider selects), and
      // `localization.locale` had its domain declaration deliberately REJECTED
      // in objectstack#6515 because its options ARE the shipped catalogs.
      // Widening those to free input would be a regression wearing this fix's
      // clothes, so the two branches are pinned against each other in
      // `__tests__/SettingsField.valueDomain.test.tsx`.
      if (spec.valueDomain) {
        return wrapper(
          <DomainCombobox
            id={id}
            value={value}
            disabled={disabled}
            onChange={onChange}
            options={(spec.options ?? []).map((opt) => ({
              value: String(opt.value),
              label: renderOptionLabel(opt),
            }))}
          />,
        );
      }
      return wrapper(
        <Select
          value={value == null ? undefined : String(value)}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            {/* No value yet ⇒ the locale's `common.select`, with its en word as
                the inline default so a provider-less mount never shows the
                raw key (objectui#11252). */}
            <SelectValue placeholder={t('common.select', { defaultValue: 'Select…' })} />
          </SelectTrigger>
          <SelectContent>
            {spec.options?.map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                {renderOptionLabel(opt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      );
    }
    case 'radio':
      return wrapper(
        <RadioGroup
          value={value == null ? undefined : String(value)}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
          aria-labelledby={labelId}
        >
          {spec.options?.map((opt) => (
            <div key={String(opt.value)} className="flex items-center space-x-2">
              <RadioGroupItem value={String(opt.value)} id={`${id}-${opt.value}`} />
              <Label htmlFor={`${id}-${opt.value}`} className="text-sm font-normal">
                {renderOptionLabel(opt)}
              </Label>
            </div>
          ))}
        </RadioGroup>,
        undefined,
      );
    case 'multiselect': {
      const arr = Array.isArray(value) ? (value as (string | number)[]) : [];
      return wrapper(
        <div role="group" aria-labelledby={labelId} className="grid grid-cols-2 gap-2">
          {spec.options?.map((opt) => {
            const v = String(opt.value);
            const checked = arr.map(String).includes(v);
            return (
              <label key={v} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(c) => {
                    const next = new Set(arr.map(String));
                    if (c) next.add(v); else next.delete(v);
                    onChange(Array.from(next));
                  }}
                />
                {renderOptionLabel(opt)}
              </label>
            );
          })}
        </div>,
        undefined,
      );
    }
    case 'slider':
      return wrapper(
        <div className="flex items-center gap-3">
          <Slider
            value={[Number(value ?? spec.min ?? 0)]}
            min={spec.min ?? 0}
            max={spec.max ?? 100}
            step={spec.step ?? 1}
            disabled={disabled}
            onValueChange={(v) => onChange(v[0])}
            className="flex-1"
          />
          <span className="text-sm tabular-nums w-12 text-right">{String(value ?? spec.min ?? 0)}</span>
        </div>,
        undefined,
      );
    case 'color':
      return wrapper(
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="color"
            value={(value as string | undefined) ?? '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="w-16 h-9 p-1"
          />
          <Input
            value={(value as string | undefined) ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-labelledby={labelId}
            className="flex-1 font-mono text-sm"
          />
        </div>,
      );
    case 'json':
      return wrapper(
        <Textarea
          id={id}
          rows={spec.rows ?? 6}
          className="font-mono text-xs"
          value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
    default:
      return wrapper(
        <div className="text-sm text-muted-foreground">
          {t('console.settingsView.unsupportedSpecifierType', { type: spec.type })}
        </div>,
        undefined,
      );
  }
}
