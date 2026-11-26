// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Design mode — the app shell's one place where an administrator changes the
 * app's frame in the running app (objectstack#36362, epic objectstack#36359):
 * entered from the app menu's 「Design layout」 (objectstack#36758: the mode
 * edits the app's layout; 「Edit app」 beside it opens the app in Studio),
 * shown as a bar across the top of the window with 「Design layout」,
 * 「Cancel」 and 「Save」 and nothing else (`DesignModeBar`).
 *
 * ## What the mode holds
 *
 * The mode is the shell's, not a page's: it is held by `ConsoleLayout` for the
 * app it was entered in, so it stays on while the administrator moves from
 * page to page of that app, and goes off when the app changes. It is never on
 * a phone, which draws no 「Design layout」.
 *
 * It holds the changes made under it, and nothing else but one thing: the
 * surface an arrival asked to open first ({@link DesignModeOpening},
 * objectstack#36907), held until that surface takes it. Each change is staged
 * under a key by the surface that makes it ({@link useDesignModeChange}): the
 * menu editor, the page header's pinned actions, a record page's tabs (its
 * tab row is their editor while the mode is on, objectstack#36737, as Twenty
 * customizes record page layouts under its one layout bar). A staged change
 * carries its own `commit`, the write that makes it real, so the mode needs
 * to know nothing about what a change is:
 *
 * - 「Save」 commits every staged change, in the order they were first
 *   staged, then leaves the mode. A commit that fails stops the save there:
 *   the changes committed before it are saved, the failed one and every later
 *   one stay staged, the mode stays on, and the failure is said.
 * - 「Cancel」 drops every staged change and leaves the mode. Nothing staged
 *   was written, so there is nothing to undo.
 * - With nothing staged, 「Save」 is off.
 * - A surface may also stage a change and save at once (`saveWith`): the
 *   change is committed with the rest, in the place its key holds, as if it
 *   had been staged and 「Save」 pressed. It is never staged on its own: when
 *   the save fails, what was staged under its key before stays staged and
 *   the change is gone, so a change that writes more than its key's value
 *   (the menu entry of a dashboard created for it, objectstack#36364) is
 *   never left staged for a later 「Save」 to half-write.
 *
 * ## What leaving costs
 *
 * While a change is staged, leaving the app drops it, so the shell's
 * unsaved-edits seam guards that departure (`chrome/unsavedEdits.ts`): a tab
 * close or reload asks through the browser's own prompt, a link out of the
 * app and the app switcher ask first. A link to another page of the same app
 * does not ask: the mode, and what it holds, go along.
 *
 * ## What the mode excludes
 *
 * A dashboard's and a report's own editors are not the mode's: each saves on
 * its own, with its own 「Save」 in its page header (objectstack#36692, the
 * maintainer's ruling to keep them two entries, as Twenty does). So the
 * screen never shows two Save/Cancel sets, and no editor outlives a mode
 * that has ended, the two exclude each other, both ways, through this one
 * hold:
 *
 * - while the mode is on, those editors are not offered
 *   ({@link useDesignModeActive});
 * - while one of them is open it holds the mode out
 *   ({@link useHoldDesignModeOut}), and entering refuses, saying to save or
 *   cancel those changes first.
 *
 * A list's view actions are neither the mode's nor excluded by it: a view
 * saves on its own, so its 「Reset / Update view」 stay live under the mode's
 * bar, and name the view, not the page (objectstack#36737, as Twenty's view
 * bar does).
 *
 * Who may enter is the header button's gate (`useAppStudioEntry`, a workspace
 * administrator holding `manage_metadata`), read where the button is drawn
 * (`ShellPageActions`). The app's package need not be writable: a read-only
 * (installed) package's app enters too, and what the mode saves goes to that
 * package's customization package, as Studio's edits do, except where the
 * customization door is walled off for the caller. The mode has no address:
 * no URL enters it. A Studio dashboard list's 「New」 enters it by a one-time
 * arrival in the navigation state instead (`useDesignModeArrival`,
 * objectstack#36907), which asks {@link DesignModeValue.enterOpening}: the
 * same entry, refused the same way, with the 「Add menu item」 picker opened
 * on its dashboards once the menu's editor is drawn. Each
 * change's `commit` is a write the server judges again.
 *
 * @module
 */

import * as React from 'react';
import { toast } from 'sonner';
import { useObjectTranslation } from '@object-ui/i18n';
import { registerUnsavedEdits } from '../chrome/unsavedEdits.js';

/** One staged change: its value, and the write that makes it real. */
export interface DesignModeChange<T> {
  readonly value: T;
  readonly commit: (value: T) => Promise<void>;
}

type StagedChanges = ReadonlyMap<string, DesignModeChange<unknown>>;

const NO_CHANGES: StagedChanges = new Map();

/**
 * What an arrival asks the mode to open first (objectstack#36907): the
 * 「Add menu item」 picker, on its dashboards, at the end of the menu's top
 * level. `studioReturn` is the Studio list the arrival came from, which the
 * dashboard created there goes back to (`?studio=`), or `null`.
 */
export interface DesignModeOpening {
  readonly column: 'dashboard';
  readonly studioReturn: string | null;
}

/** The mode as the shell holds it, for the app it is on. */
export interface DesignModeValue {
  /** On, for the app on screen. */
  readonly active: boolean;
  /** At least one change is staged. */
  readonly dirty: boolean;
  /** A save is under way: the bar's buttons wait, and so should every editor. */
  readonly saving: boolean;
  /**
   * Turn the mode on for the app on screen; `false`, and the reason said,
   * while a dashboard or report editor holds the mode out.
   */
  readonly enter: () => boolean;
  /**
   * {@link DesignModeValue.enter}, then hold `opening` for the surface that
   * opens it ({@link useDesignModeOpening}); `false`, nothing held and the
   * reason said, where `enter` refuses.
   */
  readonly enterOpening: (opening: DesignModeOpening) => boolean;
  /** Drop every staged change and leave the mode. */
  readonly cancel: () => void;
  /** Commit every staged change, then leave the mode; `false` when one failed. */
  readonly save: () => Promise<boolean>;
}

interface DesignModeStore extends DesignModeValue {
  readonly changes: StagedChanges;
  /** What an arrival asked to open first, until that surface takes it. */
  readonly opening: DesignModeOpening | null;
  /** Take {@link DesignModeStore.opening}: it is answered once. */
  readonly takeOpening: () => DesignModeOpening | null;
  readonly stage: (key: string, change: DesignModeChange<unknown>) => void;
  readonly unstage: (key: string) => void;
  /** Save every staged change with `change` in `key`'s place; `false` when one failed. */
  readonly saveWith: (key: string, change: DesignModeChange<unknown>) => Promise<boolean>;
  /** Hold the mode out while an editor of its own is open; the answer lets go. */
  readonly holdOut: () => () => void;
}

const DesignModeContext = React.createContext<DesignModeStore | null>(null);

interface HeldMode {
  /** The app the mode was entered in; `null` while the mode is off. */
  readonly app: string | null;
  readonly changes: StagedChanges;
  /** What an arrival asked to open first, not yet taken. */
  readonly opening: DesignModeOpening | null;
}

const OFF: HeldMode = { app: null, changes: NO_CHANGES, opening: null };

/**
 * Whether `url` is a page of the app at `appBasePath` (`/apps/SEGMENT`), read
 * against the address on screen so a router basename in front of it counts.
 */
export function isPageOfApp(url: URL, appBasePath: string, currentPathname: string): boolean {
  const at = currentPathname.indexOf(appBasePath);
  const prefix = at >= 0 ? currentPathname.slice(0, at + appBasePath.length) : appBasePath;
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

/**
 * The mode for `appName`, held by the shell: hand its answer to
 * {@link DesignModeProvider}. `enabled` is `false` where the mode is never on
 * (a phone); the staged changes are kept, unseen, until it is `true` again.
 */
export function useDesignModeController({
  appName,
  appBasePath,
  enabled,
}: {
  appName: string;
  appBasePath: string;
  enabled: boolean;
}): DesignModeStore {
  const { t } = useObjectTranslation();
  const [held, setHeld] = React.useState<HeldMode>(OFF);
  const [saving, setSaving] = React.useState(false);
  /** How many editors of their own hold the mode out. */
  // Counted in a ref, not state: an editor that opens in the same commit as
  // an arrival asks to enter (objectstack#36907) holds the mode out before
  // that entry is judged.
  const heldOut = React.useRef(0);

  // Another app: the mode and what it held were the previous app's.
  if (held.app !== null && held.app !== appName) setHeld(OFF);

  const on = held.app !== null && held.app === appName;
  const active = on && enabled;
  const changes = on ? held.changes : NO_CHANGES;
  const opening = active ? held.opening : null;
  const dirty = changes.size > 0;

  const heldRef = React.useRef(held);
  React.useLayoutEffect(() => {
    heldRef.current = held;
  });

  const enterWith = React.useCallback(
    (asked: DesignModeOpening | null): boolean => {
      if (heldOut.current > 0) {
        toast.error(
          t('designMode.editorOpen', {
            defaultValue: 'Save or cancel your dashboard or report changes before designing the layout.',
          }),
        );
        return false;
      }
      setHeld((prev) => {
        const entered = prev.app === appName ? prev : { app: appName, changes: NO_CHANGES, opening: null };
        return asked ? { ...entered, opening: asked } : entered;
      });
      return true;
    },
    [appName, t],
  );
  // `enter` takes no argument: a button's click event is never an opening.
  const enter = React.useCallback((): boolean => enterWith(null), [enterWith]);
  const enterOpening = React.useCallback(
    (asked: DesignModeOpening): boolean => enterWith(asked.column === 'dashboard' ? asked : null),
    [enterWith],
  );
  const takeOpening = React.useCallback((): DesignModeOpening | null => {
    const taken = heldRef.current.opening;
    if (taken) setHeld((prev) => (prev.opening ? { ...prev, opening: null } : prev));
    return taken;
  }, []);

  const holdOut = React.useCallback(() => {
    heldOut.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      heldOut.current -= 1;
    };
  }, []);

  const cancel = React.useCallback(() => {
    setHeld(OFF);
  }, []);

  const stage = React.useCallback((key: string, change: DesignModeChange<unknown>) => {
    setHeld((prev) => {
      if (prev.app === null) return prev;
      const next = new Map(prev.changes);
      next.set(key, change);
      return { ...prev, changes: next };
    });
  }, []);

  const unstage = React.useCallback((key: string) => {
    setHeld((prev) => {
      if (prev.app === null || !prev.changes.has(key)) return prev;
      const next = new Map(prev.changes);
      next.delete(key);
      return { ...prev, changes: next };
    });
  }, []);

  const savingRef = React.useRef(false);
  const commitAll = React.useCallback(async (extra?: { key: string; change: DesignModeChange<unknown> }): Promise<boolean> => {
    if (savingRef.current) return false;
    const start = heldRef.current;
    if (start.app === null) return false;
    const changes = extra ? new Map(start.changes).set(extra.key, extra.change) : start.changes;
    savingRef.current = true;
    setSaving(true);
    try {
      for (const [key, change] of changes) {
        try {
          await change.commit(change.value);
        } catch (error) {
          toast.error(
            t('designMode.saveFailed', {
              defaultValue: 'Some changes were not saved: {{reason}}',
              reason: error instanceof Error ? error.message : String(error),
            }),
          );
          return false;
        }
        // Saved: off the list, unless it was staged again while it was sent.
        // A change saved with `saveWith` supersedes what its key held.
        const was = start.changes.get(key);
        setHeld((prev) => {
          const now = prev.changes.get(key);
          if (now === undefined || (now !== change && now !== was)) return prev;
          const next = new Map(prev.changes);
          next.delete(key);
          return { ...prev, changes: next };
        });
      }
      setHeld((prev) => (prev.changes.size === 0 ? OFF : prev));
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [t]);
  const save = React.useCallback(() => commitAll(), [commitAll]);
  const saveWith = React.useCallback(
    (key: string, change: DesignModeChange<unknown>) => commitAll({ key, change }),
    [commitAll],
  );

  // Leaving the app drops what is staged; a page of the same app keeps it.
  const leaveMessage = t('designMode.leaveUnsaved', {
    defaultValue: 'Leave Design layout? Your unsaved changes will be lost.',
  });
  React.useEffect(() => {
    if (!dirty) return undefined;
    return registerUnsavedEdits(leaveMessage, {
      keeps: (url) => isPageOfApp(url, appBasePath, window.location.pathname),
    });
  }, [dirty, leaveMessage, appBasePath]);

  return React.useMemo(
    () => ({
      active,
      dirty,
      saving,
      enter,
      enterOpening,
      cancel,
      save,
      changes,
      opening,
      takeOpening,
      stage,
      unstage,
      saveWith,
      holdOut,
    }),
    [active, dirty, saving, enter, enterOpening, cancel, save, changes, opening, takeOpening, stage, unstage, saveWith, holdOut],
  );
}

/** Hands the shell's mode to the pages and the chrome under it. */
export function DesignModeProvider({ value, children }: { value: DesignModeStore; children: React.ReactNode }) {
  return <DesignModeContext.Provider value={value}>{children}</DesignModeContext.Provider>;
}

/** The mode, or `null` outside a shell that holds one (Home, Studio, a bare test mount). */
export function useDesignMode(): DesignModeValue | null {
  return React.useContext(DesignModeContext);
}

/** Whether the mode is on for the app on screen; `false` outside a shell that holds one. */
export function useDesignModeActive(): boolean {
  return React.useContext(DesignModeContext)?.active ?? false;
}

/**
 * What an arrival asked the mode to open first (objectstack#36907), for the
 * surface that opens it: `opening` while it is held and the mode is on,
 * `take` to answer it once. Outside a shell that holds the mode, nothing.
 */
export function useDesignModeOpening(): {
  readonly opening: DesignModeOpening | null;
  readonly take: () => DesignModeOpening | null;
} {
  const store = React.useContext(DesignModeContext);
  const takeOpening = store?.takeOpening;
  const take = React.useCallback(() => takeOpening?.() ?? null, [takeOpening]);
  return { opening: store?.opening ?? null, take };
}

/**
 * The other half of the exclusion: a dashboard's or a report's own editor
 * holds the mode out while `open`, so entering it refuses and says why
 * (objectstack#36692). Outside a shell that holds the mode, nothing.
 */
export function useHoldDesignModeOut(open: boolean): void {
  const holdOut = React.useContext(DesignModeContext)?.holdOut;
  React.useEffect(() => (open && holdOut ? holdOut() : undefined), [open, holdOut]);
}

/**
 * The extension point: a surface that changes something under the mode stages
 * its change under `key` (one key per thing changed, such as the app's menu),
 * and the mode saves or drops it with the rest. `value` is what is staged
 * under `key`, `undefined` when nothing is: a surface draws from it, so its
 * pending state survives a page change. `saveWith` saves every staged change
 * with `value` in `key`'s place, and leaves the mode when all were saved
 * (`false` when one failed; outside a shell that holds the mode, `false` and
 * nothing written). Outside a shell that holds the mode, nothing is ever
 * staged and `stage` does nothing.
 */
export function useDesignModeChange<T>(key: string): {
  readonly value: T | undefined;
  readonly stage: (value: T, commit: (value: T) => Promise<void>) => void;
  readonly unstage: () => void;
  readonly saveWith: (value: T, commit: (value: T) => Promise<void>) => Promise<boolean>;
} {
  const store = React.useContext(DesignModeContext);
  const staged = store?.changes.get(key) as DesignModeChange<T> | undefined;
  const storeStage = store?.stage;
  const storeUnstage = store?.unstage;
  const stage = React.useCallback(
    (value: T, commit: (value: T) => Promise<void>) =>
      storeStage?.(key, { value, commit: commit as (value: unknown) => Promise<void> }),
    [storeStage, key],
  );
  const unstage = React.useCallback(() => storeUnstage?.(key), [storeUnstage, key]);
  const storeSaveWith = store?.saveWith;
  const saveWith = React.useCallback(
    async (value: T, commit: (value: T) => Promise<void>) =>
      storeSaveWith ? storeSaveWith(key, { value, commit: commit as (value: unknown) => Promise<void> }) : false,
    [storeSaveWith, key],
  );
  return { value: staged?.value, stage, unstage, saveWith };
}
