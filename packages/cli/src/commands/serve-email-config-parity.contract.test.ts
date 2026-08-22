// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `EmailServiceConfigSchema` (spec) ↔ the keys `resolveEmailCapabilityArg`
// actually reads off `config.email` — #5307.
//
// `config.email` has exactly ONE reader in the whole repo (this file's
// neighbour, `serve.ts`), and `EmailServiceConfigSchema` is the operator-facing
// contract for it. Nothing held the two together, so the schema fell behind the
// reader twice in one family:
//
//   - #5104 — `provider: 'smtp'` shipped in #5087 and the enum still stopped at
//     postmark, so annotating `objectstack.config.ts` with `EmailServiceConfig`
//     made a working config a type error.
//   - #5307 — `queueDelivery` (the #5160 durable-queue switch), `appName` and
//     `defaultTemplateContext` were read here and declared nowhere. Same shape,
//     three more keys, and the generated reference docs told authors the keys
//     did not exist.
//
// Both were found by hand, with a grep. This file is that grep, mechanised, so
// the third one fails a build instead of waiting for someone to run it:
// a key added to the reader without a declaration is red here the day it lands.
//
// It is a CROSS-PACKAGE assertion for the reason the provider-parity test in
// `@objectstack/plugin-email` gives: two mirrored literals can always be
// "fixed" by editing the other literal. `@objectstack/spec` is a real
// dependency of this package, and the comparison is test-only — no runtime edge
// is added.
//
// This package's `tsconfig.json` includes `src` (tests and all), so the
// compile-time witness below is real: `pnpm --filter @objectstack/cli
// typecheck` fails on a config the schema cannot express, before any test runs.
// The spec-side companion — `@objectstack/spec`'s own `system/email-config.test.ts`,
// named without its repo-relative path here for the reason this directory's
// `serve-multi-node-cap-advisory.pin.test.ts` gives for the same gate: a quoted
// literal starting at `packages/` would force `check:cross-package-test-inputs`
// to demand a glob for a file this test never actually reads — has to be
// runtime-only, since that package excludes `**/*.test.ts` from its tsconfig
// (#5286).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmailServiceConfigSchema } from '@objectstack/spec/system';
import type { EmailServiceConfig } from '@objectstack/spec/system';
import { resolveEmailCapabilityArg } from './serve.js';
// The repo's one comment/code separator (#9367). This file used to scan RAW
// source with no separator at all (#10514): a docblock or a `// TODO: also
// read cfgEmail.foo` line was indistinguishable from a real dot access. Typed
// by the hand-written `scripts/js-comment-mask.d.mts` next to it (this
// package's `tsconfig.json` includes `src`), so this import needs no
// suppression.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const SERVE_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'serve.ts'),
  'utf8',
);

/**
 * `serve.ts` with every comment span blanked (offsets preserved, bytes
 * replaced with spaces) — see `keysReadFromConfigEmail` below for why the
 * scan reads this instead of `SERVE_SOURCE` directly (#10514).
 */
const MASKED_SERVE_SOURCE = maskComments(SERVE_SOURCE);

/**
 * Every `config.email` key the resolver reads, straight from its source — the
 * issue's own repro command:
 *
 *   grep -oE "cfgEmail\.[a-zA-Z]+" packages/cli/src/commands/serve.ts | sort -u
 *
 * `cfgEmail` is the resolver's parameter name for `config.email`, and every
 * read of it in that function is a dot access (no destructuring, no computed
 * keys), which is what makes a source scan an exact measure rather than an
 * approximation. Should that ever stop being true, this comment is the place
 * the next reader learns the scan has to change with it.
 *
 * Takes `source` explicitly (default the real file's masked text, #10514)
 * rather than closing over `SERVE_SOURCE`/`MASKED_SERVE_SOURCE` directly, so
 * the vacuity-proof tests below can drive the exact same regex over a raw vs.
 * a masked variant of a shape and show the two disagree.
 */
function keysReadFromConfigEmail(source: string = MASKED_SERVE_SOURCE): string[] {
  const reads = source.match(/cfgEmail\.[A-Za-z_$][\w$]*/g) ?? [];
  return [...new Set(reads.map((r) => r.slice('cfgEmail.'.length)))].sort();
}

/** Every key the authoring contract declares. */
function keysDeclaredBySchema(): string[] {
  return Object.keys(EmailServiceConfigSchema.shape).sort();
}

