// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7893 — `field`'s runtime-create door is RETIRED, pinned at the DECLARATION.
 *
 * ## What was wrong, in one sentence
 *
 * The registry declared `field` with `allowRuntimeCreate: true`, so
 * `PUT /api/v1/meta/field/<object>.<name>` was a SANCTIONED write — and it was
 * accepted, persisted and reported valid while reaching no object's `fields`,
 * ever. `declared != enforced`, Prime Directive #10, and ADR-0049 calls it
 * false compliance.
 *
 * ## The seam, because the card's own "Root Cause" section names the wrong one
 *
 * `field` is the ONE declared type with no standalone existence. Fields are
 * authored inside the object (`ObjectSchema.fields`), so a `field` write mints
 * a SEPARATE `sys_metadata` row keyed `('field','<object>.<name>')` and nothing
 * composes fragment rows into their parent.
 *
 * ⚠️ It is NOT `supportsOverlay: false`, and the last case in this file is the
 * control that says so: `object` carries the IDENTICAL flag pair and a
 * runtime-created object is fully readable. `supportsOverlay` gates no read
 * path at all — only `assertDeleteAllowed` consults it — so "fixing" it would
 * change nothing on the read while silently widening the delete authorization
 * gate.
 *
 * ## The two doors this file keeps apart
 *
 * These cases pin the CREATE tier only. Whether a field a code package ships
 * may be OVERLAID is #7743's question, answered `403 NOT_OVERRIDABLE` by
 * `isNestedArtifactField` in `metadata-protocol`, and untouched here — the
 * maintainer ruling of 2026-08-12 is explicit that making field OVERRIDES legal
 * is a separate decision from making field CREATES work.
 *
 * The route-level behaviour (both refusals, on both kernel topologies, plus the
 * plural-URL fold from #7894) is pinned where it is exercised:
 * `packages/runtime/src/meta-field-overlay-lock.test.ts`. This file pins the
 * declaration those gates read, because a silent re-flip of the flag is the one
 * way the retirement could be undone without any test noticing.
 */

import { describe, it, expect } from 'vitest';

import { DEFAULT_METADATA_TYPE_REGISTRY, MetadataTypeSchema } from './metadata-plugin.zod';
import { getMetadataTypeSchema } from './metadata-type-schemas';

const entryFor = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);
const fieldEntry = () => entryFor('field');

describe('`field` is still a declared metadata kind — only its create door closed', () => {
  it('is a member of MetadataTypeSchema and has a registry entry', () => {
    // The retirement withdraws a WRITE channel, not the type. Reads, the
    // `/meta/types` descriptor and #7743's overlay refusal all need it declared.
    expect(MetadataTypeSchema.safeParse('field').success).toBe(true);
    expect(fieldEntry(), '`field` missing from DEFAULT_METADATA_TYPE_REGISTRY').toBeDefined();
    expect(fieldEntry()!.domain).toBe('data');
  });

  it('still resolves a schema — schema RESOLUTION is not the write door', () => {
    // Same separation `api` (#5488) and `capability` (#5961) keep: a code-only
    // type still needs its shape resolvable for validation, diagnostics and
    // generated docs. Losing this would make `_diagnostics` silently opinionless
    // on every existing `field` row.
    expect(getMetadataTypeSchema('field')).toBeDefined();
  });
});

describe('`field` registry flags — the authorization verdict, written down', () => {
  // ── RETIREMENT PINS (#7893) ───────────────────────────────────────────────
  //
  // These REPLACE the tripwire in `packages/runtime`'s route test that asserted
  // the opposite ("THE FEATURE — `allowRuntimeCreate: true` is real and must
  // survive", #7743). That pin was doing its job: it existed so a later fix
  // could not quietly retire runtime field authoring. The retirement is now the
  // RULED outcome (maintainer, 2026-08-12), so it is deliberate and on the
  // record rather than quiet — and these pins are what make a silent re-flip
  // loud from here on.

  it('declares `allowRuntimeCreate: false` — the runtime create door is retired (#7893)', () => {
    expect(fieldEntry()!.allowRuntimeCreate).toBe(false);
  });

  it('IS code-only: no runtime write channel is declared (#5086 refuses the inlet)', () => {
    // The exact predicate #5086 (PR #5263) refuses on, spelled as the gate
    // spells it. `true` here is what makes PUT /api/v1/meta/field/:name answer
    // 403 `NOT_CREATABLE` instead of 200 "Saved" — in draft mode too, since the
    // inlet runs before the draft/publish branch and does not look at `mode`.
    const entry = fieldEntry()!;
    const codeOnly = entry.allowRuntimeCreate === false && entry.allowOrgOverride === false;
    expect(codeOnly).toBe(true);
  });

  it('declares `allowOrgOverride: false` — UNCHANGED, #7743’s overlay refusal stays', () => {
    // Binding carry-over of the 2026-08-12 ruling. This card closed the create
    // tier; the override tier was already closed and must not move in either
    // direction as a side effect.
    expect(fieldEntry()!.allowOrgOverride).toBe(false);
  });

  it('leaves `supportsOverlay: false` alone — flipping it would widen the DELETE gate', () => {
    // The card's stated root cause was that the read skipped fields "since
    // `field` has `supportsOverlay: false`". Following it would have been a
    // regression: the flag gates no read path, and `assertDeleteAllowed` is its
    // only consumer, so a flip silently widens delete authorization.
    expect(fieldEntry()!.supportsOverlay).toBe(false);
  });
});

describe('the control that falsifies the card’s stated root cause', () => {
  it('`object` carries the IDENTICAL overlay flag and stays runtime-creatable', () => {
    // Same `supportsOverlay: false`, opposite outcome — so the flag was never
    // what skipped the read. What `object` has and `field` never did is a
    // composition path: an object write reaches `applyObjectRegistryMutation`
    // and is read back in full.
    const object = entryFor('object')!;
    const field = fieldEntry()!;

    expect(object.supportsOverlay).toBe(field.supportsOverlay);
    expect(object.supportsOverlay).toBe(false);

    // …and this is the half that must NOT be equal any more: the object route
    // is the remedy the refusal prescribes, so it has to stay open or the
    // prescription is itself false compliance.
    expect(object.allowRuntimeCreate).toBe(true);
    expect(field.allowRuntimeCreate).toBe(false);
  });
});
