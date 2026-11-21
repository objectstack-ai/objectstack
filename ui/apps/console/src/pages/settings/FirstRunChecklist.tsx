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
 * Home (`/home`), in the slot Home's page gives its host's checklist
 * (app-shell's `HomePage`, `checklist`). Home is the environment's own home
 * (ObjectUI ADR-0075): every deployment that declares no landing app opens
 * there after sign-in, the Setup-only one included (`RootLandingRedirect`).
 * Mounted by the console's Home route (`App.tsx`), inside the
 * `ConsolePermissionsScope` that route already sits under: that provider is
 * what answers which capabilities this session holds.
 *
 * Home names the placement (`placement`). `top`, above the page's sections
 * (a desktop, or a page with no app yet), draws the card as it always was.
 * `afterApps` is a phone's: the card sits in the content column after the
 * apps and starts folded to one line, its title, its progress and Continue,
 * so the first screen keeps the launcher (objectstack#34596). Continue opens
 * the card in place, and a fold control closes it again; like the done rows'
 * fold, this is the mount's own state and a fresh visit starts folded.
 * Folding changes no row and no completion rule.
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
 *   5. Email delivery, OPTIONAL (objectstack#32643): mail can deliver; links
 *      to Setup → Mail Delivery. Only for a session that may write mail. The
 *      row says it is optional and never holds the checklist open
 *      (`OPTIONAL_ROWS`): a deployment that sends no mail has nothing to set
 *      up. A setup that delivers still reads done.
 *   6. Invite colleagues: a second member or a pending invitation; links to
 *      Setup → Users, where Invite User is.
 *   7. The built-in AI: a provider is in use in the running system, as the
 *      server states it (`live.provider` of `GET /api/settings/ai`, never the
 *      saved `values.provider`, which misses a provider the runtime detected
 *      from its boot environment). The row names the provider and where it
 *      came from (Setup, or the server's environment) and links to Setup →
 *      AI & Embedder. Only for a session that may write `ai`; a server that
 *      states nothing about the provider gets no row (unknown is not unset).
 *   8. Connect an external AI assistant: done once this administrator has
 *      authorized an AI assistant or holds an API key that still works, read
 *      from those records by `useConnectedAccess` (the read Connect an AI
 *      Assistant's Connected line uses), never from a click; links to that
 *      page. Only where the served Account app carries the page (MCP turned
 *      on). Its words say it is for assistants outside the product, over MCP,
 *      and not the built-in AI (Setup → AI & Embedder). While this row is
 *      drawn and not done it claims the `connect_assistant` item, and Home's
 *      Connect an AI Assistant card stands aside.
 *
 * ## What the host adds: the profile
 *
 * The rows above are the platform's. A host can add rows, hide rows that do
 * not apply to it, and leave rows optional, through the checklist's PROFILE
 * (`firstRunChecklistProfile.ts`), which the served auth config selects
 * (`features.cloudManaged`). This component reads the profile's lists and
 * never which host it runs on. On a self-hosted deployment the profile is
 * empty and the checklist is exactly the rows above. On a managed one:
 *
 *   9. Put your first app in: the launcher lists an app that is not a platform
 *      built-in (the launcher's own `/me/apps` answer, no request of its own).
 *  10. Add your first record, OPTIONAL there: a person created a record on an
 *      object those apps list (one `sys_activity` read; the feed keeps 14 days,
 *      which is why the row is optional). Links to the first of those apps.
 *
 * and the mail row is drawn only once it reads done. Until the auth config
 * answers, nothing is drawn; a config that cannot be read is self-hosted.
 *
 * Language and country are named in the page's language (`Intl.DisplayNames`),
 * not by the setting's option label: the language options are autonyms, so a
 * zh-CN page read 「当前为English、美国 (US)」.
 *
 * A row whose state cannot be read is left out rather than shown as not done.
 * Once every REQUIRED row shown is done the checklist draws nothing, whatever
 * the optional rows say (`checklistCompletion`), and its progress line counts
 * the required rows alone; it comes back on its own if a setting is unset
 * again.
 *
 * Rows that are done are folded away: the list draws the rows still to do, and
 * one control under them names how many are done and shows them (in their
 * place in the list) or folds them again, so the card keeps the first screen
 * for the work left (objectstack#32157). Unfolding is this mount's own state:
 * a fresh visit starts folded. The control counts the required rows and the
 * optional ones apart once an optional row is done, since the progress line
 * counts the required rows alone (`checklistDoneCount`).
 *
 * Above the page, once few rows are left to do (`drawsOneLine`: two or fewer,
 * optional ones included), the card folds to one line: its title, its
 * progress, each row left by its title and a Set button, and the close
 * button; no description, no done rows and no control to unfold them. The
 * line wraps on a narrow page rather than scroll. A localization row's Set
 * opens the full card with that row's editor, and the card folds back to the
 * line once the editor closes; every other row's Set opens the page its row
 * links to. A phone's card (`afterApps`) folds its own way, above.
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
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Circle, Loader2, X } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import {
  appRouteSegment,
  connectAssistantPath,
  resolveSetupAppPath,
  useAdapter,
  useConnectedAccess,
  useHomeItemClaim,
  useLauncherApps,
  useMetadata,
} from '@object-ui/app-shell';
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
  AI_NAMESPACE,
  AI_PROVIDER_KEY,
  COUNTRY_KEY,
  CURRENCY_KEY,
  LOCALE_KEY,
  LOCALIZATION_NAMESPACE,
  TIMEZONE_KEY,
  checklistCompletion,
  checklistDoneCount,
  deviceStorage,
  dismissRecordKey,
  drawsOneLine,
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
import {
  SELF_HOSTED_PROFILE,
  appObjectNames,
  checklistProfileFor,
  hasOwnApp,
  isProfileOptionalRow,
  ownApps,
  profileDrawsRow,
  readFirstRecordCreated,
  type ChecklistApp,
  type FirstRecordSource,
  type FirstRunChecklistProfile,
} from './firstRunChecklistProfile';

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
              className="ml-2 rounded-full border border-border px-1.5 py-px align-middle text-[11px] font-normal text-muted-foreground"
              data-testid={`first-run-checklist-optional-${id}`}
            >
              {t('console.firstRunChecklist.optional')}
            </span>
          ) : null}
        </p>
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

/**
 * Where Home draws the checklist: app-shell's `HomeChecklistPlacement`, by
 * value (see the module doc).
 */
export type FirstRunChecklistPlacement = 'top' | 'afterApps';

/**
 * One row as the checklist draws it: the full row (`node`), and what the
 * one-line form draws of it, its title and where its Set goes (a page to open,
 * or the localization row to open for editing in the full card).
 */
interface ChecklistDrawnRow {
  id: string;
  done: boolean;
  title: string;
  set?: { to: string } | { edit: ChecklistSettingsRow['id'] };
  node: ReactNode;
}

export function FirstRunChecklist({ placement = 'top' }: { placement?: FirstRunChecklistPlacement } = {}) {
  const { t, language } = useObjectTranslation();
  const { user, activeOrganization, getMembers, listInvitations, getAuthConfig } = useAuth();
  const { systemPermissions } = usePermissions();
  const { apps } = useMetadata();
  const dataSource = useAdapter();
  // The apps the launcher offers this user: the `/meta/app` list narrowed by
  // the console's one `/me/apps` read. "Put your first app in" reads it.
  const launcher = useLauncherApps((apps ?? []) as Array<ChecklistApp & Record<string, unknown>>);
  const labels = useSettingsLabel(LOCALIZATION_NAMESPACE);
  const aiLabels = useSettingsLabel(AI_NAMESPACE);

  const [editing, setEditing] = useState<ChecklistSettingsRow['id'] | null>(null);
  // Whether the rows that are done are drawn; folded on every visit.
  const [showDone, setShowDone] = useState(false);
  // A phone's card starts folded to one line; folded on every visit.
  const foldable = placement === 'afterApps';
  const [unfolded, setUnfolded] = useState(false);
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
  // The host's profile, from the served auth config (`firstRunChecklistProfile.ts`).
  // `null` until the config answers: drawing the self-hosted rows first and
  // the host's a moment later would move the list under the reader.
  const [profile, setProfile] = useState<FirstRunChecklistProfile | null>(null);
  // Whether a person created a record, read for one identity and object list.
  const [firstRecord, setFirstRecord] = useState<{ key: string; created: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The auth client holds one config answer per signed-in stretch, which
    // sign-in already read: this asks no new request.
    Promise.resolve(getAuthConfig?.())
      .then((config) => {
        if (!cancelled) setProfile(checklistProfileFor(config?.features));
      })
      .catch(() => {
        // Unreadable: the checklist is what it is without a host.
        if (!cancelled) setProfile(SELF_HOSTED_PROFILE);
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

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
  // Connect an AI Assistant: the row reads whether this administrator has
  // connected one only once the checklist is going to draw.
  const assistantPath = connectAssistantPath(apps);
  const assistant = useConnectedAccess({ enabled: Boolean(settings && !dismissed && assistantPath) });
  // One Home card per item (app-shell's `homeItemClaims`): this checklist's
  // assistant row, while it is open, outranks Home's Connect an AI Assistant card.
  const drawsAssistantRow = Boolean(
    settings && !dismissed && orgId && userId && recordKey && assistantPath &&
      assistant.state === 'ready' && !assistant.connected,
  );
  useHomeItemClaim('connect_assistant', drawsAssistantRow);
  // Add your first record: read once the checklist is going to draw, the
  // profile adds the row and the launcher has answered, for the objects the
  // environment's own apps list. Keyed on that list's content, never on the
  // array's identity (AGENTS.md #10).
  const own = ownApps(launcher.apps);
  const recordObjects = appObjectNames(own);
  const firstRecordKey =
    settings && !dismissed && identity && profile?.addedRows.includes('first_record') && !launcher.pending && dataSource
      ? [identity, recordObjects.join(',')].join('\u0001')
      : null;
  useEffect(() => {
    if (!firstRecordKey || !dataSource) return;
    let cancelled = false;
    readFirstRecordCreated(dataSource as unknown as FirstRecordSource, recordObjects)
      .then((created) => {
        if (!cancelled) setFirstRecord({ key: firstRecordKey, created });
      })
      .catch(() => {
        // Unreadable (no activity feed, or a refused read): the row is left out.
      });
    return () => {
      cancelled = true;
    };
    // `recordObjects` and `dataSource` are carried by the key's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRecordKey]);
  const recordCreated = firstRecord && firstRecord.key === firstRecordKey ? firstRecord.created : undefined;

  const setSettings = (update: (prev: ChecklistSettingsState) => ChecklistSettingsState) =>
    setLoaded((prev) => (prev ? { identity: prev.identity, settings: update(prev.settings) } : prev));

  if (!settings || !profile || dismissed || !orgId || !userId || !recordKey) return null;
  const optionalRow = (id: string) => isProfileOptionalRow(profile, id);

  const setupPath = resolveSetupAppPath(apps);
  const localization = localizationRows(settings.localization.manifest, settings.localization.values, browser);
  const organizationNamed = isOrganizationNamed(activeOrganization?.name);

  const rows: ChecklistDrawnRow[] = [];

  const organizationPath = `${setupPath}/sys_organization/record/${encodeURIComponent(orgId)}`;
  rows.push({
    id: 'organization_name',
    done: organizationNamed,
    title: t('console.firstRunChecklist.organizationName.title'),
    set: { to: organizationPath },
    node: (
      <ChecklistRow
        key="organization_name"
        id="organization_name"
        optional={optionalRow('organization_name')}
        done={organizationNamed}
        title={t('console.firstRunChecklist.organizationName.title')}
        detail={
          organizationNamed
            ? activeOrganization?.name ?? ''
            : t('console.firstRunChecklist.organizationName.todo', { name: activeOrganization?.name ?? '' })
        }
        action={
          <RowLink
            to={organizationPath}
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
      title: settingsRowTitle(row, t),
      set: { edit: row.id },
      node: (
        <ChecklistRow
          key={row.id}
          id={row.id}
          optional={optionalRow(row.id)}
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
      title: t('console.firstRunChecklist.mail.title'),
      set: { to: `${setupPath}/system/settings/mail` },
      node: (
        <ChecklistRow
          key="mail"
          id="mail"
          optional={optionalRow('mail')}
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
      title: t('console.firstRunChecklist.invite.title'),
      set: { to: `${setupPath}/sys_user/view/all_users` },
      node: (
        <ChecklistRow
          key="invite"
          id="invite"
          optional={optionalRow('invite')}
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

  if (settings.ai) {
    const ai = settings.ai;
    const provider = ai.value ? aiLabels.optionLabel(AI_PROVIDER_KEY, ai.value, ai.optionLabel ?? ai.value) : '';
    rows.push({
      id: 'ai_provider',
      done: ai.done,
      title: t('console.firstRunChecklist.aiProvider.title'),
      set: { to: `${setupPath}/system/settings/${AI_NAMESPACE}` },
      node: (
        <ChecklistRow
          key="ai_provider"
          id="ai_provider"
          optional={optionalRow('ai_provider')}
          done={ai.done}
          title={t('console.firstRunChecklist.aiProvider.title')}
          detail={
            !ai.done
              ? t('console.firstRunChecklist.aiProvider.todo')
              : ai.source === 'environment'
                ? provider
                  ? t('console.firstRunChecklist.aiProvider.doneEnvironment', { provider })
                  : // In use, handed over by the host, and named by no option:
                    // there is no provider name to put in the sentence.
                    t('console.settingsView.aiProviderManaged')
                : t('console.firstRunChecklist.aiProvider.doneSettings', { provider })
          }
          action={
            <RowLink
              to={`${setupPath}/system/settings/${AI_NAMESPACE}`}
              label={ai.done ? t('console.firstRunChecklist.change') : t('console.firstRunChecklist.aiProvider.action')}
              testId="first-run-checklist-link-ai_provider"
            />
          }
        />
      ),
    });
  }

  if (assistantPath && assistant.state === 'ready') {
    const done = assistant.connected;
    rows.push({
      id: 'connect_assistant',
      done,
      title: t('console.firstRunChecklist.connectAssistant.title'),
      set: { to: assistantPath },
      node: (
        <ChecklistRow
          key="connect_assistant"
          id="connect_assistant"
          optional={optionalRow('connect_assistant')}
          done={done}
          title={t('console.firstRunChecklist.connectAssistant.title')}
          detail={
            done
              ? t('console.firstRunChecklist.connectAssistant.done')
              : t('console.firstRunChecklist.connectAssistant.todo')
          }
          action={
            <RowLink
              to={assistantPath}
              label={done ? t('console.firstRunChecklist.view') : t('console.firstRunChecklist.connectAssistant.action')}
              testId="first-run-checklist-link-connect_assistant"
            />
          }
        />
      ),
    });
  }

  for (const added of profile.addedRows) {
    if (added === 'first_app' && !launcher.pending) {
      const done = hasOwnApp(launcher.apps);
      rows.push({
        id: 'first_app',
        done,
        title: t('console.firstRunChecklist.firstApp.title'),
        node: (
          <ChecklistRow
            key="first_app"
            id="first_app"
            optional={optionalRow('first_app')}
            done={done}
            title={t('console.firstRunChecklist.firstApp.title')}
            detail={done ? t('console.firstRunChecklist.firstApp.done') : t('console.firstRunChecklist.firstApp.todo')}
          />
        ),
      });
    }
    if (added === 'first_record' && recordCreated !== undefined) {
      const done = recordCreated;
      const firstOwn = own[0];
      rows.push({
        id: 'first_record',
        done,
        title: t('console.firstRunChecklist.firstRecord.title'),
        set: firstOwn ? { to: `/apps/${appRouteSegment(firstOwn)}` } : undefined,
        node: (
          <ChecklistRow
            key="first_record"
            id="first_record"
            optional={optionalRow('first_record')}
            done={done}
            title={t('console.firstRunChecklist.firstRecord.title')}
            detail={done ? t('console.firstRunChecklist.firstRecord.done') : t('console.firstRunChecklist.firstRecord.todo')}
            action={
              firstOwn ? (
                <RowLink
                  to={`/apps/${appRouteSegment(firstOwn)}`}
                  label={t('console.firstRunChecklist.firstRecord.action')}
                  testId="first-run-checklist-link-first_record"
                />
              ) : undefined
            }
          />
        ),
      });
    }
  }

  // The host hides the rows that do not apply to it while they read not done.
  const drawn = rows.filter((row) => profileDrawsRow(profile, row.id, row.done));
  // Done rows are folded away, the optional ones included; only the required
  // ones decide whether the checklist is still drawn and what its progress says.
  // The control that unfolds them names the required and the optional apart,
  // so its count never reads larger than the progress line's.
  const doneCount = checklistDoneCount(drawn, optionalRow);
  const completion = checklistCompletion(drawn, optionalRow);
  if (completion.complete) return null;

  const hide = () => {
    markDismissed(deviceStorage(), recordKey);
    setHiddenKey(recordKey);
  };

  const progress = t('console.firstRunChecklist.progress', { done: completion.done, total: completion.total });

  const dismissButton = (
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

  // Above the page, with few rows left and none open for editing: one line,
  // each row left by its title and its Set. A localization row's Set opens the
  // full card with that row's editor; the others open their page.
  if (!foldable && editing === null && drawsOneLine(drawn)) {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <section
          className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card py-2 pl-4 pr-1.5"
          data-testid="first-run-checklist"
          data-one-line="true"
          aria-labelledby="first-run-checklist-title"
        >
          <p className="flex min-w-0 items-baseline gap-2">
            <span id="first-run-checklist-title" className="text-[13px] font-semibold tracking-tight">
              {t('console.firstRunChecklist.title')}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground" data-testid="first-run-checklist-progress">
              {progress}
            </span>
          </p>
          <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
            {drawn
              .filter((row) => !row.done)
              .map(({ id, title, set }) => (
                <li
                  key={id}
                  className="flex min-w-0 items-center gap-2"
                  data-testid={`first-run-checklist-row-${id}`}
                  data-done="false"
                  data-optional={optionalRow(id) ? 'true' : undefined}
                >
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 text-[13px]">{title}</span>
                  {optionalRow(id) ? (
                    <span
                      className="shrink-0 rounded-full border border-border px-1.5 py-px text-[11px] text-muted-foreground"
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
                      onClick={() => setEditing(set.edit)}
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

  if (foldable && !unfolded) {
    return (
      <section
        className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card py-2 pl-4 pr-1.5"
        data-testid="first-run-checklist"
        data-folded="true"
        aria-labelledby="first-run-checklist-title"
      >
        <p className="flex min-w-0 items-baseline gap-2">
          <span id="first-run-checklist-title" className="truncate text-[13px] font-semibold tracking-tight">
            {t('console.firstRunChecklist.title')}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground" data-testid="first-run-checklist-progress">
            {progress}
          </span>
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 gap-0.5 px-1.5 text-primary"
          onClick={() => setUnfolded(true)}
          aria-expanded={false}
          data-testid="first-run-checklist-continue"
        >
          {t('console.firstRunChecklist.continue')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </section>
    );
  }

  const card = (
    <section
      className={cn(
        'rounded-xl border border-border bg-card px-5 pt-4 pb-1',
        !foldable && 'mx-auto max-w-[1120px]',
      )}
      data-testid="first-run-checklist"
      data-folded={foldable ? 'false' : undefined}
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
        {drawn.filter((row) => showDone || !row.done).map((row) => row.node)}
      </ol>
      {doneCount.required + doneCount.optional > 0 ? (
        <div className="border-t border-border py-2">
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
            {showDone
              ? t('console.firstRunChecklist.hideDone')
              : doneCount.optional > 0
                ? t('console.firstRunChecklist.showDoneSplit', { required: doneCount.required, optional: doneCount.optional })
                : t('console.firstRunChecklist.showDone', { done: doneCount.required })}
          </button>
        </div>
      ) : null}
    </section>
  );

  // In the content column (a phone's placement) the column gives the width
  // and the gutters; above the page the card brings its own.
  return foldable ? card : <div className="px-4 pt-4 sm:px-6 lg:px-8">{card}</div>;
}
