/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record drawer's in-place stack (objectstack#26679, maintainer rulings
 * 2-5 on that card).
 *
 * A record drawer is ONE drawer. A related row, a lookup value or any other
 * record link inside it opens that record in the same drawer, one level down,
 * and the previous record stays on a stack: the bar's left side shows `←` and
 * the path (each ancestor returns to its level), `←` / `Esc` go back one
 * level, `Esc` at the root closes and `✕` closes the whole stack. `↑` `↓`
 * step through the current level's sibling set — the rows its list showed
 * beside it — and never cross a level. `⤢` maximizes the pane in place at
 * any level (objectstack#27545); the record header's 「Open as full page」
 * opens that record's page with the ancestors as its `?from=` trail. A page
 * the list row's `↗` opened offers 「Collapse to drawer」, which returns to the
 * list with the record open (and the stack, when one is handed back).
 *
 * **What survives a reload.** Only the root is addressable: on an object list
 * it is `?recordId=`, which a reload reopens. The levels above it live in
 * component memory (and, across the ⤢ round trip, in the router's history
 * state, consumed once on return), so a reload shows the root record.
 *
 * **`?tab=`.** Every level reads the one record-tab URL parameter, so a level
 * that is left keeps the tab it showed and gets it back when the stack returns
 * to it; a newly opened level starts on its page's default tab.
 *
 * Two hosts mount it: the object list (`objectViewRecordOverlay.tsx`, the root
 * is the list row the URL names) and the record page itself
 * ({@link RecordPageDrawerHost}, mounted by `RecordDetailView` when it is not
 * embedded: a related row or lookup on the page opens over it). Whether a
 * record opens here at all is its object's own way of opening — the drawer by
 * default, the page where the object declares `navigation.mode: 'page'`
 * (`opensInRecordDrawer`, `./recordDrawerContext.ts`).
 */

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ChevronRight, Minimize2 } from 'lucide-react';
import {
  NavigationOverlay,
  RecordTopBarButton,
  cn,
  type NavigationOverlayMode,
  type RecordTopBarStepper,
} from '@object-ui/components';
import { overlayWidthFor } from '@object-ui/plugin-view';
import type { FieldContainerLike } from '@object-ui/core';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import { prefetchRelatedCounts, relatedCountTargetsIn } from '@object-ui/plugin-detail';
import { useFilterScope } from '@object-ui/react';
import {
  RECORD_DETAIL_TAB_PARAM,
  RECORD_DRAWER_PARAM,
  RECORD_RELATED_ENLARGE_PARAM,
  RECORD_RELATED_ENLARGE_PUSHED_STATE,
  RECORD_TRAIL_PARAM,
  appendRecordTrail,
  encodeRecordTrail,
  type RecordTrailEntry,
} from '../urlParams.js';
import { appRecordPath, routableObjectNames } from './RelatedRecordActionsBridge.js';
import {
  RecordDrawerContext,
  RecordPaneBarContext,
  RecordPaneContext,
  type RecordDrawerApi,
  type RecordPaneApi,
  type RecordPaneBarApi,
} from './recordDrawerContext.js';

export {
  opensInRecordDrawer,
  useRecordDrawer,
  useRecordPane,
  useRecordPaneBar,
  type RecordDrawerApi,
  type RecordPaneApi,
  type RecordPaneBarApi,
} from './recordDrawerContext.js';

/** One level of the stack: a record, and what the drawer learned about it. */
export interface RecordDrawerLevel {
  objectName: string;
  recordId: string;
  /** The ids of the level's sibling set, in the order its list showed them. */
  siblings?: readonly string[];
  /**
   * The sibling set's own name — the group or board lane the record sits in
   * on a grouped list (objectstack#28461) — which the counter's tooltip says
   * in place of the list's.
   */
  scope?: string;
  /** The record's title, learned when a level above it was opened from it. */
  title?: string;
  /** The `?tab=` the level showed when a level above it was opened. */
  tab?: string | null;
}

/** The history-state key the ↗ round trip carries the stack under. */
const RETURN_STATE_KEY = 'recordDrawerReturn';
const RESTORE_STATE_KEY = 'recordDrawerRestore';

/** Where the record page's 「Collapse to drawer」 goes, written by the row's ↗. */
interface RecordDrawerReturn {
  pathname: string;
  search: string;
  state: unknown;
  path: RecordDrawerLevel[];
}

