// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objectstack serve`'s AuditPlugin registration — the facts the #9863 ruling
// rests on, mechanised.
//
// ## The question, and the answer
//
// #9863 asked whether `os serve` should grow an `appAuditPluginOptions(config)`
// helper mirroring the `appSecurityPluginOptions(config)` sibling six lines
// above it, so that record-view auditing (`AuditPluginOptions.readAudit`) could
// be turned on from `objectstack.config.ts` — rather than only by an app
// putting its OWN configured `new AuditPlugin({ readAudit: … })` in the stack's
// `plugins` array, where it supersedes the CLI's option-less instance under the
// declared last-one-wins registration contract (#9864, maintainer ruling
// 2026-08-19, option B).
//
// Ruled NO, on four measurements — the reasoning lives at the registration site
// in `serve.ts` and in #9863's ruling comment; what lives HERE is the part that
// has to keep being true:
//
//   1. The CLI constructs `AuditPlugin` exactly once, with NO options. That is
//      the ruling itself. Re-opening it means editing this file deliberately,
//      not discovering later that the shape drifted.
//   2. That construction sits inside the auth-gated pair block and ABOVE the
//      stack `plugins` loop. The ORDER is load-bearing and was, until this file,
//      asserted by nothing: invert it and the CLI's option-less instance
//      supersedes the app's configured one, silently turning record-view
//      auditing back OFF for every deployment that had opted in. Nothing else
//      in the repo goes red on that edit.
//   3. `@objectstack/verify`'s `bootStack` constructs no `AuditPlugin` at all.
//      This is why the #7001 argument for the security helper does not transfer:
//      that helper exists because TWO boot paths both built a `SecurityPlugin`
//      and silently disagreed about its options. Audit has exactly one boot path
//      with an opinion, so there is no disagreement for a shared helper to close
//      — and `@objectstack/verify` does not even depend on
//      `@objectstack/plugin-audit` (see its package.json), so it cannot grow one
//      by accident. If that changes, the ruling's basis changes with it, and
//      this assertion is what says so.
//
// ## Why a source scan rather than a boot
//
// Same reason as this directory's `serve-verify-security-parity.contract.test.ts`
// and `serve-email-config-parity.contract.test.ts`: the failure mode is an EDIT
// to these files, and every one of the three facts above is invisible to a
// behavioural test. `serve.ts`'s audit block is reachable only from a live
// `objectstack serve` boot with `@objectstack/plugin-auth` and
// `@objectstack/plugin-audit` installed, an auth secret set and no app-supplied
// AuthPlugin; a unit test that got there would be testing the fixture. The grep
// that WOULD have caught each edit, mechanised, is the honest instrument.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The separator (#9367) is a plain `.mjs`, but it ships a hand-written `.d.mts`
// declaration alongside it (#10398), so this import is typed and needs no
// suppression. A `@ts-expect-error` here is an UNUSED directive, and cli's tsc
// program does include this file, so tsc fails the build on one.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * `packages/cli/src/commands/` → `packages/`. Reading verify's harness from
 * here is what makes fact 3 an assertion instead of a comment;
 * `@objectstack/verify` is a real dependency of this package and the read is
 * test-only (tests never ship — `files: ["dist"]`). The glob is already declared
 * for `@objectstack/cli` by `pnpm check:cross-package-test-inputs`, and hashed
 * by `@objectstack/cli#test` in turbo.json, for the sibling parity scan; this
 * file adds a second reader of the same path, not a new radius.
 *
 * That gate is named by its runnable script rather than by its file path on
 * purpose. Its literal collector takes any quoted path without parsing, so
 * spelling the path here — in prose, about a file this test never opens — would
 * demand a declaration for it and put cli's whole suite on every edit of the
 * gate. The reads this scan really makes are the two below.
 */
const PACKAGES_DIR = path.resolve(HERE, '../../..');

