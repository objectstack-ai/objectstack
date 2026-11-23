// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <FirstRunChecklist> — what an administrator sets up first (objectstack#30206),
 * drawn from the one set of reads `FirstRunChecklistProvider` makes
 * (`firstRunChecklistState.tsx`). It replaces the dialog that asked for the
 * workspace timezone and default currency on the first screens (objectui#11758,
 * objectstack#28872).
 *
 * ## Where it is drawn (`placement`)
 *
 * - `popover`: opened in place from the sidebar's 「Get started n/m」 pill
 *   (`FirstRunChecklistPill`), in every app, while a required row is left
 *   (objectstack#36739). Done rows fold away; its X only closes the popover,
 *   and 「Hide on this device」 under the list hides the pill and Home's card.
 * - `setupPage`: the top of the Setup app's first page (objectstack#36732),
 *   handed to app-shell's `SetupFirstPageSlotProvider` by the console's app
 *   route. The FULL list, done rows included, so an administrator can look
 *   back at it: it is drawn whether or not the list is finished or hidden on
 *   this device, and once the required rows are done it folds to one line that
 *   opens the list again.
 * - `top` and `afterApps`: Home's checklist slot (app-shell's `HomePage`): on a
 *   desktop that is the no-apps empty state, on a phone the card after the apps
 *   (`afterApps`, which starts folded to one line, objectstack#34596). Both
 *   stand aside once the required rows are done or the checklist was hidden.
 *   Above the page (`top`), with two rows left or fewer, the card folds to one
 *   line: its title, its progress, each row left by its title and a Set button.
 *
 * Nothing is drawn for a session the checklist is not for: a member, or one
 * whose answers have not arrived (`useFirstRunChecklist` answers `null`).
 *
 * ## The rows
 *
 * Each row's done state is read from the real setting, never from a click
 * (`checklistRows`); the required ones come first.
 *
 *   1. The organization's basics, the ONE required platform row
 *      (objectstack#36739): its name, default language and country, time zone
 *      and currency, in one form saved by one button. The name is written
 *      through the organization (`updateOrganization`), the other four through
 *      the Settings page's own write (`saveSettingsNamespace('localization')`,
 *      one `PUT /api/settings/localization`, judged against the manifest's
 *      `writePermission` and audited like any settings save). The browser only
 *      PRE-FILLS the four keys (objectui#11693 B2): nothing is written until the
 *      administrator presses Save. Done once the organization carries a name of
 *      its own and every key is set.
 *   2. Email delivery (objectstack#32643), 3. invite colleagues, 4. the
 *      built-in AI (`live.provider`, never the saved value), 5. connect an
 *      external AI assistant (`useConnectedAccess`; while it is drawn and not
 *      done it claims Home's `connect_assistant` item). All OPTIONAL: each says
 *      so, ticks itself from the real records, and never holds the checklist
 *      open. Each links to the Setup page where it is done.
 *
 * A host adds rows through its profile (`firstRunChecklistProfile.ts`, selected
 * by `features.cloudManaged`): on a managed environment 「Put your first app
 * in」 (required) and 「Add your first record」 (optional), and the mail row
 * only once it reads delivering.
 *
 * The progress counts every row drawn; the checklist is finished once its
 * REQUIRED rows are done (`checklistCompletion`), and comes back on its own if
 * a setting is unset again.
 *
 * Language and country are named in the page's language (`Intl.DisplayNames`),
 * not by the setting's option label: the language options are autonyms.
 *
 * ## The writes
 *
 * Save writes only what changed: the name when it differs, and the keys whose
 * value is not already the key's own (an unset key is written even when the
 * offer equals its default, which is what makes it set). Refusals land where
 * the Settings page puts them: a lock names the key, a validation refusal goes
 * to the field's error slot (in the console's words for a format miss,
 * `settingsFieldRefusals`), anything else carries the server's sentence.
 * Cancel writes nothing; neither does hiding the checklist.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Circle, Loader2, X } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { appRouteSegment, useHomeItemClaim } from '@object-ui/app-shell';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { SettingsField } from './SettingsField';
import { lockedKeyOf, saveSettingsNamespace } from './api';
import { fieldWording, settingsFieldRefusals } from './settingsFieldRefusals';
import { resolveLabel, type ResolvedSettingValue, type Specifier } from './types';
import { useSettingsLabel, type SettingsLabelHelpers } from './useSettingsLabel';
import {
  AI_NAMESPACE,
  AI_PROVIDER_KEY,
  COUNTRY_KEY,
  CURRENCY_KEY,
  LOCALE_KEY,
  LOCALIZATION_NAMESPACE,
  drawsOneLine,
  isOrganizationNamed,
  type ChecklistField,
  type OrganizationBasics,
} from './firstRunChecklistLogic';
import { useFirstRunChecklist, type ChecklistRowState, type FirstRunChecklistData } from './firstRunChecklistState';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A currency's name in `language`, or `undefined` where `Intl.DisplayNames` cannot answer. */
function currencyName(language: string, code: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([language], { type: 'currency' }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A language or region's name in `language`, or `undefined` where `Intl.DisplayNames` cannot answer. */
function displayName(language: string, type: 'language' | 'region', code: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([language], { type }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A field's value as the row names it: the currency by its name and code, the
 * language and the country by their names in the page's language, any other
 * key by its option's translated label, else the value itself.
 */
function describeValue(field: ChecklistField, value: string, labels: SettingsLabelHelpers, language: string): string {
  if (field.key === CURRENCY_KEY) {
    const name = currencyName(language, value);
    return name ? `${name} (${value})` : value;
  }
  if (field.key === LOCALE_KEY || field.key === COUNTRY_KEY) {
    const name = displayName(language, field.key === LOCALE_KEY ? 'language' : 'region', value);
    if (name) return name;
  }
  const option = (field.spec.options ?? []).find((o) => String(o.value) === value);
  return option ? labels.optionLabel(field.key, value, resolveLabel(option.label)) : value;
}

/** The current value of a field, as a string, or `''` when it holds none. */
function currentValue(resolved: ResolvedSettingValue): string {
  const value = resolved.value;
  return value === null || value === undefined ? '' : String(value);
}

/** One row of the list: its mark, its title and line, its action, and an optional editor below. */
function ChecklistRow({
  id,
  done,
  optional = false,
  title,
  detail,
  action,
  children,
}: {
  id: string;
  done: boolean;
  /** The row may be left undone: the profile's answer (`isProfileOptionalRow`). */
  optional?: boolean;
  title: string;
  detail?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useObjectTranslation();
  return (
    <li
      className="flex items-start gap-3 py-3"
      data-testid={`first-run-checklist-row-${id}`}
      data-done={done ? 'true' : 'false'}
      data-optional={optional ? 'true' : undefined}
    >
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done && 'text-muted-foreground')}>
          {title}
          {optional ? (
            <span
              className="ml-2 rounded-full border border-border px-1.5 py-px align-middle text-xs font-normal text-muted-foreground"
              data-testid={`first-run-checklist-optional-${id}`}
            >
              {t('console.firstRunChecklist.optional')}
            </span>
          ) : null}
        </p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/** A row's action that opens a page. */
function RowLink({ to, label, testId }: { to: string; label: string; testId: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={to} data-testid={testId}>
        {label}
      </Link>
    </Button>
  );
}

/** The line under the basics row's title: the five values once done, else what the form holds. */
function basicsDetail(
  basics: OrganizationBasics,
  name: string,
  labels: SettingsLabelHelpers,
  language: string,
  t: Translate,
): string {
  if (!basics.done) return t('console.firstRunChecklist.organizationBasics.todo');
  const values = basics.fields.map((field) => describeValue(field, currentValue(field.resolved), labels, language));
  return [name, ...values].join(t('validation.formInvalidJoiner'));
}

type FieldErrors = Record<string, string | undefined>;

/** The organization name's key in the form: not a settings key, never sent to the settings door. */
const NAME_FIELD = 'organization_name';

/**
 * The basics form: the organization's name and the Settings page's own field
 * for each localization key, pre-filled with the current value of a set key or
 * the browser's offer for an unset one; one Save and Cancel.
 */
function OrganizationBasicsEditor({
  data,
  labels,
  onDone,
}: {
  data: FirstRunChecklistData;
  labels: SettingsLabelHelpers;
  onDone: () => void;
}) {
  const { t } = useObjectTranslation();
  const { updateOrganization } = useAuth();
  const basics = data.readings.basics;
  const [name, setName] = useState(() => (basics.named ? data.organizationName : ''));
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      basics.fields.map((field) => [field.key, field.set ? currentValue(field.resolved) : field.offer ?? '']),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // The keys Save writes: a field holding a value that is not already the
  // key's own. A field the server already holds that is cleared here is left
  // as it is; one it holds no value for is required (`onSave`).
  const changes: Record<string, string> = {};
  for (const field of basics.fields) {
    const draft = drafts[field.key] ?? '';
    if (draft === '') continue;
    if (field.set && draft === currentValue(field.resolved)) continue;
    changes[field.key] = draft;
  }
  const trimmed = name.trim();
  const renames = trimmed !== '' && trimmed !== data.organizationName.trim();
  const hasChanges = renames || Object.keys(changes).length > 0;
  const specifiers = basics.fields.map((field) => field.spec);
  const nameSpec: Specifier = {
    type: 'text',
    key: NAME_FIELD,
    label: t('console.firstRunChecklist.organizationBasics.name'),
    maxLength: 120,
  };

  const onSave = async () => {
    if (saving) return;
    // The row is done only with a name of the organization's own: the name the
    // platform created it with does not count, so it is not accepted here.
    // The row is done only once every setting holds a value too, so a field
    // the server holds no value for and the browser offered none for (an
    // `es-419` browser names no country, so no currency either) is required
    // here like the name: Save never reports 「saved」 and closes while the
    // row it was opened from stays undone.
    const missing: FieldErrors = {};
    if (!isOrganizationNamed(trimmed)) {
      missing[NAME_FIELD] = t('console.firstRunChecklist.organizationBasics.nameRequired');
    }
    for (const field of basics.fields) {
      if (!field.set && (drafts[field.key] ?? '') === '') missing[field.key] = t('form.fieldRequired');
    }
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }
    if (!hasChanges) {
      onDone();
      return;
    }
    setSaving(true);
    setFieldErrors({});
    try {
      if (renames) {
        try {
          await updateOrganization(data.orgId, { name: trimmed });
        } catch (err) {
          const message = (err as { message?: string } | undefined)?.message;
          setFieldErrors({ [NAME_FIELD]: message || t('console.settingsView.saveFailed') });
          toast.error(message || t('console.settingsView.saveFailed'));
          return;
        }
      }
      if (Object.keys(changes).length > 0) {
        try {
          const res = await saveSettingsNamespace(LOCALIZATION_NAMESPACE, changes);
          data.localizationSaved(res.values);
        } catch (err) {
          // The Settings page's own reading of a refused save, for the keys
          // this form writes. `api.ts` parks the raw error body on `err.payload`.
          const failure = err as { message?: string; payload?: { error?: { code?: unknown } } } | undefined;
          const apiError = failure?.payload?.error;
          if (apiError?.code === 'SETTINGS_LOCKED') {
            const key = lockedKeyOf(apiError);
            toast.error(
              key ? t('console.settingsView.lockedByEnv', { key }) : t('console.settingsView.lockedByEnvNoKey'),
            );
          } else {
            const refused: FieldErrors = {};
            const perField = settingsFieldRefusals(apiError, specifiers, fieldWording(labels), t);
            for (const f of perField ?? []) {
              if (basics.fields.some((field) => field.key === f.field)) refused[f.field] = f.message;
            }
            setFieldErrors(refused);
            toast.error(
              Object.keys(refused).length > 0
                ? t('console.settingsView.fieldErrorsToast', {
                    count: Object.keys(refused).length,
                    settings: basics.fields
                      .filter((field) => refused[field.key])
                      .map((field) => labels.fieldLabel(field.key, resolveLabel(field.spec.label)))
                      .join(t('validation.formInvalidJoiner')),
                  })
                : failure?.message ?? t('console.settingsView.saveFailed'),
            );
          }
          return;
        }
      }
      toast.success(t('console.firstRunChecklist.organizationBasics.saved'));
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3" data-testid="first-run-checklist-editor-organization_basics">
      <SettingsField
        spec={nameSpec}
        value={name}
        onChange={(next) => {
          setName(next == null ? '' : String(next));
          setFieldErrors((prev) => ({ ...prev, [NAME_FIELD]: undefined }));
        }}
        saving={saving}
        error={fieldErrors[NAME_FIELD]}
      />
      {basics.fields.map((field) => (
        <SettingsField
          key={field.key}
          spec={field.spec}
          resolved={field.resolved}
          value={drafts[field.key] ?? ''}
          onChange={(next) => {
            setDrafts((prev) => ({ ...prev, [field.key]: next == null ? '' : String(next) }));
            setFieldErrors((prev) => ({ ...prev, [field.key]: undefined }));
          }}
          saving={saving}
          locked={field.resolved.locked}
          labels={labels}
          error={fieldErrors[field.key]}
        />
      ))}
      <p className="text-xs text-muted-foreground">{t('console.firstRunChecklist.organizationBasics.prefilled')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving} data-testid="first-run-checklist-save-organization_basics">
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {t('console.firstRunChecklist.organizationBasics.save')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDone}
          disabled={saving}
          data-testid="first-run-checklist-cancel-organization_basics"
        >
          {t('console.firstRunChecklist.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Where the checklist is drawn; see the module doc. */
export type FirstRunChecklistPlacement = 'top' | 'afterApps' | 'setupPage' | 'popover';

/**
 * One row as the checklist draws it: the full row (`node`), and what the
 * one-line form draws of it, its title and where its Set goes (a page to open,
 * or the basics form to open in the full card).
 */
interface ChecklistDrawnRow extends ChecklistRowState {
  title: string;
  set?: { to: string } | { edit: true };
  node: ReactNode;
}

export function FirstRunChecklist({
  placement = 'top',
  onClose,
}: {
  placement?: FirstRunChecklistPlacement;
  /** The popover's: called when the checklist is hidden from inside it. */
  onClose?: () => void;
} = {}) {
  const { t, language } = useObjectTranslation();
  const data = useFirstRunChecklist();
  const labels = useSettingsLabel(LOCALIZATION_NAMESPACE);
  const aiLabels = useSettingsLabel(AI_NAMESPACE);

  const [editing, setEditing] = useState(false);
  // Whether the rows that are done are drawn: the Setup page's full list draws
  // them; elsewhere they are folded on every visit.
  const [showDone, setShowDone] = useState(placement === 'setupPage');
  // A phone's card, and the Setup page's finished list, start folded to one line.
  const [unfolded, setUnfolded] = useState(false);

  // One Home card per item (app-shell's `homeItemClaims`): this checklist's
  // assistant row, while it is open on Home, outranks Home's Connect an AI
  // Assistant card.
  const homeCard = placement === 'top' || placement === 'afterApps';
  const assistant = data?.readings.assistant;
  const drawsAssistantRow = Boolean(
    homeCard && data && !data.dismissed && !data.completion.complete && assistant && !assistant.connected,
  );
  useHomeItemClaim('connect_assistant', drawsAssistantRow);

  // A row finished elsewhere closes the form here.
  const basicsDone = data?.readings.basics.done ?? false;
  useEffect(() => {
    if (basicsDone) setEditing(false);
  }, [basicsDone]);

  if (!data) return null;
  if (homeCard && (data.dismissed || data.completion.complete)) return null;
  const { readings, setupPath, completion } = data;

  const rows: ChecklistDrawnRow[] = data.rows.map((state) => {
    const { id, done, optional } = state;
    const row = (title: string, props: { detail?: string; action?: ReactNode; children?: ReactNode }) => (
      <ChecklistRow key={id} id={id} optional={optional} done={done} title={title} {...props} />
    );
    switch (id) {
      case 'organization_basics': {
        const title = t('console.firstRunChecklist.organizationBasics.title');
        return {
          ...state,
          title,
          set: { edit: true },
          node: row(title, {
            detail: basicsDetail(readings.basics, data.organizationName, labels, language, t),
            action: editing ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                data-testid="first-run-checklist-set-organization_basics"
              >
                {done ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.set')}
              </Button>
            ),
            children: editing ? (
              <OrganizationBasicsEditor data={data} labels={labels} onDone={() => setEditing(false)} />
            ) : null,
          }),
        };
      }
      case 'mail': {
        const title = t('console.firstRunChecklist.mail.title');
        const to = `${setupPath}/system/settings/mail`;
        return {
          ...state,
          title,
          set: { to },
          node: row(title, {
            detail: done ? t('console.firstRunChecklist.mail.done') : t('console.firstRunChecklist.mail.todo'),
            action: (
              <RowLink
                to={to}
                label={done ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.mail.action')}
                testId="first-run-checklist-link-mail"
              />
            ),
          }),
        };
      }
      case 'invite': {
        const title = t('console.firstRunChecklist.invite.title');
        const to = `${setupPath}/sys_user/view/all_users`;
        return {
          ...state,
          title,
          set: { to },
          node: row(title, {
            detail: done ? t('console.firstRunChecklist.invite.done') : t('console.firstRunChecklist.invite.todo'),
            action: (
              <RowLink
                to={to}
                label={done ? t('console.firstRunChecklist.view') : t('console.firstRunChecklist.invite.action')}
                testId="first-run-checklist-link-invite"
              />
            ),
          }),
        };
      }
      case 'ai_provider': {
        const ai = readings.ai!;
        const provider = ai.value ? aiLabels.optionLabel(AI_PROVIDER_KEY, ai.value, ai.optionLabel ?? ai.value) : '';
        const title = t('console.firstRunChecklist.aiProvider.title');
        const to = `${setupPath}/system/settings/${AI_NAMESPACE}`;
        return {
          ...state,
          title,
          set: { to },
          node: row(title, {
            detail: !ai.done
              ? t('console.firstRunChecklist.aiProvider.todo')
              : ai.source === 'environment'
                ? provider
                  ? t('console.firstRunChecklist.aiProvider.doneEnvironment', { provider })
                  : // In use, handed over by the host, and named by no option:
                    // there is no provider name to put in the sentence.
                    t('console.settingsView.aiProviderManaged')
                : t('console.firstRunChecklist.aiProvider.doneSettings', { provider }),
            action: (
              <RowLink
                to={to}
                label={ai.done ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.aiProvider.action')}
                testId="first-run-checklist-link-ai_provider"
              />
            ),
          }),
        };
      }
      case 'connect_assistant': {
        const title = t('console.firstRunChecklist.connectAssistant.title');
        const to = assistant!.path;
        return {
          ...state,
          title,
          set: { to },
          node: row(title, {
            detail: done
              ? t('console.firstRunChecklist.connectAssistant.done')
              : t('console.firstRunChecklist.connectAssistant.todo'),
            action: (
              <RowLink
                to={to}
                label={done ? t('console.firstRunChecklist.view') : t('console.firstRunChecklist.connectAssistant.action')}
                testId="first-run-checklist-link-connect_assistant"
              />
            ),
          }),
        };
      }
      case 'first_app': {
        const title = t('console.firstRunChecklist.firstApp.title');
        return {
          ...state,
          title,
          node: row(title, {
            detail: done ? t('console.firstRunChecklist.firstApp.done') : t('console.firstRunChecklist.firstApp.todo'),
          }),
        };
      }
      default: {
        // `first_record`, the last row a profile adds.
        const title = t('console.firstRunChecklist.firstRecord.title');
        const firstOwn = data.ownApps[0];
        const to = firstOwn ? `/apps/${appRouteSegment(firstOwn)}` : undefined;
        return {
          ...state,
          title,
          set: to ? { to } : undefined,
          node: row(title, {
            detail: done ? t('console.firstRunChecklist.firstRecord.done') : t('console.firstRunChecklist.firstRecord.todo'),
            action: to ? (
              <RowLink to={to} label={t('console.firstRunChecklist.firstRecord.action')} testId="first-run-checklist-link-first_record" />
            ) : undefined,
          }),
        };
      }
    }
  });

  const doneCount = completion.done;
  const progress = t('console.firstRunChecklist.progress', { done: completion.done, total: completion.total });

  const hide = () => {
    data.hide();
    onClose?.();
  };
  // Home's card: the X hides the checklist on this device (the pill too).
  // In the popover the X only closes it, as a popover's X does; hiding there
  // is its own labelled action under the list, so a press meant to close the
  // popover never hides the pill for good.
  const dismissButton =
    placement === 'setupPage' ? null : placement === 'popover' ? (
      <button
        type="button"
        onClick={() => onClose?.()}
        aria-label={t('common.close')}
        title={t('common.close')}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="first-run-checklist-close"
      >
        <X className="h-4 w-4" />
      </button>
    ) : (
      <button
        type="button"
        onClick={hide}
        aria-label={t('console.firstRunChecklist.dismiss')}
        title={t('console.firstRunChecklist.dismiss')}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="first-run-checklist-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    );

  const titleLine = (
    <p className="flex min-w-0 items-baseline gap-2">
      <span id="first-run-checklist-title" className="truncate text-sm font-medium tracking-tight">
        {t('console.firstRunChecklist.title')}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground" data-testid="first-run-checklist-progress">
        {progress}
      </span>
    </p>
  );

  // Above Home's page, with few rows left and none open for editing: one line,
  // each row left by its title and its Set. The basics row's Set opens the
  // full card with its form; the others open their page.
  if (placement === 'top' && !editing && drawsOneLine(rows)) {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <section
          className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card py-2 pl-4 pr-1.5"
          data-testid="first-run-checklist"
          data-one-line="true"
          aria-labelledby="first-run-checklist-title"
        >
          {titleLine}
          <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
            {rows
              .filter((row) => !row.done)
              .map(({ id, title, set, optional }) => (
                <li
                  key={id}
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`first-run-checklist-row-${id}`}
                  data-done="false"
                  data-optional={optional ? 'true' : undefined}
                >
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 text-sm">{title}</span>
                  {optional ? (
                    <span
                      className="shrink-0 rounded-full border border-border px-1.5 py-px text-xs text-muted-foreground"
                      data-testid={`first-run-checklist-optional-${id}`}
                    >
                      {t('console.firstRunChecklist.optional')}
                    </span>
                  ) : null}
                  {set && 'edit' in set ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0"
                      onClick={() => setEditing(true)}
                      data-testid={`first-run-checklist-set-${id}`}
                    >
                      {t('console.firstRunChecklist.set')}
                    </Button>
                  ) : set ? (
                    <Button asChild size="sm" variant="outline" className="h-7 shrink-0">
                      <Link to={set.to} data-testid={`first-run-checklist-link-${id}`}>
                        {t('console.firstRunChecklist.set')}
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
          {dismissButton}
        </section>
      </div>
    );
  }

  // A phone's card, and the Setup page's list once its required rows are
  // done, start folded to one line; the line's button opens the list in place.
  const foldable = placement === 'afterApps' || (placement === 'setupPage' && completion.complete);
  if (foldable && !unfolded) {
    const line = (
      <section
        className={cn(
          'flex items-center justify-between gap-2 rounded-xl border border-border bg-card py-2 pl-4 pr-1.5',
          placement === 'setupPage' && 'mx-auto max-w-[1120px]',
        )}
        data-testid="first-run-checklist"
        data-folded="true"
        aria-labelledby="first-run-checklist-title"
      >
        {titleLine}
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 gap-0.5 px-1.5 text-primary"
          onClick={() => setUnfolded(true)}
          aria-expanded={false}
          data-testid="first-run-checklist-continue"
        >
          {placement === 'setupPage' ? t('console.firstRunChecklist.showList') : t('console.firstRunChecklist.continue')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </section>
    );
    return placement === 'setupPage' ? <div className="px-4 pt-4 sm:px-6 lg:px-8">{line}</div> : line;
  }

  const popover = placement === 'popover';
  const card = (
    <section
      className={cn(
        popover ? 'px-4 pt-3 pb-1' : 'rounded-xl border border-border bg-card px-5 pt-4 pb-1',
        (placement === 'top' || placement === 'setupPage') && 'mx-auto max-w-[1120px]',
      )}
      data-testid="first-run-checklist"
      data-placement={placement}
      data-folded={foldable ? 'false' : undefined}
      aria-labelledby="first-run-checklist-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="first-run-checklist-title" className="text-base font-medium tracking-tight">
            {t('console.firstRunChecklist.title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('console.firstRunChecklist.description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="first-run-checklist-progress">
            {progress}
          </span>
          {foldable ? (
            <button
              type="button"
              onClick={() => setUnfolded(false)}
              aria-expanded
              aria-controls="first-run-checklist-rows"
              aria-label={t('common.collapse')}
              title={t('common.collapse')}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              data-testid="first-run-checklist-fold"
            >
              <ChevronUp className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          {dismissButton}
        </div>
      </div>
      <ol className="mt-2 divide-y divide-border" id="first-run-checklist-rows">
        {rows.filter((row) => showDone || !row.done).map((row) => row.node)}
      </ol>
      {doneCount > 0 || popover ? (
        <div className="flex items-center justify-between gap-2 border-t border-border py-2">
          {doneCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowDone((shown) => !shown)}
            aria-expanded={showDone}
            aria-controls="first-run-checklist-rows"
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="first-run-checklist-toggle-done"
          >
            {showDone ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            {showDone ? t('console.firstRunChecklist.hideDone') : t('console.firstRunChecklist.showDone', { done: doneCount })}
          </button>
          ) : (
            <span />
          )}
          {popover ? (
            <button
              type="button"
              onClick={hide}
              className="rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              data-testid="first-run-checklist-dismiss"
            >
              {t('console.firstRunChecklist.hideHere')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  // In the content column (a phone's placement) and in the popover the host
  // gives the width and the gutters; above a page the card brings its own.
  return placement === 'afterApps' || popover ? card : <div className="px-4 pt-4 sm:px-6 lg:px-8">{card}</div>;
}
