// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first-run checklist's reads, made ONCE for every place it is drawn
 * (objectstack#36739): the sidebar's 「Get started n/m」 pill in every app, the
 * full list at the top of the Setup app's first page, and Home's card (the
 * no-apps empty state, and a phone's Home). Mounted by the console's
 * `ConsolePermissionsScope`, above `/home` and every app route, so moving
 * between apps keeps one answer and asks nothing again.
 *
 * What it reads, and for whom, is unchanged from the card that used to read it
 * itself (`FirstRunChecklist.tsx` keeps the account of each row):
 *
 * - an administrator only: a session that may write `localization`
 *   (`readChecklistSettings`); for anyone else {@link useFirstRunChecklist}
 *   answers `null` and nothing further is asked;
 * - after the console's first paint (`whenBootPainted`), so the reads never go
 *   out beside the page's own first reads;
 * - each answer is stored with the identity it was read for (organization,
 *   user, capability set), so an answer read for another one is never drawn.
 *
 * Every row's done state is read from the server, never from a click
 * ({@link checklistRows}).
 *
 * @module
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  connectAssistantPath,
  resolveSetupAppPath,
  useAdapter,
  useConnectedAccess,
  useLauncherApps,
  useMetadata,
} from '@object-ui/app-shell';
import { useAuth } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import { getSettingsNamespace } from './api';
import type { ResolvedSettingValue, SettingsManifest } from './types';
import { whenBootPainted } from '../../loadLocales';
import {
  checklistCompletion,
  deviceStorage,
  dismissRecordKey,
  hasInvitedColleagues,
  LOCALIZATION_NAMESPACE,
  markDismissed,
  organizationBasics,
  readBrowserAnswers,
  readChecklistSettings,
  wasDismissed,
  type BrowserAnswers,
  type ChecklistCompletion,
  type ChecklistSettingsState,
  type OrganizationBasics,
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

/** One row the checklist draws: which, whether it is done, and whether it may be left undone. */
export interface ChecklistRowState {
  id: string;
  done: boolean;
  optional: boolean;
}

/** What the reads answered, for one administrator in one organization. */
export interface ChecklistReadings {
  profile: FirstRunChecklistProfile;
  basics: OrganizationBasics;
  /** `undefined` when this session may not write mail, or its read failed. */
  mail?: { done: boolean };
  /** `undefined` while unread, or when members or invitations are unreadable. */
  colleagues?: boolean;
  /** The built-in AI, as `readChecklistSettings` answers it. */
  ai?: ChecklistSettingsState['ai'];
  /** Connect an AI Assistant: `undefined` unless the page is served and the read answered. */
  assistant?: { path: string; connected: boolean };
  /** Put your first app in: `undefined` while the launcher has not answered. */
  firstApp?: boolean;
  /** Add your first record: `undefined` while unread, or unreadable. */
  firstRecord?: boolean;
}

/**
 * The rows drawn, in the order they are drawn: the required ones first, then
 * the optional ones, each group in the platform's order with the host's added
 * rows after the platform's. A row whose state is unknown is left out rather
 * than shown as not done; a row the profile hides while not done is left out
 * while it is not done.
 */
export function checklistRows(readings: ChecklistReadings): ChecklistRowState[] {
  const { profile } = readings;
  const found: Array<{ id: string; done: boolean | undefined }> = [
    { id: 'organization_basics', done: readings.basics.done },
    { id: 'mail', done: readings.mail?.done },
    { id: 'invite', done: readings.colleagues },
    { id: 'ai_provider', done: readings.ai?.done },
    { id: 'connect_assistant', done: readings.assistant?.connected },
  ];
  for (const added of profile.addedRows) {
    if (added === 'first_app') found.push({ id: 'first_app', done: readings.firstApp });
    if (added === 'first_record') found.push({ id: 'first_record', done: readings.firstRecord });
  }
  const rows: ChecklistRowState[] = [];
  for (const { id, done } of found) {
    if (done === undefined || !profileDrawsRow(profile, id, done)) continue;
    rows.push({ id, done, optional: isProfileOptionalRow(profile, id) });
  }
  return [...rows.filter((row) => !row.optional), ...rows.filter((row) => row.optional)];
}

/** Everything a place that draws the checklist needs. */
export interface FirstRunChecklistData {
  orgId: string;
  organizationName: string;
  /** The Setup app's address, which most rows link into. */
  setupPath: string;
  /** The localization namespace, as the server last answered it. */
  localization: { manifest: SettingsManifest; values: Record<string, ResolvedSettingValue> };
  browser: BrowserAnswers;
  readings: ChecklistReadings;
  rows: ChecklistRowState[];
  completion: ChecklistCompletion;
  /** The environment's own apps (the first-record row opens the first). */
  ownApps: Array<ChecklistApp & Record<string, unknown>>;
  /**
   * This administrator hid the checklist in this organization on this device
   * (`dismissRecordKey`): the sidebar pill and Home's card stand aside. The
   * Setup app's first page still draws the full list.
   */
  dismissed: boolean;
  hide: () => void;
  /** Merge a localization write's read-back, then read the namespace again, as the Settings page does after a save. */
  localizationSaved: (values: Record<string, ResolvedSettingValue>) => void;
}

const FirstRunChecklistContext = createContext<FirstRunChecklistData | null>(null);

/**
 * The checklist for this session, or `null` when it is not shown to it: a
 * member, a session whose answers have not arrived, or no provider mounted.
 */
export function useFirstRunChecklist(): FirstRunChecklistData | null {
  return useContext(FirstRunChecklistContext);
}

/** Reads the checklist once and hands it to every place it is drawn. */
export function FirstRunChecklistProvider({ children }: { children: ReactNode }) {
  const { user, activeOrganization, getMembers, listInvitations, getAuthConfig } = useAuth();
  const { systemPermissions } = usePermissions();
  const { apps } = useMetadata();
  const dataSource = useAdapter();
  // The apps the launcher offers this user: the `/meta/app` list narrowed by
  // the console's one `/me/apps` read. "Put your first app in" reads it.
  const launcher = useLauncherApps((apps ?? []) as Array<ChecklistApp & Record<string, unknown>>);
  // The browser's answers are read once: what the form offers does not change
  // under the administrator while they look at it.
  const [browser] = useState(readBrowserAnswers);

  const userId = user?.id;
  const orgId = activeOrganization?.id;
  // Keyed on the capability LIST's content, never on the array's identity
  // (AGENTS.md #10): a provider refetch that answers the same set must not
  // re-run the reads. `null` keeps "not reported" apart from "holds nothing".
  const heldKey = Array.isArray(systemPermissions) ? systemPermissions.join('\n') : null;
  const identity = userId && orgId && heldKey !== null ? [orgId, userId, heldKey].join('\u0000') : null;
  const recordKey = userId && orgId ? dismissRecordKey(orgId, userId) : null;

  const [loaded, setLoaded] = useState<{ identity: string; settings: ChecklistSettingsState } | null>(null);
  const [invited, setInvited] = useState<{ identity: string; colleagues: boolean } | null>(null);
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  // `null` until the auth config answers: drawing the self-hosted rows first
  // and the host's a moment later would move the list under the reader.
  const [profile, setProfile] = useState<FirstRunChecklistProfile | null>(null);
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
    if (!identity || !orgId || heldKey === null) return;
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
  const dismissed = recordKey !== null && (hiddenKey === recordKey || wasDismissed(deviceStorage(), recordKey));

  // Connect an AI Assistant: whether this administrator has connected one is
  // read only once the checklist is going to be drawn somewhere.
  const assistantPath = connectAssistantPath(apps);
  const assistant = useConnectedAccess({ enabled: Boolean(settings && assistantPath) });

  // Add your first record: read once the profile adds the row and the launcher
  // has answered, for the objects the environment's own apps list. Keyed on
  // that list's content, never on the array's identity (AGENTS.md #10).
  const own = ownApps(launcher.apps);
  const recordObjects = appObjectNames(own);
  const firstRecordKey =
    settings && identity && profile?.addedRows.includes('first_record') && !launcher.pending && dataSource
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

  const organizationName = activeOrganization?.name ?? '';
  // Computed on every render, from the answers above; nothing downstream keys
  // on this object's identity (AGENTS.md #10).
  const data = ((): FirstRunChecklistData | null => {
    if (!settings || !profile || !orgId || !recordKey) return null;
    const { manifest, values } = settings.localization;
    const readings: ChecklistReadings = {
      profile,
      basics: organizationBasics(manifest, values, browser, organizationName),
      ...(settings.mail ? { mail: settings.mail } : {}),
      ...(colleagues !== undefined ? { colleagues } : {}),
      ...(settings.ai ? { ai: settings.ai } : {}),
      ...(assistantPath && assistant.state === 'ready'
        ? { assistant: { path: assistantPath, connected: assistant.connected } }
        : {}),
      ...(!launcher.pending ? { firstApp: hasOwnApp(launcher.apps) } : {}),
      ...(recordCreated !== undefined ? { firstRecord: recordCreated } : {}),
    };
    const rows = checklistRows(readings);
    const setLocalization = (localization: ChecklistSettingsState['localization']) =>
      setLoaded((prev) => (prev ? { identity: prev.identity, settings: { ...prev.settings, localization } } : prev));
    return {
      orgId,
      organizationName,
      setupPath: resolveSetupAppPath(apps),
      localization: settings.localization,
      browser,
      readings,
      rows,
      completion: checklistCompletion(rows, (id) => isProfileOptionalRow(profile, id)),
      ownApps: own,
      dismissed,
      hide: () => {
        markDismissed(deviceStorage(), recordKey);
        setHiddenKey(recordKey);
      },
      localizationSaved: (written) => {
        setLocalization({ ...settings.localization, values: { ...settings.localization.values, ...written } });
        getSettingsNamespace(LOCALIZATION_NAMESPACE)
          .then((fresh) => setLocalization({ manifest: fresh.manifest, values: fresh.values }))
          .catch(() => {
            // Keep what is on screen; the next visit reads again.
          });
      },
    };
  })();

  return <FirstRunChecklistContext.Provider value={data}>{children}</FirstRunChecklistContext.Provider>;
}
