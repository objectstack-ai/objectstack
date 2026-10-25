/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `nav:menu` — the app's navigation tree as PAGE CONTENT, addressable from a
 * page schema (`969ba84f4`).
 *
 * ## Why this exists
 *
 * `nav:menu` is a first-class member of `@objectstack/spec`'s
 * `PageComponentType` and Phase 1 of the 2026-08-26 maintainer ruling on
 * objectstack#12183, alongside `app:launcher`, because both are purely
 * metadata-driven. Nothing rendered it, so a page that authored it drew
 * `PlaceholderRenderer`'s literal "Component Placeholder" scaffold — the
 * author-time gate accepted the metadata and the screen showed a dashed box.
 *
 * ## What backs it — nothing new
 *
 * The app's own navigation tree, which the shell already resolves for its
 * chrome: `useMetadata().apps` (fetched eagerly by `MetadataProvider` —
 * `GET /api/v1/meta/app`), narrowed to the app in the route, then
 * `activeArea.navigation ?? app.navigation`. No request of this block's own and
 * no adapter call, which is the ruling's "no external data-source dependency"
 * claim discharged. (A tree holding a `doc` entry also reads the `doc` / `book`
 * lists through that same `MetadataProvider` cache — `useNavDocTargetCheck`,
 * objectui#10188 — the cache's request, shared with the sidebar.)
 *
 * Every derived fact comes from `@object-ui/layout`, not from a second copy:
 *
 *   - hrefs from `resolveHref` — the documented single source of truth for
 *     nav → URL, so `recordId` / `filters` / `viewName` / `runAction`
 *     precedence cannot drift between the sidebar and an authored menu;
 *   - labels from `resolveNavItemLabel` — the same rule the sidebar gets: a
 *     present label as authored (an inline locale map in the viewer's
 *     `language`, the locale `UnifiedSidebar` passes, objectui#11299), and for
 *     an entry with NO `label` the same inherited target label
 *     (`useNavTargetLabel`, objectui#9868), so the two surfaces cannot show
 *     one entry under two names;
 *   - the active row from `resolveActiveNavItem`, the round-trip inverse of
 *     `resolveHref`;
 *   - the item-level guards in the same ORDER `NavigationItemRenderer` applies
 *     them (`visible` → `requiredPermissions` → `requiresObject` →
 *     `requiresService` → a `doc` entry's member-readability answer), wired to
 *     the same console providers and hook `UnifiedSidebar` wires them to.
 *
 * The tree those guards run over is the sidebar's too: an entry bound to an
 * object the caller may not read is pruned first, by the one function
 * `UnifiedSidebar` prunes with (`withoutUnreadableObjectEntries`, in this
 * package, objectui#12109) — the layout holds no permissions to ask.
 *
 * ## Why not mount `NavigationRenderer` itself
 *
 * Measured, not assumed: `NavigationRenderer` renders through
 * `SidebarMenuButton`, which calls `useSidebar()`, which THROWS
 * ("useSidebar must be used within a SidebarProvider") outside the shell's
 * provider (`useSidebar` in `components/src/ui/sidebar.tsx`). A page
 * block has to render standalone — in the Studio preview, in a test, in any
 * host — so mounting it would trade a dashed box for a crash. Wrapping the block
 * in its own `SidebarProvider` is worse than it looks: that provider renders a
 * `min-h-svh` full-viewport flex wrapper and registers a WINDOW-level
 * Ctrl/Cmd+B handler, so an authored menu would resize the page around itself
 * and fight the real sidebar for the shell's own keyboard shortcut.
 *
 * So this block reuses every pure helper and none of the sidebar chrome. What
 * it deliberately does NOT reproduce is sidebar-only interaction state —
 * drag-reorder, pinning, and the nav search box — all of which are
 * localStorage-backed personalisation of the SHELL's menu (`useNavOrder`,
 * `useNavPins`), not properties of an authored page.
 *
 * ## Two deliberate narrowings, stated rather than left implicit
 *
 *  1. **Areas.** When an app declares `areas`, the sidebar lets the user switch
 *     between them and shows one at a time; the elected default is the first
 *     area with at least one visible item (objectui#3311's derived visibility,
 *     via the shared `hasVisibleNavigationItems` predicate). This block renders
 *     that same default and offers no switcher: which area you are in is shell
 *     state, and a page block has nowhere to put it. Apps with no `areas` — the
 *     common case — render `app.navigation` flat, exactly as the sidebar does.
 *  2. **App-level context selectors.** `UnifiedSidebar` passes `contextValues` from
 *     `useAppContextSelectors` into the template context, because it also
 *     RENDERS those selectors. This block passes only `currentUserId` /
 *     `currentOrgId`; an entry referencing `{some_selector}` therefore falls
 *     back to the unscoped URL, which is `applyNavTemplate`'s documented answer
 *     for an unresolved variable, not a new failure mode.
 *
 * `action` items DO render here: `useNavActionDispatch` is wired, so
 * `hasActionHandler` is true and framework#4509's "renders but dead-clicks"
 * shape is not reintroduced.
 *
 * ## Declared propless, deliberately
 *
 * `ComponentPropsMap['nav:menu']` is an EMPTY shape, so this registration
 * publishes NO `inputs` — declaring even `className` would advertise an
 * authoring key the contract rejects by name (the forward direction of
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`). The
 * node-level `className` the SchemaRenderer threads through is a NODE key of
 * `PageComponentSchema`, not a prop, and needs no declaration. `nav:menu` is
 * already pinned in that test's `EXPECTED_WITHOUT_INPUTS`, where the eager
 * placeholder registration put it, and this registration keeps it there.
 *
 * Registered in app-shell rather than `@object-ui/components` for the same
 * reason `global:search` is (`f99932a42`): the providers are here.
 * `@object-ui/components` depends on neither `@object-ui/layout` (the resolvers)
 * nor `@object-ui/permissions` nor `react-router-dom` — measured against its
 * `package.json` on `592acafbe`. The eager palette placeholder in
 * `components/renderers/placeholders.tsx` STAYS: it is the fallback for a host
 * that embeds `@object-ui/components` without app-shell, and this module
 * imports that package, so its registration always runs first and this one
 * overwrites it.
 */

import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { useMetadata } from '@object-ui/react';
import { useAuth } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import { useObjectTranslation } from '@object-ui/i18n';
import { Badge, Separator, cn } from '@object-ui/components';
import {
  hasVisibleNavigationItems,
  resolveActiveNavItem,
  resolveHref,
  resolveNavItemLabel,
  type NavTemplateContext,
} from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { useNavVisibility } from '../hooks/useNavMemberGates.js';
import { useNavActionDispatch } from '../hooks/useNavActionDispatch.js';
import { useNavTargetLabel } from '../hooks/useNavTargetLabel.js';
import { useNavDocTargetCheck } from '../hooks/useNavDocTargetCheck.js';
import { withoutUnreadableObjectEntries } from '../utils/navObjectReadGate.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { getIcon } from '../utils/getIcon.js';
import { appRouteSegment, matchAppBySegment } from '../utils/index.js';
import { navigationNames } from '../console/appObjectScope.js';

/** Keep the designer's own data attributes on the wrapper, drop the rest. */
const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style } = props || {};
  return { 'data-obj-id': id, 'data-obj-type': type, style };
};

const ROW =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 ' +
  'transition-colors hover:bg-accent hover:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const NO_MISSING_OBJECTS: readonly string[] = [];
/** No entry requires an object, and no package scopes the read: nothing to ask. */
const NO_CAPABILITY_SCOPE = Object.freeze({ objects: [] as any[], served: [] as any[], missing: NO_MISSING_OBJECTS, settled: true });

export interface NavMenuRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const NavMenuRenderer: React.FC<NavMenuRendererProps> = ({
  className,
  schema: _schema,
  ...props
}) => {
  const { t, language } = useObjectTranslation();
  // ⛔ `objects` is not destructured: reading it loads the whole registry
  // (objectui#12980). The capability gate below reads the app's scope.
  const metadata = useMetadata();
  const { apps } = metadata;
  const { appName } = useParams();
  const { currentAppName } = useNavigationContext();
  const { pathname, search } = useLocation();
  const { user, activeOrganization } = useAuth();
  const dispatchNavAction = useNavActionDispatch();
  // The same resolver `UnifiedSidebar` hands `NavigationRenderer`: an entry with
  // no `label` shows its target's current label (objectui#9868).
  const targetLabel = useNavTargetLabel();

  /* ── The three guards, wired to the same providers `UnifiedSidebar` uses ── */

  // The shell's one navigation `visible` evaluator (objectui#13029): an entry
  // that declares an API `dataSource` reads its bound value as `data`, and is
  // hidden until that read answers. Built below, once the app is known.

  // `object:action` → object CRUD gate; a bare name is an ADR-0066 system
  // capability, with the legacy "can read <object>" reading kept as fallback.
  // Same mapping as `UnifiedSidebar` — one question, one answer.
  const { can, hasCapabilities } = usePermissions();
  const checkPerm = useCallback(
    (permissions: string[]) =>
      permissions.every((perm: string) => {
        const parts = perm.split(':');
        if (parts.length >= 2) return can(parts[0], parts[1] as any);
        return hasCapabilities([perm]) || can(perm, 'read');
      }),
    [can, hasCapabilities],
  );

  /* ── Which app, and which slice of its navigation ──────────────────────── */

  const activeApp = useMemo(() => {
    const list = ((apps as any[]) || []).filter((a: any) => a?.active !== false);
    return matchAppBySegment(list, appName ?? currentAppName ?? null);
  }, [apps, appName, currentAppName]);

  const evalVis = useNavVisibility(activeApp);

  // The runtime-capability gate for `requiresObject` entries. objectui#12980 —
  // it reads the objects the app's entries require, by name (beside the app's
  // package list when the app names one, the names-only scope when it does
  // not), never the whole registry: an object the answer holds is registered,
  // one the server answered without a definition is not, and one not yet
  // answered shows, as every entry did while the whole list loaded. A
  // hand-rolled metadata context has no scope, and its `objects` is read.
  const requiredObjects = [
    ...navigationNames(activeApp?.navigation, (item) => item.requiresObject),
    ...((activeApp?.areas ?? []) as Array<{ navigation?: unknown } | undefined>).flatMap((area) =>
      navigationNames(area?.navigation, (item) => item.requiresObject),
    ),
  ];
  const appPackageId =
    typeof activeApp?._packageId === 'string' && activeApp._packageId ? (activeApp._packageId as string) : undefined;
  const capabilityScope = !metadata.readObjectScope
    ? null
    : appPackageId
      ? metadata.readObjectScope({ packageId: appPackageId, names: requiredObjects })
      : requiredObjects.length > 0
        ? metadata.readObjectScope({ names: requiredObjects })
        : NO_CAPABILITY_SCOPE;
  const registeredObjects = capabilityScope ? capabilityScope.objects : metadata.objects;
  const registeredObjectNames = useMemo(
    () => new Set<string>(((registeredObjects as any[]) || []).map((o: any) => o?.name).filter(Boolean)),
    [registeredObjects],
  );
  const missingObjects = capabilityScope ? capabilityScope.missing : NO_MISSING_OBJECTS;
  const missingObjectNames = useMemo(() => new Set<string>(missingObjects), [missingObjects]);
  const scoped = capabilityScope !== null;
  const checkCap = useCallback(
    (kind: 'object' | 'service', name: string): boolean => {
      if (kind === 'object') {
        if (scoped) return registeredObjectNames.has(name) || !missingObjectNames.has(name);
        // While metadata is still loading the set is empty; show entries by
        // default rather than flickering the whole menu away (`UnifiedSidebar`
        // does the same, and it must match or the two menus disagree on first paint).
        if (registeredObjectNames.size === 0) return true;
        return registeredObjectNames.has(name);
      }
      return true;
    },
    [registeredObjectNames, missingObjectNames, scoped],
  );

  // A `doc` entry the member may not read is not drawn (objectui#10188) — the
  // same hook `UnifiedSidebar` wires, so the two menus agree.
  const appAreas = (activeApp?.areas ?? []) as ReadonlyArray<{ navigation?: NavigationItem[] } | undefined>;
  const checkDocTarget = useNavDocTargetCheck([
    activeApp?.navigation as NavigationItem[] | undefined,
    ...appAreas.map((area) => area?.navigation),
  ]);

  const guards = useMemo(
    () => ({
      evaluateVisibility: evalVis,
      checkPermission: checkPerm,
      checkCapability: checkCap,
      checkDocTarget,
      // This block DOES wire `onAction`, so `action` items count towards an
      // area's derived visibility here (framework#4509).
      hasActionHandler: true,
    }),
    [evalVis, checkPerm, checkCap, checkDocTarget],
  );

  // An entry bound to an object the caller may not read is not drawn
  // (objectui#12109) — pruned before the guards run, through the same function
  // `UnifiedSidebar` prunes with, so the area election and the drawn rows here
  // read the tree the sidebar reads.
  const items: NavigationItem[] = useMemo(() => {
    const readable = (navigation: NavigationItem[] | undefined): NavigationItem[] =>
      withoutUnreadableObjectEntries(navigation ?? [], can);
    const areas = (activeApp?.areas as any[]) || [];
    if (areas.length > 0) {
      const firstVisible = areas.find((area: any) =>
        hasVisibleNavigationItems(readable(area?.navigation), guards),
      );
      if (firstVisible) return readable(firstVisible.navigation);
    }
    return readable(activeApp?.navigation as NavigationItem[] | undefined);
  }, [activeApp, guards, can]);

  const basePath = activeApp ? `/apps/${appRouteSegment(activeApp) ?? activeApp.name}` : '';

  const templateContext: NavTemplateContext = useMemo(
    () => ({ currentUserId: user?.id ?? null, currentOrgId: activeOrganization?.id ?? null }),
    [user?.id, activeOrganization?.id],
  );

  const activeId = useMemo(
    () => resolveActiveNavItem(items, pathname, search, basePath, templateContext)?.id ?? null,
    [items, pathname, search, basePath, templateContext],
  );

  /* ── Rendering ─────────────────────────────────────────────────────────── */

  const label = useCallback(
    (item: NavigationItem) => resolveNavItemLabel(item, t, targetLabel, language),
    [t, targetLabel, language],
  );

  // A plain (hoisted) function declaration, not a `useCallback`: it recurses
  // into itself for `group` children, and a `const` arrow cannot be called from
  // inside its own initializer without reading the binding before it is
  // declared (`react-hooks/immutability`). Memoising would buy nothing anyway —
  // `rows` below is recomputed on every render regardless.
  function renderItem(item: NavigationItem): React.ReactNode {
      // The guard ORDER is `NavigationItemRenderer`'s and
      // `hasVisibleNavigationItems`'; keeping it identical is what makes the
      // derived-area predicate above agree with what actually renders.
      if (!evalVis(item.visible, item)) return null;
      if (item.requiredPermissions?.length && !checkPerm(item.requiredPermissions)) return null;
      if (item.requiresObject && !checkCap('object', item.requiresObject)) return null;
      if (item.requiresService && !checkCap('service', item.requiresService)) return null;
      if (item.type === 'doc' && checkDocTarget && !checkDocTarget({ book: item.book, doc: item.doc })) return null;

      if (item.type === 'separator') {
        return (
          <li key={item.id} aria-hidden="true" className="py-1">
            <Separator />
          </li>
        );
      }

      if (item.type === 'group') {
        const children = (item.children ?? [])
          .map((child) => renderItem(child))
          .filter(Boolean);
        // A group whose children are all gated away contributes nothing a user
        // can navigate to, so it does not render its heading either.
        if (children.length === 0) return null;
        return (
          <li key={item.id}>
            <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label(item)}
            </div>
            <ul className="ml-2 grid gap-0.5 border-l pl-2">{children}</ul>
          </li>
        );
      }

      const Icon = getIcon(item.icon);
      const text = label(item);
      const badge =
        item.badge !== undefined && item.badge !== null && item.badge !== '' ? (
          <Badge variant={(item.badgeVariant as any) ?? 'secondary'} className="ml-auto shrink-0">
            {item.badge}
          </Badge>
        ) : null;
      const body = (
        <>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{text}</span>
          {badge}
        </>
      );
      const isActive = activeId !== null && item.id === activeId;
      const rowClass = cn(ROW, isActive && 'bg-accent font-medium text-foreground');

      if (item.type === 'action') {
        return (
          <li key={item.id}>
            <button type="button" className={rowClass} onClick={() => dispatchNavAction(item)}>
              {body}
            </button>
          </li>
        );
      }

      const { href, external } = resolveHref(item, basePath, templateContext);
      return (
        <li key={item.id}>
          {external ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={rowClass}
              aria-current={isActive ? 'page' : undefined}
            >
              {body}
            </a>
          ) : (
            <Link to={href} className={rowClass} aria-current={isActive ? 'page' : undefined}>
              {body}
            </Link>
          )}
        </li>
      );
  }

  const rows = items.map((item) => renderItem(item)).filter(Boolean);

  return (
    <nav
      className={className}
      aria-label={t('console.nav.menuLabel', { defaultValue: 'App navigation' }) as string}
      data-block="nav:menu"
      {...splitDesigner(props)}
    >
      {rows.length > 0 ? (
        <ul className="grid gap-0.5">{rows}</ul>
      ) : (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          {t('console.nav.menuEmpty', {
            defaultValue: 'This app has no navigation entries you can open.',
          })}
        </p>
      )}
    </nav>
  );
};

// Bare name + namespace (the registry prepends it itself); `skipFallback: true`
// keeps this off the top-level `menu` key. No `inputs`: the spec shape is empty.
ComponentRegistry.register('menu', NavMenuRenderer, {
  namespace: 'nav',
  skipFallback: true,
  category: 'navigation',
  label: 'Nav Menu',
  icon: 'Menu',
});

export default NavMenuRenderer;
