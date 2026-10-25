/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * NotificationPreferencesMenu — the two announcement switches, in the account
 * menu's Preferences section (objectui#7011).
 *
 * It sits beside Theme and Language for the reason those two are there: a
 * rarely-touched, browser-local preference that would not earn a top-bar
 * button. Rendered as plain rows rather than `DropdownMenuItem`s, matching
 * `ModeToggle` / `LocaleSwitcher` above it — a menu ITEM closes the menu when
 * activated, which would shut the panel the moment a switch is flipped and hide
 * the permission outcome the user needs to see.
 *
 * ## The desktop switch is the whole reason this file is careful
 *
 * Flipping it on is the ONLY thing in this console that calls
 * `Notification.requestPermission()`. That is not an implementation detail to
 * be tidied later: a browser answers the prompt once and `denied` is permanent
 * for the origin, so a page that asks on load spends a channel the user never
 * agreed to open, for every user who reflexively blocks. Asking from this one
 * gesture means the prompt always arrives with a reason the user just supplied.
 *
 * Three states, three answers:
 *  - no Notification API in this browser → the row is disabled and says so;
 *  - `denied` → disabled, and the hint points at browser settings, because
 *    nothing this app can do will change it;
 *  - otherwise → live, and the switch's position follows the VERDICT rather
 *    than the click (a user who blocks the prompt gets the switch back off,
 *    which is what will actually happen at delivery time).
 */

import { Switch } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useNotificationPreferences } from '../hooks/notificationPreferences.js';

export function NotificationPreferencesMenu() {
  const { t } = useObjectTranslation();
  const {
    preferences,
    desktopPermission,
    desktopSupported,
    setToastEnabled,
    enableDesktop,
    disableDesktop,
  } = useNotificationPreferences();

  const desktopBlocked = desktopPermission === 'denied';
  const desktopDisabled = !desktopSupported || desktopBlocked;

  const hint = !desktopSupported
    ? t('notifications.desktopUnsupported', {
        defaultValue: 'This browser does not support desktop notifications.',
      })
    : desktopBlocked
      ? t('notifications.desktopBlocked', {
          defaultValue: 'Blocked. Allow notifications for this site in your browser settings.',
        })
      : null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
        <span className="text-foreground/80">
          {t('notifications.toastEnabled', { defaultValue: 'In-app alerts' })}
        </span>
        <Switch
          checked={preferences.toast}
          onCheckedChange={setToastEnabled}
          data-testid="notification-toast-toggle"
          aria-label={t('notifications.toastEnabled', { defaultValue: 'In-app alerts' })}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
        <span className={desktopDisabled ? 'text-muted-foreground' : 'text-foreground/80'}>
          {t('notifications.desktopEnabled', { defaultValue: 'Desktop notifications' })}
        </span>
        <Switch
          checked={preferences.desktop && desktopPermission === 'granted'}
          disabled={desktopDisabled}
          // ⭐ The only call site of the permission prompt in this console.
          onCheckedChange={(next) => {
            if (next) void enableDesktop();
            else disableDesktop();
          }}
          data-testid="notification-desktop-toggle"
          aria-label={t('notifications.desktopEnabled', { defaultValue: 'Desktop notifications' })}
        />
      </div>
      {hint && (
        <p className="px-2 pb-1.5 text-xs text-muted-foreground" data-testid="notification-desktop-hint">
          {hint}
        </p>
      )}
    </>
  );
}
