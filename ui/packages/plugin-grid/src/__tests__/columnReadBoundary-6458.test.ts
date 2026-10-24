/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6458 — what `ObjectGrid.generateColumns()` is allowed to READ off
 * the AUTHORED column. The answer is now: **only what `ListColumn` declares.**
 *
 * ## The seam, and why it is NOT the one objectui#6004 fenced
 *
 * objectui#6004 (landed as objectui#6461) typed what this producer WRITES:
 * `ObjectGridColumnDraft` / `ObjectGridColumn`, with a tombstone band DERIVED
 * from `keyof ListColumn` so a future spec member is refused by default. That
 * fence is on the emit, and `columnEmitBoundary-6004.test.ts` pins it.
 *
 * This file pins the OTHER half: the same function's READ of its authored
 * input. That side was untyped — `col` is a `ListColumn`, and every read
 * `ListColumn` did not declare went through `(col as any)`, which admits any
 * key whatsoever. `ListColumnSchema` is a `strictObject`, so an author who
 * wrote one of those keys was REFUSED at publish with `unrecognized_keys`
 * while this renderer honoured it — the `declared != enforced` split
 * AGENTS.md #0.1 exists to stop.
 *
 * ## The bound is now the EMPTY SET, and that is the load-bearing part
 *
 * Both halves of the defect are closed, for two different reasons:
 *
 *   - A key `ListColumn` DECLARES, read through a cast (`prefix` was), buys
 *     nothing and hides the undeclared ones among lookalikes. It also throws
 *     away the declared type at every use. Fixed by objectui#6587.
 *   - A key `ListColumn` does NOT declare, read at all (`format`, `options`,
 *     `appearance`, `essential` were), is the declared != enforced split
 *     itself. RETIRED by the maintainer's 2026-08-28 ruling — "B on all four"
 *     — under the standing zero-authors rule: zero measured authors means
 *     immediate retirement, no deprecation window. Re-measured on the ref that
 *     carried the deletion: zero authored occurrences of any of the four on a
 *     column, across `examples/` and `apps/`, with `field` as the positive
 *     control in the same query shape.
 *
 * So `generateColumns()`'s `ListColumn` branch now contains NO cast read of
 * any key, and this file pins exactly that. ⛔ The deletion alone would be
 * undone by the next person who adds a cast; this bound is what makes the
 * retirement stick.
 *
 * ⚠️ Retired for want of authors, NOT forbidden forever. If a real request for
 * semantic mobile-column control arrives, the declare route reopens —
 * objectstack#12715 is the precedent (removed while unenforced, re-introduced
 * once demand and enforcement met). The right move then is to declare the key
 * on `@objectstack/spec` and read it WITHOUT a cast, which this file allows by
 * construction. What stays forbidden is the third road: a renderer-side
 * tolerance for a key the schema refuses.
 *
 * ## Why a source scan rather than a rendering test
 *
 * Same reason `columnEmitBoundary-6004.test.ts` is compile-time: a grid that
 * renders correctly renders exactly as correctly with a cast added back. The
 * defect is that a read is unchecked, and nothing observable at runtime
 * distinguishes `(col as any).prefix` from `col.prefix`. What CAN be measured
 * is the source, so the source is what this reads.
 *
 * ## Anti-vacuity, which matters more here than it did before
 *
 * The guarded region's expected answer is now ZERO cast reads, so a scanner
 * that silently matches nothing would be indistinguishable from success. Three
 * separate controls stop that, and each must be able to fail on its own:
 *   1. both region anchors asserted present, BY COUNT, before any slice;
 *   2. the regex proved able to find cast reads on a synthetic input whose
 *      answer is known;
 *   3. the regex proved able to find a cast read in THIS REAL FILE, at real
 *      scale — necessarily from OUTSIDE the guarded region, since inside it
 *      the whole point is that there is nothing left to find. Its anchor is a
 *      cast on a DIFFERENT receiver than the bound assertions scan for, which
 *      is why the scanner takes the receiver as a parameter — objectui#6424
 *      dismantled the `col` cast this control used to observe, and the file has
 *      no other `col` cast outside the region to move to.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The schema comes from the spec, which is where the AUTHORING surface is
