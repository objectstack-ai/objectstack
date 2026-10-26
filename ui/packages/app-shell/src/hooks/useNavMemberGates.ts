/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The member gates the console's sidebar draws its navigation through, in ONE
 * place, so that every console consumer of an app's navigation tree reads the
 * same answer (objectui#12426).
 *
 * ## What a member is shown
 *
 * An entry is shown to a member when it survives both halves the sidebar
 * applies:
 *
 *  - the object-read prune (`withoutUnreadableObjectEntries`, objectui#12109):
 *    a `type: 'object'` entry whose object the member may not read is dropped,
 *    with its subtree;
 *  - `@object-ui/layout`'s item guard, asked per node through
 *    `hasVisibleNavigationItems([item], …)`: the `visible` expression or
 *    boolean, `requiredPermissions`, and the `requiresObject` /
 *    `requiresService` runtime-capability gates. A `group` survives only
 *    through a child that does.
 *
 * The callbacks that guard is handed (`evaluateVisibility`, `checkPermission`,
 * `checkCapability`) are built here and nowhere else: `UnifiedSidebar` draws
 * with them, and the app root's landing (`AppContent`) picks its first entry
 * with them. Before this, the sidebar built them inline and the landing applied
 * none, so a member was sent to the first SERVED entry even when the sidebar
 * hid it from them (objectui#12426), the same family as the mobile tab bar
 * (objectui#11362).
 *
 * ## Readiness
 *
 * Nothing here waits on its own. The console mounts `MePermissionsProvider`
 * above the whole app shell, and it renders its loading fallback, not its
 * children, until it holds an answer; so a consumer of this hook never runs on
 * an unchecked member. With no permission provider mounted, `can` answers
 * `true`, exactly as it does for the sidebar.
 *
 * The `visible` evaluation is the exception to that "unknown reads as yes", and
 * deliberately (objectui#12700): it goes through `evaluateNavigationVisibility`,
 * so a predicate the evaluator cannot answer — `current_user.can(...)` where no
 * permissions payload is bound, as on a frame with no permission provider —
 * withholds its entry and reports once, instead of drawing it for everyone.
 *
 * ## An entry's API binding (objectui#13029)
 *
 * An entry may declare the spec's API `dataSource`
 * (`{ provider: 'api', read: { url }, path? }`, `BaseNavItemSchema.dataSource`):
 * its `visible` reads the value the binding selects as `data`
 * (`data.total == 1`). Only `visible` reads it: not the label, not the target,
 * and not the entry's `children`. {@link useNavVisibility} is the one evaluator
 * every navigation surface of the shell hands its guard: the sidebar and the
 * landing through {@link useNavMemberGates}, the `nav:menu` block and the
 * command palette directly. It reads each binding an app's navigation declares
 * through `@object-ui/react`'s element reader (`readElementApi`, the request a
 * page element's binding makes, with the host's `apiFetch`), so there is no
 * second fetch; and in the open the read is asked in (`ElementApiOpenScope`,
 * which the console mounts per visit of a history entry), so a page element bound to the
 * same read takes the answer this read already holds instead of asking again
 * (objectui#13323). An entry is drawn only once its read has answered and its
 * `visible` holds over that value: while the read is pending, when it fails,
 * when `path` selects nothing, or when the spec refuses the binding, the entry
 * is hidden. An entry without the key is evaluated exactly as before, with no
 * read and no wait.
 *
 * Internal module: not re-exported by the package entry.
 */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasVisibleNavigationItems, type NavigationVisibilityOptions } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import type { ExpressionEvaluator } from '@object-ui/core';
import {
  SchemaRendererContext,
  isElementApiDataSourceShape,
  judgeElementApiDataSource,
  readElementApi,
  selectElementApiPath,
  useElementApiOpen,
  type ApiFetch,
} from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useExpressionContext, evaluateNavigationVisibility } from '../providers/ExpressionProvider.js';
import { withoutUnreadableObjectEntries, type ObjectReadCheck } from '../utils/navObjectReadGate.js';
import { filterActiveApps } from '../utils/appRoute.js';
import { navigationNames } from '../console/appObjectScope.js';

const NO_MISSING: readonly string[] = [];

/** No app requires an object: nothing is gated, and nothing is asked. */
const NO_REQUIRED_OBJECTS = Object.freeze({ objects: [] as readonly unknown[], missing: NO_MISSING });

/**
 * Every `requiresObject` name the app list carries (objectui#12980): in the
 * `navigation` and every `areas[].navigation` of each active app, and of the
 * app being rendered (a hidden one is not in the active list). These are all
 * the names any consumer of the gate asks it about. Sorted, so the same list
 * reads the same names in the same order.
 */
function requiredObjectUnion(apps: unknown, current: Record<string, unknown> | undefined): string[] {
  const out = new Set<string>();
  const pick = (item: Record<string, unknown>) => item.requiresObject;
  const listed = filterActiveApps(Array.isArray(apps) ? (apps as Array<Record<string, unknown>>) : []);
  for (const app of current ? [...listed, current] : listed) {
    for (const name of navigationNames(app?.navigation, pick)) out.add(name);
    const areas: unknown[] = Array.isArray(app?.areas) ? app.areas : [];
    for (const area of areas) {
      const tree = area && typeof area === 'object' ? (area as { navigation?: unknown }).navigation : undefined;
      for (const name of navigationNames(tree, pick)) out.add(name);
    }
  }
  return [...out].sort();
}

/** Where one entry's API binding stands for its `visible` (objectui#13029). */
export type NavEntryDataRead =
  | { status: 'absent' }
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'ready'; data: unknown };

/** A binding's content: the key its read is shared and remembered under. */
function bindingKey(dataSource: unknown): string {
  return JSON.stringify(dataSource);
}

/**
 * Every API binding an app's navigation declares, in its `navigation` and every
 * `areas[].navigation`, at every group depth: sorted keys, so the same bindings
 * read as the same list.
 */
function navBindingKeys(app: unknown): string[] {
  const out = new Set<string>();
  const visit = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const { dataSource, children } = item as { dataSource?: unknown; children?: unknown };
      if (isElementApiDataSourceShape(dataSource)) out.add(bindingKey(dataSource));
      visit(children);
    }
  };
  const shape = (app && typeof app === 'object' ? app : {}) as { navigation?: unknown; areas?: unknown };
  visit(shape.navigation);
  if (Array.isArray(shape.areas)) {
    for (const area of shape.areas) {
      visit(area && typeof area === 'object' ? (area as { navigation?: unknown }).navigation : undefined);
    }
  }
  return [...out].sort();
}

