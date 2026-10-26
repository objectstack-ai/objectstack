/**
 * <SettingsView> — single namespace renderer.
 *
 * Fetches manifest+values from `/api/settings/:namespace`, lays them
 * out via <SettingsField>, tracks dirty state, and saves through PUT.
 * A successful save or action reads the namespace again, manifest included.
 * Env-locked fields are read-only and show <EnvLockBadge>.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ConsolePageHeader } from '@object-ui/app-shell';
import { Loader2, ArrowLeft, ChevronRight, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button, Card, CardContent, Skeleton, Badge, getLazyIcon } from '@object-ui/components';
import { ExpressionEvaluator } from '@object-ui/core';
import { extractFieldErrors } from '@object-ui/react';
import { useObjectTranslation } from '@object-ui/i18n';
import { SettingsField } from './SettingsField';
import {
  getSettingsNamespace,
  lockedKeyOf,
  runSettingsAction,
  saveSettingsNamespace,
} from './api';
import { resolveLabel, type SettingsNamespacePayload, type Specifier } from './types';
import { useSettingsLabel, type SettingsLabelHelpers } from './useSettingsLabel';
import { useUnsavedLeaveGuard } from './useUnsavedLeaveGuard';

/**
 * Evaluate the manifest's `visible: "${data.foo === 'bar'}"` expression
 * against the live value map, through `@object-ui/core`'s `ExpressionEvaluator`
 * — the CSP-safe interpreter (`SafeExpressionParser`) every other `visible`
 * predicate in the renderer is judged by, never a compiled JS function. The
 * manifest's values are bound as `data`, the one namespace the server's
 * settings grammar reads too.
 *
 * Fails CLOSED: a predicate that does not evaluate hides the setting, the way
 * the server refuses a save whose `visible` it cannot parse. Showing a field
 * the deployment never meant to expose is the worse of the two mistakes.
 */
function evalVisibility(expr: string | undefined, data: Record<string, unknown>): boolean {
  if (!expr) return true;
  try {
    return new ExpressionEvaluator({ data }).evaluateCondition(expr, { throwOnError: true });
  } catch {
    return false;
  }
}

/** `{ ...rest }` without `key`, returned as a new object so React sees the change. */
function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = map;
  return rest;
}

/**
 * A `SETTINGS_CRYPTO_UNAVAILABLE` refusal, as this view renders it
 * (objectstack#8273, PR objectstack#8396).
 *
 * The deployment has nothing able to encrypt a key the manifest declares
 * encrypted, so the write was REFUSED rather than quietly stored in the clear.
 * That is a property of the deployment, not of the value — which is why the
 * envelope locates the refusal (`details: { namespace, key }`) and never
 * carries the value itself.
 */
interface CryptoRefusal {
  /** `namespace.key` — the refused key, as located by `error.details`. */
  subject?: string;
  /**
   * The server's own sentence, carrying the operator prescription (wire
   * `SettingsServicePluginOptions.cryptoProvider`, or configure a real crypto
   * adapter). Rendered verbatim and never restated here: the server owns this
   * copy, and a second wording is how the two drift into disagreeing about how
   * to fix the deployment. Absent when the body carried no message — the
   * console renders nothing rather than inventing a prescription.
   */
  prescription?: string;
}

/**
 * Read the refusal out of the declared `error.details` slot.
 *
 * Deliberately inline rather than beside `lockedKeyOf` in `api.ts`: that helper
 * lives there because it is a dual-position COMPAT SHIM, reading the declared
 * `details.key` *and* the pre-objectstack#4224 `error.key` sibling. This code is
 * new in #8396 and has exactly one declared position, so there is no second
 * shape to reconcile and nothing for the wire-shape module to own.
 */
function cryptoRefusalOf(apiError: unknown): CryptoRefusal {
  const e = (apiError ?? {}) as {
    message?: unknown;
    details?: { namespace?: unknown; key?: unknown } | null;
  };
  const nonEmpty = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const details = e.details && typeof e.details === 'object' ? e.details : undefined;
  const namespace = nonEmpty(details?.namespace);
  const key = nonEmpty(details?.key);
  return {
    subject: key ? (namespace ? `${namespace}.${key}` : key) : undefined,
    prescription: nonEmpty(e.message),
  };
}

