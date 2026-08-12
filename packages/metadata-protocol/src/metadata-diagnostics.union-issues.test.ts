// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5598 — the READ path's `_diagnostics` keeps the union branch that explains
 * the rejection, exactly as the save path's 422 does.
 *
 * `computeMetadataDiagnostics` is the fifth consumer of one mechanism
 * (#4971 spec, #5014 rest, #5341 cli, #5364 the save-path 422, this one). Zod
 * folds every branch of a failed `z.union` into ONE top-level issue whose path
 * is `''` and whose message is the literal `"Invalid input"`; mapping only the
 * top-level issues therefore put exactly that on `_diagnostics`. Since
 * `ViewMetadataSchema` IS a top-level union (`view.zod.ts` —
 * `z.preprocess(stripViewConsoleDecorations, z.union([…]))`), EVERY stored view
 * with a defect degraded to one rootless line, and the module's own promise of
 * "inline field errors" had no field to name.
 *
 * The consequence was a SPLIT verdict, which is what makes this its own bug
 * rather than a cosmetic one: after #5364 an author who SAVED a broken view saw
 * the offending key, while the same author OPENING that same stored view saw
 * `Invalid input`. These tests pin the two paths to one answer by construction —
 * the read path calls `zodIssuesToMetadataIssues`, it does not re-derive the
 * policy — so the ranking's own behaviour stays pinned where it is defined
 * (`protocol.save-union-issues.test.ts`) and is not restated here.
 */
import { describe, expect, it } from 'vitest';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
import type { z } from 'zod';
import { zodIssuesToMetadataIssues } from './protocol.js';
import { computeMetadataDiagnostics, decorateMetadataItem } from './metadata-diagnostics.js';

/**
 * The exact document from #5598 (and #5364 before it): a view authored with a
 * single VIEW's keys at the CONTAINER level. Every branch of the top-level
 * union rejects it, which is precisely the shape that used to collapse.
 */
const brokenView = {
    name: 'task_list',
    object: 'task',
    type: 'list',
    label: 'Tasks',
    columns: [{ field: 'title', summary: { type: 'sum', fieldd: 'amount' } }],
};

describe('#5598 computeMetadataDiagnostics — a stored view names the offending key', () => {
    it('expands the union instead of serving one rootless "Invalid input"', () => {
        const diag = computeMetadataDiagnostics('view', brokenView);

        expect(diag?.valid).toBe(false);
        // The defect, stated as a number: this was exactly 1 before the fix.
        expect(diag?.errors?.length).toBeGreaterThan(1);

        // Additive, not replacing: the union's own entry is still first, so a
        // consumer reading `errors[0]` reads the same entry it always did.
        expect(diag?.errors?.[0]).toEqual({
            path: '',
            message: 'Invalid input',
            code: 'invalid_union',
        });

        // ...and the branch behind it is the one that names keys. The #4001
        // curated prose itself is spec-owned and deliberately not pinned here —
        // what this file guards is that a KEY reaches the consumer at all.
        const explained = diag?.errors?.slice(1) ?? [];
        expect(explained.some((e) => e.code === 'unrecognized_keys')).toBe(true);
        expect(explained.some((e) => e.message.includes('`columns`'))).toBe(true);
    });

    it('serves the same verdict the save path serves — one ranking, not two', () => {
        // The point of the change: reuse, not a second copy of the policy. If
        // this ever diverges, the same document says two different things
        // depending on whether it is being opened or being saved (#5364).
        const schema = getMetadataTypeSchema('view') as z.ZodTypeAny;
        const parsed = schema.safeParse(brokenView);
        expect(parsed.success).toBe(false);

        const fromSharedRanking = zodIssuesToMetadataIssues(
            (parsed as { error: { issues: unknown[] } }).error.issues,
        );
        expect(computeMetadataDiagnostics('view', brokenView)?.errors).toEqual(fromSharedRanking);
    });

    it('reaches the Studio-facing surface — `decorateMetadataItem` carries it', () => {
        const decorated = decorateMetadataItem('view', brokenView) as {
            _diagnostics?: { valid: boolean; errors?: Array<{ code?: string }> };
        };
        expect(decorated._diagnostics?.valid).toBe(false);
        expect(decorated._diagnostics?.errors?.length).toBeGreaterThan(1);
    });

    it('re-decorating an already-decorated item is stable — the strip still runs', () => {
        // `computeMetadataDiagnostics` strips its own `_diagnostics` before
        // re-validating. That strip is untouched by this change, and a document
        // read twice must not accumulate a rejection of the envelope itself.
        const once = decorateMetadataItem('view', brokenView);
        const twice = decorateMetadataItem('view', once);
        expect((twice as { _diagnostics?: unknown })._diagnostics)
            .toEqual((once as { _diagnostics?: unknown })._diagnostics);
    });
});

describe('#5598 the entries that never went through a union are unchanged', () => {
    it('a plain field-level rejection keeps its own path, message and code', () => {
        const diag = computeMetadataDiagnostics('object', {
            name: 'task',
            label: 'Task',
            fields: { title: { type: 'nosuchtype' } },
        });

        expect(diag?.valid).toBe(false);
        expect(diag?.errors?.[0]?.path).toBe('fields.title.type');
        expect(diag?.errors?.[0]?.code).toBe('invalid_value');
    });

    it('a non-object document still gets the hand-written envelope', () => {
        expect(computeMetadataDiagnostics('object', null)).toEqual({
            valid: false,
            errors: [{
                path: '',
                message: 'Metadata document must be a non-null object',
                code: 'invalid_type',
            }],
        });
    });

    it('a spec-valid view stays valid — the expansion invents no rejection', () => {
        const diag = computeMetadataDiagnostics('view', {
            name: 'crm_lead.all',
            object: 'crm_lead',
            viewKind: 'list',
            config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: 'crm_lead' } },
        });
        expect(diag).toEqual({ valid: true });
    });

    it('an unregistered type is still "no opinion", not "valid"', () => {
        expect(computeMetadataDiagnostics('service', { name: 'whatever' })).toBeUndefined();
    });
});

