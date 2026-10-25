/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0047 (amended, objectui #2338): on an object's default list ("views"
 * mode) a `dropdown` (value-chip) `userFilters` IS honored — those are the
 * Airtable quick-filter pills. What stays suppressed by
 * `ObjectView.renderListView` is only the page-only navigation:
 *   - `quickFilters` (never valid on an object view), and
 *   - a `tabs`-style `userFilters` (or one carrying `tabs`), which would
 *     collide with the ViewTabBar that already owns the tab-bar role.
 *
 * An author who reaches for those on an object list view gets a page that
 * renders nothing where they expect the control — surface the drop with a
 * one-shot console warning per object/view. A `dropdown` userFilters is NOT
 * a drop and is never warned.
 *
 * Returns whether the view carried a suppressed field (mainly for tests).
 */
const warned = new Set<string>();

/** True when a `userFilters` value is the page-only `tabs` preset style. */
function isTabsUserFilters(uf: unknown): boolean {
    if (!uf || typeof uf !== 'object') return false;
    const rec = uf as { element?: unknown; tabs?: unknown };
    return rec.element === 'tabs' || rec.tabs != null;
}

export function warnSuppressedListNav(
    objectName: string,
    viewId: string,
    viewDef: Record<string, unknown> | null | undefined,
    listSchema: Record<string, unknown> | null | undefined,
): boolean {
    const offending: string[] = [];
    if ((viewDef?.quickFilters ?? listSchema?.quickFilters) != null) {
        offending.push('quickFilters');
    }
    const uf = viewDef?.userFilters ?? listSchema?.userFilters;
    if (isTabsUserFilters(uf)) offending.push('userFilters (element: "tabs")');
    if (offending.length === 0) return false;
    const key = `${objectName}.${viewId}`;
    if (!warned.has(key)) {
        warned.add(key);
        console.warn(
            `[ObjectView] View "${viewId}" on object "${objectName}" defines ` +
                `${offending.join(' and ')}, which are ignored on an object list view ` +
                `(ADR-0047 "views" mode — the view switcher owns the tab bar here). ` +
                `Use \`listViews\` for named presets, \`element: "dropdown"\` for value ` +
                `chips, or move them to a page list (InterfaceListPage "filters" mode).`,
        );
    }
    return true;
}

/** Test-only: clear the one-shot warning memory. */
export function resetSuppressedListNavWarnings(): void {
    warned.clear();
}