/**
 * No exemptions: both directions below are plain set equality.
 *
 * There was one, and its history is the reason this paragraph stays. `persist`
 * was declared and NOT read — the mirror image of #5307 — so this file shipped
 * it as the single registered `DECLARED_BUT_UNREAD` entry, filed as #5447
 * rather than silently excused. The plugin option it names was already live
 * (`EmailServicePlugin` builds no `EmailPersistence` when `persist === false`),
 * but nothing carried `config.email.persist` to the plugin, and
 * `resolveEmailCapabilityArg` is the only reader `config.email` has. So the
 * schema advertised an authoring surface with no carrier: a deployment that
 * wrote `email: { persist: false }` to keep bodies out of the database
 * type-checked, parsed, read as configured, and went on writing every subject,
 * body and recipient to `sys_email`.
 *
 * ADR-0049 enforce-or-remove, answered "enforce" by PR #5470 (`cd2efe62a`):
 * the resolver reads the key, behind a tri-state `OS_EMAIL_PERSIST_ENABLED`
 * env layer, with the default still ON. That is what the exemption was waiting
 * for, so the promise it carried is kept here.
 *
 * The array is DELETED rather than left standing empty. An empty registry is
 * an invitation — the next declared-but-unread key gets appended to it instead
 * of argued about, which is exactly the silent excusing the entry existed to
 * prevent. With it gone, a key declared and not read is red the day it lands,
 * and re-introducing an exemption means re-introducing the mechanism, in a
 * diff someone has to justify.
 */

describe('EmailServiceConfigSchema ↔ resolveEmailCapabilityArg', () => {
  it('declares every config.email key the resolver reads (#5307)', () => {
    const declared = new Set(keysDeclaredBySchema());
    const undeclared = keysReadFromConfigEmail().filter((k) => !declared.has(k));
    // Red before #5307 with ['appName', 'defaultTemplateContext', 'queueDelivery'].
    expect(undeclared).toEqual([]);
  });

  it('reads every key it declares — no exemptions since #5447 landed (PR #5470)', () => {
    const read = new Set(keysReadFromConfigEmail());
    const unread = keysDeclaredBySchema().filter((k) => !read.has(k));
    // Red before PR #5470 with ['persist']. With this at [] and the assertion
    // above also at [], the declared set and the read set are equal.
    expect(unread).toEqual([]);
  });

  it('pins the measured key set so a rename is a conscious edit', () => {
    expect(keysDeclaredBySchema()).toEqual([
      'apiKey',
      'appName',
      'defaultFrom',
      'defaultTemplateContext',
      'options',
      'persist',
      'provider',
      'queueDelivery',
      'retries',
    ]);
  });
});

/**
 * Vacuity proof (#10514): both directions the raw scan was one ordinary
 * comment away from getting wrong, reproduced on synthetic sources shaped
 * like the real resolver so the two legs (raw vs. masked) can be compared
 * without waiting for `serve.ts` to actually regress. Each `it` shows the RAW
 * leg producing the wrong verdict — the verdict this file's scan would have
 * produced before #10514 — and the MASKED leg producing the right one.
 */
describe('the key scan ignores prose that looks like a cfgEmail read (#10514)', () => {
  it('does not let a comment fabricate an undeclared key ("declares every key" direction)', () => {
    const synthetic = [
      'function resolveEmailCapabilityArg(cfgEmail = {}) {',
      '  // TODO: someday also read cfgEmail.bogusKey from the config',
      "  const provider = cfgEmail.provider;",
      '  return { provider };',
      '}',
    ].join('\n');

    // Pre-#10514 (raw): the comment's `cfgEmail.bogusKey` is indistinguishable
    // from a real dot access — this is what would have made "declares every
    // config.email key the resolver reads" go RED over a comment alone.
    expect(keysReadFromConfigEmail(synthetic)).toEqual(['bogusKey', 'provider']);
    // Post-#10514 (masked): the comment is blanked, so only the real read
    // survives.
    expect(keysReadFromConfigEmail(maskComments(synthetic))).toEqual(['provider']);
  });

  it('does not let a comment fabricate a read of a declared-but-unread key — the #5447 shape, "the worse one" ("reads every key" direction)', () => {
    const synthetic = [
      'function resolveEmailCapabilityArg(cfgEmail = {}) {',
      "  const provider = cfgEmail.provider;",
      '  // historically we also honoured cfgEmail.persist here',
      '  return { provider };',
      '}',
    ].join('\n');

    // Pre-#10514 (raw): the comment alone counts as a "read" of `persist` —
    // silently restoring the exact `DECLARED_BUT_UNREAD` exemption this
    // file's docblock (above) says was deleted for good after #5447/#5470.
    expect(keysReadFromConfigEmail(synthetic)).toContain('persist');
    // Post-#10514 (masked): the comment does not count, so a schema key with
    // no real reader still reads as unread here.
    expect(keysReadFromConfigEmail(maskComments(synthetic))).not.toContain('persist');
  });
});

