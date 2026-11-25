// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sentences Studio's suggested-audience strip says (ADR-0090 D5/D9), in
 * the designer locale, naming each suggestion's set by `setLabel`. Moved out
 * of the Access pillar unchanged (objectstack#36905) so the permission set's
 * full-screen page draws the same strip with the same words.
 */

import type { SuggestedBindingsStrings } from '../../components/SuggestedBindingsPanel.js';
import type { SuggestedBinding } from '../../services/suggestedBindingsApi.js';
import { t, tFormat } from '../metadata-admin/i18n.js';

export function accessSuggestionStrings(
  locale: string,
  setLabel: (s: SuggestedBinding) => string,
): SuggestedBindingsStrings {
  return {
    describe: (s) =>
      tFormat(
        s.anchor === 'guest' ? 'engine.studio.access.suggestPromptGuest' : 'engine.studio.access.suggestPromptEveryone',
        locale,
        { set: setLabel(s) },
      ),
    confirm: t('engine.studio.access.suggestConfirm', locale),
    confirming: t('engine.studio.access.suggestConfirming', locale),
    dismiss: t('engine.studio.access.suggestDismiss', locale),
    confirmedToast: (s) =>
      tFormat('engine.studio.access.suggestConfirmedToast', locale, { set: setLabel(s), anchor: s.anchor }),
    dismissedToast: (s) => tFormat('engine.studio.access.suggestDismissedToast', locale, { set: setLabel(s) }),
    guestUnsupported: t('engine.studio.access.suggestGuestUnsupported', locale),
    acceptedState: (s) => tFormat('engine.studio.access.suggestAcceptedState', locale, { set: setLabel(s) }),
    notInForceState: (s) => tFormat('engine.studio.access.suggestNotInForceState', locale, { set: setLabel(s) }),
    dismissedState: (s) => tFormat('engine.studio.access.suggestDismissedState', locale, { set: setLabel(s) }),
    revoke: t('engine.studio.access.suggestRevoke', locale),
    revoking: t('engine.studio.access.suggestRevoking', locale),
    revokedToast: (s) => tFormat('engine.studio.access.suggestRevokedToast', locale, { set: setLabel(s) }),
    reopen: t('engine.studio.access.suggestReopen', locale),
    reopening: t('engine.studio.access.suggestReopening', locale),
    reopenedToast: (s) => tFormat('engine.studio.access.suggestReopenedToast', locale, { set: setLabel(s) }),
  };
}
