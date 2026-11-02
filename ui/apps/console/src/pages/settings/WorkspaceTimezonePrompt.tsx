// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * <WorkspaceTimezonePrompt> — asks an administrator ONCE to set a workspace
 * timezone that is still the manifest default, pre-filled with the browser's
 * zone (objectui#11758, the gate the objectui#11693 ruling put on PR #11729),
 * and a default currency that is still unset, pre-filled with the currency of
 * the browser's region (objectstack#28872). When both are unset it is one
 * dialog with both fields, and one write.
 *
 * Mounted once, in the console's app shell (`AppContent`), inside the
 * `MePermissionsProvider` that shell already mounts: that provider is what
 * answers which capabilities this session holds. When to ask, and what to
 * offer, is decided in `workspaceTimezonePromptLogic.ts`; this file is the dialog.
 *
 * Both halves of the write are the Settings page's own:
 *
 * - each FIELD is `<SettingsField>` rendering the manifest's own `timezone` or
 *   `currency` specifier, so the value is edited in the same control (the
 *   `valueDomain` combobox with the curated options as suggestions), with the
 *   same translated label and help, and a refusal lands in the same error slot;
 * - the WRITE is `saveSettingsNamespace('localization', { timezone, currency })`
 *   carrying the keys whose field holds a value, the function `SettingsView`
 *   saves through: one `PUT /api/settings/localization`, judged by the server
 *   against the manifest's `writePermission` and audited like any other
 *   settings save.
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
  CURRENCY_KEY,
  LOCALIZATION_NAMESPACE,
  TIMEZONE_KEY,
  browserCurrency,
  browserTimeZone,
  deviceStorage,
  findWorkspacePromptOffer,
  markAsked,
  promptRecordKey,
  wasAsked,
  type WorkspacePromptOffer,
} from './workspaceTimezonePromptLogic';

/** A currency's name in `language`, or `undefined` where `Intl.DisplayNames` cannot answer. */
function currencyName(language: string, code: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([language], { type: 'currency' }).of(code);
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

type FieldErrors = Partial<Record<typeof TIMEZONE_KEY | typeof CURRENCY_KEY, string>>;

export function WorkspaceTimezonePrompt() {
  const { t, language } = useObjectTranslation();
  const { user, activeOrganization } = useAuth();
  const { systemPermissions } = usePermissions();
  const labels = useSettingsLabel(LOCALIZATION_NAMESPACE);

  const [offer, setOffer] = useState<WorkspacePromptOffer | null>(null);
  const [open, setOpen] = useState(false);
  const [zoneDraft, setZoneDraft] = useState('');
  const [currencyDraft, setCurrencyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
    const browser = { zone: browserTimeZone(), currency: browserCurrency() };
    if (!browser.zone && !browser.currency) return;
    const held = heldKey === '' ? [] : heldKey.split('\n');

    let cancelled = false;
    whenBootPainted()
      .then(() => (cancelled ? null : findWorkspacePromptOffer(held, browser)))
      .then((found) => {
        if (cancelled || !found) return;
        // Re-read: another tab may have shown it while this one was fetching.
        if (wasAsked(storage, recordKey) || !markAsked(storage, recordKey)) return;
        setOffer(found);
        setZoneDraft(found.timezone?.zone ?? '');
        setCurrencyDraft(found.currency?.currency ?? '');
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

  const { timezone, currency } = offer;
  const both = Boolean(timezone && currency);
  // The keys Confirm writes: an arm whose field was cleared is left unset.
  const changes: Record<string, string> = {};
  if (timezone && zoneDraft) changes[TIMEZONE_KEY] = zoneDraft;
  if (currency && currencyDraft) changes[CURRENCY_KEY] = currencyDraft;
  const hasChanges = Object.keys(changes).length > 0;

  // The offer as the copy names it: the currency's name in the UI language, and its code.
  const offered = currency
    ? { name: currencyName(language, currency.currency) ?? currency.currency, code: currency.currency }
    : undefined;

  const title = both
    ? t('console.workspaceTimezonePrompt.bothTitle')
    : currency
      ? t('console.workspaceTimezonePrompt.currencyTitle')
      : t('console.workspaceTimezonePrompt.title');
  const confirmLabel = both
    ? t('console.workspaceTimezonePrompt.bothConfirm')
    : currency
      ? t('console.workspaceTimezonePrompt.currencyConfirm')
      : t('console.workspaceTimezonePrompt.confirm');
  // "Keep the default" names the timezone's manifest default; the currency has none to keep.
  const declineLabel = currency
    ? t('console.workspaceTimezonePrompt.notNow')
    : t('console.workspaceTimezonePrompt.decline');

  const savedMessage = () => {
    const zone = changes[TIMEZONE_KEY];
    const code = changes[CURRENCY_KEY];
    if (zone && code) return t('console.workspaceTimezonePrompt.bothSaved', { zone, currency: code });
    if (code) return t('console.workspaceTimezonePrompt.currencySaved', { currency: code });
    return t('console.workspaceTimezonePrompt.saved', { zone });
  };

  const onConfirm = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      await saveSettingsNamespace(LOCALIZATION_NAMESPACE, changes);
      toast.success(savedMessage());
      setOpen(false);
    } catch (err) {
      // The Settings page's own reading of a refused save, for the keys this
      // dialog writes: a lock names the key, a validation refusal lands in the
      // field's error slot, anything else carries the server's sentence.
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
        const refused: FieldErrors = {};
        for (const f of extractFieldErrors(apiError) ?? []) {
          if (f.field === TIMEZONE_KEY || f.field === CURRENCY_KEY) refused[f.field] = f.message;
        }
        setFieldErrors(refused);
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {timezone
              ? t('console.workspaceTimezonePrompt.description', { current: timezone.current })
              : t('console.workspaceTimezonePrompt.currencyDescription', offered)}
          </DialogDescription>
        </DialogHeader>
        {timezone ? (
          <SettingsField
            spec={timezone.spec}
            resolved={timezone.resolved}
            value={zoneDraft}
            onChange={(next) => {
              setZoneDraft(next == null ? '' : String(next));
              setFieldErrors((prev) => ({ ...prev, [TIMEZONE_KEY]: undefined }));
            }}
            saving={saving}
            labels={labels}
            error={fieldErrors[TIMEZONE_KEY]}
          />
        ) : null}
        {both ? (
          <p className="text-sm text-muted-foreground" data-testid="workspace-timezone-prompt-currency-description">
            {t('console.workspaceTimezonePrompt.currencyDescription', offered)}
          </p>
        ) : null}
        {currency ? (
          <SettingsField
            spec={currency.spec}
            resolved={currency.resolved}
            value={currencyDraft}
            onChange={(next) => {
              setCurrencyDraft(next == null ? '' : String(next));
              setFieldErrors((prev) => ({ ...prev, [CURRENCY_KEY]: undefined }));
            }}
            saving={saving}
            labels={labels}
            error={fieldErrors[CURRENCY_KEY]}
          />
        ) : null}
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
            {declineLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={saving || !hasChanges}
            data-testid="workspace-timezone-prompt-confirm"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