/**
 * Absence must be loud (AGENTS.md, Route & surface ownership §3). A scan that
 * reports success because it could not find its subject is worse than no scan:
 * every assertion below is of the form "this shape is present / is not present",
 * and an empty string satisfies half of them for free.
 */
function readBootPath(relative: string): string {
  const full = path.join(PACKAGES_DIR, relative);
  try {
    return readFileSync(full, 'utf8');
  } catch (e) {
    throw new Error(
      `#9863 audit-registration scan cannot read its subject '${relative}' (looked at ${full}). ` +
        'The file moved or was renamed — repoint this scan; do NOT delete it. The ruling it pins ' +
        `is still in force. (${(e as Error).message})`,
    );
  }
}

/**
 * Comments MASKED, because this scan is about what the two files DO.
 *
 * Not optional here, and not caution copied from the sibling scans: `serve.ts`'s
 * audit block DESCRIBES the very construction being counted — it spells
 * `new AuditPlugin({ readAudit: … })` in prose to explain the app-side opt-in it
 * documents, and it names the helper by name to record that the helper was ruled
 * against. Over raw text this file would count two constructions where the code
 * has one, and its own ruling assertion would fail on the sentence stating the
 * ruling.
 *
 * ## Why the SHARED masker rather than a private `stripComments`
 *
 * Because the private ones are a measured defect class here (#9367), and this
 * file walked straight into it. Its first draft used the two-regex strip the two
 * older scans in this directory still carry, block pass first — and `serve.ts`
 * has a route wildcard in a line comment (`/api/v1/auth/*` in the `5d.` header).
 * A regex cannot tell that `/*` from a real opener, so it ran a phantom block
 * comment to the next real terminator ten lines below, inside
 * `import(/* webpackIgnore: true *\/ …)`, deleting the `hasAuthPlugin`
 * computation and the auth gate this file measures against. Measured on this
 * exact pair: the naive strip keeps 1895 code-bearing lines of `serve.ts`, the
 * masker keeps 2098.
 *
 * `maskComments` also BLANKS rather than deletes — spans become spaces, newlines
 * kept — so the offsets the ordering assertion below compares are offsets into
 * the real file rather than into a shrunken copy of it. Cross-checked on both
 * subjects: masker and naive-strip agree on all four anchor counts, and the
 * masker leaves the line count identical (4638 → 4638), which is the property
 * being bought.
 *
 * #10427 (open) has the masker desyncing on nested template literals in 16
 * files. Neither file read here is among them, and the cross-check above is what
 * says so rather than assuming it.
 */

const SERVE = maskComments(readBootPath('cli/src/commands/serve.ts'));
const HARNESS = maskComments(readBootPath('verify/src/harness.ts'));

/**
 * Every `new AuditPlugin(...)` construction in a file, with its argument text.
 *
 * Walks parentheses rather than matching `\(([^)]*)\)`, for the reason the
 * sibling parity scan measured: an options argument is itself brace- and
 * paren-bearing (`appAuditPluginOptions(config)`, `{ readAudit: { objects: [] } }`),
 * and a non-nesting match stops at the first inner `)` and silently reports a
 * truncation. The empty-argument case this file asserts today would be reported
 * identically by both forms, which is exactly how a scan that cannot read the
 * shape it guards passes until the day it matters.
 */
function auditPluginConstructions(source: string): string[] {
  const NEW = 'new AuditPlugin(';
  const found: string[] = [];
  for (let i = source.indexOf(NEW); i !== -1; i = source.indexOf(NEW, i + 1)) {
    let depth = 1;
    let j = i + NEW.length;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
    }
    if (depth !== 0) throw new Error(`unbalanced \`${NEW}…\` at offset ${i} — the scan cannot read this file`);
    found.push(source.slice(i + NEW.length, j - 1).trim());
  }
  return found;
}

