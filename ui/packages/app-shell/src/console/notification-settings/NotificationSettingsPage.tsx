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
 * Channels are columns as the door lists them, so a channel the deployment
 * adds later (Slack, …) appears without a change here; a channel the
 * deployment cannot send on yet says so in its header.
 */

import { Suspense, useCallback, useContext, useEffect, useState } from 'react';
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
import { SchemaRendererContext, useAdapter } from '@object-ui/react';
import { PageHeader } from '../../layout/PageHeader.js';
import {
  cellWrite,
  generalWrite,
  loadMyPreferences,
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

type Load = { readonly state: 'loading' } | { readonly state: 'failed' } | { readonly state: 'read'; readonly prefs: MyPreferences };

const DIGESTS: readonly DigestCadence[] = ['none', 'daily', 'weekly'];

const DIGEST_KEY: Record<DigestCadence, string> = {
  none: 'notificationSettings.digestNone',
  daily: 'notificationSettings.digestDaily',
  weekly: 'notificationSettings.digestWeekly',
};

const SOURCE_KEY: Record<PreferenceSource, string> = {
  own: 'notificationSettings.sourceOwn',
  default: 'notificationSettings.sourceDefault',
  builtin: 'notificationSettings.sourceBuiltin',
  mandatory: 'notificationSettings.sourceMandatory',
};

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

export function NotificationSettingsPage() {
  const { t } = useObjectTranslation();
  const { user } = useAuth();
  const adapter = useAdapter();
  const apiFetch = useContext(SchemaRendererContext)?.apiFetch;
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
      if (!write || !adapter) return;
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
    [adapter, read],
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
  const canWrite = !!userId && !!adapter && !saving;
  const QuietHours = getLazyFieldWidget('quiet-hours');
  const quietValue = quietDraft === undefined ? prefs.general.quietHours.value : quietDraft;

  const topicLabel = (topic: PreferenceTopic) =>
    topic.topic === PREFERENCE_WILDCARD ? t('notificationSettings.allTopics') : topic.topic;

  const cellFor = (topic: PreferenceTopic, channel: string): PreferenceCell | undefined =>
    topic.channels.find((c) => c.channel === channel);

  return (
    <div data-testid="notification-settings-page">
      {header}
      <div className="space-y-6 p-4 sm:p-6">
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
                onChange={(e) => void apply(generalWrite(userId!, prefs.general, { digest: e.target.value as DigestCadence }))}
              >
                {DIGESTS.map((d) => (
                  <option key={d} value={d}>
                    {t(DIGEST_KEY[d])}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t(SOURCE_KEY[prefs.general.digest.source])}</p>
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
                  disabled={!canWrite || quietDraft === undefined}
                  onClick={() => void apply(generalWrite(userId!, prefs.general, { quiet_hours: quietDraft ?? null }))}
                >
                  {t('notificationSettings.save')}
                </Button>
                <span className="text-xs text-muted-foreground">{t(SOURCE_KEY[prefs.general.quietHours.source])}</span>
              </div>
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
      </div>
    </div>
  );
}
