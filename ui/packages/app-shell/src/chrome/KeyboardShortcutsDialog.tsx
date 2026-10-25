/**
 * KeyboardShortcutsDialog
 *
 * A dialog listing the keyboard shortcuts that are wired right now, triggered
 * by pressing "?".
 *
 * Its rows are not a list of its own: each one is a shortcut some mounted
 * handler advertises beside itself (`advertisedShortcuts.ts`, objectui#11674).
 * A shortcut whose handler is not mounted is not listed.
 * @module
 */

import { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useUrlOverlay } from '../hooks/useUrlOverlay.js';
import { KEYBOARD_SHORTCUTS_PARAM } from '../urlParams.js';
import {
  SHORTCUT_GROUPS,
  shortcutKeycaps,
  useAdvertiseShortcut,
  useAdvertisedShortcuts,
  type AdvertisedShortcut,
  type ShortcutGroup,
  type ShortcutLabelTranslate,
} from './advertisedShortcuts.js';

/** `?` — the handler is this component's own keydown listener below. */
const SHOW_SHORTCUTS_SHORTCUT: AdvertisedShortcut = {
  id: 'shortcuts-help',
  group: 'general',
  chord: { key: '?' },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.showShortcuts'),
};

/**
 * `Esc` — the handler is Radix's dismiss listener, which this dialog and every
 * other dialog and panel in the shell carry. Advertised here, beside the
 * `Dialog` it closes.
 */
const CLOSE_OVERLAY_SHORTCUT: AdvertisedShortcut = {
  id: 'close-overlay',
  group: 'general',
  chord: { key: 'Escape' },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.closeDialog'),
};

function groupTitle(group: ShortcutGroup, t: ShortcutLabelTranslate): string {
  switch (group) {
    case 'general':
      return t('console.shortcuts.groups.general');
    case 'navigation':
      return t('console.shortcuts.groups.navigation');
    case 'aiChat':
      return t('console.shortcuts.groups.aiChat');
  }
}

interface ShortcutRow {
  id: string;
  keys: string[];
  description: string;
}

interface ShortcutSection {
  group: ShortcutGroup;
  title: string;
  rows: ShortcutRow[];
}

export function KeyboardShortcutsDialog() {
  const { t, language } = useObjectTranslation();
  // URL-addressable (?shortcuts=1) so the dialog is deep-linkable and openable
  // from the header Help menu, not only via the `?` keyboard accelerator (ADR-0054
  // C1/C2/C3).
  const { open, setOpen, toggleOverlay } = useUrlOverlay(KEYBOARD_SHORTCUTS_PARAM);

  useAdvertiseShortcut(SHOW_SHORTCUTS_SHORTCUT);
  useAdvertiseShortcut(CLOSE_OVERLAY_SHORTCUT);
  const advertised = useAdvertisedShortcuts();

  // Sections in `SHORTCUT_GROUPS` order, rows alphabetical by their text: the
  // order handlers mount in is not an order a reader should see.
  const translate: ShortcutLabelTranslate = (key) => String(t(key));
  const sections: ShortcutSection[] = SHORTCUT_GROUPS.map((group) => ({
    group,
    title: groupTitle(group, translate),
    rows: advertised
      .filter((shortcut) => shortcut.group === group)
      .map((shortcut) => ({
        id: shortcut.id,
        keys: shortcutKeycaps(shortcut.chord),
        description: shortcut.label(translate),
      }))
      .sort((a, b) => a.description.localeCompare(b.description, language)),
  })).filter((section) => section.rows.length > 0);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only trigger when not in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleOverlay();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleOverlay]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-lg max-h-[80vh] overflow-y-auto"
        data-testid="overlay:keyboard-shortcuts"
      >
        <DialogHeader>
          <DialogTitle>{t('console.shortcuts.title')}</DialogTitle>
          <DialogDescription>
            {t('console.shortcuts.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          {sections.map(section => (
            <div key={section.group}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.rows.map(row => (
                  <div
                    key={row.id}
                    data-shortcut-id={row.id}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm">{row.description}</span>
                    <div className="flex items-center gap-1">
                      {row.keys.map((key, kidx) => (
                        <kbd
                          key={kidx}
                          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border bg-muted px-1.5 text-xs font-medium text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
