/**
 * Leaf pieces of the Console `ObjectView` (`./ObjectView.tsx`): the "object
 * not found" state, the viewport check that decides whether the saved-view tab
 * strip is drawn, and the inline-edit toggle's session-only callback, moved out
 * of that file verbatim (objectstack#25992, slice 3). `ObjectView.tsx`
 * re-exports every name it exported before.
 */

import { useState, useEffect } from 'react';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { Table as TableIcon } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';

/**
 * The "object not found" state the route draws for an object it has no
 * definition of. objectui#13052 — `packageDisabled`: the server answered that
 * the object exists and its package is disabled (`OBJECT_PACKAGE_DISABLED`),
 * so the description says that instead. The console route draws it for that
 * answer (`AppContent`); this module's `ObjectView` draws it for an absence.
 * Not part of the package entry.
 */
export function ObjectNotFoundState({ objectName, packageDisabled = false }: { objectName: string | undefined; packageDisabled?: boolean }) {
    const { t } = useObjectTranslation();
    return (
        <div className="h-full p-4 flex items-center justify-center">
          <Empty data-testid={packageDisabled ? 'object-package-disabled' : 'object-not-found'}>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <TableIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <EmptyTitle>{t('console.objectView.objectNotFound')}</EmptyTitle>
            <EmptyDescription>
              {packageDisabled
                ? t('console.objectView.objectPackageDisabled', { objectName })
                : t('console.objectView.objectNotFoundDescription', { objectName })}
              {' '}
              {t('console.objectView.objectNotFoundHint')}
            </EmptyDescription>
          </Empty>
        </div>
    );
}

/**
 * The list toolbar's inline-edit toggle, as this page wires it: it writes
 * nothing (objectui#5144, triage's ruling E).
 *
 * The view's `inlineEdit` and `userActions.editInline` are the AUTHOR's
 * permission keys, and `normalizeListViewSchema` folds the first into the
 * second. `editInline` is on by default since the v18 ruling (objectstack#22605,
 * objectui#12086), so a view that declares neither key offers the toggle, and
 * `editInline: false` withdraws it. This toggle used to persist a USER's edit
 * mode into `inlineEdit` through `persistViewPatch`. After the fold, switching
 * it off stored `inlineEdit: false`, which reads as "not offered", so the
 * toggle was gone from the next load and nothing in the console could bring it
 * back.
 *
 * The edit mode is now session state. `ListView` keeps it, and seeds it from
 * the view's `inlineEdit` on each load. The callback stays wired because
 * `ListView` offers the wide toolbar toggle only to a host that wires one.
 *
 * Recorded costs: the edit mode is not remembered across loads, and an overlay
 * that already stores `inlineEdit: false` still reads off. That is existing
 * data, and the maintainer's ruling rejects migrating it. Declaring
 * `userActions.editInline: true` on such a view brings the toggle back.
 */
/**
 * Tailwind's `sm` breakpoint (px): from here up the list page draws its
 * saved-view tabs in the list toolbar; below it the app bar's mobile view
 * switcher is the page's only view control (objectui#12440).
 */
const VIEW_TABS_MIN_WIDTH = 640;

/**
 * Is the viewport at least {@link VIEW_TABS_MIN_WIDTH} wide? The matchMedia
 * idiom of `useIsMobile` / `useIsWideViewport`, except the first answer is
 * read synchronously: the tab strip is the first thing on the page's list row,
 * and resolving it in an effect would draw the row once without it and then
 * jump. objectui#12440 — this decides whether the strip is HANDED to the list
 * at all, so below `sm` nothing is passed and nothing is drawn (the CSS
 * `hidden sm:block` it replaces only hid it).
 */
function viewTabsFitNow(): boolean {
    return typeof window !== 'undefined' && window.innerWidth >= VIEW_TABS_MIN_WIDTH;
}

export function useViewTabsFit(): boolean {
    const [fits, setFits] = useState<boolean>(viewTabsFitNow);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(`(min-width: ${VIEW_TABS_MIN_WIDTH}px)`);
        const onChange = () => setFits(viewTabsFitNow());
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return fits;
}

export function keepInlineEditModeForTheSession(): void {
    // Deliberately empty: see the docblock.
}
