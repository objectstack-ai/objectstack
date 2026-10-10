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
// ⛔ THE SECOND ONE WAS NOT, AND THE REASON WAS A SECOND DEFECT ONE LAYER DOWN.
// A tenant's rename still did not reach those reads — but no longer because of
// the catalog. `mergeObjectDefinitions` applied an extender's scalars LAST onto
// whatever base it was given, and ADR-0029 D9.2 makes the tenant's overlay that
// base (`overlay ?? own`, extenders folded on). So the showcase extension's
// `label: 'Account (Success Overlay)'` overwrote the tenant's 'Customer'
// inside the fold, and the value was simply not in the document any read was
// serving. The card measured this without naming it — its own table records
// `layers.effective = "Account (Success Overlay)"` after the rename, i.e. the
// extension had already beaten the overlay before i18n ever ran.
//
// Whether a package extension's label should outrank a tenant's Studio rename
// is a fold-precedence decision the 2026-08-13 ruling did not make, and it is
// NOT arm B (nothing here proposes dropping scalars from the fold). It was filed
// as a sub-issue of #8284 and ruled on separately (ADR-0029 D9.2a).
//
// ══════════════════════════════════════════════════════════════════════════
// [ADR-0029 D9.2a] THE FOLD LAYER, RULED AND FIXED — THE SECOND PIN IS NOW GREEN
// ══════════════════════════════════════════════════════════════════════════
//
// Maintainer ruling, 2026-08-13 (option A, "tenant wins"): an extender's scalar
// applies only while the fold's BASE still carries the packaged owner's value;
// a diverged base has been authored by the tenant and the extender YIELDS.
// Deliberately the same comparison-based mechanism as #8284 one layer up — the
// same predicate, imported rather than re-spelled — so one sentence governs
// both layers: *an explicit override beats a packaged default.* No provenance
// flags, no migration, and no escape hatch: a package can no longer relabel an
// object a tenant deliberately renamed, which the ruling records as the point
// rather than a regression. Implemented in `SchemaRegistry`, at the single fold
// both read exits already funnel through.
//
// So the `it.fails` below is flipped to a plain `it` — UNMODIFIED otherwise,
// because it was written as the acceptance evidence for exactly this ruling.
// The case after it still passes as written too: it asserts that the three
// reads AGREE and that they do not serve the catalog string, both of which
// remain true — what changed is the value they agree ON, which it deliberately
// never named. Its prose is updated where the fix falsified it.
//
// ══════════════════════════════════════════════════════════════════════════
// [ADR-0131 D6] MANAGED CONTENT IS SEALED — WHERE THE RENAME NOW COMES FROM
// ══════════════════════════════════════════════════════════════════════════
//
// The rename used to be the Studio round-trip itself, behind the
// `OS_METADATA_WRITABLE=object` hatch. The hatch opens no write onto an object
// a managed package ships any more, so that round-trip is now pinned REFUSED
// (403 `NOT_OVERRIDABLE`, nothing stored). The rename the two read cases need
// is the one a deployment still carries: a row stored before the seal, read by
// a COLD boot over the same database. The read path is unchanged by the seal,
// so those two cases still measure what they always measured.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { MetadataPlugin } from '@objectstack/metadata';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

/** What the showcase's `objectExtensions` entry declares on `main` today. */
const EXTENSION_LABEL = 'Account (Success Overlay)';
/** What the showcase's `en` catalog declares for the same object. */
const CATALOG_LABEL = 'Account';

const labelOf = (item: unknown): unknown =>
    (item as { label?: unknown } | null | undefined)?.label;

/** The platform's own write context, for the one row this file stores by hand. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** The tenant's rename, as a row stored before the seal carries it. */
const RENAMED_LABEL = 'Customer';