function isLevel(value: unknown): value is RecordDrawerLevel {
  const v = value as RecordDrawerLevel | null | undefined;
  return !!v && typeof v.objectName === 'string' && v.objectName !== ''
    && typeof v.recordId === 'string' && v.recordId !== '';
}

/** The stack a page's ↗ return hands back to a host, or `undefined`. */
export function readRestoredPath(state: unknown): RecordDrawerLevel[] | undefined {
  const path = (state as Record<string, unknown> | null | undefined)?.[RESTORE_STATE_KEY];
  return Array.isArray(path) && path.length > 0 && path.every(isLevel) ? path : undefined;
}

function readReturn(state: unknown): RecordDrawerReturn | undefined {
  const value = (state as Record<string, unknown> | null | undefined)?.[RETURN_STATE_KEY] as
    | RecordDrawerReturn
    | undefined;
  if (!value || typeof value.pathname !== 'string' || !Array.isArray(value.path)) return undefined;
  return value.path.length > 0 && value.path.every(isLevel) ? value : undefined;
}

/** History state without the restore key — the restore is consumed once. */
function withoutRestore(state: unknown): unknown {
  if (!state || typeof state !== 'object' || !(RESTORE_STATE_KEY in state)) return state;
  const { [RESTORE_STATE_KEY]: _consumed, ...rest } = state as Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : null;
}

const levelKey = (level: { objectName: string; recordId: string } | null | undefined) =>
  level ? `${level.objectName}:${level.recordId}` : null;

/** A record the drawer can show next. */
export interface RecordDrawerUpcoming {
  objectName: string;
  recordId: string;
}

/**
 * The records a `↑` / `↓` press would show (objectstack#27056, Target 4;
 * objectstack#27545, Target 5): the current level's siblings on both sides,
 * the one in the direction of the last step (`↓` before any) first. Empty
 * with no stepper, and outside a drawer. The record drawn in the pane reads
 * it to warm those records' related counts while the reader looks at this one.
 */
export const RecordDrawerUpcomingContext = createContext<readonly RecordDrawerUpcoming[]>([]);

/**
 * Warms the related counts of the records a pane step would show
 * (objectstack#27056, Target 4; objectstack#27545, Target 5: the next and the
 * previous): the related lists of `page` — the page drawn now, which a sibling
 * of the same object draws too — counted for each, so its tab badges and cards
 * draw from the store. Renders nothing. Waits for `ready` (the record drawn now
 * has loaded), so the warm-up never competes with the reads of the record on
 * screen.
 */
export function PrefetchUpcomingRelatedCounts({
  page,
  objectName,
  dataSource,
  fieldsOf,
  ready,
}: {
  page: unknown;
  objectName: string | undefined;
  dataSource: unknown;
  fieldsOf?: (objectName: string) => FieldContainerLike;
  ready: boolean;
}) {
  const upcoming = useContext(RecordDrawerUpcomingContext);
  const scope = useFilterScope();
  const targets = relatedCountTargetsIn(page);
  const parentIds = ready ? upcoming.filter((u) => u.objectName === objectName).map((u) => u.recordId) : [];
  const key = parentIds.length > 0 && targets.length > 0 ? JSON.stringify([parentIds, targets]) : '';
  const latest = useRef({ targets, dataSource, fieldsOf, scope, parentIds });
  latest.current = { targets, dataSource, fieldsOf, scope, parentIds };
  useEffect(() => {
    if (!key) return;
    const { targets: warm, dataSource: ds, fieldsOf: fields, scope: session, parentIds: ids } = latest.current;
    for (const parentId of ids) {
      void prefetchRelatedCounts(warm, { parentId, dataSource: ds, fieldsOf: fields }, session);
    }
    // `key` is the content of the targets and the records (AGENTS.md #10).
  }, [key]);
  return null;
}

/**
 * The `?tab=` reader and writer the stack saves and restores levels through.
 * Written with `replace` (switching levels stacks no history entries) and
 * with the entry's own history state, which the record page's back link
 * reads.
 */
