// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ManifestSchema, PluginRuntimeSchema } from './manifest.zod';

// ─── [commit a9ee98992] `manifest.runtime` text states publish-gate-only enforcement ──
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
// ⚠️ On the assertion set: a describe string is not a rejection envelope, so
// there is no ADR-0112 `code` + `status` to pin here. Where the WORDING is the
// contract, the wording is what gets pinned (#5240). The final case guards the
// other direction — that this text-only change moved no accept/reject
// behaviour.
//
// [#25767] The `manifest.loading` tombstone and its ADR-0087 D3 entry — the
// two other carriers of this sentence, whose halves this file used to pin in
// the same way — were a 16.x retirement kit and aged out at 18 (ADR-0087
// amendment, D2 = A). `loading` is a strict unknown key now, pinned in
// `plugin-loading-retirement.test.ts`; the describes below are the carriers
// that remain, and the ones the reference docs render.
//
// [#27123, ADR-0025 §3.5 M1] The second half MOVED, so it is pinned as it now
// reads. The boot-time loader for plugins `os plugin install` installed
// dispatches on the tier (`dispatchPluginRuntime` in
// `packages/runtime/src/installed-plugin-loader.ts`, pinned there): only `node`
// is loaded, in process and NOT isolated, and `sandbox` / `worker` are refused
// until M3 routes them. Still a split, and still both halves: the text must
// not claim isolation (`node` is not isolation, and nothing confines
// `sandbox` yet: it is refused). The old sentence, "load-side enforcement is
// NOT implemented", is now false and is pinned absent.

/** Both halves of the truthful split, as separate probes. */
const SAYS_PUBLISH_GATE_ENFORCED = /publish gate/i;
const SAYS_422 = /422/;
const SAYS_BOOT_LOADS_ONLY_NODE = /at boot for a plugin `os plugin install` installed: only `node` is loaded/i;
const SAYS_NODE_NOT_ISOLATED = /not isolated/i;
const SAYS_SANDBOX_WORKER_REFUSED = /`sandbox` and `worker` are refused until/i;
const RETRACTED_NOT_ENFORCED = /load-side enforcement is NOT implemented/i;
describe('manifest.runtime trust-tier text is truthful', () => {
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
    expect(text).toMatch(SAYS_BOOT_LOADS_ONLY_NODE);
    expect(text).toMatch(SAYS_NODE_NOT_ISOLATED);
    expect(text).toMatch(SAYS_SANDBOX_WORKER_REFUSED);
    expect(text).not.toMatch(RETRACTED_NOT_ENFORCED);
  });

  it('states BOTH halves on the `manifest.runtime` field describe', () => {
    // The field carries its own describe — this is the string that lands in
    // `content/docs/references/kernel/manifest.mdx`, i.e. the one an author
    // actually reads in the reference table.
    const text = ManifestSchema.shape.runtime.description ?? '';

    expect(text, 'the field must carry its own describe').not.toBe('');
    expect(text).toMatch(SAYS_PUBLISH_GATE_ENFORCED);
    expect(text).toMatch(SAYS_422);
    expect(text).toMatch(SAYS_BOOT_LOADS_ONLY_NODE);
    expect(text).toMatch(SAYS_NODE_NOT_ISOLATED);
    expect(text).toMatch(SAYS_SANDBOX_WORKER_REFUSED);
    expect(text).not.toMatch(RETRACTED_NOT_ENFORCED);
  });

  it('`loading` no longer carries the sentence at all — it is a strict unknown key (#25767)', () => {
    // The tombstone that used to redirect authors here aged out; the refusal
    // an author meets is the strict one, naming the key and the upgrade guide.
    // Pinned so a re-added tombstone would have to bring the truthful split
    // back with it, under the pins above.
    const result = ManifestSchema.safeParse({ ...baseManifest, loading: { strategy: 'lazy' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.filter((i) => i.path[0] === 'loading')).toEqual([]);
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys')!;
    expect(issue.message).toContain('https://objectstack.ai/docs/protocol-upgrade');
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