// defined; the type comes from `@object-ui/types`, which is what `ObjectGrid`
// itself imports. `packages/types` re-exports the spec schema BY REFERENCE
// (pinned by `types/src/__tests__/spec-subschema-parity.test.ts`), so the two
// sides of this test cannot drift apart.
import { ListColumnSchema } from '@objectstack/spec/ui';
import type { ListColumn } from '@object-ui/types';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-grid/src/__tests__ -> repo root
const repoRoot = path.resolve(here, '../../../..');
const GRID_SOURCE = path.join(repoRoot, 'packages/plugin-grid/src/ObjectGrid.tsx');

const gridSource = readFileSync(GRID_SOURCE, 'utf8');

/**
 * The bounds of the `ListColumn` branch of `generateColumns()`. The scan is
 * scoped to it on purpose: `col` names a DIFFERENT thing further down the file
 * (a generated column, in the grouped-width pass), and what is read off it
 * there is a separate question owned by objectui#6424 — pulling it in here
 * would make this guard fail for a reason it has no verdict on. That read went
 * through `(col as any).fitContent` until objectui#6424's 2026-08-29 ruling
 * dismantled the cast; the READ is unchanged and still outside this guard's
 * remit, and the emitted column it reads is still not the authored input.
 */
const REGION_START = '(cols as ListColumn[])';
const REGION_END = '// String array format - enrich with objectDef field metadata';

/**
 * Any cast spelling, not just `as any` — `(col as unknown as X).k` and
 * `(col as ListColumn & { k })` would dodge a narrower pattern while doing the
 * same thing.
 *
 * The RECEIVER is a parameter (objectui#6424). It was hard-coded to `col` while
 * anti-vacuity control 3's anchor happened to be a `col` cast; the 2026-08-29
 * ruling dismantled that cast and left the file with ZERO `col` casts outside
 * the guarded region, so the control had to re-point at a cast on a different
 * receiver — which a hard-coded pattern cannot express. ⚠️ The parameter is the
 * WHOLE of that change and it defaults to `col`: every BOUND assertion below
 * still scans for `col`, over the same region, and still means exactly what it
 * meant. Control 2 pins that the parameter is honoured rather than ignored, so
 * this cannot quietly become a pattern that matches any receiver at all.
 */
const castReadRe = (receiver: string) =>
  new RegExp(String.raw`\(\s*${receiver}\s+as\s+[^)]*\)\s*\.\s*([A-Za-z_$][\w$]*)`, 'g');

function castReadKeys(source: string, receiver = 'col'): string[] {
  return [...source.matchAll(castReadRe(receiver))].map((m) => m[1]);
}

function guardedRegion(): string {
  return gridSource.slice(gridSource.indexOf(REGION_START), gridSource.indexOf(REGION_END));
}

/** The keys `ListColumnSchema` admits — read from the schema, never hand-listed. */
const DECLARED_KEYS = Object.keys(
  (ListColumnSchema as unknown as { shape: Record<string, unknown> }).shape
);

/**
 * The four undeclared reads objectui#6458 escalated and the maintainer RETIRED
 * on 2026-08-28. Listed here only so a re-added read can be named in the
 * failure message; the bound itself is the empty set and does not depend on
 * this list, so a FIFTH key arriving is refused just as loudly as one of these
 * four returning.
 */
const RETIRED_UNDECLARED_READS = ['format', 'options', 'appearance', 'essential'];

/**
 * Anti-vacuity control 3's anchor in the REAL file — re-pointed by objectui#6424
 * (maintainer ruling 2026-08-29), which dismantled the `(col as any).fitContent`
 * read in the grouped-width pass that used to serve as it. Per this control's
 * own standing instruction the control was RE-POINTED, never deleted.
 *
 * Why this cast and not one of the twelve others outside the region: it is the
 * only kind here that cannot expire SILENTLY. `hideRowHeightToggle` is a
 * deliberately held non-authoring key (objectui#5091) — a host-written switch
 * that `ComponentPropsMap['object-grid']`'s `strictObject` refuses by name, so
 * `(schema as any)` is the only way to read it and the cast is load-bearing
 * rather than incidental — and it is INDEPENDENTLY PINNED by
 * `gridNonAuthorKeys.test.tsx`, in that file's key table and in a behavioural
 * test. If it is ever retired, that guard goes red in the same run and names it,
 * instead of leaving this control to fail alone against a stale anchor.
 *
 * ⭐ That is precisely the failure the previous anchor had, and the reason this
 * one is chosen on a different principle rather than merely moved: `fitContent`
 * was nothing else's premise, so dismantling it broke this control with no other
 * signal — the silent-expiry shape this card family keeps recording.
 */