function useRecordTabParam() {
  const [, setSearchParams] = useSearchParams();
  const location = useLocation();
  // The router's location, read at call time: a handler outlives the render
  // it was made in.
  const locationRef = useRef(location);
  locationRef.current = location;
  const read = useCallback(
    () => new URLSearchParams(locationRef.current.search).get(RECORD_DETAIL_TAB_PARAM),
    [],
  );
  const write = useCallback(
    (tab: string | null | undefined) => {
      const sp = new URLSearchParams(locationRef.current.search);
      if ((sp.get(RECORD_DETAIL_TAB_PARAM) ?? null) === (tab ?? null)) return;
      if (tab) sp.set(RECORD_DETAIL_TAB_PARAM, tab);
      else sp.delete(RECORD_DETAIL_TAB_PARAM);
      setSearchParams(sp, { replace: true, state: locationRef.current.state });
    },
    [setSearchParams],
  );
  return { read, write };
}

/**
 * The stack over a host-controlled root (level 0). The levels reset whenever
 * the root changes — another row, a step at the root, a close — except to the
 * path a ⤢ return restores for that same root.
 */
export function useRecordDrawerStack({
  root,
  restoredPath,
  onRootStep,
}: {
  root: RecordDrawerLevel | null;
  restoredPath?: RecordDrawerLevel[];
  onRootStep?: (recordId: string) => void;
}) {
  const rootKey = levelKey(root);
  const restores = (candidate: RecordDrawerLevel[] | undefined) =>
    !!candidate && levelKey(candidate[0]) === rootKey;
  const [state, setState] = useState<{
    rootKey: string | null;
    restore: RecordDrawerLevel[] | undefined;
    path: RecordDrawerLevel[];
  }>(() => ({ rootKey, restore: restoredPath, path: restores(restoredPath) ? restoredPath! : [] }));
  let stored = state.path;
  if (state.rootKey !== rootKey || state.restore !== restoredPath) {
    // A new root starts a new stack; a restore handed over for THIS root
    // replaces it. Compared by the restore's own value — the host keeps it in
    // state until it closes — never by a memoised identity.
    if (restores(restoredPath) && (state.restore !== restoredPath || state.rootKey !== rootKey)) {
      stored = restoredPath!;
    } else if (state.rootKey !== rootKey) {
      stored = [];
    }
    setState({ rootKey, restore: restoredPath, path: stored });
  }
  // Level 0 is the host's root, annotated with what the stack learned on it.
  const path: RecordDrawerLevel[] = useMemo(
    () => (root ? [{ ...root, title: stored[0]?.title, tab: stored[0]?.tab }, ...stored.slice(1)] : []),
    [root, stored],
  );
  const depth = path.length - 1;
  const current = root ? path[depth] : null;
  const tabParam = useRecordTabParam();

  const push = useCallback<RecordDrawerApi['open']>(
    (objectName, recordId, options) => {
      if (!root) return;
      const leftTab = tabParam.read();
      setState((prev) => {
        const base = prev.path.length > 0 ? prev.path : [root];
        const top = base[base.length - 1];
        if (top.objectName === objectName && top.recordId === String(recordId)) return prev;
        const annotated = [...base];
        annotated[annotated.length - 1] = {
          ...top,
          tab: leftTab,
          ...(options?.fromTitle ? { title: options.fromTitle } : {}),
        };
        annotated.push({
          objectName,
          recordId: String(recordId),
          ...(options?.siblings ? { siblings: options.siblings.map(String) } : {}),
        });
        return { ...prev, path: annotated };
      });
      // The new level opens on its own page's default tab.
      tabParam.write(null);
    },
    [root, tabParam],
  );

  /** Return to level `target` (0 = the root), restoring the tab it showed. */
  const popTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= depth) return;
      tabParam.write(path[target].tab ?? null);
      setState((prev) => ({ ...prev, path: prev.path.slice(0, target + 1) }));
    },
    [depth, path, tabParam],
  );

  // The direction of the last ↑ / ↓ step: the record after the current one
  // in that direction is the one prefetched (`upcoming` below).
  const [stepDirection, setStepDirection] = useState<1 | -1>(1);

  /** The current level's previous / next sibling, when it has a set, and its place in it. */
  const stepper = useMemo<RecordTopBarStepper | undefined>(() => {
    if (!current?.siblings || current.siblings.length === 0) return undefined;
    if (depth === 0 && !onRootStep) return undefined;
    const index = current.siblings.indexOf(current.recordId);
    if (index < 0) return undefined;
    const go = (recordId: string, direction: 1 | -1) => () => {
      setStepDirection(direction);
      if (depth === 0) {
        onRootStep?.(recordId);
        return;
      }
      setState((prev) => {
        const next = [...prev.path];
        const top = next[next.length - 1];
        next[next.length - 1] = { objectName: top.objectName, recordId, siblings: top.siblings, scope: top.scope };
        return { ...prev, path: next };
      });
    };
    return {
      onPrevious: index > 0 ? go(current.siblings[index - 1], -1) : undefined,
      onNext: index < current.siblings.length - 1 ? go(current.siblings[index + 1], 1) : undefined,
      position: { index, total: current.siblings.length },
    };
  }, [current, depth, onRootStep]);

  // The records a step shows: onward in the last step's direction first, then
  // back the other way.
  const upcomingIds =
    stepper && current?.siblings
      ? (() => {
          const index = current.siblings.indexOf(current.recordId);
          return [current.siblings[index + stepDirection], current.siblings[index - stepDirection]]
            .filter((id): id is string => typeof id === 'string');
        })()
      : [];
  const upcomingKey = upcomingIds.join('\n');
  const upcomingObject = current?.objectName ?? null;
  const upcoming = useMemo<readonly RecordDrawerUpcoming[]>(
    () => (upcomingKey && upcomingObject
      ? upcomingKey.split('\n').map((recordId) => ({ objectName: upcomingObject, recordId }))
      : []),
    [upcomingKey, upcomingObject],
  );

  return { path, depth, current, push, popTo, stepper, upcoming, tabParam };
}

