// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ManifestSchema, PluginRuntimeSchema } from './manifest.zod';
import { entry as loadingRetiredEntry } from '../migrations/entries/semantic/17.plugin-manifest-loading-retired';

// ─── [#11330] `manifest.runtime` text states publish-gate-only enforcement ────
//
// Maintainer ruling 2026-08-30 (verbatim「同意」), option B: say it truthfully
// NOW; enforcing the tier at load is a v18 direction, deliberately NOT built
// here. Retirement (option C) was ruled OUT — the cloud marketplace publish
// gate is a real consumer of this key, so deleting it would tear out the
// marketplace's trust-gate input.
//
// The defect these pins close is ADR-0049 false compliance with a shipped
// migration message attached. `manifest.loading`'s tombstone redirected every
// upgrading author, verbatim, to "the plugin trust tier (`manifest.runtime`)
// and the permission declarations, which are enforced" — while in this repo
// nothing dispatches on the tier at all (its only reads are two CLI progress
// lines that echo the value). An author who followed the prescription got the
// same nothing the prescription was warning them about, one key over.
//
// The truthful statement is a SPLIT, and both halves are load-bearing:
//   • ENFORCED at the cloud marketplace publish gate — an unverified publisher
//     requesting the `node` tier is hard-rejected (HTTP 422) and forced to
//     manual review.
//   • NOT ENFORCED at load — no local isolation follows from the declared tier.
// Pinning only the first half would restore the original lie in softer words;
// pinning only the second would deny a gate that really does run. So every pin
// below asserts BOTH halves, and one asserts the retracted claim is gone —
// without that negative pin, a future edit could re-add "which are enforced"
// beside the new text and every positive assertion would stay green.
//
// ⚠️ On the assertion set: a describe string and a tombstone prescription are
// not a rejection envelope, so there is no ADR-0112 `code` + `status` to pin
// here (the tombstone's own envelope is pinned in
// `plugin-loading-retirement.test.ts`). Where the WORDING is the contract, the
// wording is what gets pinned (#5240). The final case guards the other
// direction — that this text-only change moved no accept/reject behaviour.

/** Both halves of the truthful split, as separate probes. */
const SAYS_PUBLISH_GATE_ENFORCED = /publish gate/i;
const SAYS_422 = /422/;
const SAYS_LOAD_SIDE_NOT_ENFORCED = /load-side enforcement is NOT implemented/i;

describe('[#11330] manifest.runtime trust-tier text is truthful', () => {
  const baseManifest = {
    id: 'com.example.plugin',
    namespace: 'example',
    version: '1.0.0',
    type: 'app',
    name: 'Example Plugin',
  } as const;

  it('states BOTH halves on the `PluginRuntime` enum describe', () => {
    const text = PluginRuntimeSchema.description ?? '';

    expect(text, 'the enum must carry a describe at all').not.toBe('');
    expect(text).toMatch(SAYS_PUBLISH_GATE_ENFORCED);
    expect(text).toMatch(SAYS_422);
    expect(text).toMatch(SAYS_LOAD_SIDE_NOT_ENFORCED);
  });

  it('states BOTH halves on the `manifest.runtime` field describe', () => {
    // The field carries its own describe — this is the string that lands in
    // `content/docs/references/kernel/manifest.mdx`, i.e. the one an author
    // actually reads in the reference table.
    const text = ManifestSchema.shape.runtime.description ?? '';

    expect(text, 'the field must carry its own describe').not.toBe('');
    expect(text).toMatch(SAYS_PUBLISH_GATE_ENFORCED);
    expect(text).toMatch(SAYS_422);
    expect(text).toMatch(SAYS_LOAD_SIDE_NOT_ENFORCED);
  });

  it('corrects the `loading` tombstone that redirected authors here', () => {
    const result = ManifestSchema.safeParse({
      ...baseManifest,
      loading: { sandboxing: { enabled: true, isolationLevel: 'process' } },
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const message = result.error.issues.find((i) => i.path[0] === 'loading')!.message;

    // Still names the tier — the redirection itself is not the defect, the
    // unqualified "which are enforced" was.
    expect(message).toMatch(/manifest\.runtime/);
    expect(message).toMatch(SAYS_PUBLISH_GATE_ENFORCED);
    expect(message).toMatch(SAYS_422);
    expect(message).toMatch(SAYS_LOAD_SIDE_NOT_ENFORCED);

    // ⛔ The retracted claim must not come back. This is the pin that makes the
    // three above mean something: they all stay green if someone re-adds the
    // old sentence alongside the new one.
    expect(
      message,
      'the tombstone must not claim the trust tier is enforced without qualification',
    ).not.toMatch(/trust tier \(`manifest\.runtime`\) and the permission declarations, which are enforced/);
  });

  it('leaves the PERMISSIONS half of that sentence verbatim (#11333 owns it)', () => {
    // Coordination pin from the ruling: the tombstone sentence has two halves —
    // the trust tier (this card) and the permission declarations (#11333). This
    // card corrects ONLY its own half. If #11333 later corrects the permissions
    // half, this expectation is the thing that goes red and tells that author
    // the pin is theirs to update — which is exactly the handoff the ruling
    // asked for ("⛔ 不两张各改一半" without a signal between them).
    const result = ManifestSchema.safeParse({ ...baseManifest, loading: { strategy: 'lazy' } });
    expect(result.success).toBe(false);
    if (result.success) return;

    const message = result.error.issues.find((i) => i.path[0] === 'loading')!.message;
    expect(message).toContain('the permission declarations, which are enforced');
  });

  it('corrects the same claim in the shipped ADR-0087 D3 entry', () => {
    // The tombstone ships TWICE — once in the schema, once through this entry
    // into `docs/protocol-upgrade-guide.md`. Fixing only the schema would leave
    // the upgrade guide still telling authors the tier is a surface "the
    // platform actually enforces".
    const text = loadingRetiredEntry.replacement;

    expect(text).toMatch(SAYS_PUBLISH_GATE_ENFORCED);
    expect(text).toMatch(SAYS_422);
    expect(text).toMatch(SAYS_LOAD_SIDE_NOT_ENFORCED);
    expect(
      text,
      'the D3 entry must not present the trust tier as an enforced surface',
    ).not.toMatch(/trust tier\s*\(`manifest\.runtime`, ADR-0025 §3\.6\) and the manifest permission declarations/);
  });

  it('changes NO accept/reject behaviour — every tier still parses as before', () => {
    // Anti-vacuity and byte-invariance in one: this card is a text correction,
    // so the accepted value set must be untouched. If a future "clarification"
    // narrows the enum (e.g. dropping `worker` because it is reserved), that is
    // a contract change wearing a text-change costume, and it fails here.
    for (const tier of ['node', 'sandbox', 'worker'] as const) {
      const result = ManifestSchema.safeParse({ ...baseManifest, runtime: tier });
      expect(result.success, `runtime: '${tier}' must still be accepted`).toBe(true);
    }

    expect(ManifestSchema.safeParse({ ...baseManifest, runtime: 'isolated' }).success).toBe(false);
    // Unset stays legal — it means a pure-metadata package, which the describe
    // still says and which no part of this change touches.
    expect(ManifestSchema.safeParse(baseManifest).success).toBe(true);
  });
});
