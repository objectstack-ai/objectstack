#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-org-identifier -- keeps author-facing reference code on the blessed
// org name in hook/action bodies.
//
// #3280 made `organizationId` the blessed developer-facing name for the
// caller's active org across the JS authoring surface: a hook or action body
// reads `ctx.user.organizationId` / `ctx.session.organizationId`, matching the
// `organization_id` column and `current_user.organizationId` in RLS. The old
// `ctx.session.tenantId` was a deprecated alias; #3290 REMOVED it from the
// hook/action `ctx.session` surface entirely (v11 major), so any `session.tenantId`
// read in an authoring body now resolves to `undefined` and is simply a bug.
//
// This is a hard-fail guard, not a ratchet: the scanned surfaces carry ZERO
// occurrences today, so any match is a NEW one and fails. It is deliberately
// NARROW:
//   • Scope is author-facing reference code: examples/, apps/, AND packages/
//     (#3290). The framework's own hook/action surface no longer emits or reads
//     `session.tenantId` (engine `buildSession`, the record-change trigger, and
//     the ObjectQL audit-stamp plugin were migrated to `organizationId`), so
//     packages/ is now held to the same bar as reference apps -- an author or AI
//     copying a package example body will not find the removed name.
//   • The generic DRIVER-LAYER tenancy knob is untouched and never matched: the
//     pattern anchors on the `session` receiver, so `execCtx.tenantId` /
//     `opts.tenantId` / `DriverOptions.tenantId` (a configurable isolation
//     column, legitimately an *environment* id in database-per-tenant kernels)
//     do not trip it. For the rare genuine driver-layer `session.tenantId`, add
//     an `os-allow-tenant-id` comment on the same line.
//   • Test/spec files are EXCLUDED: they legitimately reference the removed
//     token to assert its ABSENCE (`expect(session.tenantId).toBeUndefined()`),
//     and are not reference bodies an author copies a hook from.
//   • Comments are SKIPPED -- a migration note that NAMES the removed alias to
//     explain its removal is documentation, not an executable read. Which spans
//     ARE comments is decided by the ONE shared string-, template- and regex-
//     aware scanner (`scripts/js-comment-mask.mjs`, #9367), not by this gate.
//   • skills/ and content/docs/ are EXCLUDED: prose there may still name the
//     removed alias when documenting the migration.
//
//   node scripts/check-org-identifier.mjs
//   node scripts/check-org-identifier.mjs --self-test
//
// Scope: tracked sources under examples/, apps/, and packages/ (git ls-files).
//
// ## Why the comment split is not this gate's own business (#9444)
//
// This gate used to answer "comment or code?" per line, with a `trimmed`
// `startsWith` triple and then
//
//     const code = line.replace(/\/\/.*$/, '');
//
// which truncates at the FIRST doubled slash on the line, whatever that slash
// is. A URL or any slash-bearing string literal therefore deleted the rest of
// its own line -- including the very `session.tenantId` read this gate exists
// to catch. Silent under-reporting: the gate printed OK over a line it had
// truncated, the failure direction AGENTS.md calls worse than no verifier.
//
// It was wrong in the MIRROR direction too, which the card did not name. Only a
// line whose first non-space characters were `*`, `//` or `/*` counted as a
// comment, so an interior line of a block comment (`/*` on one line, prose with
// no leading `*` on the next) and a trailing `/* … */` on a code line both read
// as live code: the gate would have MANUFACTURED a finding out of prose. Both
// directions are gone with one shared mask, and both are pinned in `--self-test`.
//
// ## LIVE or LATENT, measured on 51a46a440's successor (af2a989be)
//
// Corpus: 2051 author-facing source files. Projections (this gate's old strip
// vs `maskComments`) disagree on the text of **271** files, but the gate's
// VERDICT changes on **0** -- every one of the 10 corpus lines that names
// `session.tenantId` today is inside a comment, and old and new agree on all
// ten. So the defect is LATENT here, and structurally so: this is a hard-fail
// ZERO-occurrence guard, so a corpus that contains the hazard is a corpus in
// which the gate is already red. The intersection the card asks for can only
// ever be empty while the gate is green; the measurement that means something
// is the NEAR MISS, and that half is everywhere -- **665 lines across 181
// files** carry a doubled slash inside a string, template or regex literal.
// The day one of them also carries the removed read, the old gate goes quiet.
//
// ## Why `maskComments` and not `stripComments`
//
// This gate reports a FILE and a LINE, so it takes the blanking projection: the
// masked text stays byte-for-byte aligned with the source and line `i` is still
// line `i`. Cost measured over the same 2051 files (best of 3, scan + match
// only): old per-line strip 195ms, `maskComments` 2088ms, `stripComments`
// 1275ms. #9367 measured a 51x cliff (6.4s -> 5m27s) when a LAZY `[\s\S]*?`
// matcher was dragged across the whitespace blanking leaves behind; this gate's
// matcher is a short anchored pattern run per line, so it is not exposed to
// that, and ~2s is the scanner's own linear cost over 29MB.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskComments } from './js-comment-mask.mjs';

const ROOTS = ['examples', 'apps', 'packages'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cts', '.mts'];
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo)\//;
// Tests assert the alias is GONE, so they reference the token on purpose.
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)/;

// `ctx.session.tenantId`, `session?.tenantId`, `this.session . tenantId`, … --
// the `session` receiver immediately before `.tenantId`. Anchored on the
// `session` word so `execCtx.tenantId` / `opts.tenantId` never match.
const PATTERN = /\bsession\s*\??\.\s*tenantId\b/;
const ALLOW_MARKER = 'os-allow-tenant-id';