export type RecordDrawerStack = ReturnType<typeof useRecordDrawerStack>;

/**
 * The pane itself: the shared `NavigationOverlay` — the drawer, or the pane
 * beside `mainContent` (the list) on the split face — with the record's top
 * bar (objectstack#27524, Target 7): at the root the breadcrumb 「对象 › 记录名」
 * (the object returns to the list: it closes the pane), one level down `←`
 * and the path (objectstack#26679); on the right the counter and ↓ ↑, the
 * record's ⊟ when its tier has a right column (portalled into the bar by the
 * record, `RecordPaneBarContext`), ⤢ / ⤡ and ✕. It draws the current level
 * through the host's `renderRecord`, inside the contexts that make every
 * record link below it open one level down and the record header's
 * 「Open as full page」 open the level shown.
 */
export function RecordStackDrawer({
  stack,
  open,
  mode = 'drawer',
  width,
  storageKey,
  objects,
  mainContent,
  stepScope,
  onClose,
  onOpenAsPage,
  renderRecord,
}: {
  stack: RecordDrawerStack;
  open: boolean;
  mode?: NavigationOverlayMode;
  width?: string | number;
  storageKey?: string;
  objects: ReadonlyArray<unknown>;
  /** The list the pane opens from (`NavigationOverlay.mainContent`). */
  mainContent?: ReactNode;
  /**
   * The root level's set by name — the list view it came from — for the
   * counter's tooltip, unless the level names its own set (its group).
   */
  stepScope?: string;
  onClose: () => void;
  /** The record header's 「Open as full page」 — the path from the root to the record shown, inclusive. */
  onOpenAsPage?: (path: RecordDrawerLevel[]) => void;
  renderRecord: (level: RecordDrawerLevel) => ReactNode;
}) {
  const { objectLabel, objectPluralLabel } = useObjectLabel();
  const { t } = useObjectTranslation();
  const { path, depth, current, push, popTo, stepper, upcoming } = stack;
  const api = useMemo<RecordDrawerApi>(() => ({ open: push }), [push]);
  const pane = useMemo<RecordPaneApi | null>(
    () => (onOpenAsPage ? { openAsPage: () => onOpenAsPage(path) } : null),
    [onOpenAsPage, path],
  );
  // The bar's slot for the record's ⊟, and the titles the records drawn
  // reported, by level key: the breadcrumb names the record, and an ancestor
  // that was not opened with a title is still named by the one it reported.
  const [toggleSlot, setToggleSlot] = useState<HTMLElement | null>(null);
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const currentObject = current?.objectName;
  const bar = useMemo<RecordPaneBarApi>(
    () => ({
      toggleSlot,
      reportTitle: (recordId: string, title: string | undefined) => {
        if (!currentObject || !title) return;
        const key = `${currentObject}:${recordId}`;
        setTitles((prev) => (prev[key] === title ? prev : { ...prev, [key]: title }));
      },
    }),
    [toggleSlot, currentObject],
  );
  const defOf = (objectName: string) =>
    objects.find((o) => (o as { name?: unknown } | null)?.name === objectName);
  const labelOf = (objectName: string) => {
    const def = defOf(objectName);
    return def ? objectLabel(def as never) : objectName;
  };
  const pluralLabelOf = (objectName: string) => {
    const def = defOf(objectName);
    return def ? objectPluralLabel(def as never) : objectName;
  };
  const shortId = (recordId: string) => `#${recordId.length > 12 ? `${recordId.slice(0, 8)}…` : recordId}`;
  const titleOf = (level: RecordDrawerLevel) => titles[levelKey(level)!] || level.title || shortId(level.recordId);
  const crumbClass =
    'min-w-0 truncate rounded px-1 hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const trail = !current ? undefined : depth > 0 ? (
    <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-testid="record-drawer-trail">
      {path.slice(0, depth).map((level, index) => (
        <span key={`${index}:${levelKey(level)}`} className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => popTo(index)} className={crumbClass}>
            {labelOf(level.objectName)}{' '}
            <span className="font-medium text-foreground">{titleOf(level)}</span>
          </button>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        </span>
      ))}
      <span className="truncate" aria-current="page">{labelOf(current.objectName)}</span>
    </nav>
  ) : (
    <nav
      aria-label={t('common.breadcrumb', { defaultValue: 'Breadcrumb' })}
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      data-testid="record-drawer-crumb"
    >
      <button type="button" onClick={onClose} className={cn(crumbClass, 'shrink-0')} data-record-crumb-object="">
        {pluralLabelOf(current.objectName)}
      </button>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate px-1 font-medium text-foreground" aria-current="page">
        {titleOf(current)}
      </span>
    </nav>
  );
  const rootScope = current?.scope ?? stepScope;
  const scopedStepper = stepper && depth === 0 && rootScope ? { ...stepper, scope: rootScope } : stepper;
  return (
    <NavigationOverlay
      isOpen={open && !!current}
      isOverlay
      mode={mode}
      width={width}
      selectedRecord={current ? { id: current.recordId } : null}
      close={onClose}
      setIsOpen={(next: boolean) => {
        if (!next) onClose();
      }}
      maximizable
      mainContent={mainContent}
      activeListRecordId={path[0]?.recordId ?? null}
      storageKey={storageKey}
      onBack={depth > 0 ? () => popTo(depth - 1) : undefined}
      trail={trail}
      stepper={scopedStepper}
      toggles={<span ref={setToggleSlot} className="contents" data-record-pane-toggles="" />}
    >
      {() => (
        <RecordDrawerContext.Provider value={api}>
          <RecordPaneContext.Provider value={pane}>
            <RecordPaneBarContext.Provider value={bar}>
              <RecordDrawerUpcomingContext.Provider value={upcoming}>
                {/* Keyed by level and object: a step to a sibling swaps the record
                    in place (the view follows `recordIdOverride`), while a level
                    change is a different record page. */}
                <Fragment key={`${depth}:${current?.objectName}`}>
                  {current ? renderRecord(current) : null}
                </Fragment>
              </RecordDrawerUpcomingContext.Provider>
            </RecordPaneBarContext.Provider>
          </RecordPaneContext.Provider>
        </RecordDrawerContext.Provider>
      )}
    </NavigationOverlay>
  );
}