type SettledRead = { ok: true; data: unknown } | { ok: false };

/**
 * Read every API binding `app`'s navigation declares, and answer where a given
 * entry's binding stands. Each binding is read once per change of the set,
 * through `readElementApi` with the host's `apiFetch` (the page element's
 * reader), and its `path` selected with `selectElementApiPath`; a binding the
 * spec refuses is judged by `judgeElementApiDataSource` and never read.
 *
 * Each read is asked in the open the shell is in (objectui#13323), so the page
 * that open shows reuses it. A new open does not re-read the navigation's
 * bindings: they are read once per change of the set, as before.
 */
function useNavEntryData(app: unknown): (entry: NavigationItem) => NavEntryDataRead {
  const context = useContext(SchemaRendererContext);
  const doFetch: ApiFetch = context?.apiFetch ?? fetch;
  const scope = useElementApiOpen();
  const open = scope?.open;
  const reads = scope?.reads;
  // Keyed on the bindings' CONTENT, never on the identity of the tree that
  // holds them (AGENTS.md #10).
  const signature = navBindingKeys(app).join('\n');
  const [answers, setAnswers] = useState<Record<string, SettledRead>>({});

  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    const settle = (key: string, read: SettledRead) => {
      if (!cancelled) setAnswers((prev) => ({ ...prev, [key]: read }));
    };
    for (const key of signature.split('\n')) {
      const judged = judgeElementApiDataSource(JSON.parse(key));
      if (judged.status !== 'parsed') continue;
      const { read, path } = judged.config;
      readElementApi(read.url, doFetch, reads && open !== undefined ? { open, reads } : null).then(
        (body) => {
          const selected = selectElementApiPath(body, path);
          settle(key, selected.found ? { ok: true, data: selected.value } : { ok: false });
        },
        () => settle(key, { ok: false }),
      );
    }
    return () => {
      cancelled = true;
    };
    // `open` is left out on purpose: a new open does not re-read the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, doFetch, reads]);

  return useCallback(
    (entry: NavigationItem): NavEntryDataRead => {
      const dataSource = entry.dataSource;
      if (!isElementApiDataSourceShape(dataSource)) return { status: 'absent' };
      if (judgeElementApiDataSource(dataSource).status !== 'parsed') return { status: 'failed' };
      const answer = answers[bindingKey(dataSource)];
      if (!answer) return { status: 'pending' };
      return answer.ok ? { status: 'ready', data: answer.data } : { status: 'failed' };
    },
    [answers],
  );
}

/**
 * Should this navigation entry be drawn, as far as its `visible` goes? The one
 * decision every navigation surface of the shell makes (objectui#13029): an
 * entry that declares an API `dataSource` is hidden until its read is `ready`,
 * and then its `visible` is evaluated with the selected value bound as `data`;
 * any other entry is `evaluateNavigationVisibility`'s answer, as before.
 */