/**
 * The settings a refused save names, by the label each row draws
 * (objectui#13146): the manifest literal, through the same
 * `labels.fieldLabel` lookup `SettingsField` renders, so the toast and the row
 * call a setting by the same name in every pack.
 *
 * The refusal's `field` is the machine key and is never shown. The server's
 * `FieldError.label` is not read either: the settings service fills it with
 * the manifest literal, untranslated, so it would name the setting differently
 * from its row in any pack that translates the label. A key no specifier on
 * this page declares, or one whose label resolves empty, is left out: the page
 * has no product name for it, and its row (if any) carries its own message.
 * Order is the refusal's, which is the manifest's.
 */
function refusedSettingLabels(
  refused: ReadonlyArray<{ field: string }>,
  specifiers: ReadonlyArray<Specifier>,
  labels: SettingsLabelHelpers,
): string[] {
  const named: string[] = [];
  const seen = new Set<string>();
  for (const { field } of refused) {
    if (seen.has(field)) continue;
    seen.add(field);
    const spec = specifiers.find((s) => s.key === field);
    if (!spec) continue;
    const label = labels.fieldLabel(field, resolveLabel(spec.label));
    if (label) named.push(label);
  }
  return named;
}

/**
 * Specifier types that draw no value of their own: a `required` on one of
 * these names nothing an admin can fill, so the pre-save check skips it.
 */
const NON_INPUT_TYPES = new Set(['group', 'info_banner', 'child_pane', 'title_value', 'action_button']);

/**
 * The empty test the settings service applies to a `required` key: null,
 * undefined, or a string that is blank once trimmed. `false` and `0` are
 * values. Kept to the server's own predicate so the page and the server never
 * disagree about what "filled" means.
 */
function isEmptySettingValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * The value format each format-bearing specifier TYPE declares (objectui#13287):
 * ADR-0007's specifier table, "`email` / `url` / `phone` | typed input | string
 * | format validation" and "`color` | colour picker | hex string".
 *
 * Each grammar is the settings service's own, `DECLARED_VALUE_FORMATS` in
 * objectstack's `service-settings` (objectstack#24882), which refuses a miss at
 * the save door with one `FieldError` per key. Kept to the server's grammar so
 * the page never blocks a value the server and its readers accept, nor lets
 * through one the server will refuse:
 *
 *  - `email` — `local@domain` with a dotted domain.
 *  - `url` — `scheme://…`, a root-relative `/path`, a `data:` URI or a
 *    `blob:` URL (`branding.logo_url`'s reader takes absolute or relative).
 *  - `phone` — digits, spaces and `+ ( ) - .` only, at least 5 characters.
 *  - `color` — CSS hex, `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 *
 * A `Map`, so a type spelled like an `Object.prototype` member looks up nothing.
 */
const DECLARED_VALUE_FORMATS: ReadonlyMap<string, RegExp> = new Map([
  ['email', /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/],
  ['url', /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|\/\S*|data:\S+|blob:\S+)$/i],
  ['phone', /^[+()\-\s\d.]{5,}$/],
  ['color', /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i],
]);

/**
 * True when `value` misses the format its specifier `type` declares. A type
 * with no declared format, a non-string value, or an empty one passes: "no
 * value" is the `required` rule's business. Judged trimmed, as the server
 * judges it.
 */
function missesDeclaredFormat(type: string, value: unknown): boolean {
  const re = DECLARED_VALUE_FORMATS.get(type);
  if (!re || typeof value !== 'string' || value.trim() === '') return false;
  return !re.test(value.trim());
}

/** Why the page blocked a save on one key: an empty `required`, or a format miss. */
type PreSaveBlock = { key: string; rule: 'required' | 'format'; type: string };

/**
 * The visible keys a save is blocked on, in manifest order: a `required` key
 * that holds no value (objectui#13239), or a value that misses the format its
 * type declares (objectui#13287). The spec declares `required` as "renderer +
 * server-side validation"; the server judges only the keys a save touches, so a
 * required key nobody edited is the renderer's half to check.
 *
 * - Visibility is the same `evalVisibility` reading the page renders by, over
 *   the live values (draft over stored): a hidden key is not checked.
 * - The value judged is the effective one: the draft's when the key is in it,
 *   the stored value otherwise. A set secret reads back as the mask, so it
 *   counts as filled.
 * - A locked row is not checked. An env lock reads back as `locked: true` with
 *   the environment's value in `value`, and the row's control is disabled, so
 *   nothing on this page could fill or fix it either way.
 */
function preSaveBlocks(
  specifiers: ReadonlyArray<Specifier>,
  values: SettingsNamespacePayload['values'],
  draft: Record<string, unknown>,
  liveValues: Record<string, unknown>,
): PreSaveBlock[] {
  const blocks: PreSaveBlock[] = [];
  for (const spec of specifiers) {
    const key = spec.key;
    if (!key || NON_INPUT_TYPES.has(spec.type)) continue;
    if (!evalVisibility(spec.visible, liveValues)) continue;
    const resolved = values[key];
    if (resolved?.locked) continue;
    const effective = key in draft ? draft[key] : resolved?.value;
    if (spec.required && isEmptySettingValue(effective)) {
      blocks.push({ key, rule: 'required', type: spec.type });
    } else if (missesDeclaredFormat(spec.type, effective)) {
      blocks.push({ key, rule: 'format', type: spec.type });
    }
  }
  return blocks;
}

export function SettingsView() {
  const params = useParams<{ namespace?: string }>();
  const navigate = useNavigate();
  // objectui#4024 — the same convention the sibling `SettingsHub.tsx` already
  // uses (`useObjectTranslation` + `console.settings*`), rather than
  // `createSafeTranslation`: this is an app screen, not a published primitive
  // with provider-less consumers to keep green, and its own suites mount a
  // provider or pin the key-literal behaviour explicitly.
  const { t } = useObjectTranslation();
  const namespace = params.namespace ?? '';

  const [payload, setPayload] = useState<SettingsNamespacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /**
   * The last load's failure, or null. `message` is the server's own sentence
   * when it sent one; without one the card shows `console.settingsView.loadError`,
   * translated at render so the fetch below reads no `t` (objectui#13254).
   */
  const [error, setError] = useState<{ message?: string } | null>(null);
  /** Live edit map keyed by spec.key. Falls back to resolved value when undefined. */
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  /**
   * Per-field rejections from the last failed save, keyed by field name
   * (objectstack#4224). Empty until a save comes back `SETTINGS_VALIDATION`.
   *
   * Before #4224 the server sent this as a `Record<key, message>` hung beside
   * `error.code`, which `extractFieldErrors` could not read — so the whole
   * batch collapsed into one toast that named no field. It now arrives as the
   * declared `FieldError[]` under `error.details.fields`.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * The last save's fail-closed crypto refusal, or null (objectui#4570).
   *
   * Unlike `fieldErrors` this deliberately does NOT clear when the key is
   * edited. A field error describes the VALUE the server saw, so typing
   * contradicts it; this describes the DEPLOYMENT's inability to encrypt, which
   * typing does not change. It clears when that claim can actually have become
   * false: a new save attempt, a save that succeeds, a discard, or a reload.
   */
  const [cryptoRefusal, setCryptoRefusal] = useState<CryptoRefusal | null>(null);
  /**
   * The row a blocked save moves focus to (objectui#13239). A fresh object per
   * request, so a second blocked save on the same key focuses it again.
   */
  const [focusKey, setFocusKey] = useState<{ key: string } | null>(null);
  const fieldListRef = useRef<HTMLDivElement>(null);
  /**
   * Counts the reads this page starts (objectui#13382). A read applies its
   * payload only while it is still the latest one, so a re-read that resolves
   * after a namespace change, or after a newer re-read, is dropped.
   */
  const readSeqRef = useRef(0);

  useEffect(() => {
    if (!focusKey) return;
    const row = Array.from(
      fieldListRef.current?.querySelectorAll<HTMLElement>('[data-settings-key]') ?? [],
    ).find((el) => el.dataset.settingsKey === focusKey.key);
    if (!row) return;
    // The control the row's label names, else the row's first focusable
    // control (a radio or checkbox group names itself from its label instead).
    const labelFor = row.querySelector('label[for]')?.getAttribute('for');
    const target =
      (labelFor ? row.ownerDocument.getElementById(labelFor) : null) ??
      row.querySelector<HTMLElement>(
        'input:not([type="hidden"]), textarea, [role="combobox"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"]',
      );
    target?.focus();
  }, [focusKey]);

  // objectui#13254 — the load is keyed on the namespace and nothing else. It
  // was a `useCallback` over `[namespace, t]` that this effect depended on, so
  // every new `t` re-ran it and the success path below dropped the draft in
  // place: i18next hands out a new `t` on a language switch and on every write
  // to its store. AGENTS.md #10: an effect never keys on a memoised identity.
  // The draft resets when the namespace changes, on save and on discard.
  useEffect(() => {
    if (!namespace) return;
    // A re-read still in flight for the namespace being left is now stale.
    readSeqRef.current += 1;
    const loadNamespace = async () => {
      setLoading(true);
      setError(null);
      try {
        const p = await getSettingsNamespace(namespace);
        setPayload(p);
        setDraft({});
        setFieldErrors({});
        setCryptoRefusal(null);
      } catch (err: any) {
        setError({ message: err?.message });
      } finally {
        setLoading(false);
      }
    };
    void loadNamespace();
  }, [namespace]);

  /** Effective live values for visibility expressions. */
  const liveValues = useMemo(() => {
    const v: Record<string, unknown> = {};
    if (!payload) return v;
    for (const [k, r] of Object.entries(payload.values)) v[k] = r.value;
    return { ...v, ...draft };
  }, [payload, draft]);

  const dirtyKeys = useMemo(() => Object.keys(draft), [draft]);

  /** i18n helpers bound to this settings namespace. */
  const labels = useSettingsLabel(namespace);

  // objectui#13163 — leaving the page asks first while it holds edits. Armed
  // exactly while the "N unsaved changes" bar is drawn: a loaded page, not the
  // skeleton or the error card. A draft outlives its page only across a
  // Back/Forward between two namespaces (the guard cannot see `popstate`); it
  // is then not on screen, so the skeleton and the error card must not prompt
  // for it — which is also why the error card's Back needs no guard. The
  // sentence is the existing `form.unsavedChanges` leave question.
  const hasUnsavedEdits =
    payload !== null && !loading && error === null && dirtyKeys.length > 0;
  const confirmLeave = useUnsavedLeaveGuard(hasUnsavedEdits, t('form.unsavedChanges'));

  if (!namespace) {
    return (
      <div className="p-6 text-muted-foreground">{t('console.settingsView.noNamespace')}</div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {t('console.settingsView.back')}
        </Button>
        <Card className="mt-3">
          <CardContent className="py-8 text-center text-sm text-destructive">
            {error.message ?? t('console.settingsView.loadError')}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!payload) return null;

  const { manifest, values } = payload;
  const Icon = manifest.icon ? getLazyIcon(manifest.icon) : null;
  const title = labels.title(resolveLabel(manifest.label));
  const description = labels.description(manifest.description);

  /**
   * Read the namespace again after a successful save or action and take the
   * whole payload, manifest included (objectui#13382). The server computes
   * parts of the manifest on every read: objectstack#25448 puts a live-status
   * `info_banner` (id `live_status`) first in `manifest.specifiers`, and a
   * save can change what it says. The PUT answers values only, so without
   * this the banner kept the first load's text until a reload.
   *
   * The draft, field errors and crypto refusal are left alone: the caller
   * decides those. `loading` is not flipped, so the form does not flash its
   * placeholder. A failed re-read keeps what is on screen: the save or action
   * itself succeeded, so the page must not turn into an error.
   */
  const reread = async (ns: string) => {
    const seq = ++readSeqRef.current;
    try {
      const fresh = await getSettingsNamespace(ns);
      if (readSeqRef.current === seq) setPayload(fresh);
    } catch {
      // Keep the page as it is; the next load or save reads again.
    }
  };

  const onSave = async () => {
    if (dirtyKeys.length === 0) return;
    // objectui#13239 — a visible required field left empty blocks the save
    // here: no request goes out, each such row is marked through the same
    // field-error slot a server refusal uses, and focus moves to the first.
    // objectui#13287 — a value that misses its type's declared format blocks
    // the same way, with one message per format naming what is expected.
    const blocked = preSaveBlocks(manifest.specifiers, values, draft, liveValues);
    if (blocked.length > 0) {
      const messageFor = ({ rule, type }: PreSaveBlock): string => {
        if (rule === 'required') return t('form.fieldRequired');
        if (type === 'email') return t('validation.email');
        if (type === 'url') return t('validation.url');
        if (type === 'phone') return t('console.settingsView.invalidPhone');
        return t('console.settingsView.invalidColor');
      };
      setFieldErrors(Object.fromEntries(blocked.map((b) => [b.key, messageFor(b)])));
      setFocusKey({ key: blocked[0].key });
      const named = refusedSettingLabels(
        blocked.map(({ key }) => ({ field: key })),
        manifest.specifiers,
        labels,
      );
      if (named.length > 0) {
        toast.error(
          t('console.settingsView.fieldErrorsToast', {
            count: named.length,
            settings: named.join(t('validation.formInvalidJoiner')),
          }),
        );
      }
      return;
    }
    setSaving(true);
    // Each attempt re-derives the refusal from scratch, so the panel always
    // reflects THIS save's verdict rather than a stale one from a previous try.
    setCryptoRefusal(null);
    try {
      const res = await saveSettingsNamespace(namespace, draft);
      setPayload({ ...payload, values: { ...values, ...res.values } });
      setDraft({});
      setFieldErrors({});
      toast.success(t('console.settingsView.saved'));
      void reread(namespace);
    } catch (err: any) {
      const apiError = err?.payload?.error;
      if (apiError?.code === 'SETTINGS_LOCKED') {
        // `lockedKeyOf` reads both wire positions — see its note (objectstack#4224).
        const key = lockedKeyOf(apiError);
        // Parameterized, not concatenated: the key is spliced INTO the
        // sentence, so a pack can place it where its own grammar wants.
        toast.error(
          key
            ? t('console.settingsView.lockedByEnv', { key })
            : t('console.settingsView.lockedByEnvNoKey'),
        );
      } else if (apiError?.code === 'SETTINGS_CRYPTO_UNAVAILABLE') {
        // The deployment cannot encrypt a declared-secret key, so the write was
        // refused (objectstack#8396). This is neither a per-field rejection nor
        // a transient failure the user can retry their way out of — it stays on
        // screen as its own state, carrying the server's prescription, until
        // the deployment is reconfigured.
        //
        // The toast mirrors SETTINGS_LOCKED above: a code-specific sentence
        // naming the subject, not the generic `err.message`. It fires for the
        // same reason the validation branch's does — the panel can be scrolled
        // out of view, and a save that silently does nothing is the worse
        // failure.
        const refusal = cryptoRefusalOf(apiError);
        setCryptoRefusal(refusal);
        toast.error(
          refusal.subject
            ? t('console.settingsView.cryptoRefusalToast', { subject: refusal.subject })
            : t('console.settingsView.cryptoRefusalToastNoSubject'),
        );
      } else {
        // Per-field rejections render against the inputs that caused them
        // (objectstack#4224). `extractFieldErrors` reads `details.fields`, so it
        // is handed `error` — the object that carries `details` — not the
        // whole body.
        //
        // The toast still fires: the offending field can be scrolled out of
        // view, or hidden behind a `visible` expression, and a save that
        // silently does nothing is the worse failure.
        //
        // With per-field rejections the toast names the settings by their
        // labels and leaves the reasons to the rows (objectui#13146). The
        // server's summary sentence (`SettingsValidationError.message`) is
        // written for logs: it leads with the namespace and each machine key,
        // calls every refusal "incomplete" even for a malformed value, and
        // repeats each row's whole message, help text included.
        // `{{settings}}` is the labels joined with the pack's own list
        // separator, the one the record form's field lists use.
        const perField = extractFieldErrors(apiError);
        if (perField?.length) {
          setFieldErrors(Object.fromEntries(perField.map((f) => [f.field, f.message])));
          const named = refusedSettingLabels(perField, manifest.specifiers, labels);
          toast.error(
            named.length > 0
              ? t('console.settingsView.fieldErrorsToast', {
                  count: named.length,
                  settings: named.join(t('validation.formInvalidJoiner')),
                })
              : t('console.settingsView.saveFailed'),
          );
        } else {
          // Not field-scoped (a 403, an unknown key, a server fault): the
          // server's sentence is the only account of what happened.
          toast.error(err?.message ?? t('console.settingsView.saveFailed'));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const onAction = async (actionId: string) => {
    setSaving(true);
    try {
      const result = await runSettingsAction(namespace, actionId, draft);
      if (result.ok) {
        toast.success(result.message ?? t('console.settingsView.actionSucceeded'));
        // An action does not save the draft, so the draft stays as it is.
        void reread(namespace);
      } else {
        toast.error(result.message ?? t('console.settingsView.actionFailed'));
      }
    } catch (err: any) {
      toast.error(err?.message ?? t('console.settingsView.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
    {/* The console's one page header (objectui#12553), the one an object list,
        a dashboard and the Approvals Inbox draw: the namespace's icon chip
        (when its manifest names an icon), the title, and the description
        beside the title from `sm` up — under it inside Setup (objectui#12606).
        The Beta badge rides in the title node beside the name. "All settings"
        is the description line's first crumb (objectui#12606); it sat at the
        top of the body before. Below `sm` the one-row header hides the
        description line. */}
    <ConsolePageHeader
      title={
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{title}</span>
          {manifest.beta ? (
            // `settingsHub.beta`, not a settingsView twin: it is the same
            // release-stage badge on the same feature, and zh deliberately
            // keeps it Latin (allowlisted in untranslated-identity-4376).
            // A second key would be one more thing to keep in step.
            <Badge variant="secondary">{t('console.settingsHub.beta')}</Badge>
          ) : null}
        </span>
      }
      subtitle={description}
      breadcrumb={
        <span className="mr-1.5 inline-flex items-center gap-1 align-top">
          <button
            type="button"
            className="hover:text-foreground hover:underline"
            onClick={() => confirmLeave(() => navigate('/system/settings'))}
            data-testid="settings-breadcrumb-hub"
          >
            {t('console.settingsView.backToHub')}
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        </span>
      }
      icon={
        Icon ? (
          // eslint-disable-next-line react-hooks/static-components -- getLazyIcon returns a module-cached stable component per name, not one created during render
          <Icon className="h-4 w-4" />
        ) : undefined
      }
    />
    <div className="p-6 max-w-3xl mx-auto pb-32">
      {manifest.helpText ? (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{manifest.helpText}</p>
      ) : null}

      {cryptoRefusal ? (
        <Card className="mt-4 border-destructive/50 bg-destructive/5">
          <CardContent className="py-4">
            <div role="alert" className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-destructive">
                  {t('console.settingsView.cryptoRefusalTitle')}
                </p>
                <p className="mt-1">
                  {cryptoRefusal.subject ? (
                    <>
                      <code className="font-mono text-xs">{cryptoRefusal.subject}</code>{' '}
                      {t('console.settingsView.cryptoRefusalSubjectSuffix')}
                    </>
                  ) : (
                    t('console.settingsView.cryptoRefusalNoSubject')
                  )}
                </p>
                {cryptoRefusal.prescription ? (
                  <p className="mt-2 text-muted-foreground whitespace-pre-wrap">
                    {cryptoRefusal.prescription}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 divide-y" ref={fieldListRef}>
        {manifest.specifiers
          .filter((spec) => evalVisibility(spec.visible, liveValues))
          .map((spec, idx) => {
            const key = spec.key;
            const resolved = key ? values[key] : undefined;
            const current = key ? (key in draft ? draft[key] : resolved?.value) : undefined;
            return (
              <SettingsField
                key={(key ?? `_layout_${idx}`) + idx}
                spec={spec}
                resolved={resolved}
                value={current}
                onChange={(v) => {
                  if (!key) return;
                  setDraft((d) => ({ ...d, [key]: v }));
                  // Clear this field's rejection the moment it is edited. The
                  // error describes the value the server saw, so keeping it on
                  // screen while the user types contradicts what is in the box —
                  // and the next save re-derives the set from scratch anyway.
                  setFieldErrors((e) => (key in e ? omitKey(e, key) : e));
                }}
                onAction={spec.type === 'action_button' ? () => onAction(spec.id ?? key ?? 'test') : undefined}
                locked={resolved?.locked}
                saving={saving}
                labels={labels}
                error={key ? fieldErrors[key] : undefined}
              />
            );
          })}
      </div>

      {dirtyKeys.length > 0 ? (
        <div className="fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t shadow-lg z-40">
          <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
            {/* i18next's plural mechanism, NOT an English `change(s)`: the
                count picks the pack's own plural slot, and the base key serves
                every CLDR category a pack does not enumerate (objectui#3863) —
                which is what keeps `ru` Russian at 2 and 5. */}
            <div className="text-sm text-muted-foreground" data-testid="settings-unsaved-count">
              {t('console.settingsView.unsavedCount', { count: dirtyKeys.length })}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft({});
                  // Discarding reverts to the stored values, so rejections of
                  // the edits being thrown away go with them.
                  setFieldErrors({});
                  setCryptoRefusal(null);
                }}
                disabled={saving}
              >
                <RotateCcw className="h-4 w-4 mr-1" /> {t('console.settingsView.discard')}
              </Button>
              <Button onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                {t('console.settingsView.saveChanges')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