/**
 * Portal the record's panel switches into the top bar of the pane it is drawn
 * in (objectstack#27524, Target 7): the bar owns the place, the record owns
 * whether a switch applies. Draws nothing until the bar's slot has mounted,
 * and nothing outside a pane.
 */
export function RecordPaneBarToggles({ children }: { children: ReactNode }) {
  const bar = useContext(RecordPaneBarContext);
  if (!bar?.toggleSlot || children == null || children === false) return null;
  return createPortal(children, bar.toggleSlot);
}

/**
 * The page the record header's 「Open as full page」 opens from a pane level:
 * the record's route, with the levels below it as the `?from=` trail its back
 * link walks, after `leading` (the trail the host itself sits under, if any).
 * `null` when the console cannot route there.
 */
export function expandedRecordPath(
  appName: string | undefined,
  objects: ReadonlyArray<unknown>,
  path: RecordDrawerLevel[],
  leadingTrail?: string | null,
): string | null {
  const target = path[path.length - 1];
  if (!target) return null;
  const url = appRecordPath(appName, routableObjectNames(objects), target.objectName, target.recordId);
  if (url === null) return null;
  let trail = leadingTrail ?? null;
  for (const level of path.slice(0, -1)) {
    const entry: RecordTrailEntry = { o: level.objectName, i: level.recordId, ...(level.title ? { t: level.title } : {}) };
    trail = appendRecordTrail(trail, entry);
  }
  if (!trail || encodeRecordTrail([]) === trail) return url;
  const sp = new URLSearchParams();
  sp.set(RECORD_TRAIL_PARAM, trail);
  return `${url}?${sp.toString()}`;
}