export function navEntryVisible(
  expression: NavigationItem['visible'],
  entry: NavigationItem | undefined,
  evaluator: ExpressionEvaluator,
  readEntry: (entry: NavigationItem) => NavEntryDataRead,
): boolean {
  if (entry && isElementApiDataSourceShape(entry.dataSource)) {
    const read = readEntry(entry);
    if (read.status !== 'ready') return false;
    return evaluateNavigationVisibility(expression, evaluator.withContext({ data: read.data }));
  }
  return evaluateNavigationVisibility(expression, evaluator);
}

/**
 * The `visible` evaluator for `app`'s navigation: {@link navEntryVisible} over
 * the shell's expression evaluator and the bindings `app` declares. The sidebar
 * (through {@link useNavMemberGates}), the `nav:menu` block and the command
 * palette each build theirs here, so they cannot disagree.
 */
export function useNavVisibility(
  app: unknown,
): (expression: NavigationItem['visible'], entry?: NavigationItem) => boolean {
  return useNavVisibilityAndReads(app).evaluate;
}

/**
 * {@link useNavVisibility}'s evaluator together with the read state it is built
 * on, so a consumer that must tell "hidden" from "not answered yet" asks the
 * same reads instead of issuing its own (objectui#13097).
 */
function useNavVisibilityAndReads(app: unknown): {
  evaluate: (expression: NavigationItem['visible'], entry?: NavigationItem) => boolean;
  readEntry: (entry: NavigationItem) => NavEntryDataRead;
} {
  const { evaluator } = useExpressionContext();
  const readEntry = useNavEntryData(app);
  const evaluate = useCallback(
    (expression: NavigationItem['visible'], entry?: NavigationItem) =>
      navEntryVisible(expression, entry, evaluator, readEntry),
    [evaluator, readEntry],
  );
  return { evaluate, readEntry };
}

/** The member's gates, as the sidebar applies them. */
export interface NavMemberGates {
  /** The `visible` evaluator handed to `@object-ui/layout`'s item guard. */
  evaluateVisibility: NonNullable<NavigationVisibilityOptions['evaluateVisibility']>;
  /** The `requiredPermissions` checker handed to the same guard. */
  checkPermission: NonNullable<NavigationVisibilityOptions['checkPermission']>;
  /** The runtime-capability checker handed to the same guard. */
  checkCapability: NonNullable<NavigationVisibilityOptions['checkCapability']>;
  /** The object-read verdict the tree is pruned by (objectui#12109). */
  can: ObjectReadCheck;
}

/**
 * The member's gates, with where each entry's API binding stands
 * (objectui#13097): the read state the `visible` evaluator is built on, so the
 * app root's landing can tell an entry that is hidden from one whose read has
 * not answered yet, without a read of its own.
 */
export interface NavMemberGatesWithReads extends NavMemberGates {
  readEntry: (entry: NavigationItem) => NavEntryDataRead;
}

/**
 * The member's gates, built from the providers the console mounts: the
 * expression evaluator, `usePermissions()`, and the registered object list.
 */
