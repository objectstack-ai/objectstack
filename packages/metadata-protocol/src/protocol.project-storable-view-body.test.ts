// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20051] `projectStorableViewBody`, driven directly: the `view` write door's
 * storable body, with the re-parse injected, so no save and no schema is
 * involved.
 *
 * The save-path pins, on real `view` bodies, live in
 * `protocol.graft-folded-form-sections.test.ts`, where they ride that file's
 * pinned engine double. This file pins the helper's own arms. It pins the
 * `converged: false` fail-safe above all: no `view` schema reaches that arm
 * today, so nothing else would notice if it regressed into storing the
 * authored body, or into dropping keys.
 *
 * The injected `reparse` stands in for the schema's `safeParse`: it returns
 * `{ ok: true, data }` for an accepted body and `{ ok: false }` for a refused
 * one. Each stub below is a small, explicit model of one behaviour a parse can
 * have: applying a default, folding a key, refusing, or never settling.
 */
import { describe, expect, it } from 'vitest';
import { projectStorableViewBody } from './protocol.js';

type Reparse = Parameters<typeof projectStorableViewBody>[2];

/** Wraps a stub parse function and counts how often the projection calls it. */
function counted(parse: (body: Record<string, unknown>) => ReturnType<Reparse>) {
    const calls: unknown[] = [];
    const reparse: Reparse = (body) => {
        calls.push(body);
        return parse(body as Record<string, unknown>);
    };
    return { reparse, calls };
}

/**
 * A parse that applies `defaults` to every key the body omits and folds
 * `moves` (old key → canonical key) the way `groups` → `sections` folds.
 */
function modelParse(opts: { defaults?: Record<string, unknown>; moves?: Record<string, string> }) {
    return (body: Record<string, unknown>): ReturnType<Reparse> => {
        const out: Record<string, unknown> = { ...body };
        for (const [from, to] of Object.entries(opts.moves ?? {})) {
            if (out[from] !== undefined) {
                if (out[to] === undefined) out[to] = out[from];
                delete out[from];
            }
        }
        for (const [key, value] of Object.entries(opts.defaults ?? {})) {
            if (out[key] === undefined) out[key] = value;
        }
        return { ok: true, data: out };
    };
}

describe('projectStorableViewBody — the converged arms', () => {
    it('(c) a key the parse adds and the re-parse reproduces is a default, and is not stored', () => {
        const parse = modelParse({ defaults: { type: 'grid' } });
        const authored = { name: 'crm_lead.all', sort: [{ field: 'name', order: 'asc' }] };
        const parsed = (parse(authored) as { data: unknown }).data;
        expect(parsed).toHaveProperty('type', 'grid');
        const { reparse, calls } = counted(parse);

        const out = projectStorableViewBody(authored, parsed, reparse);

        expect(out.converged).toBe(true);
        expect(out.body).not.toHaveProperty('type');
        expect(out.body).toEqual(authored);
        // One verify parse, no restoration round: the common case's cost.
        expect(calls).toHaveLength(1);
    });

    it('(d) a key the parse adds and the re-parse does NOT reproduce is a moved key, stored under its canonical spelling', () => {
        const parse = modelParse({ moves: { visibleOn: 'visibleWhen' } });
        const authored = { name: 'contact_us', visibleOn: 'record.a == 1' };
        const parsed = (parse(authored) as { data: unknown }).data;
        const { reparse } = counted(parse);

        const out = projectStorableViewBody(authored, parsed, reparse);

        expect(out.converged).toBe(true);
        expect(out.body).toEqual({ name: 'contact_us', visibleWhen: 'record.a == 1' });
        expect(out.body).not.toHaveProperty('visibleOn');
    });

    it('(d) a moved container is projected against the key it moved from: its nested defaults are not stored', () => {
        // `groups` → `sections`, where each section gains a `collapsed` default
        // the author did not write.
        const sectionDefaults = (s: Record<string, unknown>) => ({ collapsed: false, ...s });
        const reparse: Reparse = (body) => {
            const b = body as Record<string, unknown>;
            const { groups, ...rest } = b;
            const sections = (rest.sections ?? groups) as Array<Record<string, unknown>> | undefined;
            return { ok: true, data: sections ? { ...rest, sections: sections.map(sectionDefaults) } : rest };
        };
        const authored = { name: 'contact_us', groups: [{ label: 'About you', fields: ['name'] }] };
        const parsed = (reparse(authored) as { data: unknown }).data;
        expect(parsed).toEqual({ name: 'contact_us', sections: [{ collapsed: false, label: 'About you', fields: ['name'] }] });

        const out = projectStorableViewBody(authored, parsed, reparse);

        expect(out.converged).toBe(true);
        expect(out.body).toEqual({ name: 'contact_us', sections: [{ label: 'About you', fields: ['name'] }] });
    });

    it('an authored key is stored with its PARSED value; a value whose shape the parse changed is stored as parsed', () => {
        const parsed = { operator: 'not_equals', exportOptions: { formats: ['csv'] }, l: [1] };
        const out = projectStorableViewBody(
            { operator: 'notEquals', exportOptions: ['csv'], l: [1, 2], undeclared: true },
            parsed,
            (body) => ({ ok: true, data: body }),
        );
        expect(out).toEqual({ body: parsed, converged: true });
    });
});

