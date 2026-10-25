/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import '../renderers/basic/icon';

// ---------------------------------------------------------------------------
// objectui#5622 — the `ui:icon` renderer's two declared spellings must agree.
//
// Two metadata spots feed the designer: the registration's `icon` meta (the
// glyph on the palette entry) and the glyph INPUT's `defaultValue` (what an
// `icon` dropped from that palette renders before anyone types a name). The
// defect objectui#5622 repaired was ONE name in TWO places, so the repair is
// only correct if they stay one name — split them and the palette advertises a
// glyph the dropped component does not render.
//
// ⚠️ That input is keyed `icon` since objectui#5631 — it was `name` until the
// glyph key migrated off the SDUI identity key.
//
// Read off the REGISTRY rather than out of source: the registry entry is the
// artifact the designer palette actually consumes.
//
// ── The MEMBERSHIP half was retired at objectui#5936 ────────────────────────
// This file used to also assert that both spellings are live keys of lucide's
// runtime `icons` record — the objectui#5622 mechanism, where a retired name
// keeps its named export while dropping out of the record, so it imports,
// type-checks and renders as a COMPONENT while resolving to `null` as a STRING.
// That half is gone, and the reason is a measurement rather than a preference.
//
// It was KEPT at objectui#5633 (which built the repo-level gate,
// `scripts/check-lucide-icon-record-names.mjs`) on one explicit premise: that
// the palette reading this meta lives OUTSIDE this repo, so the gate had no
// measured basis to generalise the claim but a local pin could still hold it.
// objectui#5936 was filed to find that palette. It was not found — in objectui,
// in objectstack, or in cloud. The gate's own header carries the three readings,
// their controls, and the 2026-09-04 adjudication that the gate is NOT extended
// to registration `icon` meta.
//
// Given that, the membership half asserted the liveness of a string with no
// measured consumer, and it cost more than it looked:
//
//   - It guarded ONE of the 45 registrations that declare an `icon` meta, while
//     the gate is adjudicated NOT to cover the other 44. A membership check
//     over 1/45 of its own population does not manage that risk; it SIGNALS
//     that the risk is managed — and that signal is what sent objectui#5936
//     looking for a consumer this pin implied must exist.
//   - It carried a hand-copied `toPascalCase` + `iconNameMap`, annotated
//     "Copied EXACTLY — a pin that normalised names differently from the
//     consumer would answer a question nobody asks" and "module-private there".
//     objectui#5935 / PR #7491 collapsed the eight resolvers into ONE seam that
//     EXPORTS `describeIconLookup`/`resolveIcon` and tokenises on
//     `/[-_\s]+/`. This copy still said `split('-')`. Both halves of its own
//     stated correctness condition had gone stale inside one round, and nothing
//     went red — which is what a pin over a surface with no consumer does.
//   - Measured at the retirement: all 45 declared registration `icon` metas are
//     live on BOTH lucide surfaces, so no red was dropped by removing it.
//
// ⛔ The published `ComponentMeta.icon` key itself (`packages/types/src/base.ts`)
// is UNTOUCHED — removing a published capability is a maintainer decision and
// was fenced out of objectui#5936. What retired here is a TEST claim about it.
// If an actual reader of this meta is ever found, in any repo, the answer is to
// extend the gate to the whole population — ⛔ not to restore a pin over one
// registration.
//
// ── The COUPLING half was retired at objectui#7493 ──────────────────────────
// It asserted that the registration's `icon` meta and the glyph input's
// `defaultValue` named the same glyph. `ComponentInput.defaultValue` is an
// ADR-0049 retirement tombstone since objectui#7493 (with `label` and
// `advanced`, objectui#7781): the manifest serializer never forwarded it and
// no consumer of `ComponentMeta.inputs` — no designer, no palette, no renderer
// — ever read it, so the "second spelling" was a shadow value only this pin
// compared. There is no renderer default to re-pin it against either: an
// `icon` node with no `icon` name renders the PLACEHOLDER branch and warns
// (objectui#5631), by design — the renderer has no fallback glyph.
//
// ── What this file still asserts
// The registration's `icon` meta — the ONE declared spelling left — is a real
// icon name, and the `icon` input is still declared (it is what the manifest
// publishes for the key). Both are preconditions the old coupling test carried;
// they survive because the ledger in
// `scripts/__tests__/check-lucide-icon-record-names.test.ts` keeps this file as
// the record of the objectui#5936 retirement, and because a registration whose
// palette glyph silently went blank is the objectui#5622 defect's other half.
// ---------------------------------------------------------------------------

const meta = ComponentRegistry.getMeta('icon', 'ui');
const glyphInput = meta?.inputs?.find(input => input.name === 'icon');

describe('the `ui:icon` registration\'s one declared glyph spelling (objectui#5622, objectui#7493)', () => {
  it('the registration and its `icon` input were actually found — the precondition', () => {
    // Load-bearing, not ceremony: `typeof undefined` is a string too, so the
    // glyph assertion below needs the registration to exist first.
    expect(meta, '`ui:icon` is not registered — the import above no longer registers it.').toBeDefined();
    expect(
      glyphInput,
      'the `icon` input is gone from the `ui:icon` registration — fix the reader or the registration.',
    ).toBeDefined();
  });

  it('declares the palette glyph as a non-empty icon name', () => {
    expect(typeof meta?.icon, 'registration `icon` (the palette entry glyph) declares no icon name at all').toBe('string');
    expect(meta?.icon).not.toBe('');
  });

  it('the `icon` input carries no declared default — the tombstone, read off the registry', () => {
    // Not `toBeUndefined()` on the property: that would be vacuously green on a
    // missing input too (the precondition above guards it), and the point is
    // that the key is ABSENT from what the registration publishes, not that its
    // value happens to be undefined.
    expect(glyphInput).not.toHaveProperty('defaultValue');
  });
});
