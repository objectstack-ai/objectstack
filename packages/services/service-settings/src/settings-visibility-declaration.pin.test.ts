// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// The producer/consumer pin for settings `visible` (#7327, the alignment half
// of #7169).
//
// There are two checks on a `visible` predicate and they live in different
// packages. The DECLARATION — `SettingsManifestSchema` in `@objectstack/spec`
// — refuses an unsupported predicate at publish/parse. The EVALUATOR —
// `evaluateVisibility` in this package — refuses it at save (#7310, fail
// closed). Those two agreeing is not a nice-to-have: #7169 was caused by a
// producer and a consumer disagreeing about what parses, and answering it by
// adding a SECOND grammar statement would have reproduced the bug class if the
// two were left free to drift.
//
// So this file asserts the pairing directly, from the consumer side (spec
// cannot import a service — Prime Directive #2, the spec declares, it does not
// execute). Two facts:
//
//   1. The corpus. Every bundled manifest still parses. This is the #7169
//      measurement (94 predicates / 10 manifests) carried onto the declaration
//      side: narrowing that refused even one of them would brick publishing of
//      a builtin namespace, and the whole reason direction (b) was chosen over
//      direction (a) is that this number is 0 rather than 93.
//   2. The agreement table. For a spread of in-grammar and out-of-grammar
//      sources, "the schema accepts it" and "the evaluator can parse it" are
//      the same bit.

import { describe, it, expect } from 'vitest';
import { SettingsManifestSchema, SpecifierSchema } from '@objectstack/spec/system';
import { builtinSettingsManifests } from './manifests/index.js';
import { evaluateVisibility, visibilitySource } from './visibility-eval.js';

/** Wrap a predicate in the smallest specifier that carries one. */
const specifierWith = (visible: unknown) => ({
  type: 'text' as const,
  key: 'some_key',
  label: 'Some key',
  visible,
});

const declarationAccepts = (visible: unknown): boolean =>
  SpecifierSchema.safeParse(specifierWith(visible)).success;

const evaluatorParses = (visible: unknown): boolean => {
  try {
    evaluateVisibility(visible, {});
    return true;
  } catch {
    return false;
  }
};

describe('settings `visible` — declaration ⇄ evaluator', () => {
  it('the corpus: every bundled manifest parses against the narrowed declaration', () => {
    // The #7169 corpus, on the declaration side. Expected refusals: 0.
    const refusals: string[] = [];
    for (const manifest of builtinSettingsManifests as Array<Record<string, any>>) {
      const parsed = SettingsManifestSchema.safeParse(manifest);
      if (!parsed.success) {
        refusals.push(`${manifest.namespace}: ${parsed.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join(' | ')}`);
      }
    }
    expect(refusals).toEqual([]);
  });

  it('the corpus is still the size the ruling measured — 10 manifests, 94 predicates', () => {
    // If a bundled manifest gains or loses a `visible`, this number moves and
    // the reader is sent back to the measurement rather than trusting a stale
    // one. It is a tripwire on the premise, not a rule about how many
    // predicates a manifest may have — move it deliberately.
    const predicates = (builtinSettingsManifests as Array<Record<string, any>>).flatMap((m) => [
      ...(typeof m.visible === 'undefined' ? [] : [m.visible]),
      ...(m.specifiers ?? []).filter((s: any) => typeof s.visible !== 'undefined').map((s: any) => s.visible),
    ]);
    expect(builtinSettingsManifests).toHaveLength(10);
    expect(predicates).toHaveLength(94);
  });

  it('every bundled predicate is accepted by BOTH sides', () => {
    for (const manifest of builtinSettingsManifests as Array<Record<string, any>>) {
      for (const spec of manifest.specifiers ?? []) {
        if (typeof spec.visible === 'undefined') continue;
        const where = `${manifest.namespace}.${spec.key ?? '(layout)'}: ${visibilitySource(spec.visible)}`;
        expect(declarationAccepts(spec.visible), `declaration refused ${where}`).toBe(true);
        expect(evaluatorParses(spec.visible), `evaluator refused ${where}`).toBe(true);
      }
    }
  });

  describe('the two sides answer the same bit', () => {
    const IN_GRAMMAR = [
      // Every shape the bundled corpus actually uses.
      "${data.provider === 'smtp'}",
      "${data.provider !== 'memory'}",
      '${data.email_password_enabled !== false}',
      '${data.mfa_required === true}',
      '${data.lockout_threshold > 0}',
      "${data.provider === 'resend' || data.provider === 'postmark'}",
      "${data.embedder_provider && data.embedder_provider !== 'none'}",
      "${data.provider !== 'memory' && data.title_generation_enabled !== false}",
      // Reachable but unused by the bundled set — declared is declared.
      '${!data.disabled}',
      '${data.count <= 10 && (data.a == 1 || data.b != null)}',
      '${data.ratio >= 0.5}',
      "${data.mode < 'z'}",
      // Both accepted envelopes, and the unwrapped spelling.
      "data.provider === 'smtp'",
      { dialect: 'cel' as const, source: "${data.provider === 'smtp'}" },
      { dialect: 'cel' as const, source: "data.provider === 'smtp'" },
    ];

    const OUT_OF_GRAMMAR = [
      // Real CEL an author would reasonably reach for — the case #7327 exists
      // to move from a save-time failure to a publish-time one.
      "${data.provider in ['smtp', 'resend']}",
      '${size(data.recipients) > 0}',
      "${data.provider.startsWith('s')}",
      '${data.nested.field === 1}',
      "${current_user.role === 'admin'}",
      "${has(data.provider) ? 'a' : 'b'}",
      // Malformed rather than mis-dialected.
      "${data.provider === 'smtp'",
      '${data.provider ===}',
      "${data.a === 'x'} && ${data.b === 'y'}",
      '${data.provider === }{',
      '${-5 > data.x}',
    ];

    const labelled = (xs: unknown[]) => xs.map((v) => [JSON.stringify(v), v] as const);

    it.each(labelled(IN_GRAMMAR))('accepts %s on both sides', (_label, visible) => {
      expect(evaluatorParses(visible)).toBe(true);
      expect(declarationAccepts(visible)).toBe(true);
    });

    it.each(labelled(OUT_OF_GRAMMAR))('refuses %s on both sides', (_label, visible) => {
      expect(evaluatorParses(visible)).toBe(false);
      expect(declarationAccepts(visible)).toBe(false);
    });
  });

  it('the publish-time refusal prescribes the grammar instead of just naming a violation', () => {
    const result = SpecifierSchema.safeParse(specifierWith("${data.provider in ['smtp', 'resend']}"));
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues.map((i) => i.message).join('\n');
    // The offending source, why, and — the point of the card — what to write.
    expect(message).toContain("data.provider in ['smtp', 'resend']");
    expect(message).toContain('unsupported identifier "in"');
    expect(message).toContain('not CEL');
    expect(message).toContain('`===`');
    expect(message).toContain('one-level member access');
  });

  it('the manifest-level slot carries the same grammar as the specifier-level one', () => {
    const base = {
      namespace: 'demo',
      label: 'Demo',
      specifiers: [{ type: 'text' as const, key: 'some_key', label: 'Some key' }],
    };
    expect(SettingsManifestSchema.safeParse({ ...base, visible: "${data.tier === 'pro'}" }).success).toBe(true);
    expect(SettingsManifestSchema.safeParse({ ...base, visible: "${data.tier in ['pro']}" }).success).toBe(false);
  });
});
