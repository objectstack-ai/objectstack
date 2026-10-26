/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#3913 ratchet — no app-shell file dispatches `/api/v1/actions`
 * by hand.
 *
 * The bug this guards: the `/actions` response wraps TWICE (the route's own
 * `{success, data}` inside the dispatcher's), and a failure has three shapes
 * only one of which `res.ok` catches. Two copies of that rule existed — the
 * shared console runtime and RecordDetailView's — and they drifted: one learned
 * to inspect the inner envelope, the other did not. The one that did not was
 * the console's MAIN action path, so a failed action fired a green "completed"
 * toast on every list and page surface while the real error was swallowed.
 * `marketplaceApi.installPackage` had the same hole and could report a package
 * as installed when it was not.
 *
 * Since #2904 the dispatch itself lives in `@object-ui/core`
 * (`createServerActionHandler`, which applies `interpretActionResponse` — the
 * envelope rule, also moved there) and the console layers its DOM choreography
 * on top through `utils/consoleServerAction`. The ratchet is therefore
 * STRONGER than it used to be: an app-shell file has no business naming the
 * action route in code at all.
 *
 * If this fails: don't hand-roll the POST. Register a handler built with
 * `createConsoleServerActionHandler` (console surfaces) or core's
 * `createServerActionHandler` — or call the action through
 * `@objectstack/client`, which folds every shape into `{ success, data?, error? }`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
const appShellSrc = here;

/** Files allowed to name the route without going through the core dispatcher. */
const EXEMPT = new Set<string>([
    // The cloud marketplace install posts to a *cloud* origin's action route
    // and consumes `InstallResponse`, not `ActionResult`. It still has to
    // honour the envelope, and does — covered by its own tests — but it is not
    // an ActionRunner handler, so it does not use the core dispatcher.
    path.join(appShellSrc, 'console', 'marketplace', 'marketplaceApi.ts'),
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

/** A source file that POSTs to the action route. */
const ROUTE = /\/api\/v1\/actions\//;

/**
 * Comments name the route freely while explaining the routing rules (e.g.
 * ConsoleShell's note on why `modal` stays client-side). Only CODE counts.
 */
function stripComments(src: string): string {
    return mask(src);
}

describe('objectstack#3913 ratchet — /actions dispatch goes through the core dispatcher', () => {
    const files = walk(appShellSrc);

    const offenders = files
        .filter((f) => !EXEMPT.has(f) && ROUTE.test(stripComments(readFileSync(f, 'utf8'))))
        .map((f) => path.relative(appShellSrc, f));

    it('no app-shell file names the /actions route in code (dispatch is core-owned)', () => {
        expect(offenders).toEqual([]);
    });

    it('still guards something — the known dispatch surfaces route through the shared wrapper', () => {
        // A ratchet that matches nothing passes vacuously forever. Pin that the
        // two surfaces the hand-rolled copies lived in still exist and now build
        // their handler with `createConsoleServerActionHandler` — the moment one
        // reverts to a hand-rolled fetch, the route string reappears and the
        // offenders assertion above catches it.
        const surfaces = [
            path.join('hooks', 'useConsoleActionRuntime.tsx'),
            path.join('views', 'RecordDetailView.tsx'),
        ];
        for (const rel of surfaces) {
            const src = readFileSync(path.join(appShellSrc, rel), 'utf8');
            expect(src, `${rel} should dispatch via createConsoleServerActionHandler`)
                .toContain('createConsoleServerActionHandler');
        }
        // …and the wrapper itself delegates to core rather than fetching.
        const wrapper = readFileSync(path.join(appShellSrc, 'utils', 'consoleServerAction.ts'), 'utf8');
        expect(wrapper).toContain('createServerActionHandler');
    });
});