describe('projectStorableViewBody — the converged: false fail-safe', () => {
    // Authored and parsed differ in every way the arm could get wrong: a
    // normalised value, a dropped undeclared key, and an added default.
    const authored = { name: 'crm_lead.all', operator: 'notEquals', undeclared: 1 };
    const parsed = { name: 'crm_lead.all', operator: 'not_equals', type: 'grid' };

    it('(a) a re-parse that refuses the body on the first round: the stored body is the parse output, not the authored body', () => {
        const { reparse, calls } = counted(() => ({ ok: false }));

        const out = projectStorableViewBody(authored, parsed, reparse);

        expect(out.converged).toBe(false);
        expect(out.body).toEqual(parsed);
        expect(out.body).not.toEqual(authored);
        expect(out.body).not.toHaveProperty('undeclared');
        expect(calls).toHaveLength(1);
    });

    it('(b) a re-parse that never reproduces the parse and makes no progress: converged false, bounded, no throw', () => {
        const { reparse, calls } = counted((body) => ({ ok: true, data: { ...body, operator: 'drifted' } }));

        let out: ReturnType<typeof projectStorableViewBody> | undefined;
        expect(() => { out = projectStorableViewBody(authored, parsed, reparse); }).not.toThrow();

        expect(out!.converged).toBe(false);
        expect(out!.body).toEqual(parsed);
        // A round that adds nothing ends the loop at once.
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(calls.length).toBeLessThanOrEqual(8);
    });

    it('(b) a re-parse that reveals one more needed key every round stops at the round bound, not at convergence', () => {
        // Twenty keys the parse adds. Each re-parse withholds the first one the
        // body does not carry yet, so every round finds exactly one "moved"
        // key and adds it. Convergence would take 21 rounds; the bound
        // (`STORABLE_VIEW_MAX_ROUNDS`, 8) must stop it first.
        const keys = Array.from({ length: 20 }, (_, i) => `k${String(i).padStart(2, '0')}`);
        const wide: Record<string, unknown> = { name: 'crm_lead.all' };
        for (const k of keys) wide[k] = k.toUpperCase();
        const { reparse, calls } = counted((body) => {
            const missing = keys.find((k) => body[k] === undefined);
            const data: Record<string, unknown> = { ...wide };
            if (missing) delete data[missing];
            return { ok: true, data };
        });

        const out = projectStorableViewBody({ name: 'crm_lead.all' }, wide, reparse);

        expect(out.converged).toBe(false);
        expect(out.body).toEqual(wide);
        expect(calls.length).toBeLessThanOrEqual(8);
        expect(calls.length).toBeGreaterThan(1);
    });
});
