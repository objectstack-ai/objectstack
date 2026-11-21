// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * HelpMenu — the console's 「?」 menu, drawn once and placed by two hosts
 * (objectstack#36111): the top bar (`AppHeader`) and the page's top-right
 * button group (`ShellPageActions`). One component, so the two cannot drift
 * while both exist, and the top bar's removal deletes a reference, not a copy.
 *
 * An aggregated menu rather than a bare external link:
 *  1. 「This app's docs」 — only inside an app whose package ships `doc`
 *     metadata (ADR-0046), read lazily on the first open (names and labels
 *     only; the list response omits `content`);
 *  2. 「All documentation」 — the in-product docs hub;
 *  3. 「Keyboard shortcuts」 — inside an app, the dialog the `?` key opens
 *     (C2/C3: the `?shortcuts=1` URL param);
 *  4. 「Online documentation」 — the public docs site;
 *  5. 「About」 — the console's own build (objectui#12970).
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@object-ui/components';
import { BookOpen, ExternalLink, HelpCircle, Info, Keyboard, Layers } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useUrlOverlay } from '../hooks/useUrlOverlay.js';
import { KEYBOARD_SHORTCUTS_PARAM } from '../urlParams.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { AboutDialog } from './AboutDialog.js';
import { getConsoleBuild } from '../buildIdentity.js';

export interface HelpMenuProps {
  /** Inside an app: draws 「Keyboard shortcuts」. */
  inApp: boolean;
  /** The current app's package id, which owns the app's docs; absent outside an app. */
  appPackageId?: string;
  /** The trigger's classes: each host sizes and hides it for its own bar. */
  triggerClassName?: string;
  /** The trigger's `data-testid`, for a host that addresses it. */
  triggerTestId?: string;
}

type HelpDoc = { name: string; label?: string; _packageId?: string };

export function HelpMenu({ inApp, appPackageId, triggerClassName, triggerTestId }: HelpMenuProps) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  // objectui#13231 — the menu navigates from a button, which no page's link
  // guard sees, so a departure asks first while a page holds unsaved edits.
  const leaveTo = (to: string) => confirmUnsavedLeave(() => navigate(to));
  const { openOverlay: openShortcuts } = useUrlOverlay(KEYBOARD_SHORTCUTS_PARAM);
  // Ephemeral, so component state, not a URL param — nobody shares a link to it.
  const [aboutOpen, setAboutOpen] = useState(false);
  const dataSource = useAdapter();

  // `null` = not yet loaded, `[]` = loaded-but-empty.
  const [helpDocs, setHelpDocs] = useState<HelpDoc[] | null>(null);
  const loadHelpDocs = useCallback(async () => {
    if (helpDocs !== null) return; // fetch at most once per mount
    try {
      const client: any = dataSource?.getClient?.();
      if (!client?.meta?.getItems) {
        setHelpDocs([]);
        return;
      }
      const result: any = await client.meta.getItems('doc');
      // `meta.getItems` answers the `{ type, items: [...] }` envelope (or a
      // bare array from the ADR-0037 preview path) — the two shapes
      // `MetadataProvider`'s `extractItems` accepts. A `value` arm used to
      // trail them; measured zero producers emit `value` at THIS seam
      // (objectui#6917), so it is gone (AGENTS.md #0.1).
      const items: any[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.items)
          ? result.items
          : [];
      setHelpDocs(
        items
          .map((it) => ({ name: it?.name, label: it?.label, _packageId: it?._packageId }))
          .filter((d) => d.name),
      );
    } catch {
      // Soft-degrade: docs are an optional feature — a failed fetch just
      // means the menu shows the static entries (All docs / Online docs).
      setHelpDocs([]);
    }
  }, [helpDocs, dataSource]);

  // Docs owned by the current app, matched by package id (the precise owner
  // link; ADR-0048). Empty outside an app, for an app that ships no docs, or
  // before the lazy read has run.
  const appDocs = appPackageId ? (helpDocs ?? []).filter((d) => d._packageId === appPackageId) : [];

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (open) void loadHelpDocs(); }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={triggerClassName}
            aria-label={t('sidebar.helpTooltip', { defaultValue: 'Help & Documentation' })}
            data-testid={triggerTestId}
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56 rounded-lg" sideOffset={4}>
          {appDocs.length > 0 && appPackageId ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() =>
                leaveTo(
                  appDocs.length === 1
                    ? `/apps/${appPackageId}/docs/${appDocs[0].name}`
                    : `/apps/${appPackageId}/docs`,
                )
              }
            >
              <BookOpen className="mr-2 h-4 w-4" />
              {t('help.appDocs', { defaultValue: "This app's docs" })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="cursor-pointer" onClick={() => leaveTo('/docs')}>
            <Layers className="mr-2 h-4 w-4" />
            {t('help.allDocs', { defaultValue: 'All documentation' })}
          </DropdownMenuItem>
          {inApp ? (
            <DropdownMenuItem
              className="cursor-pointer"
              data-testid="action:keyboard-shortcuts:open"
              onClick={openShortcuts}
            >
              <Keyboard className="mr-2 h-4 w-4" />
              {t('help.keyboardShortcuts', { defaultValue: 'Keyboard shortcuts' })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer">
            <a href="https://docs.objectstack.ai" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('help.onlineDocs', { defaultValue: 'Online documentation' })}
            </a>
          </DropdownMenuItem>
          {/* About — names the console's own build, on every variant
              (objectui#12970). */}
          <DropdownMenuItem
            className="cursor-pointer"
            data-testid="action:about:open"
            onClick={() => setAboutOpen(true)}
          >
            <Info className="mr-2 h-4 w-4" />
            {t('help.about', { defaultValue: 'About' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} build={getConsoleBuild()} />
    </>
  );
}
