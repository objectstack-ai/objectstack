// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5056 — the controls the door measurement itself owes.
 *
 * `door-reachability.testkit.ts` decides whether a #4001 batch tightens a shape
 * or reclassifies it as `no door`. Its consumers (`chart.test.ts`,
 * `widget.test.ts`, `i18n.test.ts`) each carry the three controls for THEIR
 * shapes; nothing carried the controls for the instrument. This file does, so
 * that the walker's own limbs — the `.describe()` premise the bridge rests on,
 * the derived-clone bridge, and the overlap threshold that bounds it — cannot
 * rot behind green consumer tests.
 *
 * Every number asserted here was measured on this build, not reasoned about.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { measureDoors } from './door-reachability.testkit';
import { PageSchema } from './page.zod';
import { ObjectListViewSchema } from './view.zod';
import { WidgetManifestSchema } from './widget.zod';
import { I18nLabelSchema } from './i18n.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/** The walker's identity key, mirrored here so the premise tests can assert on it. */
const defOf = (s: unknown): unknown => (s as { _zod?: { def?: unknown } })?._zod?.def;

// ============================================================================
// 1. The PREMISE the derived-clone bridge rests on.
//
// The bridge exists because zod builders return a clone that shares the base's
// per-property schema INSTANCES. Which builders share the `_zod.def` OBJECT
// itself, and which do not, is what decides whether the bridge sees a real
// derivation or a coincidence. A zod upgrade that changes `clone()` semantics
// changes the bridge's meaning, and that must be LOUD rather than silent.
// ============================================================================
describe('#5056 premise — which zod builders share the `_zod.def` object', () => {
  it('`.describe()` shares the def of the instance it was called on', () => {
    // THE mechanism behind #5056. `clone(inst)` without an explicit def reuses
    // `inst._zod.def`, so a described clone is def-IDENTICAL to its receiver.
    const base = z.string();
    expect(defOf(base.describe('x')), '.describe() clone vs its receiver').toBe(defOf(base));
    expect(defOf(base.describe('x')), 'two different descriptions of ONE instance').toBe(defOf(base.describe('y')));
  });

  it('but two independently constructed schemas do NOT share a def', () => {
    // #5056's issue body spells the fact as
    //   `defOf(z.string().describe('x')) === defOf(z.string())` → true
    // and that spelling is FALSE on this build: two separate `z.string()` calls
    // build two separate defs, so there is nothing to share. Measured, not
    // assumed — the corrected statement is the one above: sharing follows the
    // RECEIVER INSTANCE, not the shape. That distinction is the whole reason
    // the bug bites this repo: the spec funnels dozens of shapes through a
    // handful of SHARED leaf instances, and every `.describe()` of one of them
    // is def-identical to every other.
    expect(defOf(z.string().describe('x'))).not.toBe(defOf(z.string()));
    expect(defOf(z.string())).not.toBe(defOf(z.string()));
  });

  it('the repo\'s shared leaves are therefore def-identical across every site that describes them', () => {
    // `SnakeCaseIdentifierSchema` and `I18nLabelSchema` are the two the campaign
    // actually tripped over: `name:` and `label:` are on nearly every authorable
    // shape in this repo, described in place at each site.
    expect(defOf(SnakeCaseIdentifierSchema.describe('a'))).toBe(defOf(SnakeCaseIdentifierSchema.describe('b')));
    expect(defOf(I18nLabelSchema.describe('a'))).toBe(defOf(I18nLabelSchema.describe('b')));
  });

  it('`.optional()` / `.extend()` / `.strip()` each build a NEW def', () => {
    // The other half of the premise: these are the builders whose clones the
    // bridge must still recognise, and they can only be recognised through
    // shared PROPERTY instances, because the def itself is new.
    const base = z.string();
    expect(defOf(base.optional())).not.toBe(defOf(base));
    const obj = z.object({ a: z.string() });
    expect(defOf(obj.extend({ b: z.number() }))).not.toBe(defOf(obj));
    expect(defOf(obj.strip())).not.toBe(defOf(obj));
  });
});

