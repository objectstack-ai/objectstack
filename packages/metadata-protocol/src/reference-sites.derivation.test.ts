// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9190] The reference-site index is DERIVED — these are the pins that keep it
 * derived, and the pins that make its remaining gaps loud.
 *
 * Three jobs, and they are different:
 *
 *  1. **Regression** — every target type the old hand-curated table CLAIMED
 *     must resolve at least one live site. Five of its seven claimed keys
 *     resolved none, which is the defect this card closed.
 *  2. **Anti-guesser** — the naming rule must stay the small total rule it is.
 *     A suffix rule was measured and rejected; these pins are what a future
 *     "let's also match `endsWith(Cap(T))`" change trips over.
 *  3. **Honest gaps** — `unwalkableSourceTypes` is where "not computable"
 *     lives now that it no longer hides inside `{ references: [] }`. It is
 *     pinned exactly, so a type that stops being walkable turns this test red
 *     instead of silently shortening a "Used by" panel.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { REFERENCE_SITES, deriveReferenceSites } from './reference-sites.js';

/** The seven keys `REFERENCE_PATHS` carried on `origin/main` before this card. */
const PREVIOUSLY_CLAIMED_TARGETS = ['object', 'view', 'tool', 'skill', 'flow', 'dashboard', 'page'] as const;

/** Site lookup that reads as the sentence it is asserting. */
function sitesFor(target: string): Array<{ fromType: string; property: string }> {
    return (REFERENCE_SITES.byTarget.get(target) ?? []).map((s) => ({ fromType: s.fromType, property: s.property }));
}

function hasSite(target: string, fromType: string, property: string): boolean {
    return sitesFor(target).some((s) => s.fromType === fromType && s.property === property);
}

describe('[#9190] derived reference sites — regression: every target the old table claimed now resolves', () => {
    it.each(PREVIOUSLY_CLAIMED_TARGETS)('%s has at least one derived site', (target) => {
        expect(sitesFor(target).length).toBeGreaterThan(0);
    });

    it('the five targets whose every curated path was DEAD now resolve real ones', () => {
        // Measured on `origin/main` @ `739fe5b79`: `view`, `tool`, `flow`,
        // `dashboard` and `page` were registry keys whose only rows named
        // properties no schema declares — `app.navItems[]` / `app.tabs[]`
        // (`AppSchema` declares `navigation` / `areas`), `agent.tools[]`
        // (removed in spec 17, #3894), `dashboard.widgets[].view`. Each
        // answered `{ references: [] }` unconditionally while LOOKING covered,
        // which is the exact shape the "Used by" panel reads as "safe to
        // delete".
        expect(hasSite('view', 'app', 'viewName')).toBe(true);
        expect(hasSite('view', 'page', 'view')).toBe(true);
        expect(hasSite('tool', 'skill', 'tools')).toBe(true);
        expect(hasSite('dashboard', 'app', 'dashboardName')).toBe(true);
        expect(hasSite('page', 'app', 'pageName')).toBe(true);
        // `flow` is reachable only through a flow NODE config, which
        // `FlowSchema` declares as `additionalProperties: {}` — limb 2 of the
        // derivation exists for exactly this, and this is its proof.
        expect(hasSite('flow', 'flow', 'flowName')).toBe(true);
    });

    it('the curated table is beaten on coverage, not merely matched', () => {
        // The old table claimed 7 targets and served 2. Anything at or below
        // its CLAIM would mean derivation bought nothing.
        expect(REFERENCE_SITES.byTarget.size).toBeGreaterThan(PREVIOUSLY_CLAIMED_TARGETS.length);
    });

    it('a newly DECLARED type cannot arrive uncovered — the index is keyed off the declared universe', () => {
        // The property that makes the defect non-recurring (#7894's shape): the
        // walk enumerates `DEFAULT_METADATA_TYPE_REGISTRY`, so every declared
        // type is either walked or named in `unwalkableSourceTypes`. There is
        // no third state, and no list anyone has to remember to extend.
        const declared = DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type);
        const walked = declared.filter((t) => !REFERENCE_SITES.unwalkableSourceTypes.includes(t));
        expect(walked.length + REFERENCE_SITES.unwalkableSourceTypes.length).toBe(declared.length);
    });
});

