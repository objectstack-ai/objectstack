// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <FirstRunChecklist> — what an administrator sets up first, at the top of Home
 * (objectstack#30206). It replaces the dialog that asked for the workspace
 * timezone and default currency on the first screens (objectui#11758,
 * objectstack#28872), which opened before anything needed a currency and once
 * covered the toast that said how to share an invitation (objectstack#30125
 * row 3).
 *
 * ## Where it is drawn
 *
 * Home (`/home`), above the page's own sections. Home is the environment's own
 * home (ObjectUI ADR-0075): every deployment that declares no landing app opens
 * there after sign-in, the Setup-only one included (`RootLandingRedirect`).
 * Mounted by the console's Home route (`App.tsx`), inside the
 * `ConsolePermissionsScope` that route already sits under: that provider is
 * what answers which capabilities this session holds.
 *
 * ## Who sees it, and what each row says
 *
 * An administrator: a session that may write `localization`
 * (`readChecklistSettings`). A member never sees it, and neither does a
 * session whose capability answer has not arrived. Each row's done state is
 * read from the real setting (`firstRunChecklistLogic.ts`), never from a click:
 *
 *   1. Organization name: the organization no longer carries the name the
 *      platform gave it; links to Setup → Organization.
 *   2. Language and country, 3. timezone, 4. default currency: the
 *      localization keys, edited in place with the Settings page's own fields,
 *      pre-filled from the browser and written only on the row's Confirm.
 *   5. Email delivery: mail can deliver; links to Setup → Mail Delivery.
 *      Only for a session that may write mail.
 *   6. Invite colleagues: a second member or a pending invitation; links to
 *      Setup → Users, where Invite User is.
 *
 * A row whose state cannot be read is left out rather than shown as not done.
 * Once every row shown is done the checklist draws nothing; it comes back on
 * its own if a setting is unset again.
 *
 * ## Hiding it
 *
 * The close button hides it for this administrator in this workspace on this
 * device (`dismissRecordKey`). Nothing is written to the server and no row
 * changes: the deployment works the same with every row left as it is.
 *
 * ## The writes
 *
 * A row's Confirm is `saveSettingsNamespace('localization', changes)`, the
 * function `SettingsView` saves through: one `PUT /api/settings/localization`,
 * judged by the server against the manifest's `writePermission` and audited
 * like any other settings save. Its refusals land where the Settings page puts
 * them: a lock names the key, a validation refusal goes to the field's error
 * slot (in the console's words for a format miss, `settingsFieldRefusals`),
 * anything else carries the server's sentence. Cancel writes nothing.
 *
 * Its reads wait for the console's first paint (`whenBootPainted`,
 * objectui#12980), so they never go out beside the page's own first reads.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Loader2, X } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { useMetadata, resolveSetupAppPath } from '@object-ui/app-shell';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { SettingsField } from './SettingsField';
import { getSettingsNamespace, lockedKeyOf, saveSettingsNamespace } from './api';
import { fieldWording, settingsFieldRefusals } from './settingsFieldRefusals';
import { resolveLabel, type ResolvedSettingValue } from './types';
import { useSettingsLabel, type SettingsLabelHelpers } from './useSettingsLabel';
import { whenBootPainted } from '../../loadLocales';
import {
  CURRENCY_KEY,
  LOCALIZATION_NAMESPACE,
  TIMEZONE_KEY,
  deviceStorage,
  dismissRecordKey,
  hasInvitedColleagues,
  isOrganizationNamed,
  localizationRows,
  markDismissed,
  readBrowserAnswers,
  readChecklistSettings,
  wasDismissed,
  type ChecklistField,
  type ChecklistSettingsRow,
  type ChecklistSettingsState,
} from './firstRunChecklistLogic';

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

/**
 * A field's value as the row names it: the currency by its name and code, any
 * other key by its option's translated label, else the value itself.
 */
function describeValue(field: ChecklistField, value: string, labels: SettingsLabelHelpers, language: string): string {
  if (field.key === CURRENCY_KEY) {
    const name = currencyName(language, value);
    return name ? `${name} (${value})` : value;
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
  title,
  detail,
  action,
  children,
}: {
  id: string;
  done: boolean;
  title: string;
  detail?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      className="flex items-start gap-3 py-3"
      data-testid={`first-run-checklist-row-${id}`}
      data-done={done ? 'true' : 'false'}
    >
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done && 'text-muted-foreground')}>{title}</p>
        {detail ? <p className="mt-0.5 text-[13px] text-muted-foreground">{detail}</p> : null}
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

/** A localization row's title. */
function settingsRowTitle(row: ChecklistSettingsRow, t: Translate): string {
  if (row.id === 'language_country') return t('console.firstRunChecklist.languageCountry.title');
  if (row.id === 'timezone') return t('console.firstRunChecklist.timezone.title');
  return t('console.firstRunChecklist.currency.title');
}

/** The line under a localization row's title. */
function settingsRowDetail(
  row: ChecklistSettingsRow,
  labels: SettingsLabelHelpers,
  language: string,
  t: Translate,
): string {
  // A row that is done shows its value alone; two values are joined by the
  // pack's own list separator, the one the Settings page's toasts use.
  const named = (field: ChecklistField) => describeValue(field, currentValue(field.resolved), labels, language);
  if (row.done) return row.fields.map(named).join(t('validation.formInvalidJoiner'));
  if (row.id === 'language_country') {
    const [locale, country] = row.fields;
    return t('console.firstRunChecklist.languageCountry.todo', { language: named(locale), country: named(country) });
  }
  if (row.id === 'timezone') return t('console.firstRunChecklist.timezone.todo', { current: named(row.fields[0]) });
  return t('console.firstRunChecklist.currency.todo');
}

/** The toast a localization row's Confirm raises once the server took the write. */
function savedMessage(
  row: ChecklistSettingsRow,
  changes: Record<string, string>,
  labels: SettingsLabelHelpers,
  language: string,
  t: Translate,
): string {
  if (row.id === 'timezone') return t('console.firstRunChecklist.timezone.saved', { zone: changes[TIMEZONE_KEY] });
  if (row.id === 'currency') {
    const field = row.fields[0];
    return t('console.firstRunChecklist.currency.saved', {
      currency: describeValue(field, changes[CURRENCY_KEY], labels, language),
    });
  }
  return t('console.firstRunChecklist.languageCountry.saved');
}

type FieldErrors = Record<string, string | undefined>;

/**
 * A localization row's editor: the Settings page's own field for each key,
 * pre-filled with the current value of a set key or the browser's offer for an
 * unset one, and Confirm / Cancel.
 */
function SettingsRowEditor({
  row,
  labels,
  onSaved,
  onCancel,
}: {
  row: ChecklistSettingsRow;
  labels: SettingsLabelHelpers;
  onSaved: (values: Record<string, ResolvedSettingValue>) => void;
  onCancel: () => void;
}) {
  const { t, language } = useObjectTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      row.fields.map((field) => [field.key, field.set ? currentValue(field.resolved) : field.offer ?? '']),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // The keys Confirm writes: a field holding a value that is not already the
  // key's own. A cleared field is left as it is.
  const changes: Record<string, string> = {};
  for (const field of row.fields) {
    const draft = drafts[field.key] ?? '';
    if (draft === '') continue;
    if (field.set && draft === currentValue(field.resolved)) continue;
    changes[field.key] = draft;
  }
  const hasChanges = Object.keys(changes).length > 0;
  const specifiers = row.fields.map((field) => field.spec);

  const onConfirm = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const res = await saveSettingsNamespace(LOCALIZATION_NAMESPACE, changes);
      toast.success(savedMessage(row, changes, labels, language, t));
      onSaved(res.values);
    } catch (err) {
      // The Settings page's own reading of a refused save, for the keys this
      // row writes. `api.ts` parks the raw error body on `err.payload`.
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
          if (row.fields.some((field) => field.key === f.field)) refused[f.field] = f.message;
        }
        setFieldErrors(refused);
        toast.error(
          Object.keys(refused).length > 0
            ? t('console.settingsView.fieldErrorsToast', {
                count: Object.keys(refused).length,
                settings: row.fields
                  .filter((field) => refused[field.key])
                  .map((field) => labels.fieldLabel(field.key, resolveLabel(field.spec.label)))
                  .join(t('validation.formInvalidJoiner')),
              })
            : failure?.message ?? t('console.settingsView.saveFailed'),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3" data-testid={`first-run-checklist-editor-${row.id}`}>
      {row.fields.map((field) => (
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
      <p className="text-xs text-muted-foreground">{t('console.firstRunChecklist.prefilled')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={saving || !hasChanges}
          data-testid={`first-run-checklist-confirm-${row.id}`}
        >
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {t('console.firstRunChecklist.confirm')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          data-testid={`first-run-checklist-cancel-${row.id}`}
        >
          {t('console.firstRunChecklist.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function FirstRunChecklist() {
  const { t, language } = useObjectTranslation();
  const { user, activeOrganization, getMembers, listInvitations } = useAuth();
  const { systemPermissions } = usePermissions();
  const { apps } = useMetadata();
  const labels = useSettingsLabel(LOCALIZATION_NAMESPACE);

  const [editing, setEditing] = useState<ChecklistSettingsRow['id'] | null>(null);
  // The browser's answers are read once per mount: what the rows offer does not
  // change under the administrator while they look at it.
  const [browser] = useState(readBrowserAnswers);

  const userId = user?.id;
  const orgId = activeOrganization?.id;
  // Keyed on the capability LIST's content, never on the array's identity
  // (AGENTS.md #10): a provider refetch that answers the same set must not
  // re-run the reads. `null` keeps "not reported" apart from "holds nothing".
  const heldKey = Array.isArray(systemPermissions) ? systemPermissions.join('\n') : null;
  // Who is reading, where, holding what. Every answer below is stored with the
  // identity it was read for, so an answer read for another one is never drawn.
  const identity = userId && orgId && heldKey !== null ? [orgId, userId, heldKey].join('\u0000') : null;
  const recordKey = userId && orgId ? dismissRecordKey(orgId, userId) : null;

  const [loaded, setLoaded] = useState<{ identity: string; settings: ChecklistSettingsState } | null>(null);
  const [invited, setInvited] = useState<{ identity: string; colleagues: boolean } | null>(null);
  // Hidden in this mount by the close button; a record from an earlier visit is
  // read from the device below.
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);

  useEffect(() => {
    if (!identity || !userId || !orgId || heldKey === null) return;
    if (wasDismissed(deviceStorage(), dismissRecordKey(orgId, userId))) return;
    const held = heldKey === '' ? [] : heldKey.split('\n');

    let cancelled = false;
    whenBootPainted()
      .then(() => (cancelled ? null : readChecklistSettings(held)))
      .then((found) => {
        if (cancelled || !found) return;
        setLoaded({ identity, settings: found });
        // Only an administrator's checklist asks who else is here.
        Promise.all([getMembers(orgId), listInvitations(orgId)])
          .then(([members, invitations]) => {
            if (!cancelled) setInvited({ identity, colleagues: hasInvitedColleagues(members, invitations) });
          })
          .catch(() => {
            // Members or invitations unreadable: the invite row is left out.
          });
      })
      .catch(() => {
        // A settings service that is absent or failing shows no checklist.
      });
    return () => {
      cancelled = true;
    };
    // `getMembers` / `listInvitations` are the provider's stable callbacks;
    // the reads re-run on who is signed in, where, and what they may do, all
    // of which `identity` carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const settings = loaded && loaded.identity === identity ? loaded.settings : null;
  const colleagues = invited && invited.identity === identity ? invited.colleagues : undefined;
  const dismissed =
    recordKey !== null && (hiddenKey === recordKey || wasDismissed(deviceStorage(), recordKey));
  const setSettings = (update: (prev: ChecklistSettingsState) => ChecklistSettingsState) =>
    setLoaded((prev) => (prev ? { identity: prev.identity, settings: update(prev.settings) } : prev));

  if (!settings || dismissed || !orgId || !userId || !recordKey) return null;

  const setupPath = resolveSetupAppPath(apps);
  const localization = localizationRows(settings.localization.manifest, settings.localization.values, browser);
  const organizationNamed = isOrganizationNamed(activeOrganization?.name);

  const rows: Array<{ id: string; done: boolean; node: ReactNode }> = [];

  rows.push({
    id: 'organization_name',
    done: organizationNamed,
    node: (
      <ChecklistRow
        key="organization_name"
        id="organization_name"
        done={organizationNamed}
        title={t('console.firstRunChecklist.organizationName.title')}
        detail={
          organizationNamed
            ? activeOrganization?.name ?? ''
            : t('console.firstRunChecklist.organizationName.todo', { name: activeOrganization?.name ?? '' })
        }
        action={
          <RowLink
            to={`${setupPath}/sys_organization/record/${encodeURIComponent(orgId)}`}
            label={organizationNamed ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.organizationName.action')}
            testId="first-run-checklist-link-organization_name"
          />
        }
      />
    ),
  });

  for (const row of localization) {
    const open = editing === row.id;
    rows.push({
      id: row.id,
      done: row.done,
      node: (
        <ChecklistRow
          key={row.id}
          id={row.id}
          done={row.done}
          title={settingsRowTitle(row, t)}
          detail={settingsRowDetail(row, labels, language, t)}
          action={
            row.done ? (
              <RowLink
                to={`${setupPath}/system/settings/${LOCALIZATION_NAMESPACE}`}
                label={t('console.firstRunChecklist.change')}
                testId={`first-run-checklist-link-${row.id}`}
              />
            ) : open ? null : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(row.id)}
                data-testid={`first-run-checklist-set-${row.id}`}
              >
                {t('console.firstRunChecklist.set')}
              </Button>
            )
          }
        >
          {open && !row.done ? (
            <SettingsRowEditor
              row={row}
              labels={labels}
              onCancel={() => setEditing(null)}
              onSaved={(values) => {
                setEditing(null);
                setSettings((prev) => ({
                  ...prev,
                  localization: { ...prev.localization, values: { ...prev.localization.values, ...values } },
                }));
                // The write's read-back is merged at once; the namespace is
                // then read again, as the Settings page does after a save, so
                // every row shows what the server now resolves.
                getSettingsNamespace(LOCALIZATION_NAMESPACE)
                  .then((fresh) => {
                    setSettings((prev) => ({ ...prev, localization: { manifest: fresh.manifest, values: fresh.values } }));
                  })
                  .catch(() => {
                    // Keep what is on screen; the next visit reads again.
                  });
              }}
            />
          ) : null}
        </ChecklistRow>
      ),
    });
  }

  if (settings.mail) {
    const done = settings.mail.done;
    rows.push({
      id: 'mail',
      done,
      node: (
        <ChecklistRow
          key="mail"
          id="mail"
          done={done}
          title={t('console.firstRunChecklist.mail.title')}
          detail={done ? t('console.firstRunChecklist.mail.done') : t('console.firstRunChecklist.mail.todo')}
          action={
            <RowLink
              to={`${setupPath}/system/settings/mail`}
              label={done ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.mail.action')}
              testId="first-run-checklist-link-mail"
            />
          }
        />
      ),
    });
  }

  if (colleagues !== undefined) {
    rows.push({
      id: 'invite',
      done: colleagues,
      node: (
        <ChecklistRow
          key="invite"
          id="invite"
          done={colleagues}
          title={t('console.firstRunChecklist.invite.title')}
          detail={colleagues ? t('console.firstRunChecklist.invite.done') : t('console.firstRunChecklist.invite.todo')}
          action={
            <RowLink
              to={`${setupPath}/sys_user/view/all_users`}
              label={colleagues ? t('console.firstRunChecklist.view') : t('console.firstRunChecklist.invite.action')}
              testId="first-run-checklist-link-invite"
            />
          }
        />
      ),
    });
  }

  const doneCount = rows.filter((row) => row.done).length;
  if (rows.length === 0 || doneCount === rows.length) return null;

  const hide = () => {
    markDismissed(deviceStorage(), recordKey);
    setHiddenKey(recordKey);
  };

  return (
    <div className="px-4 pt-7 sm:px-6 lg:px-8">
      <section
        className="mx-auto max-w-[1120px] rounded-xl border border-border bg-card px-5 pt-4 pb-1"
        data-testid="first-run-checklist"
        aria-labelledby="first-run-checklist-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="first-run-checklist-title" className="text-base font-semibold tracking-tight">
              {t('console.firstRunChecklist.title')}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('console.firstRunChecklist.description')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="first-run-checklist-progress">
              {t('console.firstRunChecklist.progress', { done: doneCount, total: rows.length })}
            </span>
            <button
              type="button"
              onClick={hide}
              aria-label={t('console.firstRunChecklist.dismiss')}
              title={t('console.firstRunChecklist.dismiss')}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              data-testid="first-run-checklist-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <ol className="mt-2 divide-y divide-border">{rows.map((row) => row.node)}</ol>
      </section>
    </div>
  );
}
