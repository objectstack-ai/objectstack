// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8037] One object, three reads, three different labels — measured on a stack
// booted the way a DEPLOYED runtime boots.
//
//   GET /meta/object              (list)     → "Account"
//   GET /meta/object/showcase_account        → "Account"
//   GET /meta/object/showcase_account?layers=true → "Account (Success Overlay)"
//
// ⭐ WHERE THE DIVERGENCE IS NOT. It is not in the fold. Traced through a real
// boot, `foldObjectExtendersOnto` is called on the by-name read and on the
// layered read with the same base and returns the same body to both — label
// included ("Account" in, "Account (Success Overlay)" out, on BOTH). The
// property-class sweep in
// `packages/rest/src/meta-object-extension-property-classes.test.ts` holds that
// from the other side: on twelve host shapes every read agrees with the
// registry's resolved schema on all six properties `mergeObjectDefinitions`
// touches. A fix applied to the fold would therefore be applied to the one
// layer that is behaving.
//
// ⭐ WHERE IT IS. `translateObject` (packages/spec/src/system/i18n-resolver.ts)
// resolves each of the three scalar props as `catalog ?? document`:
//
//     const label = lookupObjectField(bundle, objectName, 'label', opts) ?? doc.label;
//
// The showcase's own catalog declares `objects.showcase_account.label = "Account"`.
// The list and by-name reads are translated, so the catalog entry REPLACES
// whatever the fold resolved. `?layers=true` is deliberately not translated
// ("Not translated and not cached, both deliberately: this is a diagnostic"),
// so it alone shows the folded value. Hence "onto `?layers=true` only".
//
// ⛔ AND THE EXTENSION IS THE MILDER HALF. The catalog is keyed by object name
// and resolved AHEAD of the document, so it does not defeat only a code-declared
// extension override — it defeats the TENANT's own customisation too. The final
// case below renames the object through the ordinary Studio round-trip and the
// rename reaches `layers.overlay` and nothing else: both reads every writable
// form derives from keep serving the packaged catalog string. That is the
// scenario #8027/#8045 were entirely about ("an admin renaming the object's
// label in Studio"), and it is why this file escalates rather than pinning a
// preference — see the report on #8037.
//
// The `it.fails` cases below are the invariants that SHOULD hold, quarantined in
// the repo's existing xfail idiom (see `field-zoo-roundtrip.dogfood.test.ts`).
// They pass while the defect stands and turn RED the moment it is fixed, which
// is what makes them a handover rather than a pin of current behaviour.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

/** What the showcase's `objectExtensions` entry declares on `main` today. */
const EXTENSION_LABEL = 'Account (Success Overlay)';
/** What the showcase's `en` catalog declares for the same object. */
const CATALOG_LABEL = 'Account';

const labelOf = (item: unknown): unknown =>
    (item as { label?: unknown } | null | undefined)?.label;

describe('dogfood: the object-extension fold and the i18n catalog disagree on scalars (#8037)', () => {
    let stack: VerifyStack;
    let token: string;
    let tempDir: string;
    let priorWritable: string | undefined;

    beforeAll(async () => {
        // The last case performs a tenant customisation of an `object`, which is
        // not overlay-writable by default (`NOT_OVERRIDABLE`). This is the same
        // switch a deployment flips to let Studio customise object metadata.
        priorWritable = process.env.OS_METADATA_WRITABLE;
        process.env.OS_METADATA_WRITABLE = 'object';

        tempDir = mkdtempSync(join(tmpdir(), 'os-8037-scalar-'));
        const artifactPath = join(tempDir, 'objectstack.json');
        // The real `objectstack build` lowering, for the same reason #7556's
        // dogfood file uses it: `JSON.stringify(stack)` drops callables silently.
        writeBuildShapedArtifact(showcaseStack as unknown as Record<string, unknown>, artifactPath);

        // Boots from a COMPILED ARTIFACT, whose `objects` and `objectExtensions`
        // are separate collections — the deployment shape, and the only one on
        // which this family of defects is observable at all.
        stack = await bootStack(showcaseStack, {
            extraPlugins: [
                new MetadataPlugin({
                    rootDir: tempDir,
                    watch: false,
                    artifactWatch: false,
                    registerSystemObjects: false,
                    artifactSource: { mode: 'local-file', path: artifactPath },
                }),
            ],
        });
        token = await stack.signIn();
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
        if (priorWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
        else process.env.OS_METADATA_WRITABLE = priorWritable;
    });

    const listedLabel = async (): Promise<unknown> => {
        const res = await stack.apiAs(token, 'GET', '/meta/object');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        const items = (Array.isArray(body)
            ? body
            : (body?.items ?? body?.data ?? [])) as Array<{ name?: string }>;
        return labelOf(items.find((o) => o?.name === 'showcase_account'));
    };

    it('the premise: the extension declares a label, and the catalog declares a different one', async () => {
        // Both halves ship on `main`. Neither is a fixture — if either changes,
        // every case below stops meaning what it says, and this fails first.
        const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true');
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(labelOf(body?.code)).toBe(EXTENSION_LABEL);
        expect(await listedLabel()).toBe(CATALOG_LABEL);
        expect(EXTENSION_LABEL).not.toBe(CATALOG_LABEL);
    });

    it('the fold itself is uniform — it reaches BOTH layers of the diagnostic', async () => {
        // The half that is working, pinned so a future fix cannot "resolve" the
        // divergence by unfolding the layered read and calling the three reads
        // agreed. `effective` is `overlay ?? code`, and the showcase customises
        // nothing at this point, so both layers carry the extension.
        const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true');
        const body: any = await res.json();
        expect(labelOf(body?.code)).toBe(EXTENSION_LABEL);
        expect(labelOf(body?.effective)).toBe(EXTENSION_LABEL);
        expect(body?.overlay ?? null).toBeNull();
    });

    it('the two translated reads agree with EACH OTHER — the divergence is not between them', async () => {
        const res = await stack.apiAs(token, 'GET', '/meta/object/showcase_account');
        const body: any = await res.json();
        expect(labelOf(body?.item)).toBe(await listedLabel());
    });

    it.fails('SHOULD: all three reads of one object serve one label', async () => {
        const single = await stack.apiAs(token, 'GET', '/meta/object/showcase_account');
        const singleBody: any = await single.json();
        const layered = await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true');
        const layeredBody: any = await layered.json();

        // `effective` is documented as "what `getMetaItem` would return". It is
        // not, and this is the sentence that stops being true.
        expect(labelOf(layeredBody?.effective)).toBe(labelOf(singleBody?.item));
        expect(labelOf(layeredBody?.effective)).toBe(await listedLabel());
    });

    it.fails('SHOULD: a tenant\'s own rename reaches the reads its forms derive from', async () => {
        // The ordinary Studio round-trip: GET the served document, rename it,
        // PUT it back. The write path persists the request body verbatim
        // (ADR-0005 §Validation), so this is exactly what an admin's save stores.
        const before: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        const put = await stack.apiAs(token, 'PUT', '/meta/object/showcase_account', {
            ...(before?.item ?? {}), label: 'Customer',
        });
        expect(put.status).toBeLessThan(400);

        const layered: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true')).json();
        // The row stored the rename — the customisation is real and readable…
        expect(labelOf(layered?.overlay)).toBe('Customer');

        // …and neither read that a writable form derives from ever shows it.
        const after: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        expect(labelOf(after?.item)).toBe('Customer');
        expect(await listedLabel()).toBe('Customer');
    });
});