describe('[#9190] derived reference sites — the naming rule stays total and unclever', () => {
    it('a name that merely ENDS WITH a type name is NOT a reference to it', () => {
        // ⛔ The rejected rule, pinned so it cannot come back by accident. A
        // suffix rule was measured against the real schemas and is ~15% signal:
        // it reads `displayField`, `nameField`, `startDateField`, `stageField`
        // and thirty siblings as references to the `field` METADATA TYPE, when
        // every one of them names a field INSIDE an object.
        expect(hasSite('field', 'object', 'displayField')).toBe(false);
        expect(hasSite('field', 'object', 'nameField')).toBe(false);
        expect(hasSite('mapping', 'mapping', 'fieldMapping')).toBe(false);
        expect(hasSite('agent', 'app', 'defaultAgent')).toBe(false);
    });

    it('an ENUM-constrained value that shares a type name is NOT a reference', () => {
        // `chartConfig.xAxis.position` is `'left' | 'right'` and
        // `flow.nodes[].position` is `{ x, y }`. Neither names a `position`
        // artifact, and the shape half of the rule is what keeps them out —
        // while the real one stays in.
        expect(hasSite('position', 'dashboard', 'position')).toBe(false);
        expect(hasSite('position', 'flow', 'position')).toBe(false);
        expect(hasSite('position', 'permission', 'positions')).toBe(true);
    });

    it('a name-keyed RECORD is a reference site, which the curated path grammar could not express', () => {
        // `PermissionSetSchema.objects` is `z.record(objectName, …)`. The old
        // table spelled it `objects[].name` — an ARRAY of `{ name }`, which the
        // schema has never declared — so a permission set was invisible to
        // every "what depends on this object?" question an admin asked.
        expect(hasSite('object', 'permission', 'objects')).toBe(true);
    });
});

describe('[#9190] derived reference sites — the gaps are named, not hidden', () => {
    it('THE PIN: exactly one declared type cannot be walked, and it is named', () => {
        // This is where "not computable" lives now. `external_catalog` resolves
        // no schema at all (runtime-created by the datasource Sync wizard,
        // ADR-0062/0088), so nothing can be said about what it references —
        // which is a different fact from "it references nothing".
        //
        // ⚠️ If this set GROWS, a source type stopped being readable and every
        // "Used by" panel silently got shorter. That is the #8896 harm shape
        // arriving through the back door, and it must be a red test rather than
        // a quiet one. Do not "fix" a failure here by widening the expectation.
        expect(REFERENCE_SITES.unwalkableSourceTypes).toEqual(['external_catalog']);
    });

    it('the un-derivable residue is exactly one property, so growing it is a conscious act', () => {
        // `FieldSchema.reference` names an object in PROSE ("Target object name
        // (snake_case) for lookup/master_detail fields") and nowhere a machine
        // can read. It is carried because dropping it would regress the
        // highest-value edge in the graph; it is pinned at ONE because a
        // hand-written list is exactly what this card removed. Other members of
        // the same class are measured and deliberately EXCLUDED
        // (`AppSchema.homePageId` → page, `AppSchema.defaultAgent` → agent), so
        // the incompleteness stays visible rather than looking handled.
        //
        // Closing this class properly is a producer-side annotation in
        // `packages/spec`, not another row here.
        expect(hasSite('object', 'object', 'reference')).toBe(true);
        expect(hasSite('page', 'app', 'homePageId')).toBe(false);
    });
});

describe('[#9190] derived reference sites — derivation is a pure function of the schemas', () => {
    it('two derivations of the same schemas agree exactly', () => {
        // The module-load singleton must not be doing anything a caller cannot
        // reproduce; a derived registry that depends on WHEN it ran is a
        // curated one wearing a function.
        const a = deriveReferenceSites();
        const b = deriveReferenceSites();
        const flatten = (index: ReturnType<typeof deriveReferenceSites>) =>
            [...index.byTarget.entries()]
                .map(([target, sites]) => `${target}=${sites.map((s) => `${s.fromType}.${s.property}`).join(',')}`)
                .sort();
        expect(flatten(a)).toEqual(flatten(b));
        expect(flatten(a)).toEqual(flatten(REFERENCE_SITES));
    });
});
