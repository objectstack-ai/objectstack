// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — the create ask: a create that names no package asks the
 * person to pick a package or create one, before anything is written
 * (ADR-0070 D3, ADR-0084's amendment of 2026-11-26: "When no package resolves,
 * the interface asks the person to pick a package or create one"; ruling
 * 7184753035 on topic objectstack#37424).
 *
 * One component, every create path: Setup's metadata lists and the item
 * editor (`ResourceListPage`, `ResourceEditPage`), Studio's cross-package leg,
 * a new view or report in an app (`runtime-metadata-persistence.ts`) and the
 * console's create-app wizard.
 *
 * Invariants:
 *  - The choose list holds the packages the server says this caller may
 *    write (`writable: true` on `GET /api/v1/packages`, read through
 *    {@link fetchPackages}), never a client guess, and never a kernel package.
 *    A read-only base appears only as its `.custom` pair, and only once that
 *    pair is a listed writable package.
 *  - The heuristic pick a caller has (the current app's package, the package
 *    owning the most rows of the type) is pre-selected, never taken as the
 *    answer: the person confirms it.
 *  - "Create a new one" reuses the Packages page's create dialog
 *    ({@link CreatePackageDialog}); the package it creates is the answer.
 *  - The answer is a package id; Cancel answers `null`, and the caller then
 *    writes nothing.
 */

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@object-ui/components';
import { fetchPackages, type PkgEntry } from '../studio-design/packages-io.js';
import { CreatePackageDialog } from './PackagesPage.js';
import { t, tFormat, useMetadataLocale } from './i18n.js';

/**
 * The location-state key a list's package repair writes beside the
 * `?package=` it repaired, holding that package id: the mark that tells a
 * heuristic pick from a package the person named (a link, or the scope
 * selector, writes no such state). Kept by the list's own address writes.
 */
export const PACKAGE_PICKED_STATE = 'objectui.packagePicked';

/** What a caller asks with. */
export interface PackageAskRequest {
  /** The heuristic pick, pre-selected when the list holds it. */
  preselect?: string | null;
  /** The type being created, as the reader reads it; names the question. */
  typeLabel?: string;
}

/** The packages the ask offers: the server's writable verdict, kernel packages out, by name. */
export function packageAskOptions(entries: readonly PkgEntry[]): PkgEntry[] {
  return entries
    .filter((p) => p.writable && !p.kernel)
    .sort((a, b) => a.name.localeCompare(b.name));
}

type ListState = { status: 'loading' } | { status: 'read'; options: PkgEntry[] } | { status: 'failed'; error: string };

export function PackageCreateAskDialog({
  open,
  preselect,
  typeLabel,
  onAnswer,
  readPackages = fetchPackages,
}: PackageAskRequest & {
  open: boolean;
  /** The chosen or created package id, or `null` for Cancel. */
  onAnswer: (packageId: string | null) => void;
  /** The list read; a test hands its own. */
  readPackages?: () => Promise<PkgEntry[]>;
}) {
  const locale = useMetadataLocale();
  const [list, setList] = React.useState<ListState>({ status: 'loading' });
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const answeredRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    answeredRef.current = false;
    setCreating(false);
    setList({ status: 'loading' });
    setChosen(null);
    let cancelled = false;
    readPackages()
      .then((entries) => {
        if (cancelled) return;
        const options = packageAskOptions(entries);
        setList({ status: 'read', options });
        setChosen(preselect && options.some((p) => p.id === preselect) ? preselect : null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setList({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, preselect, readPackages]);

  const answer = (packageId: string | null) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    onAnswer(packageId);
  };

  const options = list.status === 'read' ? list.options : [];
  const title = typeLabel
    ? tFormat('engine.packageAsk.titleNamed', locale, { type: typeLabel })
    : t('engine.packageAsk.title', locale);

  return (
    <>
      <Dialog
        open={open && !creating}
        onOpenChange={(next) => {
          if (!next && !creating) answer(null);
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="package-create-ask">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t('engine.packageAsk.description', locale)}</DialogDescription>
          </DialogHeader>
          {list.status === 'loading' && (
            <p className="text-sm text-muted-foreground" data-testid="package-create-ask-loading">
              {t('engine.packageAsk.loading', locale)}
            </p>
          )}
          {list.status === 'failed' && (
            <p className="text-sm text-destructive" role="alert" data-testid="package-create-ask-failed">
              {tFormat('engine.packageAsk.loadFailed', locale, { error: list.error })}
            </p>
          )}
          {list.status === 'read' && options.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="package-create-ask-none">
              {t('engine.packageAsk.none', locale)}
            </p>
          )}
          {options.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('engine.packageAsk.listLabel', locale)}</Label>
              <RadioGroup
                value={chosen ?? ''}
                onValueChange={(value: string) => setChosen(value)}
                className="max-h-64 overflow-y-auto rounded-md border p-1"
                data-testid="package-create-ask-options"
              >
                {options.map((p) => (
                  <label
                    key={p.id}
                    className="flex min-w-0 cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-muted/60"
                  >
                    <RadioGroupItem value={p.id} data-testid={`package-create-ask-option-${p.id}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      {p.name !== p.id && (
                        <span className="block truncate text-xs text-muted-foreground">{p.id}</span>
                      )}
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreating(true)}
              data-testid="package-create-ask-new"
            >
              {t('engine.packageAsk.createNew', locale)}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => answer(null)} data-testid="package-create-ask-cancel">
                {t('engine.packageAsk.cancel', locale)}
              </Button>
              <Button
                type="button"
                disabled={!chosen}
                onClick={() => chosen && answer(chosen)}
                data-testid="package-create-ask-continue"
              >
                {t('engine.packageAsk.continue', locale)}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreatePackageDialog
        open={open && creating}
        onOpenChange={(next) => {
          if (!next) setCreating(false);
        }}
        onCreated={(id) => answer(id)}
      />
    </>
  );
}

/**
 * The ask as a promise: `ask()` opens the dialog and resolves with the chosen
 * or created package id, or `null` on Cancel. The caller renders `dialog`.
 * A second `ask()` while one is open answers the first `null`.
 */
export function usePackageCreateAsk(): {
  ask: (request?: PackageAskRequest) => Promise<string | null>;
  dialog: React.ReactElement;
} {
  const [pending, setPending] = React.useState<
    (PackageAskRequest & { resolve: (id: string | null) => void }) | null
  >(null);
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const ask = React.useCallback(
    (request: PackageAskRequest = {}) =>
      new Promise<string | null>((resolve) => {
        pendingRef.current?.resolve(null);
        setPending({ ...request, resolve });
      }),
    [],
  );
  // An unmount answers the open ask, so no caller waits for ever.
  React.useEffect(() => () => pendingRef.current?.resolve(null), []);
  const onAnswer = React.useCallback((id: string | null) => {
    pendingRef.current?.resolve(id);
    setPending(null);
  }, []);
  const dialog = (
    <PackageCreateAskDialog
      open={!!pending}
      preselect={pending?.preselect ?? null}
      typeLabel={pending?.typeLabel}
      onAnswer={onAnswer}
    />
  );
  return { ask, dialog };
}

/**
 * objectstack#38149 — what a console create that no package could take says
 * (decisions Q-b of topic objectstack#37424, answered C): in a system app the
 * reason and where to go instead (My views for a view, a business app for
 * either), and for a caller the ensure door refuses, the door's own reason.
 * `null` for a cancelled ask, which says nothing.
 */
export function runtimeCreateRefusalText(
  notSaved: { reason: 'cancelled' | 'system-app' | 'caller-refused'; message: string },
  kind: 'view' | 'report',
  locale: string,
): string | null {
  if (notSaved.reason === 'cancelled') return null;
  if (notSaved.reason === 'system-app') {
    return t(kind === 'view' ? 'engine.packageAsk.systemApp.view' : 'engine.packageAsk.systemApp.report', locale);
  }
  return tFormat('engine.packageAsk.callerRefused', locale, { reason: notSaved.message });
}
