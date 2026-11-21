// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account app's Notification Settings page (`account:notification_settings`):
 * the signed-in person's own notification preferences, as a topic × channel
 * matrix of switches plus their general digest and quiet hours.
 *
 * It draws what the messaging service's caller-scoped door answers
 * (`GET /api/v1/messaging/me/preferences`) and computes nothing itself: each
 * cell says whether it is on and whether that is the person's own setting, the
 * organization's default, the built-in default or a mandatory topic. Every
 * change writes the person's own `sys_notification_preference` row through the
 * data door, as them, and then reads the door again, so what the page shows is
 * always what is in force. See `myPreferences.ts`.
 *
 * Digest and quiet hours offer only values that take effect when saved
 * (`digestChoices`, `quietHoursSaveable`): the resolver reads a stored
 * `'none'` or an empty window as "no opinion" and falls through to the
 * organization's default, so neither is ever offered as a way to turn
 * something off.
 *
 * Channels are columns as the door lists them, so a channel the deployment
 * adds later (Slack, …) appears without a change here; a channel the
 * deployment cannot send on yet says so in its header. Where the door lists
 * `slack` (connector-slack is composed), the page also draws the person's own
 * Slack link (`SlackLinkSection`): Slack delivers only to a confirmed link.
 *
 * A caller who holds neither a create nor an edit grant on
 * `sys_notification_preference` (an external member: `external_default`
 * grants none) sees the same page read-only: every control disabled, one
 * visible reason that each control names as its description, and no write
 * sent. The grant is the framework's own answer for the caller, the
 * `/me/permissions` read `usePermissions()` serves; the page names no
 * identity. With no permission answer at all (no provider, or not loaded
 * yet) it stays writable and the server's refusal decides, as every other
 * console grant read does.
 */

import { Suspense, useCallback, useContext, useEffect, useId, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useAuth } from '@object-ui/auth';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@object-ui/components';
import { getLazyFieldWidget } from '@object-ui/fields';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { SchemaRendererContext, useAdapter } from '@object-ui/react';
import { PageHeader } from '../../layout/PageHeader.js';
import {
  cellWrite,
  digestChoices,
  quietHoursSaveable,
  generalWrite,
  loadMyPreferences,
  PREFERENCE_OBJECT,
  PREFERENCE_WILDCARD,
  sendPreferenceWrite,
  type DigestCadence,
  type MyPreferences,
  type PreferenceCell,
  type PreferenceSource,
  type PreferenceTopic,
  type PreferenceWrite,
  type QuietHoursWindow,
} from './myPreferences.js';
import { SlackLinkSection } from './SlackLinkSection.js';

type Load = { readonly state: 'loading' } | { readonly state: 'failed' } | { readonly state: 'read'; readonly prefs: MyPreferences };

const DIGEST_KEY: Record<DigestCadence, string> = {
  none: 'notificationSettings.digestNone',
  daily: 'notificationSettings.digestDaily',
  weekly: 'notificationSettings.digestWeekly',
};

/** The quiet-hours face of `@object-ui/fields`, resolved once (lazy: render inside `Suspense`). */
const QuietHours = getLazyFieldWidget('quiet-hours');

const SOURCE_KEY: Record<PreferenceSource, string> = {
  own: 'notificationSettings.sourceOwn',
  default: 'notificationSettings.sourceDefault',
  builtin: 'notificationSettings.sourceBuiltin',
  mandatory: 'notificationSettings.sourceMandatory',
};