/**
 * The history state the row's ↗ writes on the page it opens: everything the
 * page's 「Collapse to drawer」 needs to return to this host with that record
 * open (objectstack#27545).
 */
export function recordDrawerReturnState(
  from: { pathname: string; search: string; state: unknown },
  path: RecordDrawerLevel[],
): Record<string, unknown> {
  const back: RecordDrawerReturn = {
    pathname: from.pathname,
    search: from.search,
    state: withoutRestore(from.state),
    path,
  };
  return { [RETURN_STATE_KEY]: back };
}

/**
 * Take a ↗ return's restored stack out of the history state, once: it is
 * handed to the host as state of its own, and the history entry is rewritten
 * without it, so a later reload or Back shows the root alone. The host clears
 * it when its drawer closes, so a later open of the same root starts fresh.
 */
export function useTakenRestore(): [RecordDrawerLevel[] | undefined, () => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [taken, setTaken] = useState<RecordDrawerLevel[] | undefined>();
  const restored = readRestoredPath(location.state);
  useEffect(() => {
    if (!restored) return;
    setTaken(restored);
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: withoutRestore(location.state) },
    );
  }, [restored, location, navigate]);
  const clear = useCallback(() => setTaken(undefined), []);
  return [taken, clear];
}

/** `state` without `keys` — `null` when nothing else is left. */
function withoutKeys(state: unknown, keys: readonly string[]): Record<string, unknown> {
  const rest = { ...((state && typeof state === 'object' ? state : {}) as Record<string, unknown>) };
  for (const key of keys) delete rest[key];
  return rest;
}

/** `pathname` with the record segment `/record/<from>` naming `to` instead, or `null`. */
function siblingRecordPath(pathname: string, from: string, to: string): string | null {
  for (const id of [encodeURIComponent(from), from]) {
    const marker = `/record/${id}`;
    const at = pathname.lastIndexOf(marker);
    const after = pathname.slice(at + marker.length);
    if (at >= 0 && (after === '' || after.startsWith('/'))) {
      return `${pathname.slice(0, at)}/record/${encodeURIComponent(to)}${after}`;
    }
  }
  return null;
}

/** What a page opened from a list knows about that list. */
export interface RecordPageReturn {
  /**
   * The counter and ↓ ↑ over the list's rows (objectstack#27524, Target 7):
   * a step replaces the page with the sibling's, the way back following it.
   */
  stepper?: RecordTopBarStepper;
  /** ⤡ 「Collapse to drawer」: the list, with the record shown open in its pane. */
  collapse?: () => void;
  /** The object crumb: the list as it was left, with no record open. */
  toList?: () => void;
}

/**
 * The rows a list showed, handed in the page's `from` state by a list whose
 * rows open as pages (objectstack#27524): its row click and its record links.
 */
function readFromSiblings(state: unknown): readonly string[] | undefined {
  const from = (state as { from?: { siblings?: unknown } } | null | undefined)?.from;
  const siblings = from?.siblings;
  return Array.isArray(siblings) && siblings.every((id) => typeof id === 'string')
    ? (siblings as string[])
    : undefined;
}

/** The name of those rows' own set — their group on a grouped list (objectstack#28461). */
function readFromScope(state: unknown): string | undefined {
  const scope = (state as { from?: { scope?: unknown } } | null | undefined)?.from?.scope;
  return typeof scope === 'string' && scope !== '' ? scope : undefined;
}

/**
 * The record page's list context (objectstack#27524, Target 7). A page the
 * list row's ↗ opened carries the way back to that list in its history state
 * (`recordDrawerReturnState`, objectstack#27545), and with it the rows the
 * list showed: it gets the counter, ↓ ↑ and ⤡. A page a list opened as a page
 * (a row click or a record link on an object whose rows open as pages) carries
 * those rows in its `from` state: it gets the counter and ↓ ↑, and no ⤡, since
 * that list opens no pane; so does the pane root's 「Open as full page」.
 * Empty on a page opened any other way — a direct link, a link opened in a
 * new tab, a level above the pane's root — which therefore draws no counter,
 * no ↓ ↑ and no ⤡.
 */
