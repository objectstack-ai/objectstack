/**
 * LocaleSwitcher
 *
 * Dropdown menu for switching the application language.
 * Uses the i18n context to change language at runtime.
 *
 * The menu is not a list of its own (objectui#4039): it renders whatever the
 * i18n provider says is offerable — the app's own locale list ∩ what the
 * renderer can resolve. This file owns only the *labels*, because the native
 * names are the one piece of that no API response supplies:
 * `GET /api/v1/i18n/locales` returns descriptors whose `label` is the code
 * echoed back (`toLocaleDescriptors` in @objectstack/spec), so a server label
 * would put `th` in the menu where `ไทย` belongs. The built-in packs are named
 * from the platform locale table instead, every other code by the runtime.
 *
 * It is also not a device-local setting any more (objectui#10059). A switch made
 * while signed in writes `sys_user.locale` — the column the profile page's
 * language card already writes — so the two controls are two faces of one
 * stored value instead of two settings sharing one word. `useLanguageSelection`
 * owns that; this file owns the menu.
 */

import { Globe } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { PLATFORM_LOCALES } from '@objectstack/spec/system';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { useLanguageSelection } from '../hooks/useUserLocale.js';

/**
 * Native display names for the built-in language packs, read from the
 * platform locale table (`PLATFORM_LOCALES` in `@objectstack/spec/system`):
 * each row's `label` is the language's own name for itself, the name a
 * language menu shows. The table is the one list of platform languages, so
 * there is no second, hand-kept list of names here. Indexed by the row's
 * canonical `tag` (`en`, `zh-Hans`, `pt-BR`, …).
 *
 * A `Map` rather than an object literal so a code like `constructor` cannot
 * pick a label off `Object.prototype`.
 */
const BUILT_IN_LABEL_BY_TAG: ReadonlyMap<string, string> = new Map(
  PLATFORM_LOCALES.map((row): [string, string] => [row.tag, row.label]),
);

/**
 * Name a locale in its own language.
 *
 * A platform locale table tag is named by its row's `label`, which is the
 * same on every runtime and ICU version. Any other code (an app-shipped
 * locale like `th`) goes through `Intl.DisplayNames` in the locale itself, so
 * a menu of app locales reads the way the built-in ones do (native, not
 * translated into the current UI language). Every failure degrades to the
 * bare code, which is still a selectable, honest entry: `Intl.DisplayNames`
 * is absent on old runtimes, throws `RangeError` on a malformed tag, and
 * returns the input unchanged for a tag it has no name for.
 */
export function localeLabel(code: string): string {
  const builtIn = BUILT_IN_LABEL_BY_TAG.get(code);
  if (builtIn) return builtIn;
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (!name || name === code) return code;
    // CLDR names many languages lowercase (`português (Brasil)`); the built-in
    // labels are capitalized, and a menu mixing both reads as a bug. A no-op
    // for caseless scripts (ไทย, العربية).
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code;
  }
}

export function LocaleSwitcher() {
  const { t, language, offerableLanguages } = useObjectTranslation();
  // ⛔ Not the i18n context's bare `changeLanguage`: while signed in the switch
  // has to reach `sys_user.locale`, or the globe and the profile page go on
  // naming two settings (objectui#10059). Signed out it IS the bare switch.
  const selectLanguage = useLanguageSelection();

  // Still asking the app which locales it ships. Render nothing rather than a
  // fallback list that would be replaced a tick later — the same idiom the
  // sibling menus in this folder use for data they do not have yet
  // (`AppSwitcher`, `WorkspaceSwitcher`), and it keeps the ten from flashing
  // past on an app that only ships two.
  if (offerableLanguages === null) return null;

  // objectui#13254 — a switch drops a page's unsaved edits: the console shell
  // remounts every page on a language change (`key={language}` in
  // `ConnectedShellInner`, which relabels the labels the server translates). So
  // while a page holds edits the switch asks that page's own question first;
  // Cancel keeps the language and the edits. The entry already checked asks
  // too: picking it still rewrites `sys_user.locale` and hands every reader a
  // new `t`, so it is not a no-op a dirty page can be sure to survive.
  // The promise is returned, as the header's other menu entries do, so the
  // tab-close prompt does not ask a second time while the switch is under way.
  const pick = (code: string) => confirmUnsavedLeave(() => selectLanguage(code));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 max-md:size-11">
          <Globe className="h-4 w-4" />
          <span className="sr-only">{t('console.localeSwitcher.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      {/* 44 px rows below `md`, as the top bar's menus (objectstack#29075). */}
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto max-md:[&_[role=menuitem]]:min-h-11">
        {offerableLanguages.map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => pick(code)}
            className="gap-2"
          >
            {localeLabel(code)}
            {language === code && <span className="ml-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
