// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <WorkspaceTimezonePrompt> — asks an administrator ONCE to set a workspace
 * timezone that is still the manifest default, pre-filled with the browser's
 * zone (objectui#11758, the gate the objectui#11693 ruling put on PR #11729).
 *
 * Mounted once, in the console's app shell (`AppContent`), inside the
 * `MePermissionsProvider` that shell already mounts: that provider is what
 * answers which capabilities this session holds. When to ask, and what to
 * offer, is decided in `workspaceTimezonePromptLogic.ts`; this file is the dialog.
 *
 * Both halves of the write are the Settings page's own:
 *
 * - the FIELD is `<SettingsField>` rendering the manifest's own `timezone`
 *   specifier, so the zone is edited in the same control (the `valueDomain`
 *   combobox with the curated zones as suggestions), with the same translated
 *   label and help, and a refusal lands in the same error slot;
 * - the WRITE is `saveSettingsNamespace('localization', { timezone })`, the
 *   function `SettingsView` saves through: one `PUT /api/settings/localization`,
 *   judged by the server against the manifest's `writePermission` and audited
 *   like any other settings save.
 *
 * Decline writes nothing. Closing the dialog any other way (Escape, the
 * overlay, the close button) is a decline.
 *
 * Its settings read waits for the console's first paint (`whenBootPainted`,
 * objectui#12980): this component mounts beside the routes, under the boot
 * splash, and a dialog has nothing to say before the page it sits over has
 * painted — so the read no longer goes out beside the page's own reads.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { extractFieldErrors } from '@object-ui/react';
import { SettingsField } from './SettingsField';
import { lockedKeyOf, saveSettingsNamespace } from './api';
import { useSettingsLabel } from './useSettingsLabel';
import { whenBootPainted } from '../../loadLocales';
import {
  LOCALIZATION_NAMESPACE,
  TIMEZONE_KEY,
  browserTimeZone,
  deviceStorage,
  findTimezoneOffer,
  markAsked,
  promptRecordKey,
  wasAsked,
  type TimezoneOffer,
} from './workspaceTimezonePromptLogic';

export function WorkspaceTimezonePrompt() {
  const { t } = useObjectTranslation();
  const { user, activeOrganization } = useAuth();
  const { systemPermissions } = usePermissions();
  const labels = useSettingsLabel(LOCALIZATION_NAMESPACE);

  const [offer, setOffer] = useState<TimezoneOffer | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  const userId = user?.id;
  const orgId = activeOrganization?.id;
  // Keyed on the capability LIST's content, never on the array's identity
  // (AGENTS.md #10): a provider refetch that answers the same set must not
  // re-run the decision. `null` keeps "not reported" apart from "holds nothing".
  const heldKey = Array.isArray(systemPermissions) ? systemPermissions.join('\n') : null;

  useEffect(() => {
    if (!userId || !orgId || heldKey === null) return;
    const storage = deviceStorage();
    const recordKey = promptRecordKey(orgId, userId);
    if (!storage || wasAsked(storage, recordKey)) return;
    const zone = browserTimeZone();
    if (!zone) return;
    const held = heldKey === '' ? [] : heldKey.split('\n');

    let cancelled = false;
    whenBootPainted()
      .then(() => (cancelled ? null : findTimezoneOffer(held, zone)))
      .then((found) => {
        if (cancelled || !found) return;
        // Re-read: another tab may have shown it while this one was fetching.
        if (wasAsked(storage, recordKey) || !markAsked(storage, recordKey)) return;
        setOffer(found);
        setDraft(found.zone);
        setOpen(true);
      })
      .catch(() => {
        // A settings service that is absent or failing is not a reason to ask.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, orgId, heldKey]);

  if (!offer) return null;

  const onConfirm = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setFieldError(undefined);
    try {
      await saveSettingsNamespace(LOCALIZATION_NAMESPACE, { [TIMEZONE_KEY]: draft });
      toast.success(t('console.workspaceTimezonePrompt.saved', { zone: draft }));
      setOpen(false);
    } catch (err) {
      // The Settings page's own reading of a refused save, for the one key
      // this dialog writes: a lock names the key, a validation refusal lands
      // in the field's error slot, anything else carries the server's sentence.
      // `api.ts` parks the raw error body on `err.payload`.
      const failure = err as { message?: string; payload?: { error?: { code?: unknown } } } | undefined;
      const apiError = failure?.payload?.error;
      if (apiError?.code === 'SETTINGS_LOCKED') {
        const key = lockedKeyOf(apiError);
        toast.error(
          key
            ? t('console.settingsView.lockedByEnv', { key })
            : t('console.settingsView.lockedByEnvNoKey'),
        );
      } else {
        const refused = extractFieldErrors(apiError)?.find((f) => f.field === TIMEZONE_KEY);
        if (refused) setFieldError(refused.message);
        toast.error(failure?.message ?? t('console.settingsView.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) setOpen(false);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="workspace-timezone-prompt">
        <DialogHeader>
          <DialogTitle>{t('console.workspaceTimezonePrompt.title')}</DialogTitle>
          <DialogDescription>
            {t('console.workspaceTimezonePrompt.description', { current: offer.current })}
          </DialogDescription>
        </DialogHeader>
        <SettingsField
          spec={offer.spec}
          resolved={offer.resolved}
          value={draft}
          onChange={(next) => {
            setDraft(next == null ? '' : String(next));
            setFieldError(undefined);
          }}
          saving={saving}
          labels={labels}
          error={fieldError}
        />
        <p className="text-xs text-muted-foreground">
          {t('console.workspaceTimezonePrompt.laterHint')}
        </p>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={saving}
            data-testid="workspace-timezone-prompt-decline"
          >
            {t('console.workspaceTimezonePrompt.decline')}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={saving || !draft}
            data-testid="workspace-timezone-prompt-confirm"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {t('console.workspaceTimezonePrompt.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
