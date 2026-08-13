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
// label in Studio"), and it is why this file escalated rather than pinning a
// preference — see the report on #8037.
//
// ══════════════════════════════════════════════════════════════════════════
// [#8284] WHAT THE RULING CHANGED, AND WHERE THIS FILE NOW STANDS
// ══════════════════════════════════════════════════════════════════════════
//
// Maintainer ruling, 2026-08-13: the catalog LOSES to an explicit override,
// decided by COMPARISON — the catalog value applies only while the document's
// scalar still equals the packaged base value; a scalar that differs was
// explicitly set and the catalog yields. No provenance flag is carried through
// the fold, all three scalars, one mechanism. `?layers=true` stays untranslated
// and diagnostic. Implemented in `translateObject`, with the packaged base
// handed in by the REST boundary from
// `ObjectStackProtocolImplementation.getPackagedObjectBase`.
//
// So the first `it.fails` above is now a plain green case: the three reads of
// one object serve ONE label, and it is the folded one.
//
// ⛔ THE SECOND ONE IS NOT, AND THE REASON IS A SECOND DEFECT ONE LAYER DOWN.
// A tenant's rename still does not reach those reads — but no longer because of
// the catalog. `mergeObjectDefinitions` applies an extender's scalars LAST onto
// whatever base it is given, and ADR-0029 D9.2 makes the tenant's overlay that
// base (`overlay ?? own`, extenders folded on). So the showcase extension's
// `label: 'Account (Success Overlay)'` overwrites the tenant's 'Customer'
// inside the fold, and the value is simply not in the document any read is
// serving. The card measured this without naming it — its own table records
// `layers.effective = "Account (Success Overlay)"` after the rename, i.e. the
// extension had already beaten the overlay before i18n ever ran.
//
// Whether a package extension's label should outrank a tenant's Studio rename
// is a fold-precedence decision the 2026-08-13 ruling did not make, and it is
// NOT arm B (nothing here proposes dropping scalars from the fold). It is filed
// as a sub-issue of #8284; the `it.fails` case below stays exactly as it was
// written, so it flips to green the day that ruling lands — and the case after
// it pins what IS true today, so the state is not merely absent from the file.

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
        // [#8284] The catalog half is read from the SHIPPED BUNDLE, not from a
        // served label any more. It used to be asserted as "the list read
        // answers `Account`" — which was only true because the catalog was
        // overwriting the fold, i.e. that assertion WAS the defect, and it
        // inverts with the fix. The declaration itself is what this premise is
        // about, and the stack carries it (`translations:` in
        // `objectstack.config.ts`).
        const catalogEn = (showcaseStack as any)?.translations?.[0]?.en?.objects?.showcase_account;
        expect(catalogEn?.label).toBe(CATALOG_LABEL);
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

    it('all three reads of one object serve one label', async () => {
        const single = await stack.apiAs(token, 'GET', '/meta/object/showcase_account');
        const singleBody: any = await single.json();
        const layered = await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true');
        const layeredBody: any = await layered.json();

        // [#8284] `effective` is documented as "what `getMetaItem` would
        // return", and as of the 2026-08-13 ruling that sentence is true again:
        // the catalog no longer overwrites the extension's scalar on the way
        // out, so the diagnostic and the two translated reads agree.
        expect(labelOf(layeredBody?.effective)).toBe(labelOf(singleBody?.item));
        expect(labelOf(layeredBody?.effective)).toBe(await listedLabel());
        // …and the value they agree on is the FOLDED one, not the catalog's.
        // Asserting only the agreement would stay green if a later change made
        // all three serve `Account` again.
        expect(labelOf(singleBody?.item)).toBe(EXTENSION_LABEL);
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

    it('[#8284] after the rename the three reads still AGREE — on the extension, not the catalog', async () => {
        // What the ruling actually bought in the renamed state, pinned so the
        // `it.fails` above is not the file's only word about it. The tenant's
        // value is absent from every read because `mergeObjectDefinitions`
        // applies the extender's scalar LAST onto the overlay base
        // (ADR-0029 D9.2) — the second defect named in this file's header, and
        // the one the `it.fails` is now waiting on. What #8284 removed is the
        // DISAGREEMENT: no read serves the packaged catalog string any more.
        //
        // Performs its own PUT rather than leaning on the case above: an
        // `it.fails` stops at its first failing assertion, so depending on its
        // side effects would make this case's meaning depend on where that
        // happens to be.
        const before: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        const put = await stack.apiAs(token, 'PUT', '/meta/object/showcase_account', {
            ...(before?.item ?? {}), label: 'Customer',
        });
        expect(put.status).toBeLessThan(400);

        const layered: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true')).json();
        expect(labelOf(layered?.overlay)).toBe('Customer');

        const after: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        expect(labelOf(after?.item)).toBe(labelOf(layered?.effective));
        expect(await listedLabel()).toBe(labelOf(layered?.effective));
        // ⛔ And NOT the catalog string, which is what all three used to serve.
        expect(labelOf(after?.item)).not.toBe(CATALOG_LABEL);
    });
});
