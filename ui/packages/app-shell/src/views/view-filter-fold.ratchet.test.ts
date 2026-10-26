/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Two ratchets on one call site, in order of strength.
 *
 * **objectui#4155 (the current contract): the list toolbar's filter panel must
 * not persist ANYTHING.** Filter-panel state is transient — it belongs to the
 * session and to `writeListFilterState`'s per-browser restore, not to the
 * view's stored body. It used to write a view-customization overlay on every
 * `onFilterChange`, so opening the panel and clicking `Add filter` put an
 * incomplete `field equals ''` condition into `sys_metadata`, where it REPLACED
 * the source-declared `filter` for every user of that view and emptied the
 * list. Overlay writes belong to an EXPLICIT save (`handleViewConfigSave`, and
 * `ObjectDataPage`'s "Save as view").
 *
 * **objectstack#5159 (subsumed, still pinned): the FilterBuilder's
 * `FilterGroup` must never reach a persisted view `filter`.** Its bug was that
 * the toolbar handed `onFilterChange`'s payload straight to
 * `persistViewPatch({ filter })` — the builder's grouped dialect against
 * `ListViewSchema.filter`'s `z.array(ViewFilterRuleSchema)`, so every
 * `Filter → Add filter → save` came back 422 `invalid_union`. #4155 removes the
 * write entirely, which is strictly stronger for THIS call site; the fold
 * survives because the explicit save paths still need it, and this file keeps
 * guarding them.
 *
 * If the #4155 assertions fail: do not re-add a filter persist to any toolbar
 * handler. A user's panel interaction is not a save.
 *
 * If the #5159 assertions fail: route the group through
 * `foldFilterGroupToSpecRules` (`./viewFilterFold`), which folds to
 * `ViewFilterRule[]` and refuses — out loud — the shapes that cannot fold
 * losslessly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const objectViewPath = path.join(here, 'ObjectView.tsx');
const widgetsPath = path.join(here, 'metadata-admin/widgets.tsx');

const objectViewSrc = readFileSync(objectViewPath, 'utf8');
const widgetsSrc = readFileSync(widgetsPath, 'utf8');

/**
 * The initializer of `const NAME = …` in `ObjectView.tsx` — for a handler, its
 * `useCallback(…)` call, so the function body and its dependency list — found
 * by the TypeScript parser. An assertion about what a handler does is bound to
 * the handler this way, not to a byte distance from its name: a fixed-width
 * window after the name went red when a docblock and an early return were
 * added to `handleViewConfigSave` (objectui#11583), with the call still there.
 */
function declarationInitializer(src: string, name: string): ts.Expression | undefined {
    const sf = ts.createSourceFile('ObjectView.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
            found = node.initializer;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/** The calls to `callee` under `node` whose first argument is the string literal `first`. */
function callsWithFirstArg(node: ts.Node, callee: string, first: string): ts.CallExpression[] {
    const out: ts.CallExpression[] = [];
    const visit = (n: ts.Node) => {
        if (
            ts.isCallExpression(n)
            && ts.isIdentifier(n.expression)
            && n.expression.text === callee
            && n.arguments.length > 0
            && ts.isStringLiteralLike(n.arguments[0])
            && n.arguments[0].text === first
        ) out.push(n);
        ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
}

describe('objectui#4155 ratchet — the filter panel persists nothing', () => {
    it('the ratchet is reading real source, not an empty string', () => {
        expect(objectViewSrc.length).toBeGreaterThan(10_000);
        expect(widgetsSrc.length).toBeGreaterThan(10_000);
        // The toolbar's view-config persist path (`persistViewPatch`), whose
        // `{ filter }` calls this file used to count, is retired since
        // objectui#12504: no toolbar control writes the view at all, and
        // `ObjectView.overlayPatchOnly.test.ts` pins that absence.
    });

    it('the `persistViewFilter` helper is gone — there is no filter-persist seam to call', () => {
        // Matched on a CALL/DECLARATION form so the comment that explains the
        // removal (which names the symbol) does not satisfy the ratchet.
        expect(objectViewSrc).not.toMatch(/const\s+persistViewFilter\b/);
        expect(objectViewSrc).not.toMatch(/persistViewFilter\s*\(/);
    });

    it('no toolbar filter handler reaches ANY persist call', () => {
        const sites = [...objectViewSrc.matchAll(/onFilterChange[=:]/g)];
        // The surviving handler is the user's own state only (objectui#12418:
        // their list-state row, cached in localStorage). If every
        // handler is gone the loop is vacuous, so pin that at least one exists —
        // the session restore is a feature, not an accident.
        expect(sites.length, 'expected at least one onFilterChange handler').toBeGreaterThanOrEqual(1);
        for (const site of sites) {
            // Window = this handler only. It ends where the NEXT `onXxx`
            // binding starts, so the sibling handlers stay out of the
            // assertion.
            const rest = objectViewSrc.slice(site.index! + 1, site.index! + 401);
            const next = rest.search(/\bon[A-Z]\w*\s*[=:]/);
            const body = next === -1 ? rest : rest.slice(0, next);
            expect(body, `this onFilterChange persists a view overlay:\n${body}`).not.toContain('persistViewPatch');
            expect(body, `this onFilterChange persists a view overlay:\n${body}`).not.toContain('persistViewFilter');
            expect(body, `this onFilterChange writes view metadata:\n${body}`).not.toContain('updateViewConfig');
            expect(body, `this onFilterChange writes view metadata:\n${body}`).not.toContain('persistRuntimeMetadata');
        }
    });

    it('the surviving handler still keeps SESSION state — the panel is not amnesiac', () => {
        // Since objectui#12418 the conditions are the user's own list state
        // (`listPrefs`, a `sys_user_preference` row), not this browser's
        // localStorage alone: still never the view's stored body.
        expect(objectViewSrc).toMatch(/onFilterChange=\{[^}]*listPrefs\.patchView\(viewDef\.id, \{ filters/s);
    });

    it('the EXPLICIT save path is untouched — this is the control', () => {
        // "Save view" through the view config panel still writes the whole view
        // body through the metadata seam. #4155 removed the automatic write,
        // not the deliberate one. Read inside the handler's own declaration
        // (see `declarationInitializer`), so the assertion cannot be satisfied
        // by a call in some other function, nor broken by a comment.
        const handler = declarationInitializer(objectViewSrc, 'handleViewConfigSave');
        expect(handler, '`const handleViewConfigSave` is gone from ObjectView.tsx').toBeDefined();
        expect(
            callsWithFirstArg(handler!, 'persistRuntimeMetadata', 'view'),
            `handleViewConfigSave no longer persists through the metadata seam:\n${handler!.getText().slice(0, 600)}`,
        ).not.toHaveLength(0);
    });
});

describe('objectstack#5159 ratchet — no raw FilterGroup on any persist path', () => {
    it('the Studio inspector still folds through the shared module — one dialect, not two', () => {
        expect(widgetsSrc).toMatch(
            /import\s*\{[^}]*foldFilterGroupToSpecRules[^}]*\}\s*from\s*'\.\.\/viewFilterFold\.js'/,
        );
        // The local operator table it used to carry is gone: a second table is
        // how the runtime toolbar ended up with no fold at all. (Matched on the
        // DECLARATION so the comment explaining the removal doesn't trip it.)
        expect(widgetsSrc).not.toMatch(/const\s+FB_TO_SPEC\b/);
    });

    it('the refusal still reaches the user where the fold is still called', () => {
        expect(widgetsSrc).toContain('foldFilterGroupToSpecRules');
        expect(widgetsSrc, 'widgets.tsx surfaces the refusal as a toast').toMatch(
            /toast\.error\(\s*tr?\(\s*FILTER_FOLD_REFUSAL_KEYS/,
        );
    });

    it('the fold module itself is still exported and used — #4155 removed a caller, not the fold', () => {
        const foldSrc = readFileSync(path.join(here, 'viewFilterFold.ts'), 'utf8');
        expect(foldSrc).toMatch(/export function foldFilterGroupToSpecRules/);
        expect(foldSrc).toMatch(/export const FILTER_FOLD_REFUSAL_KEYS/);
    });
});
