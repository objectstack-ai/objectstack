// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **on a HOST config, `os dev` has exactly ONE registrar for the four
 * ADR-0057 security collections — the artifact door — and only when that door
 * actually composes.**
 *
 * ## The two writers this refuses, as measured
 *
 * `shouldBootWithLibrary()` returns `false` for a host config (one whose
 * `plugins[]` holds instantiated plugins), so `createStandaloneStack` — the
 * composition that already declares `securityMetadataRegistrar:
 * 'artifact-door'` — never runs. Two other writers then reach the metadata
 * service over the SAME stack:
 *
 *   1. `new AppPlugin(config)` wrapping the config MODULE. Under the default
 *      `'app-plugin'` registrar its ADR-0057 block registers `positions` /
 *      `permissions` / `capabilities` / `sharingRules`.
 *   2. the dev-only HMR `MetadataPlugin`, over `dist/objectstack.json` — the
 *      COMPILED TWIN of that same module, which the `os dev` supervisor
 *      produced moments earlier. It strict-parses, forward-converts and
 *      ADR-0010-stamps, and reaches all four collections too.
 *
 * Both were measured on a real `os dev` boot of a host config (`examples/
 * app-showcase`, whose `plugins[]` holds four connector plugins and whose
 * stack declares all four collections):
 *
 *     → Compiling objectstack.config.ts → dist/objectstack.json...
 *     INFO [MetadataPlugin] Loading metadata from local artifact file
 *          {"path":".../examples/app-showcase/dist/objectstack.json"}
 *     INFO [MetadataPlugin] Artifact metadata loaded {...,"totalRegistered":246}
 *     INFO Registered stack-declared security metadata
 *          {"appId":"com.example.showcase","count":23}
 *
 * — the door at `21.215`, the wrap at `21.835`. `registerInMemory` is a
 * `Map.set`, so **the wrap's copy wins the cold boot**; and because the door
 * re-ingests on every artifact reload while the module copy never refreshes,
 * **the winner changes mid-run**. Measured on an instrumented host config
 * whose compiled twin carried a distinguishing label: the cold-boot registry
 * held the module's labels and no `_packageVersion`, and 37s later — after one
 * artifact reload, no restart — the same four items held the artifact's labels
 * and `_packageVersion: '1.0.0'`.
 *
 * ⚠️ **The two copies differ by PROVENANCE and FRESHNESS, not by parsing.** On
 * a config boot `defineStack()` is strict by default and runs the same
 * `ObjectStackDefinitionSchema` parse the door runs (`packages/spec/src/
 * stack.zod.ts`), so the wrap's copy already carries the schema defaults and
 * the ADR-0122 input transforms. What it lacks is the ADR-0010 stamp
 * (`_packageVersion` on all four kinds, `_packageId` / `_provenance` on
 * `position`), and — the half that bites — it never refreshes, while the
 * door's copy reloads on every recompile. A consumer therefore reads one of
 * two copies of an authorization input depending on when it asked. That is
 * why this is `security`-labelled, and why the fix is the ownership one
 * rather than "make the two shapes match".
 *
 * ## What is pinned, and why the guard is on SOURCE
 *
 * The decision lives inside `Serve.run()`, ~900 lines into a method that boots
 * a kernel, a database and an HTTP server; there is no seam to call. The
 * repo's answer for exactly this shape is a source pin
 * (`child-env-source-loader.pin.test.ts`, `serve-settings-ordering.pin.test.ts`)
 * — assert the STRUCTURE that makes the composition correct, and pair it with
 * a behavioural assertion that the words the structure uses still mean
 * something. Both halves are here: without the second, renaming the option on
 * `AppPlugin` would leave this file green over a dead string.
 *
 * The structural invariant has two directions and both matter:
 *
 *   • the wrap declares `'artifact-door'` when the door composes, and
 *   • it declares NOTHING (so `AppPlugin` defaults to `'app-plugin'`) when the
 *     door does not — because a host config with no compiled artifact, and
 *     every non-dev host boot, would otherwise lose its ONLY registrar.
 *     Measured: `os serve` over the same host config has a metadata service
 *     and the wrap is its only writer (`Registered stack-declared security
 *     metadata {"appId":"com.probe.hostcfg","count":4}`, no door in the boot).
 *
 * ⛔ The second direction has a trap that RESOLVING hides: under `os dev` the
 * supervisor always writes its channel, and `resolveDefaultArtifactPath`
 * returns an explicitly named path VERBATIM with no existence check
 * (`packages/runtime/src/default-host.ts`) — only the conventional
 * `<cwd>/dist/objectstack.json` fallback is stat'ed. Compose the door over a
 * path that is not on disk (`os dev --artifact ./typo.json`, a stale
 * `OS_ARTIFACT_PATH`) and it starts EMPTY and SILENT: its local-file load is
 * `{ optional: true }` and answers ENOENT with an `info` line, registering
 * nothing (`packages/metadata/src/plugin.ts`). The wrap would have deferred to
 * a writer that never writes, and all four collections would end the boot with
 * ZERO registrars — green and quiet, and strictly worse than the divergence
 * this composition removes. So the gate is EXISTENCE, not resolution.
 *
 * That is why the door instance is constructed next to the wrap and only
 * `kernel.use`d at its ordering-constrained site: ONE value decides both
 * facts. Two independent expressions would be free to drift, and the drift is
 * invisible — a boot with no registrar looks exactly like a boot with one.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppPlugin } from '@objectstack/runtime';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE_TS = path.join(HERE, 'serve.ts');