/**
 * The offset of an anchor that must appear exactly once. Both "missing" and
 * "appeared twice" are reported as failures rather than folded into an offset
 * comparison, because an ordering assertion between two anchors is meaningless
 * if either is ambiguous — and a duplicated anchor is how a refactor most
 * plausibly arrives.
 */
function soleOffset(source: string, anchor: string, role: string): number {
  const first = source.indexOf(anchor);
  if (first === -1) {
    throw new Error(
      `#9863 audit-registration scan: the ${role} anchor \`${anchor}\` is gone from serve.ts. ` +
        'It was the landmark this scan measured the AuditPlugin registration against. ' +
        'Repoint the anchor at whatever replaced it — the invariant (the CLI registration ' +
        'stays inside the auth-gated pair block and ABOVE the stack `plugins` loop) is unchanged.',
    );
  }
  if (source.indexOf(anchor, first + 1) !== -1) {
    throw new Error(
      `#9863 audit-registration scan: the ${role} anchor \`${anchor}\` now appears more than once ` +
        'in serve.ts, so "before" and "after" no longer name one place. Give this scan an ' +
        'unambiguous landmark before trusting its verdict.',
    );
  }
  return first;
}

/** The `if (!hasAuthPlugin && tierEnabled('auth'))` block the audit pair lives in. */
const AUTH_GATE = "if (!hasAuthPlugin && tierEnabled('auth'))";
/** The stack `plugins` loop, i.e. where an app's own configured instance is registered. */
const PLUGINS_LOOP = 'for (const plugin of plugins)';

describe('os serve registers AuditPlugin bare, above the stack `plugins` loop (#9863)', () => {
  it('constructs AuditPlugin exactly once, with NO options — the ruling', () => {
    // The empty string is the whole point: `[]` would mean "never constructed"
    // and `['appAuditPluginOptions(config)']` would mean the ruling was reversed.
    expect(auditPluginConstructions(SERVE)).toEqual(['']);
  });

  it('does not reach for a config-derived audit options helper', () => {
    // Re-opening #9863 is allowed; doing it by accident is not. A helper wired
    // in HERE would take effect only when the app supplies no AuthPlugin of its
    // own and an auth secret is set (see the gate below) — a declared config key
    // whose effect depends on unrelated auth conditions, on a compliance
    // surface. If the ruling is revisited, the capability resolver's
    // `CAPABILITY_PROVIDERS.audit` entry — which is NOT auth-gated and already
    // carries the `configKey` mechanism `analytics` uses — is the site to argue
    // about, and this assertion moves in the same edit as the ruling.
    expect(SERVE).not.toContain('appAuditPluginOptions');
  });

  it('registers inside the auth-gated pair block and ABOVE the stack `plugins` loop', () => {
    const gate = soleOffset(SERVE, AUTH_GATE, 'auth-gate');
    const loop = soleOffset(SERVE, PLUGINS_LOOP, 'stack-plugins-loop');
    const audit = soleOffset(SERVE, 'new AuditPlugin(', 'audit-construction');

    // ABOVE the loop: the half `serve.ts` calls load-bearing. Below it, the
    // CLI's option-less instance would supersede the app's configured one and
    // record-view auditing would be off wherever it had been opted in.
    expect(audit).toBeLessThan(loop);

    // INSIDE the auth block: the half nothing had written down. The pair is
    // registered by the `5d. Auto-register AuthPlugin (and paired
    // Security/Audit)` branch, so an app that supplies its own AuthPlugin — or
    // a production boot with no auth secret — gets NO CLI AuditPlugin, and the
    // supersede this card is named after never happens there at all. Hoisting
    // the registration out of the block is a real change of meaning, not a
    // tidy-up, and it is exactly the edit an offset comparison against the gate
    // catches.
    expect(audit).toBeGreaterThan(gate);
  });

  it("verify's bootStack has no AuditPlugin opinion — no #7001-shaped disagreement to close", () => {
    expect(auditPluginConstructions(HARNESS)).toEqual([]);
  });
});