export function useRecordPageReturn(recordId: string | undefined): RecordPageReturn {
  const location = useLocation();
  const navigate = useNavigate();
  return useMemo<RecordPageReturn>(() => {
    const back = readReturn(location.state);
    if (!back) {
      const siblings = readFromSiblings(location.state);
      const scope = readFromScope(location.state);
      const index = recordId && siblings ? siblings.indexOf(recordId) : -1;
      if (!recordId || !siblings || index < 0) return {};
      // The `from` state goes along unchanged: the next page has the same list.
      const go = (nextId: string) => () => {
        const to = siblingRecordPath(location.pathname, recordId, nextId);
        if (to === null) return;
        const pageSearch = new URLSearchParams(location.search);
        pageSearch.delete(RECORD_RELATED_ENLARGE_PARAM);
        const qs = pageSearch.toString();
        navigate(
          { pathname: to, search: qs ? `?${qs}` : '' },
          { replace: true, state: withoutKeys(location.state, [RECORD_RELATED_ENLARGE_PUSHED_STATE]) },
        );
      };
      return {
        stepper: {
          onPrevious: index > 0 ? go(siblings[index - 1]) : undefined,
          onNext: index < siblings.length - 1 ? go(siblings[index + 1]) : undefined,
          position: { index, total: siblings.length },
          ...(scope ? { scope } : {}),
        },
      };
    }
    const top = back.path[back.path.length - 1];
    const collapse = () => {
      const restoreState = { ...withoutKeys(back.state, []), [RESTORE_STATE_KEY]: back.path };
      navigate({ pathname: back.pathname, search: back.search }, { state: restoreState });
    };
    const toList = () => {
      const sp = new URLSearchParams(back.search);
      sp.delete(RECORD_DRAWER_PARAM);
      const qs = sp.toString();
      navigate({ pathname: back.pathname, search: qs ? `?${qs}` : '' }, { state: back.state });
    };
    if (!recordId || top.recordId !== recordId) return { collapse, toList };
    const siblings = top.siblings ?? [];
    const index = siblings.indexOf(recordId);
    if (index < 0) return { collapse, toList };
    const go = (nextId: string) => () => {
      const to = siblingRecordPath(location.pathname, recordId, nextId);
      if (to === null) return;
      const path = [...back.path.slice(0, -1), { ...top, recordId: nextId }];
      // At the list's own level the way back opens the record stepped to.
      let search = back.search;
      if (back.path.length === 1) {
        const sp = new URLSearchParams(back.search);
        sp.set(RECORD_DRAWER_PARAM, nextId);
        search = `?${sp.toString()}`;
      }
      // The sibling opens on the same `?tab=`; an open related tab is the
      // record's own, and the history entry it pushed is the previous page's.
      const pageSearch = new URLSearchParams(location.search);
      pageSearch.delete(RECORD_RELATED_ENLARGE_PARAM);
      const qs = pageSearch.toString();
      const state = {
        ...withoutKeys(location.state, [RECORD_RELATED_ENLARGE_PUSHED_STATE]),
        [RETURN_STATE_KEY]: { ...back, search, path } satisfies RecordDrawerReturn,
      };
      navigate({ pathname: to, search: qs ? `?${qs}` : '' }, { replace: true, state });
    };
    return {
      collapse,
      toList,
      stepper: {
        onPrevious: index > 0 ? go(siblings[index - 1]) : undefined,
        onNext: index < siblings.length - 1 ? go(siblings[index + 1]) : undefined,
        position: { index, total: siblings.length },
        ...(top.scope ? { scope: top.scope } : {}),
      },
    };
  }, [location.state, location.pathname, location.search, recordId, navigate]);
}

/**
 * The record page's 「Collapse to drawer」 (objectstack#26679), the ⤡ of its
 * top bar (objectstack#27524, Target 7): drawn on a page the list row's ↗
 * opened (objectstack#27545), it returns to that list with the record open.
 */