/**
 * Compile-time half — the author-facing symptom #5307 is written about. Every
 * value here is one the runtime has honoured since #5160; before the
 * declaration each of the last three was a type error on a config that booted
 * and worked.
 */
const AUTHORED_CONFIG: EmailServiceConfig = {
  provider: 'smtp',
  options: { host: 'smtp.acme.test', port: 465, secure: true },
  defaultFrom: { name: 'Acme CRM', address: 'no-reply@acme.test' },
  retries: 3,
  queueDelivery: true,
  appName: 'Acme CRM',
  defaultTemplateContext: { supportEmail: 'help@acme.test' },
};

describe('a config the schema accepts reaches the plugin intact', () => {
  it('carries the three keys from parse() through to the plugin options', () => {
    // Name equality is not enough: the schema could declare `queueDelivery`
    // with a shape the resolver ignores. So parse an authored config with the
    // real schema and feed the RESULT to the real reader.
    const parsed = EmailServiceConfigSchema.parse(AUTHORED_CONFIG);
    const { options } = resolveEmailCapabilityArg(parsed as Record<string, any>, {});

    expect(options).toMatchObject({
      provider: 'smtp',
      queueDelivery: true,
      defaultTemplateContext: { appName: 'Acme CRM', supportEmail: 'help@acme.test' },
    });
  });

  it('lets appName name the deployment for templates and the placeholder sender', () => {
    const parsed = EmailServiceConfigSchema.parse({ appName: 'Acme CRM' });
    const { options } = resolveEmailCapabilityArg(parsed as Record<string, any>, {});

    expect(options.defaultTemplateContext).toMatchObject({ appName: 'Acme CRM' });
    expect(options.defaultFrom).toEqual({ name: 'Acme CRM', address: 'no-reply@acme-crm.local' });
  });

  it('resolves appName by the five-rung chain — env over both declared keys (#5448)', () => {
    // This pin used to record the OPPOSITE: `defaultTemplateContext` was
    // spread OVER the resolved value, so `OS_APP_NAME` lost to an `appName`
    // written inside it. That was measured behaviour, not intent, and was
    // filed as #5448 — settled direction B (the env must win, per the header's
    // "override per setting") and implemented by PR #5498, which resolves
    // `appName` AFTER the spread. This pin now guards the new order.
    //
    // Its angle is this file's own, and not a restatement of
    // `serve-email-appname-precedence.test.ts`: that file feeds the resolver
    // raw objects, whereas the config below goes through the real
    // `EmailServiceConfigSchema.parse()` first. So what is pinned here is that
    // the two keys #5307 added to the CONTRACT survive the parse AND land on
    // the rungs the schema's own prose promises — a schema that renamed,
    // stripped or reshaped either key would be red here even while the
    // resolver's own tests stayed green.
    const parsed = EmailServiceConfigSchema.parse({
      appName: 'From The Key',
      defaultTemplateContext: { appName: 'From The Context', supportEmail: 'help@acme.test' },
    });

    // Rung 1 — all three sources distinct and present: the env var wins.
    // (Three DIFFERENT values on purpose: asserting a value all three sources
    // agree on would pass under any ordering, including the old one.)
    const withEnv = resolveEmailCapabilityArg(parsed as Record<string, any>, {
      OS_APP_NAME: 'From The Env',
    }).options;
    expect(withEnv.defaultTemplateContext).toEqual({
      appName: 'From The Env',
      supportEmail: 'help@acme.test',   // every other context key still spreads verbatim
    });
    // The blast radius #5448 named: the placeholder sender is slugged from the
    // resolved name, so the envelope moves with the body or the fix is half done.
    expect(withEnv.defaultFrom).toEqual({ name: 'From The Env', address: 'no-reply@from-the-env.local' });

    // Rung 2 — no env: the declared `appName` key beats the context form.
    // Under the old spread-over order this answered 'From The Context' too,
    // so this half discriminates the two orders even without an env var set.
    const noEnv = resolveEmailCapabilityArg(parsed as Record<string, any>, {}).options;
    expect(noEnv.defaultTemplateContext).toMatchObject({ appName: 'From The Key' });

    // Rung 3 — the context form is still IN the chain, not dropped behind the
    // dedicated key: a config that declares only this shape keeps its name
    // rather than being demoted to 'ObjectStack'.
    const contextOnly = EmailServiceConfigSchema.parse({
      defaultTemplateContext: { appName: 'From The Context' },
    });
    expect(resolveEmailCapabilityArg(contextOnly as Record<string, any>, {}).options
      .defaultTemplateContext).toMatchObject({ appName: 'From The Context' });
  });
});