const source = fs.readFileSync(SERVE_TS, 'utf8');

/** Occurrences of `needle` in the source, as a plain substring count. */
function count(needle: string): number {
    return source.split(needle).length - 1;
}

describe('#14397 — `os dev` over a HOST config composes ONE registrar for stack-declared security metadata', () => {
    it('the dev artifact door is decided ONCE, before the AppPlugin wrap', () => {
        expect(source, 'the door decision must be a single named value').toContain(
            'let devArtifactDoor: any;',
        );
        // The gate is the same one the composition has always used.
        expect(source).toContain(
            "if (isDev && flags.server && !plugins.some((p: any) => p?.constructor?.name === 'MetadataPlugin')) {",
        );
        // Exactly one MetadataPlugin is constructed in this file, and it is
        // that value — a second construction site is a second decision.
        expect(count('new MetadataPlugin(')).toBe(1);
        expect(source).toContain('devArtifactDoor = new MetadataPlugin({');
        // The path still comes from the supervisor's own channel, never from
        // `<cwd>/dist/objectstack.json` by accident.
        expect(source).toContain(
            'const hmrArtifactPath = resolveDefaultArtifactPath(readInternalArtifactPath());',
        );
    });

    it('the door is composed only when its artifact EXISTS, not merely resolves', () => {
        // The regression this closes: `resolveDefaultArtifactPath` returns a
        // NAMED path verbatim without stat'ing it, and the door tolerates
        // ENOENT by starting empty — so gating on resolution alone hands the
        // four collections to a writer that never writes.
        expect(source, 'the door must be gated on the artifact being on disk').toContain(
            'if (!fs.existsSync(hmrArtifactPath)) {',
        );
        // The gate must sit BEFORE the construction, not after it: a door
        // constructed and then discarded would still have set the wrap's
        // option under any future refactor that reads "was one built?".
        const gateAt = source.indexOf('if (!fs.existsSync(hmrArtifactPath)) {');
        const buildAt = source.indexOf('devArtifactDoor = new MetadataPlugin({');
        expect(gateAt).toBeGreaterThan(-1);
        expect(buildAt).toBeGreaterThan(-1);
        expect(gateAt).toBeLessThan(buildAt);
        // A missing artifact is not a silent downgrade: the warning names the
        // path, and says the wrap keeps the collections.
        expect(source).toContain(
            '`  ⚠ Dev metadata-HMR endpoint not enabled: no compiled artifact at ${hmrArtifactPath}`',
        );
        expect(source).toContain('Stack-declared security metadata stays with the app wrap');
    });

    it('the host-config wrap declares `artifact-door` exactly when that door exists', () => {
        expect(source).toContain(
            "devArtifactDoor ? { securityMetadataRegistrar: 'artifact-door' } : {},",
        );
        // ⛔ The unconditional shape is the defect: it is what put a SECOND
        // writer on every `os dev` boot of a host config — a copy that lacks
        // the ADR-0010 provenance stamp and never refreshes, alongside the
        // door's, which reloads on every recompile.
        expect(
            source,
            'the wrap must never be constructed without the registrar decision',
        ).not.toContain('new AppPlugin(config)]');
    });

    it('the door is `kernel.use`d from that same value, at its ordering-constrained site', () => {
        expect(count('await kernel.use(devArtifactDoor);')).toBe(1);
        expect(source).toContain('if (devArtifactDoor) {\n        try {\n          await kernel.use(devArtifactDoor);');
        // The `kernel.use` still sits AFTER the HonoServer composition —
        // MetadataPlugin.start() mounts its route on the `http-server`
        // service. Positions, not line numbers: the file moves.
        expect(source.indexOf('await kernel.use(serverPlugin);'))
            .toBeLessThan(source.indexOf('await kernel.use(devArtifactDoor);'));
        // ...and the wrap is constructed BEFORE it, which is the whole reason
        // the decision had to be hoisted.
        expect(source.indexOf("devArtifactDoor ? { securityMetadataRegistrar: 'artifact-door' } : {},"))
            .toBeLessThan(source.indexOf('await kernel.use(devArtifactDoor);'));
    });

    it('the `kernel.use` catch does not claim a consequence it cannot have', () => {
        // An earlier draft warned there that the four collections had gone
        // unregistered. `Kernel.use` only validates the plugin and registers
        // it by NAME (packages/core/src/kernel.ts) — `init`/`start` run later,
        // in `bootstrap` — so for a MetadataPlugin already constructed above,
        // on a still-`idle` kernel, that catch does not fire. The real
        // lost-door case is the missing artifact, and it warns where the path
        // can be named; see the existence test above.
        const useAt = source.indexOf('await kernel.use(devArtifactDoor);');
        expect(useAt).toBeGreaterThan(-1);
        const catchWindow = source.slice(useAt, useAt + 600);
        expect(catchWindow).not.toContain('The app wrap deferred');
        expect(catchWindow).not.toContain('NOT registered on this boot');
    });

    it('behavioural: the option the source passes is the one AppPlugin reads', () => {
        const bundle = { manifest: { id: 'com.test.14397', name: 'pin', version: '1.0.0' } };
        // The exact two literals the composition above can pass.
        expect(new AppPlugin(bundle, undefined, {}).securityMetadataRegistrar).toBe('app-plugin');
        expect(
            new AppPlugin(bundle, undefined, { securityMetadataRegistrar: 'artifact-door' })
                .securityMetadataRegistrar,
        ).toBe('artifact-door');
    });
});