describe('dogfood: the object-extension fold and the i18n catalog disagree on scalars (#8037)', () => {
    let stack: VerifyStack;
    let token: string;
    let tempDir: string;
    let priorWritable: string | undefined;
    let artifactPath: string;
    let databaseFile: string;

    /**
     * Boots from a COMPILED ARTIFACT, whose `objects` and `objectExtensions`
     * are separate collections — the deployment shape, and the only one on
     * which this family of defects is observable at all. Over a database FILE,
     * so a second boot is a real cold start on the rows the first one left.
     */
    const boot = () => bootShowcase({
        databaseFile,
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

    beforeAll(async () => {
        // [ADR-0131 D6] Open, so the refusal case below measures the seal with
        // the switch a deployment used to flip to let Studio customise object
        // metadata — the switch no longer reaches an object a package ships.
        priorWritable = process.env.OS_METADATA_WRITABLE;
        process.env.OS_METADATA_WRITABLE = 'object';

        tempDir = mkdtempSync(join(tmpdir(), 'os-8037-scalar-'));
        artifactPath = join(tempDir, 'objectstack.json');
        databaseFile = join(tempDir, 'showcase.db');
        // The real `objectstack build` lowering, for the same reason #7556's
        // dogfood file uses it: `JSON.stringify(stack)` drops callables silently.
        writeBuildShapedArtifact(showcaseStack as unknown as Record<string, unknown>, artifactPath);

        stack = await boot();
        token = await stack.signIn();
    }, 180_000);

    /**
     * The tenant's rename as a deployment carries it after the seal: a row a
     * Studio save stored BEFORE it (the authored document, renamed), read by a
     * cold boot over the same file. Done once; both read cases ask for it, so
     * neither depends on running after the other.
     */
    let renamed: Promise<void> | undefined;
    const withPreSealRename = (): Promise<void> => (renamed ??= (async () => {
        const declared = ((showcaseStack as any).objects as Array<Record<string, unknown>>)
            .find((o) => o?.name === 'showcase_account');
        expect(declared, 'the showcase still declares showcase_account').toBeDefined();
        const body = JSON.parse(JSON.stringify({ ...declared, label: RENAMED_LABEL }));
        for (const key of Object.keys(body)) if (key.startsWith('_')) delete body[key];
        const now = new Date().toISOString();
        const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as {
            insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
        };
        await ql.insert('sys_metadata', {
            type: 'object',
            name: 'showcase_account',
            organization_id: null,
            package_id: null,
            state: 'active',
            version: 1,
            checksum: null,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify(body),
        }, { context: SYSTEM_CTX });
        await stack.stop();
        stack = await boot();
        token = await stack.signIn();
    })());

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

    it('[ADR-0131 D6] the Studio rename round-trip of a PACKAGED object is refused, hatch open — nothing is stored', async () => {
        // The round-trip the rename cases below used to perform: GET the served
        // document, rename it, PUT it back. Managed content is sealed, so the
        // package door refuses it with the hatch open, and the reads keep
        // serving the folded (extension) label.
        const before: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        const put = await stack.apiAs(token, 'PUT', '/meta/object/showcase_account', {
            ...(before?.item ?? {}), label: RENAMED_LABEL,
        });
        const putBody: any = await put.json().catch(() => ({}));
        expect(put.status, JSON.stringify(putBody)).toBe(403);
        expect(putBody?.code ?? putBody?.error?.code).toBe('NOT_OVERRIDABLE');

        const layered: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true')).json();
        expect(layered?.overlay ?? null).toBeNull();
        expect(labelOf(layered?.effective)).toBe(EXTENSION_LABEL);
        expect(await listedLabel()).toBe(EXTENSION_LABEL);
    });

    it('[triage ruling Q1 → C] a pre-seal rename of the PACKAGED object is kept at rest, not served: the package definition wins', async () => {
        // [ADR-0131 D6] The rename is the row a pre-seal Studio save stored —
        // see `withPreSealRename` — read by a cold boot. `object` is sealed
        // against overlays of what a managed package ships, so that row is an
        // overlay no regime recognises: boot names it
        // (`[metadata_sealed_overlay_unserved]`) and does not load it, and the
        // reads every writable form derives from serve the package's
        // definition. Nothing is deleted.
        await withPreSealRename();

        const layered: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true')).json();
        // The row is still at rest — the diagnostic read shows it…
        expect(labelOf(layered?.overlay)).toBe(RENAMED_LABEL);

        // …and the two translated reads serve the package's (folded) label.
        const after: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        expect(labelOf(after?.item)).toBe(EXTENSION_LABEL);
        expect(await listedLabel()).toBe(EXTENSION_LABEL);
    }, 180_000);

    it('[#8284] after the rename the three reads still AGREE — on the extension, not the catalog', async () => {
        // What the ruling bought in the renamed state, pinned so the case above
        // is not the file's only word about it. This case asserts AGREEMENT and
        // the absence of the catalog string — never which value they agree on —
        // so it held under #8284 (all three served the extension's label, the
        // tenant's rename lost inside the fold) and it holds under ADR-0029 D9.2a (all
        // three serve the tenant's 'Customer', because the extender now yields
        // to a diverged base). That is the point of stating it this way: the
        // convergence #8284 bought is pinned independently of the fold
        // precedence ADR-0029 D9.2a then settled, so a regression in either is visible
        // here without this case having to be rewritten when the other moves.
        //
        // Asks for the renamed state itself rather than leaning on the case
        // above, so its meaning does not depend on that case's order or outcome.
        // [ADR-0131 D6] The rename is the pre-seal row (see `withPreSealRename`).
        await withPreSealRename();

        const layered: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account?layers=true')).json();
        expect(labelOf(layered?.overlay)).toBe(RENAMED_LABEL);

        const after: any = await (await stack.apiAs(token, 'GET', '/meta/object/showcase_account')).json();
        expect(labelOf(after?.item)).toBe(labelOf(layered?.effective));
        expect(await listedLabel()).toBe(labelOf(layered?.effective));
        // ⛔ And NOT the catalog string, which is what all three used to serve.
        expect(labelOf(after?.item)).not.toBe(CATALOG_LABEL);
    }, 180_000);
});