/** The channel the Slack section belongs to, as the preference door lists it. */
const SLACK_CHANNEL = 'slack';

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export function NotificationSettingsPage() {
  const { t } = useObjectTranslation();
  const { user } = useAuth();
  const adapter = useAdapter();
  const apiFetch = useContext(SchemaRendererContext)?.apiFetch;
  const perms = usePermissions();
  // A write is a create (no own row yet) or an edit (the person's own row):
  // holding neither, every control is read-only.
  const writeGranted =
    !perms.isLoaded || perms.can(PREFERENCE_OBJECT, 'create') || perms.can(PREFERENCE_OBJECT, 'update');
  const readOnlyReasonId = useId();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quietDraft, setQuietDraft] = useState<QuietHoursWindow | null | undefined>(undefined);

  const read = useCallback(async () => {
    // The host's authenticated fetch only: a host that supplies none cannot read the door.
    if (!apiFetch) throw new Error('no authenticated fetch');
    return loadMyPreferences(apiFetch);
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    read()
      .then((prefs) => {
        if (!cancelled) setLoad({ state: 'read', prefs });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const apply = useCallback(
    async (write: PreferenceWrite | null) => {
      if (!write || !adapter || !writeGranted) return;
      setSaving(true);
      setSaveError(null);
      try {
        await sendPreferenceWrite(adapter, write);
        setLoad({ state: 'read', prefs: await read() });
        setQuietDraft(undefined);
      } catch (err) {
        setSaveError(errorText(err));
      } finally {
        setSaving(false);
      }
    },
    [adapter, read, writeGranted],
  );

  const header = (
    <PageHeader
      title={t('notificationSettings.title')}
      subtitle={t('notificationSettings.subtitle')}
      icon={<BellRing className="h-5 w-5" aria-hidden="true" />}
    />
  );

  if (load.state !== 'read') {
    return (
      <div data-testid="notification-settings-page">
        {header}
        <div className="p-4 sm:p-6">
          {load.state === 'loading' ? (
            <p className="text-sm text-muted-foreground" data-testid="notification-settings-loading">
              {t('notificationSettings.loading')}
            </p>
          ) : (
            <Alert variant="destructive" data-testid="notification-settings-load-failed">
              <AlertDescription>{t('notificationSettings.loadFailed')}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    );
  }

  const { prefs } = load;
  const userId = user?.id;
  const canWrite = !!userId && !!adapter && !saving && writeGranted;
  // Every disabled control names the one visible reason as its description.
  const readOnlyDescribedBy = writeGranted ? undefined : readOnlyReasonId;
  const quietValue = quietDraft === undefined ? prefs.general.quietHours.value : quietDraft;

  const topicLabel = (topic: PreferenceTopic) =>
    topic.topic === PREFERENCE_WILDCARD ? t('notificationSettings.allTopics') : topic.topic;

  const cellFor = (topic: PreferenceTopic, channel: string): PreferenceCell | undefined =>
    topic.channels.find((c) => c.channel === channel);

  return (
    <div data-testid="notification-settings-page">
      {header}
      <div className="space-y-6 p-4 sm:p-6">
        {!writeGranted && (
          <Alert data-testid="notification-settings-read-only">
            <AlertDescription id={readOnlyReasonId}>{t('notificationSettings.readOnly')}</AlertDescription>
          </Alert>
        )}
        {saveError !== null && (
          <Alert variant="destructive" data-testid="notification-settings-save-failed">
            <AlertDescription>{t('notificationSettings.saveFailed', { reason: saveError })}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-base font-semibold">{t('notificationSettings.general')}</h2>
            <p className="text-sm text-muted-foreground" data-testid="notification-settings-general-warning">
              {t('notificationSettings.generalWarning')}
            </p>
            <div className="space-y-1">
              <Label htmlFor="notification-settings-digest">{t('notificationSettings.digest')}</Label>
              <select
                id="notification-settings-digest"
                data-testid="notification-settings-digest"
                className="block h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm"
                value={prefs.general.digest.value}
                disabled={!canWrite}
                aria-describedby={readOnlyDescribedBy}
                onChange={(e) => {
                  const digest = e.target.value as DigestCadence;
                  // `none` is offered only while it is already the value, so it never reaches a write.
                  if (digest !== 'none') void apply(generalWrite(userId!, prefs.general, { digest }));
                }}
              >
                {digestChoices(prefs.general).map((d) => (
                  <option key={d} value={d}>
                    {t(DIGEST_KEY[d])}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground" data-testid="notification-settings-digest-source">
                {t(SOURCE_KEY[prefs.general.digest.source])}
              </p>
              {prefs.general.digest.value !== 'none' && (
                <p className="text-xs text-muted-foreground" data-testid="notification-settings-digest-no-off">
                  {t('notificationSettings.digestNoOff')}
                </p>
              )}
            </div>
            <div className="space-y-1" data-testid="notification-settings-quiet-hours">
              <Label>{t('notificationSettings.quietHours')}</Label>
              <Suspense fallback={null}>
                <QuietHours
                  value={quietValue}
                  onChange={(v: QuietHoursWindow | null) => setQuietDraft(v)}
                  field={{ name: 'quiet_hours', type: 'quiet-hours', label: t('notificationSettings.quietHours') }}
                  readonly={!canWrite}
                />
              </Suspense>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  data-testid="notification-settings-quiet-hours-save"
                  disabled={!canWrite || !quietHoursSaveable(quietDraft)}
                  aria-describedby={readOnlyDescribedBy}
                  onClick={() => {
                    if (quietHoursSaveable(quietDraft)) void apply(generalWrite(userId!, prefs.general, { quiet_hours: quietDraft }));
                  }}
                >
                  {t('notificationSettings.save')}
                </Button>
                <span className="text-xs text-muted-foreground" data-testid="notification-settings-quiet-hours-source">
                  {t(SOURCE_KEY[prefs.general.quietHours.source])}
                </span>
              </div>
              {quietDraft === null && prefs.general.quietHours.value !== null && (
                <p className="text-xs text-muted-foreground" data-testid="notification-settings-quiet-hours-no-clear">
                  {t('notificationSettings.quietHoursNoClear')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-base font-semibold">{t('notificationSettings.matrix')}</h2>
            <div className="overflow-x-auto">
              <Table data-testid="notification-settings-matrix">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('notificationSettings.topic')}</TableHead>
                    {prefs.channels.map((c) => (
                      <TableHead key={c.channel} data-testid={`notification-settings-channel-${c.channel}`}>
                        <span>{c.channel}</span>
                        {!c.configured && (
                          <Badge variant="outline" className="ml-2">
                            {t('notificationSettings.notConfigured')}
                          </Badge>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prefs.topics.map((topic) => (
                    <TableRow key={topic.topic} data-testid={`notification-settings-topic-${topic.topic}`}>
                      <TableCell className="font-medium">
                        {topicLabel(topic)}
                        {topic.mandatory && (
                          <Badge variant="secondary" className="ml-2">
                            {t('notificationSettings.alwaysDelivered')}
                          </Badge>
                        )}
                      </TableCell>
                      {prefs.channels.map((c) => {
                        const cell = cellFor(topic, c.channel);
                        if (!cell) return <TableCell key={c.channel} />;
                        const label = t('notificationSettings.toggleLabel', { topic: topicLabel(topic), channel: c.channel });
                        return (
                          <TableCell key={c.channel}>
                            <div className="flex items-center gap-2">
                              <Switch
                                aria-label={label}
                                data-testid={`notification-settings-cell-${topic.topic}-${c.channel}`}
                                checked={cell.enabled}
                                disabled={!canWrite || topic.mandatory}
                                aria-describedby={readOnlyDescribedBy}
                                onCheckedChange={(on: boolean) => void apply(cellWrite(userId!, topic, cell, on))}
                              />
                              <span className="text-xs text-muted-foreground">{t(SOURCE_KEY[cell.source])}</span>
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {apiFetch && prefs.channels.some((c) => c.channel === SLACK_CHANNEL) && <SlackLinkSection apiFetch={apiFetch} />}
      </div>
    </div>
  );
}