export function RecordDrawerReturnLink({ collapse }: { collapse?: () => void } = {}) {
  const own = useRecordPageReturn(undefined);
  const { t } = useObjectTranslation();
  const onCollapse = collapse ?? own.collapse;
  if (!onCollapse) return null;
  return (
    <RecordTopBarButton
      label={t('detail.collapseToDrawer', { defaultValue: 'Collapse to drawer' })}
      onClick={onCollapse}
      data-testid="record-drawer-return"
    >
      <Minimize2 className="h-3.5 w-3.5" />
    </RecordTopBarButton>
  );
}

/**
 * The record page as a drawer host (objectstack#26679 target 4): a related
 * row or a lookup value on the page opens its record in a drawer over the
 * page, under the same rules as the list's drawer; an object that declares
 * `page` still navigates (the bridge asks {@link opensInRecordDrawer}).
 *
 * The page's own `?tab=` is set aside while the drawer is open and restored
 * when it closes.
 */
export function RecordPageDrawerHost({
  appName,
  objects,
  pageObjectName,
  pageRecordId,
  pageTitle,
  renderRecord,
  children,
}: {
  appName: string | undefined;
  objects: ReadonlyArray<unknown>;
  pageObjectName: string | undefined;
  pageRecordId: string | undefined;
  pageTitle: string | undefined;
  renderRecord: (level: RecordDrawerLevel) => ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [restored, clearRestored] = useTakenRestore();
  const [root, setRoot] = useState<RecordDrawerLevel | null>(null);
  // A handed-back stack reopens the drawer at the root it left.
  useEffect(() => {
    if (!restored) return;
    const [first] = restored;
    setRoot({ objectName: first.objectName, recordId: first.recordId, ...(first.siblings ? { siblings: first.siblings } : {}) });
  }, [restored]);
  const pageTab = useRef<string | null>(null);
  const onRootStep = useCallback(
    (recordId: string) => setRoot((prev) => (prev ? { ...prev, recordId } : prev)),
    [],
  );
  const stack = useRecordDrawerStack({ root, restoredPath: restored, onRootStep });
  const { push, tabParam } = stack;

  const openFromPage = useCallback<RecordDrawerApi['open']>(
    (objectName, recordId, options) => {
      if (root) {
        push(objectName, recordId, options);
        return;
      }
      pageTab.current = tabParam.read();
      tabParam.write(null);
      setRoot({
        objectName,
        recordId: String(recordId),
        ...(options?.siblings ? { siblings: options.siblings.map(String) } : {}),
      });
    },
    [root, push, tabParam],
  );
  const api = useMemo<RecordDrawerApi>(() => ({ open: openFromPage }), [openFromPage]);

  const close = useCallback(() => {
    setRoot(null);
    clearRestored();
    tabParam.write(pageTab.current);
    pageTab.current = null;
  }, [tabParam, clearRestored]);

  /** The record header's 「Open as full page」 inside the drawer over the page. */
  const openAsPage = useCallback(
    (path: RecordDrawerLevel[]) => {
      // The page itself heads the trail: it is the record the drawer opened
      // over, after the trail the page already sits under.
      const pageTrail =
        pageObjectName && pageRecordId
          ? appendRecordTrail(new URLSearchParams(location.search).get(RECORD_TRAIL_PARAM), {
              o: pageObjectName,
              i: pageRecordId,
              ...(pageTitle ? { t: pageTitle } : {}),
            })
          : null;
      const to = expandedRecordPath(appName, objects, path, pageTrail);
      if (!to) return;
      // The drawer closes: the page it opens may be drawn by this same view.
      setRoot(null);
      clearRestored();
      pageTab.current = null;
      navigate(to);
    },
    [appName, objects, pageObjectName, pageRecordId, pageTitle, location.search, navigate, clearRestored],
  );

  const rootDef = root ? objects.find((o) => (o as { name?: unknown } | null)?.name === root.objectName) : undefined;
  // The pane's own width (objectstack#27545): an authored one, else `md`.
  const rootWidth = (rootDef as { navigation?: { width?: string | number } } | undefined)?.navigation?.width
    ?? overlayWidthFor('md', rootDef);

  return (
    <RecordDrawerContext.Provider value={api}>
      {children}
      <RecordStackDrawer
        stack={stack}
        open={!!root}
        width={rootWidth}
        storageKey={root ? `drawer-width:${root.objectName}` : undefined}
        objects={objects}
        onClose={close}
        onOpenAsPage={openAsPage}
        renderRecord={renderRecord}
      />
    </RecordDrawerContext.Provider>
  );
}