/**
 * #5599 — the OTHER half of the same badge, closed in `packages/spec`.
 *
 * #5598 fixed a stored view whose defect collapsed to one rootless line. It could
 * not touch the worse case one row over: a stored view that is not a view at all
 * got `valid: true`. `ViewMetadataSchema`'s fourth union member both stripped
 * unknown keys and required none, so `{ nope: 1 }` MATCHED, and the badge this
 * module computes from that same schema said the document was fine. The two bugs
 * are one mechanism seen from both ends — a union that explains its rejections
 * badly, and a union that does not reject at all — which is why the ruling on
 * #5599 asked for the disappearance of this false `valid: true` to be asserted
 * from the READ path, not only from the schema's own unit tests.
 */
describe('#5599 a stored `view` that is not a view is no longer badged valid', () => {
    it('`{ nope: 1 }` — the issue\'s headline document — is now `valid: false`', () => {
        // On `origin/main` this returned exactly `{ valid: true }`.
        const diag = computeMetadataDiagnostics('view', { nope: 1 });
        expect(diag?.valid).toBe(false);
        expect(diag?.errors?.length).toBeGreaterThan(0);
    });

    it('…and the badge names WHY, so Studio has something to render', () => {
        const diag = computeMetadataDiagnostics('view', { nope: 1 });
        expect(diag?.errors?.[0]?.message).toContain('no recognized `view` key');
        expect(diag?.errors?.[0]?.code).toBe('custom');
    });

    it('an empty stored `view` body is `valid: false` too', () => {
        expect(computeMetadataDiagnostics('view', {})?.valid).toBe(false);
    });

    it('reaches Studio through `decorateMetadataItem`, like every other verdict', () => {
        const decorated = decorateMetadataItem('view', { nope: 1 }) as {
            _diagnostics?: { valid: boolean };
        };
        expect(decorated._diagnostics?.valid).toBe(false);
    });

    it('read and save still agree — one ranking, applied to the new rejection', () => {
        // The #5598 invariant, re-proved on the issue class #5599 introduces:
        // a document must not be "valid to open, invalid to save" or vice versa.
        const schema = getMetadataTypeSchema('view') as z.ZodTypeAny;
        const parsed = schema.safeParse({ nope: 1 });
        expect(parsed.success).toBe(false);
        const fromSharedRanking = zodIssuesToMetadataIssues(
            (parsed as { error: { issues: unknown[] } }).error.issues,
        );
        expect(computeMetadataDiagnostics('view', { nope: 1 })?.errors).toEqual(fromSharedRanking);
    });

    it('a legitimately-lean overlay is still valid — no collateral badge', () => {
        // The precondition asks "is this a view at all", never "is it complete".
        // [#7741] "lean" now still carries the object binding: the write path
        // inherits `object`/`viewKind` from the shadowed entry (#2555), so a
        // stored lean overlay of a REAL view looks exactly like this.
        expect(computeMetadataDiagnostics('view', { isPinned: true, object: 'task', viewKind: 'list' })).toEqual({ valid: true });
        expect(computeMetadataDiagnostics('view', { hidden: true, object: 'task', viewKind: 'list' })).toEqual({ valid: true });
        // …while a stored row with NO binding is a row no object-bound read
        // path can serve — the #7741 dead row — and is badged invalid now.
        expect(computeMetadataDiagnostics('view', { isPinned: true })?.valid).toBe(false);
    });

    it('a stored row of pure identity is no longer valid either', () => {
        // The stored twin of the write-path case: `{ nope: 1 }` was persisted as
        // `{ nope: 1, name: … }` (plus inherited identity where a registry entry
        // existed), so every such row read back `valid: true`. Those rows are
        // exactly the ones an operator now has to find — see the changeset.
        expect(computeMetadataDiagnostics('view', { nope: 1, name: 'garbage_view' })?.valid).toBe(false);
        expect(computeMetadataDiagnostics('view', {
            nope: 1, name: 'showcase_task.default', viewKind: 'list', object: 'showcase_task', label: 'All Tasks',
        })?.valid).toBe(false);
    });
});