// ============================================================================
// 2. The three controls, on the instrument itself.
// ============================================================================
describe('#5056 controls — the walker finds doors, and only real ones', () => {
  it('positive: live authoring roots resolve, and the graph is really walked', () => {
    const { verdict, nodeCount, rootCount } = measureDoors();
    expect(rootCount, 'every metadata type plus ObjectStackSchema').toBeGreaterThan(20);
    expect(nodeCount, 'the graph must actually have been walked').toBeGreaterThan(1000);
    expect(verdict(PageSchema), 'positive control').toBe('direct');
    expect(verdict(ObjectListViewSchema), 'positive control').toBe('direct');
  });

  it('positive: a GENUINE derived clone is recognised — this is the bridge limb', () => {
    // The limb #5056 narrowed. Nothing else in the repo exercises it: every
    // shape the consumers assert as reachable measures `direct`, so a bridge
    // that had been narrowed all the way to "never fires" would leave all
    // three consumer files green. `.extend()` and `.strip()` are exactly the
    // builders the bridge was written for.
    const { verdict, cloneOverlap } = measureDoors();

    const extended = PageSchema.extend({ osDoorProbeExtra: z.string() });
    expect(verdict(extended), 'PageSchema.extend(...) is a real derivation').toBe('derived-clone');
    expect(cloneOverlap(extended), 'one added key out of 25 kept').toBeGreaterThan(0.9);

    const stripped = ObjectListViewSchema.strip();
    expect(verdict(stripped), 'ObjectListViewSchema.strip() is a real derivation').toBe('derived-clone');
    expect(cloneOverlap(stripped), 'strip() keeps the whole shape').toBe(1);
  });

  it('negative: a look-alike that shares no property instance stays out', () => {
    // #5056's own negative control, verbatim: deliberately spelled to look like
    // every authorable shape in the repo, but built from fresh `z.string()`
    // instances, so it shares nothing with the graph.
    const { verdict, cloneOverlap } = measureDoors();
    const lookAlike = z.object({ name: z.string(), label: z.string() });
    expect(verdict(lookAlike), 'negative control').toBe('unreachable');
    expect(cloneOverlap(lookAlike)).toBe(0);
  });

  it('flip: injecting a synthetic carrier turns an unreachable shape reachable', () => {
    // Without this, "unreachable" and "the walker is broken" are the same
    // output. `extraRoots` exists for exactly this control.
    const orphan = z.object({ osDoorProbeOrphanKey: z.string() });
    expect(measureDoors().verdict(orphan), 'before').toBe('unreachable');
    const carrier = z.object({ orphan });
    expect(measureDoors([carrier]).verdict(orphan), 'after — a carrier makes the door').toBe('direct');
  });
});

// ============================================================================
// 3. The #5056 regression boundary itself.
// ============================================================================
describe('#5056 regression — the any-one-shared-property bridge stays dead', () => {
  it('WidgetManifestSchema shares leaves with the live graph but is NOT derived from it', () => {
    // The reverse verification, standing rather than one-shot.
    //
    // The OLD bridge fired when ANY one property of the candidate was def-equal
    // to a same-named property of ANY visited object node. `cloneOverlap` is
    // the max shared-property count over visited shapes, normalised — so
    // `cloneOverlap(x) > 0` is EXACTLY the condition under which the old bridge
    // fired. Asserting both halves here pins the fix without keeping a second,
    // defective copy of the walker alive to demonstrate it:
    //
    //   > 0    ⇒ the old bridge WOULD have called this file reachable, and did
    //   < 0.5  ⇒ the fixed bridge correctly does not.
    //
    // 2 shared keys (`name`, `label`, both described shared LEAVES) out of 19.
    // A coincidence, not a derivation — and a false door here would have spent
    // a v17 breaking to tighten a file nothing imports (#4583's "precisely
    // validated dead slot").
    const { verdict, cloneOverlap } = measureDoors();
    const overlap = cloneOverlap(WidgetManifestSchema);
    expect(overlap, 'it DOES share leaves — the old bridge fired on exactly this').toBeGreaterThan(0);
    expect(overlap, 'but nothing structural: measured 2/19').toBeLessThan(0.2);
    expect(verdict(WidgetManifestSchema)).toBe('unreachable');
  });

  it('the threshold discriminates by SHARE OF SHAPE, not by count of shared keys', () => {
    // Why 0.5 and not "at least 2 shared keys": the same two shared leaves
    // decide opposite verdicts depending on how much of the shape they are.
    const { cloneOverlap } = measureDoors();
    const shared = {
      name: SnakeCaseIdentifierSchema.describe('Machine name'),
      label: I18nLabelSchema.describe('Display label'),
    };
    const withFiller = z.object({ ...shared, a: z.string(), b: z.string(), c: z.string() });
    expect(cloneOverlap(withFiller), '2 shared of 5 keys').toBeCloseTo(0.4, 5);
  });

  it('KNOWN BOUND — a shape made ENTIRELY of shared leaves still bridges, whatever the threshold', () => {
    // Measured limitation, pinned deliberately rather than left latent for a
    // later batch to rediscover as a second false door.
    //
    // The ratio is taken over the CANDIDATE's own keys, so a 2-key shape whose
    // both keys are shared leaves scores 1.0 and is judged `derived-clone` —
    // no threshold in (0, 1] excludes it, because a genuine `.strip()` of a
    // live 2-key schema scores 1.0 too and must stay reachable. The instrument
    // cannot separate those two by overlap alone.
    //
    // It costs nothing today: this is a synthetic shape, and the smallest real
    // `no door` shapes the campaign has measured sit far below the threshold
    // (WidgetManifestSchema at 2/19). It becomes a real hazard the moment a
    // batch measures a SMALL shape (roughly 4 keys or fewer) whose keys are all
    // shared leaves — measure `cloneOverlap` and read this pin before trusting
    // a `derived-clone` verdict on one. Filed for the campaign as #5828.
    const { verdict, cloneOverlap } = measureDoors();
    const allSharedLeaves = z.object({
      name: SnakeCaseIdentifierSchema.describe('Machine name'),
      label: I18nLabelSchema.describe('Display label'),
    });
    expect(cloneOverlap(allSharedLeaves), '2 shared of 2 keys').toBe(1);
    expect(verdict(allSharedLeaves), 'the residual false-reachable case — see #5828').toBe('derived-clone');
  });
});