/**
 * Every removed-alias read in one source, as `{ file, line, text }`.
 *
 * The comment/code split comes from `maskComments`, once per file, and the
 * masked text is index-aligned with the raw text, so a finding still quotes the
 * RAW line the author will open.
 *
 * The waiver is read from the RAW line ON PURPOSE. It is documented as a
 * comment on the offending line, and the mask blanks comments -- testing the
 * masked line for it would silently revoke every waiver in the tree, which is
 * the sort of change a green run cannot show you.
 */
export function findOffenders(text, file) {
  const lines = text.split('\n');
  const code = maskComments(text).split('\n');
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    if (!PATTERN.test(code[i] ?? '')) continue;
    offenders.push({ file, line: i + 1, text: line.trim() });
  }
  return offenders;
}

/**
 * The shapes, not the corpus.
 *
 * A green run over today's tree proves only that today's tree lacks the shape,
 * and for a zero-occurrence hard-fail guard it can prove nothing else -- so
 * these cases ARE this gate's contract. `BLIND` marks a case the pre-#9444 strip
 * got wrong by MISSING a real read; `FABRICATE` marks one it got wrong by
 * inventing a finding out of prose.
 */
function selfTest() {
  const BT = String.fromCharCode(96); // backtick, kept out of the literals below
  const cases = [
    // [source, expected offender count, label]
    ["  const docs = 'https://objectstack.ai/x'; return session.tenantId;", 1,
      'BLIND: a URL in a string hid the read behind it (#9444)'],
    ['  const glob = ' + "'packages//src'" + '; const t = ctx.session.tenantId;', 1,
      'BLIND: a bare doubled slash inside a string'],
    ["  const p = /https:\\/\\//; return session.tenantId;", 1,
      'BLIND: a regex literal whose escaped slashes read as a comment opener'],
    ['  const hint = ' + BT + 'see https://x/y' + BT + '; return session?.tenantId;', 1,
      'BLIND: the same shape inside a template literal'],
    ['/*\n a block comment interior line naming session.tenantId\n*/\nconst ok = 1;', 0,
      'FABRICATE: an interior comment line with no leading star'],
    ['doThing(); /* session.tenantId was removed in v11 */', 0,
      'FABRICATE: a trailing block comment on a code line'],
    ['const org = ctx.user.organizationId; // session.tenantId is gone (#3290)', 0,
      'a trailing line comment naming the alias is documentation'],
    ['// the deprecated session.tenantId alias was removed in v11', 0,
      'a whole-line comment is documentation'],
    ['/**\n * the deprecated session.tenantId alias was removed in v11\n */\nconst ok = 1;', 0,
      'a JSDoc continuation line inside a real docblock is documentation'],
    ['const t = ctx.session.tenantId; // os-allow-tenant-id: driver isolation column', 0,
      'the waiver marker still exempts the line'],
    ['const t = execCtx.tenantId ?? opts.tenantId;', 0,
      'the driver-layer tenancy knob is never matched'],
    ['const t = this.session . tenantId;', 1,
      'whitespace between the receiver and the property'],
    ['/** doc naming session.tenantId */\nreturn session.tenantId;', 1,
      'a docblock does not swallow the code line under it'],
    ['const sample = ' + BT + 'ctx.session.tenantId' + BT + ';', 1,
      'a string is not a comment: an authoring sample teaching the removed alias is a finding'],
  ];

  let failed = 0;
  for (const [src, want, label] of cases) {
    const got = findOffenders(src, 'self-test.ts').length;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": expected ${want} offender(s), got ${got}`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\n✗ check-org-identifier self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-org-identifier self-test: ${cases.length} cases pass.`);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  // Newline-delimited on purpose (not `-z`): tracked paths under these roots
  // never contain a newline, and avoiding the NUL delimiter keeps this very
  // script free of any raw NUL byte (which would make it invisible to grep -- the
  // exact #3127 failure mode this repo already guards with check:nul-bytes).
  const files = execFileSync('git', ['ls-files', '--', ...ROOTS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)))
    .filter((f) => !EXCLUDED.test(f))
    .filter((f) => !TEST_FILE.test(f));

  const offenders = [];
  for (const file of files) {
    offenders.push(...findOffenders(readFileSync(join(root, file), 'utf8'), file));
  }

  if (offenders.length === 0) {
    console.log(
      `check-org-identifier: OK (${files.length} author-facing source file(s), no removed session.tenantId alias).`,
    );
    process.exit(0);
  }

  const plural = offenders.length === 1 ? 'occurrence' : 'occurrences';
  console.error(
    `check-org-identifier: ${offenders.length} removed \`session.tenantId\` ${plural} in author-facing code\n`,
  );
  for (const o of offenders) {
    console.error(`  • ${o.file}:${o.line}  ${o.text}`);
  }
  console.error(`
\`session.tenantId\` was REMOVED from the hook/action ctx.session surface (#3290);
it no longer carries a value. In a hook or action body read the caller's active
org under the blessed name instead:

    const org = ctx.user?.organizationId ?? ctx.session?.organizationId;

It matches the \`organization_id\` column and \`current_user.organizationId\` in
RLS. For a genuine driver-layer use (a configurable isolation column, not the
caller's org), add an \`${ALLOW_MARKER}\` comment on the line.`);
  process.exit(1);
}

main();