export function useNavMemberGates(): NavMemberGatesWithReads {
  const { app } = useExpressionContext();
  // objectui#13029 — the entries of the app this frame renders may bind data.
  const { evaluate: evalVis, readEntry } = useNavVisibilityAndReads(app);

  // Permission check for nav `requiredPermissions` entries.
  //
  // Two authored forms:
  //  - `object:action` → object CRUD gate.
  //  - bare name → an ADR-0066 system capability, checked against the union of
  //    the user's permission-set `systemPermissions` (from /me/permissions) —
  //    the SAME subset rule the server applies to `AppSchema.requiredPermissions`.
  //    This used to be misread as `can(<name>, 'read')` only, so a nav item
  //    requiring a capability was hidden even from users whose permission set
  //    granted it (admins included) — `requiredPermissions` degenerated into a
  //    "hide from everyone" switch. The object-read fallback stays for nav
  //    items that gate on a plain object name.
  const { can, hasCapabilities } = usePermissions();
  const checkPerm = useCallback(
    (permissions: string[]) => permissions.every((perm: string) => {
      const parts = perm.split(':');
      if (parts.length >= 2) {
        return can(parts[0], parts[1] as any);
      }
      return hasCapabilities([perm]) || can(perm, 'read');
    }),
    [can, hasCapabilities],
  );

  // Runtime capability gate: hide nav items targeting objects/services
  // not registered in this runtime (e.g. cloud-only `sys_app`).
  //
  // objectui#12811 — inside an app whose served item names its package, and
  // while nothing has asked for the whole registry, the gate reads that app's
  // object scope (`readObjectScope`): an object the scope holds is registered,
  // one the server answered without a definition is not, and any other reads
  // as registered, as every object did while the whole list loaded. The gate
  // asks for nothing itself: `AppContent` names the objects the app's own
  // entries require, so the sidebar's answer is exact, while the bell's
  // cross-app roster does not ask another app's objects one by one. Outside an
  // app (the home page's feeds) there is no package, and the gate reads the
  // whole registry, as it does once anything has loaded it.
  //
  // objectui#12980 — inside an app whose served item names NO package (an app
  // created in the console), on the same condition, the gate reads the
  // names-only scope over every `requiresObject` the app list carries, in each
  // app's `navigation` and `areas[].navigation`. That is every name any
  // consumer gates (the sidebar, the landing, the bell's cross-app roster), so
  // each is asked by name and answered exactly as the whole registry answers
  // it. A name not answered yet, or whose read failed (objectui#13009: left
  // unanswered), shows, as every entry does while the whole list loads or
  // after it fails.
  const metadata = useMetadata();
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  const packageless = !packageId && typeof app?.name === 'string' && app.name !== '';
  const readObjectScope =
    (packageId || packageless) && metadata.getTypeStatus?.('object') === 'idle' ? metadata.readObjectScope : undefined;
  const unionNames = readObjectScope && !packageId ? requiredObjectUnion(metadata.apps, app) : NO_MISSING;
  const scope: { objects: readonly unknown[]; missing: readonly string[] } | null = !readObjectScope
    ? null
    : packageId
      ? readObjectScope({ packageId })
      : unionNames.length > 0
        ? readObjectScope({ names: unionNames })
        : NO_REQUIRED_OBJECTS;
  const metadataObjects = scope ? scope.objects : metadata.objects;
  const missingObjects = scope ? scope.missing : NO_MISSING;
  const registeredObjectNames = useMemo(
    () => new Set<string>((metadataObjects || []).map((o: any) => o?.name).filter(Boolean)),
    [metadataObjects],
  );
  const missingObjectNames = useMemo(() => new Set<string>(missingObjects), [missingObjects]);
  const checkCap = useCallback(
    (kind: 'object' | 'service', name: string): boolean => {
      if (kind === 'object') {
        if (!readObjectScope) {
          if (registeredObjectNames.size === 0) return true;
          return registeredObjectNames.has(name);
        }
        return registeredObjectNames.has(name) || !missingObjectNames.has(name);
      }
      return true;
    },
    [registeredObjectNames, missingObjectNames, readObjectScope],
  );

  return { evaluateVisibility: evalVis, checkPermission: checkPerm, checkCapability: checkCap, can, readEntry };
}

/**
 * `items` as this member is shown them: the object-read prune, then every node
 * that `@object-ui/layout`'s item guard refuses dropped, at every group depth.
 *
 * A `separator` is dropped (it is no entry), and an `action` entry is kept: the
 * console's sidebar always wires an action dispatcher, so it draws one. A `doc`
 * entry is kept as served: the sidebar's doc-readability answer is defence in
 * depth behind the server, which already drops an unreadable one
 * (objectstack#19790), and no consumer of this function lands on a `doc`.
 */
export function navEntriesShownToMember(items: NavigationItem[], gates: NavMemberGates): NavigationItem[] {
  const guards: NavigationVisibilityOptions = {
    evaluateVisibility: gates.evaluateVisibility,
    checkPermission: gates.checkPermission,
    checkCapability: gates.checkCapability,
    hasActionHandler: true,
  };
  const shown = (list: NavigationItem[]): NavigationItem[] =>
    list
      .filter((item) => hasVisibleNavigationItems([item], guards))
      .map((item) =>
        item.type === 'group' && Array.isArray(item.children)
          ? ({ ...item, children: shown(item.children) } as NavigationItem)
          : item,
      );
  return shown(withoutUnreadableObjectEntries(items, gates.can));
}

/**
 * `items` as this member would be shown them if every entry whose API read is
 * still pending were shown once it answers (objectui#13097): the same gates as
 * {@link navEntriesShownToMember}, except that a pending entry's `visible` is
 * not decided yet and keeps it. Every other gate (the object-read prune,
 * `requiredPermissions`, the runtime-capability gates, a plain or answered
 * `visible`) applies as it does there.
 *
 * Comparing the two answers tells the app root's landing whether a pending read
 * could still change what it chooses: if it cannot, it lands now.
 */
export function navEntriesShownOncePendingReadsShow(
  items: NavigationItem[],
  gates: NavMemberGatesWithReads,
): NavigationItem[] {
  return navEntriesShownToMember(items, {
    ...gates,
    evaluateVisibility: (expression, entry) =>
      (entry !== undefined && gates.readEntry(entry).status === 'pending') ||
      gates.evaluateVisibility(expression, entry),
  });
}
