// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 「⋯」 package menu (objectstack#37139), at the end of 概览 Overview's
 * header (objectstack#37454; ADR-0084, amended 2026-11-26), moved there from
 * the Studio top bar's left end with its rows unchanged. With the Studio home gone
 * (objectstack#36908), it is the door to the Packages page's development-face
 * actions on the open package — the maintainer's table, in its order:
 *
 *   1. Edit package info — the development face's Edit dialog; greyed on a
 *      read-only package.
 *   2. Export — the export door's file, downloaded.
 *   3. Duplicate as a new package — the development face's Duplicate form, in
 *      a dialog. The server refuses to duplicate a read-only package
 *      (`DUPLICATE_SOURCE_NOT_A_BASE`) and the development face does not offer
 *      it there, so it is greyed there too.
 *   4. Revert to last publish — the development face's Revert, asked first;
 *      greyed on a read-only package and while nothing has changed since the
 *      last publish (the pending-changes count the top bar already reads).
 *   5. Adopt loose items — the development face's confirmation, then its
 *      adoption; greyed on a read-only package.
 *   6. Manage in Setup… — Setup → Packages on this package's row, where it is
 *      enabled, disabled or deleted.
 *
 * Every request, dialog and form is the development face's own, imported from
 * `metadata-admin/packageActions.tsx`; ⛔ never a second copy. What differs is
 * where the answer goes: a toast, as everywhere else in Studio, instead of the
 * sheet's message line. Publishing every draft is not here: 概览's Pending tab
 * and the top bar's Changes and Publish already do it. Disabling, enabling
 * and deleting stay in Setup → Packages (question 1 on the amendment, ruled
 * B), reached by Manage in Setup….
 *
 * The host draws the menu only where there is a current package (never on
 * `~org` or `~all`) and only for a `manage_metadata` holder
 * (`useCanAuthorMetadata`). Writability the host has not learned yet (still
 * reading, or the read failed) greys nothing: the server's write gate stays the
 * authority, the same courtesy posture as the rest of Studio.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Download, Inbox, MoreHorizontal, Pencil, Settings, Undo2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { t, tFormat } from '../metadata-admin/i18n.js';
import {
  AdoptLooseItemsDialog,
  DuplicatePackageForm,
  EditPackageDialog,
  adoptLooseItems,
  adoptedText,
  exportPackageFile,
  revertPackage,
} from '../metadata-admin/packageActions.js';
import type { PackageManifestRow } from '../metadata-admin/PackagesPage.js';
import { setupPackagePath } from '../metadata-admin/packageSource.js';
import { duplicatePackage, fetchListedPackageManifests } from './packages-io.js';

/** The menu's items, in the table's order; each `data-testid` is `studio-package-menu-<item>`. */
export const STUDIO_PACKAGE_MENU_ITEMS = ['edit', 'export', 'duplicate', 'revert', 'adopt', 'manage'] as const;
export type StudioPackageMenuItem = (typeof STUDIO_PACKAGE_MENU_ITEMS)[number];

type Busy = 'edit' | 'export' | 'duplicate' | 'revert' | 'adopt' | null;

const failureText = (e: unknown, locale: string): string =>
  e instanceof Error && e.message ? e.message : t('engine.packages.detail.actionFailed', locale);

export function StudioPackageMenu({
  packageId,
  packageName,
  writable,
  pendingCount,
  locale,
  onChanged,
  onRenamed,
  beforeNavigate,
  navigate,
}: {
  /** The open package. */
  packageId: string;
  /** Its display name, as the top bar shows it; the id while unknown. */
  packageName: string;
  /** The server's verdict; `null` / `undefined` while unknown greys nothing. */
  writable: boolean | null | undefined;
  /** The open package's pending changes; `null` while unknown greys nothing. */
  pendingCount: number | null;
  locale: string;
  /** A revert or an adoption changed what the package holds: the host re-reads it. */
  onChanged: () => void;
  /** The package info was saved under this name. */
  onRenamed: (name: string) => void;
  /** The host's unsaved-work veto: return false to stay. */
  beforeNavigate: () => boolean;
  navigate: (path: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<Busy>(null);
  const [editRow, setEditRow] = React.useState<{ manifest: PackageManifestRow } | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [dupOpen, setDupOpen] = React.useState(false);
  const [dupRefusal, setDupRefusal] = React.useState<string | null>(null);
  const [revertOpen, setRevertOpen] = React.useState(false);
  const [adoptOpen, setAdoptOpen] = React.useState(false);

  const readOnly = writable === false;
  const readOnlyReason = t('engine.studio.pkg.readonlyHint', locale);
  const noChanges = pendingCount === 0;
  const revertReason = readOnly ? readOnlyReason : noChanges ? t('engine.studio.packageMenu.noChanges', locale) : null;

  /** One action from start to answer: busy while it runs, a toast with its answer. */
  async function run(action: Exclude<Busy, null>, fn: () => Promise<string>) {
    setBusy(action);
    try {
      toast.success(await fn());
    } catch (e) {
      toast.error(failureText(e, locale));
    } finally {
      setBusy(null);
    }
  }

  // The Edit dialog reads the package's manifest as `/api/v1/packages` lists
  // it, the row the development face's sheet opens it on.
  const openEdit = () =>
    void (async () => {
      setBusy('edit');
      try {
        const listed = (await fetchListedPackageManifests()).get(packageId);
        if (!listed) throw new Error(t('engine.packages.loadFailed', locale));
        setEditRow({ manifest: listed.manifest as PackageManifestRow });
        setEditOpen(true);
      } catch (e) {
        toast.error(failureText(e, locale));
      } finally {
        setBusy(null);
      }
    })();

  const duplicate = async (target: string, name: string) => {
    setBusy('duplicate');
    setDupRefusal(null);
    try {
      await duplicatePackage(packageId, target, name);
      setDupOpen(false);
      toast.success(t('engine.packages.detail.duplicated', locale));
    } catch (e) {
      // The dialog stays open on the names the author typed, the refusal under them.
      setDupRefusal(failureText(e, locale));
    } finally {
      setBusy(null);
    }
  };

  const item = (
    id: StudioPackageMenuItem,
    icon: React.ReactNode,
    label: string,
    onSelect: () => void,
    disabledReason: string | null = null,
  ) => (
    <DropdownMenuItem
      data-testid={`studio-package-menu-${id}`}
      disabled={busy !== null || disabledReason !== null}
      data-disabled-reason={disabledReason ?? undefined}
      title={disabledReason ?? undefined}
      onSelect={onSelect}
    >
      {icon}
      {label}
    </DropdownMenuItem>
  );
  const iconClass = 'mr-2 h-3.5 w-3.5';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="studio-package-menu"
            aria-label={t('engine.studio.packageMenu.trigger', locale)}
            title={t('engine.studio.packageMenu.trigger', locale)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="studio-package-menu-content">
          {item(
            'edit',
            <Pencil className={iconClass} aria-hidden="true" />,
            t('engine.studio.packageMenu.editInfo', locale),
            openEdit,
            readOnly ? readOnlyReason : null,
          )}
          {item(
            'export',
            <Download className={iconClass} aria-hidden="true" />,
            t('engine.packages.detail.export', locale),
            () =>
              void run('export', async () => {
                await exportPackageFile(packageId);
                return t('engine.packages.detail.exported', locale);
              }),
          )}
          {item(
            'duplicate',
            <Copy className={iconClass} aria-hidden="true" />,
            t('engine.studio.packageMenu.duplicate', locale),
            () => {
              setDupRefusal(null);
              setDupOpen(true);
            },
            readOnly ? readOnlyReason : null,
          )}
          {item(
            'revert',
            <Undo2 className={iconClass} aria-hidden="true" />,
            t('engine.studio.packageMenu.revert', locale),
            () => setRevertOpen(true),
            revertReason,
          )}
          {item(
            'adopt',
            <Inbox className={iconClass} aria-hidden="true" />,
            t('engine.packages.detail.adoptOrphans', locale),
            () => setAdoptOpen(true),
            readOnly ? readOnlyReason : null,
          )}
          <DropdownMenuSeparator />
          {item(
            'manage',
            <Settings className={iconClass} aria-hidden="true" />,
            t('engine.studio.packageMenu.manageInSetup', locale),
            () => {
              if (!beforeNavigate()) return;
              navigate(setupPackagePath(packageId));
            },
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditPackageDialog
        pkg={editRow}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => {
          toast.success(t('engine.packages.edit.saved', locale));
          const name = updated?.manifest?.name;
          if (typeof name === 'string' && name.trim()) onRenamed(name);
        }}
      />

      <Dialog open={dupOpen} onOpenChange={(open: boolean) => busy !== 'duplicate' && setDupOpen(open)}>
        <DialogContent data-testid="studio-package-menu-duplicate-dialog">
          <DialogHeader>
            <DialogTitle>{tFormat('engine.studio.packageMenu.duplicateTitle', locale, { name: packageName })}</DialogTitle>
            <DialogDescription>{t('engine.studio.packageMenu.duplicateDescription', locale)}</DialogDescription>
          </DialogHeader>
          {dupOpen && (
            <DuplicatePackageForm
              sourceId={packageId}
              displayName={packageName}
              busy={busy !== null}
              duplicating={busy === 'duplicate'}
              onDuplicate={(target, name) => void duplicate(target, name)}
              onCancel={() => setDupOpen(false)}
              locale={locale}
            />
          )}
          {dupRefusal && (
            <p role="alert" data-testid="studio-package-menu-duplicate-refusal" className="text-sm text-destructive">
              {dupRefusal}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent data-testid="studio-package-menu-revert-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{tFormat('engine.studio.packageMenu.revertTitle', locale, { name: packageName })}</AlertDialogTitle>
            <AlertDialogDescription>{t('engine.studio.packageMenu.revertDescription', locale)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="studio-package-menu-revert-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="studio-package-menu-revert-confirm"
              onClick={() =>
                void run('revert', async () => {
                  await revertPackage(packageId);
                  onChanged();
                  return t('engine.packages.detail.reverted', locale);
                })
              }
            >
              {t('engine.packages.detail.revert', locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AdoptLooseItemsDialog
        open={adoptOpen}
        onOpenChange={setAdoptOpen}
        displayName={packageName}
        onConfirm={() => {
          setAdoptOpen(false);
          void run('adopt', async () => {
            const count = await adoptLooseItems(packageId);
            onChanged();
            return adoptedText(count, locale);
          });
        }}
        locale={locale}
      />
    </>
  );
}