const CONTROL_RECEIVER = 'schema';
const CONTROL_KEY = 'hideRowHeightToggle';

describe('objectui#6458 — the read boundary of ObjectGrid.generateColumns()', () => {
  it('the scan region is anchored — both bounds present exactly once', () => {
    // Anti-vacuity control 1. Every "no such key" claim below is worthless if
    // the region resolved to an empty string, so the anchors are asserted first
    // and BY COUNT: a moved or duplicated anchor fails HERE, loudly, rather
    // than turning the assertions that follow into green no-ops.
    expect(gridSource.split(REGION_START).length - 1).toBe(1);
    expect(gridSource.split(REGION_END).length - 1).toBe(1);
    expect(guardedRegion().length).toBeGreaterThan(1000);
  });

  it('the scanner extracts a cast read (control on a synthetic input)', () => {
    // Anti-vacuity control 2. The regex proved able to find what it is looking
    // for, on an input whose answer is known — so a zero from the real source
    // is a measurement and not a broken pattern.
    expect(castReadKeys('const x = (col as any).someKey;')).toEqual(['someKey']);
    expect(castReadKeys('const y = (col as unknown as Foo).other;')).toEqual(['other']);
    expect(castReadKeys('const z = col.declaredKey;')).toEqual([]);
    // …and the RECEIVER parameter is HONOURED rather than ignored. Without this
    // pair, `castReadRe` could degrade into a pattern that matches any receiver
    // whatsoever: control 3 below would still pass, and the two bound
    // assertions' scoping to `col` would silently become a fiction that admits
    // every cast in the region. Both directions asserted, so neither a stuck
    // receiver nor an ignored one survives.
    expect(castReadKeys('const w = (schema as any).someKey;')).toEqual([]);
    expect(castReadKeys('const w = (schema as any).someKey;', 'schema')).toEqual(['someKey']);
  });

  it('the scanner finds a cast read in the REAL file, outside the guarded region', () => {
    // Anti-vacuity control 3, and the one that has now had to move twice. It
    // first drew its control from INSIDE the region — which worked only while
    // the region still contained cast reads to find. Now that the region's
    // correct answer is zero, a control drawn from inside it would be the very
    // thing it is meant to rule out. It then drew on `(col as any).fitContent`
    // in the grouped-width pass, until objectui#6424's 2026-08-29 ruling
    // dismantled that cast; measured on that ref, the file then had ZERO `col`
    // casts anywhere outside the region, so the anchor moved to a different
    // RECEIVER (see CONTROL_RECEIVER above) rather than being deleted.
    // ⛔ If this anchor is ever retired too, re-point it at another real cast —
    // never delete this control, and never re-point it back inside the region.
    const outside = gridSource.slice(gridSource.indexOf(REGION_END));
    expect(
      castReadKeys(outside, CONTROL_RECEIVER),
      `Anti-vacuity control 3 has lost its anchor: no \`(${CONTROL_RECEIVER} as ...).` +
        `${CONTROL_KEY}\` cast read remains outside the guarded region, so this scanner ` +
        'is no longer proved able to find anything at real scale — and every "no such ' +
        'key" claim in this file becomes a green no-op. ⛔ Re-point this control at ' +
        'another real cast in this file; never delete it, and never re-point it back ' +
        'inside the region (objectui#6458).'
    ).toContain(CONTROL_KEY);
  });

  it('⭐ no key `ListColumn` DECLARES is read through a cast', () => {
    // Half one, closed by objectui#6587. `prefix` failed this before that fix:
    // declared by `ListColumnSchema`, read as `(col as any).prefix`. Casting a
    // declared key buys nothing, hides the undeclared ones among lookalikes,
    // and discards the declared type at every use.
    const castDeclared = castReadKeys(guardedRegion()).filter((k) => DECLARED_KEYS.includes(k));
    expect(
      castDeclared,
      'A declared ListColumn key read through a cast buys nothing and hides the ' +
        'undeclared ones among lookalikes — read it directly (objectui#6458).'
    ).toEqual([]);
  });

  it('⭐ no UNDECLARED key is read at all — the bound is the EMPTY SET', () => {
    // Half two, closed by the maintainer's 2026-08-28 ruling. This is the
    // assertion the retirement rests on: the deletion alone is undone by the
    // next person who adds a cast, and this is what makes it stick.
    const undeclared = [...new Set(castReadKeys(guardedRegion()))].filter(
      (k) => !DECLARED_KEYS.includes(k)
    );
    expect(
      undeclared,
      'This key is read off the authored column and `ListColumnSchema` REFUSES ' +
        'it, so an author who writes it gets `unrecognized_keys` at publish while ' +
        'this renderer honours it — the `declared != enforced` split AGENTS.md ' +
        '#0.1 exists to stop. objectui#6458 retired all four that used to be ' +
        'here (maintainer, 2026-08-28). ⛔ Do not widen this bound to make the ' +
        'build green, and do not add a renderer-side tolerance. If the ' +
        'capability is genuinely wanted, DECLARE the key on `@objectstack/spec` ' +
        'and read it without a cast — that route is open and this guard allows it.'
    ).toEqual([]);
  });

  it('each retired key is named individually, so a re-added read says which one', () => {
    // The bound above is already the empty set, so this adds no strictness. It
    // adds DIAGNOSIS: a uniform "expected [x] to equal []" tells you a read came
    // back, and this tells you which verdict it re-opens.
    const region = guardedRegion();
    for (const key of RETIRED_UNDECLARED_READS) {
      expect(
        castReadKeys(region),
        `\`${key}\` was RETIRED by objectui#6458's maintainer ruling (2026-08-28, ` +
          '"B on all four") under the standing zero-authors rule. Re-adding the ' +
          'read re-opens a verdict, which is a maintainer decision, not a ' +
          'refactor. If a real author has appeared, that is news for the card — ' +
          'the declare route reopens (objectstack#12715 precedent).'
      ).not.toContain(key);
    }
  });

  it('the split is closed — the schema still refuses `essential`, and nothing reads it', () => {
    // The card's core measurement, executable. `essential` was the clearest of
    // the four: not a `ListColumn` member, no second road (its fallback is
    // positional, `colIndex === 0`), and authored nowhere in the repo.
    const refused = ListColumnSchema.safeParse({ field: 'name', essential: true });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      const issue = refused.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue).toBeDefined();
      expect((issue as unknown as { keys: string[] }).keys).toContain('essential');
    }

    // DECLARED CONTROL, same query shape: a key this producer genuinely reads
    // is admitted, so the refusal above is about `essential` and not about the
    // fixture being malformed.
    const admitted = ListColumnSchema.safeParse({
      field: 'name',
      prefix: { field: 'stage', type: 'badge' },
    });
    expect(admitted.success).toBe(true);

    // And the renderer side of the split is gone: mobile visibility is decided
    // positionally now, with no key behind it. Asserted as a BOOLEAN rather
    // than `expect(region).toContain(...)`: the region is ~200 lines, and a
    // string-containment failure prints all of it, burying the one line that
    // matters under a diff nobody reads.
    const POSITIONAL_ONLY = 'const isEssential = colIndex === 0;';
    expect(
      guardedRegion().includes(POSITIONAL_ONLY),
      'Mobile visibility must be decided positionally, with no key behind it: ' +
        'expected the region to contain exactly `' + POSITIONAL_ONLY + '`. ' +
        'objectui#6458 retired the `essential` read (maintainer, 2026-08-28).'
    ).toBe(true);
  });

  it('the surviving reads are typed — `ListColumn["prefix"]` is not `any`', () => {
    /** True only for `any`: the one type both branches of a conditional accept. */
    type IsAny<T> = 0 extends 1 & T ? true : false;
    type Expect<T extends true> = T;
    type _PrefixIsTyped = Expect<IsAny<ListColumn['prefix']> extends true ? false : true>;

    // What the cast was throwing away, spelled out: `field` is a `string` the
    // compiler now checks at every use in the prefix cell renderer.
    const col: ListColumn = { field: 'name', prefix: { field: 'stage', type: 'badge' } };
    expect(col.prefix?.field).toBe('stage');
  });
});
