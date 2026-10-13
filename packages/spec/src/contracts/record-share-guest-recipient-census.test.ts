// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_record_share`'s `guest` recipient RETIRED (ADR-0138 D8) — the census.
 *
 * The record's row: "remove, on its own card"; the pin it names: "a census
 * showing no stored row carries it". The value was declared in two places —
 * the `recipient_type` select on `SysRecordShare` (`@objectstack/plugin-sharing`)
 * and the contract union `RecordShareRecipientType` here — and honoured by
 * none: `grant()` refused it and no gate reads such a row, because guest access
 * flows through the guest position and share links (ADR-0090 D11).
 *
 * Three legs, one walk:
 *   1. PRODUCERS — no source inside the declared radius writes
 *      `recipient_type` / `recipientType` as `guest` (a seed, a fixture, an
 *      example, a template, a test row, a REST body, a migration). The key is
 *      shared with `sys_sharing_rule`, whose vocabulary retired the same value
 *      earlier (`sharing-rule-recipient-reconcile`), so a hit on either row
 *      kind is a resurrection of a dead value, never a live one.
 *   2. THE SELECT — the `sys_record_share` object's `recipient_type` options,
 *      read from its declaration, do not offer `guest`.
 *   3. THE UNION — `RecordShareRecipientType`'s literal members do not name it
 *      (the compile-time half is `sharing-service.test.ts`'s `@ts-expect-error`).
 *
 * Each leg carries a planted positive control (the matcher finds the value
 * where it is written) and a lit control on the real tree (the matcher finds
 * the LIVE values — `user` producers, the `user` option, the `user` member) so
 * a zero is a measurement, not a matcher that reads nothing.
 *
 * The bound, stated: a value assembled at runtime (`recipient_type: kind`, a
 * spread, a computed key) is invisible to a text walk; `docs/**`, `.claude/**`,
 * `.github/**` and the repo-root files are outside the radius, which is the
 * one declared for `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
/** Under `examples/` the non-code extensions everywhere, and `.ts` under each app's `src/` only — what is declared. */
const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
const EXAMPLES_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);
/** tsup's own bundle of `tsup.config.ts`, written and deleted mid-build. */
const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

/**
 * Structural exclusions, each with its reason. ⛔ NOT an allowlist file: every
 * entry's JOB is to spell the retired value.
 */
const EXCLUDED = new Set([
  // This census plants the value in its positive controls.
  THIS_FILE,
  // The grant door's refusal pin sends `recipientType: 'guest'` on purpose.
  'packages/plugins/plugin-sharing/src/sharing-service.test.ts',
]);
const EXCLUDED_PREFIXES = [
  // Release-owned prose records the removal; never edited by a code PR.
  'content/docs/releases/',
];

/** Leg 1: a key spelling of the recipient type, then `:` (or a lone `=`), then `guest` QUOTED. */
const PRODUCER_CODE = /(?:^|[^\w$])['"]?recipient_?[tT]ype['"]?\s*(?::|=(?![=>]))\s*(['"`])guest\1/g;
/** Leg 1, YAML: a mapping line whose key is the recipient type and whose value is `guest`, quoted or not. */
const PRODUCER_YAML = /^\s*(?:-\s+)?recipient_?[tT]ype\s*:\s*(['"]?)guest\1\s*(?:#.*)?$/gm;

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Extensions read as JS/TS source: their comments are blanked first, since a comment writes no row. */
const CODE_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

const producersIn = (ext: string, raw: string, live = 'guest'): number[] => {
  if (!raw.includes(live)) return [];
  // `maskComments` blanks comment content and keeps offsets and line numbers.
  const text = CODE_EXT.has(ext) ? maskComments(raw) : raw;
  const out: number[] = [];
  const code = new RegExp(PRODUCER_CODE.source.replace('guest', live), 'g');
  for (let m = code.exec(text); m; m = code.exec(text)) out.push(lineOf(text, m.index));
  if (ext === '.yaml' || ext === '.yml' || ext === '.md' || ext === '.mdx') {
    const yaml = new RegExp(PRODUCER_YAML.source.replace('guest', live), 'gm');
    for (let m = yaml.exec(text); m; m = yaml.exec(text)) out.push(lineOf(text, m.index));
  }
  return [...new Set(out)].sort((a, b) => a - b);
};

/** The string literals inside the bracketed span that starts at `open`, in comment-masked source. */
const literalsInBrackets = (text: string, open: number): string[] => {
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [];
  return [...text.slice(open + 1, end).matchAll(/(['"`])([^'"`]*)\1/g)].map((m) => m[2]!);
};

/** Leg 2: the options of the `recipient_type` select in a file that declares `sys_record_share`, or `null`. */
const recordShareSelectOptions = (raw: string): string[] | null => {
  const text = maskComments(raw);
  if (!/name:\s*['"]sys_record_share['"]/.test(text)) return null;
  const at = text.search(/recipient_type\s*:\s*Field\.select\(/);
  if (at < 0) return null;
  const open = text.indexOf('[', at);
  return open < 0 ? null : literalsInBrackets(text, open);
};

/** Leg 3: the literal members of `RecordShareRecipientType`, or `null` when the file does not declare it. */
const unionMembers = (raw: string): string[] | null => {
  const m = /export\s+type\s+RecordShareRecipientType\s*=([^;]*);/.exec(maskComments(raw));
  if (!m) return null;
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
};

describe('record-share guest recipient census — the matchers can see the value (planted positive controls)', () => {
  it('leg 1 finds a producer in each spelling the walk reads, and ignores the neighbours', () => {
    expect(producersIn('.ts', "insert('sys_record_share', [{ id: 's', recipient_type: 'guest', recipient_id: 'x' }])")).toEqual([1]);
    expect(producersIn('.ts', "svc.grant({ object: 'a', recordId: 'r',\n  recipientType: \"guest\" })")).toEqual([2]);
    expect(producersIn('.ts', "const input = {};\ninput.recipientType = 'guest';")).toEqual([2]);
    expect(producersIn('.json', '{ "records": [ { "recipient_type": "guest" } ] }')).toEqual([1]);
    expect(producersIn('.yaml', 'records:\n  - recipient_type: guest\n    recipient_id: x\n')).toEqual([2]);
    expect(producersIn('.md', "Seed:\n\n```ts\n({ recipient_type: 'guest' });\n```\n")).toEqual([4]);
    // Neighbours that must NOT match: a comparison (a reader), another key,
    // the anchor vocabulary, a different value, and prose naming the word.
    expect(producersIn('.ts', "if (row.recipient_type === 'guest') return;")).toEqual([]);
    expect(producersIn('.ts', "({ anchor: 'guest', principalKind: 'guest', type: 'guest' })")).toEqual([]);
    expect(producersIn('.ts', "({ recipient_type: 'guest_portal' })")).toEqual([]);
    expect(producersIn('.md', 'The guest recipient type was removed.')).toEqual([]);
    // A comment writes no row; the same words in a string literal do.
    expect(producersIn('.ts', "// once: recipient_type: 'guest'\nconst x = 1;")).toEqual([]);
  });

  it('leg 2 reads the options of the record-share select, and finds a planted guest option', () => {
    const planted = "ObjectSchema.create({ name: 'sys_record_share', fields: {\n"
      + "  recipient_type: Field.select(\n    // a comment naming 'nothing'\n    ['user', 'guest'],\n    { label: 'x' },\n  ),\n} })";
    expect(recordShareSelectOptions(planted)).toEqual(['user', 'guest']);
    // Another object's `recipient_type` select is not this object's.
    expect(recordShareSelectOptions("ObjectSchema.create({ name: 'sys_sharing_rule', fields: { recipient_type: Field.select(['user', 'guest']) } })")).toBeNull();
  });

  it('leg 3 reads the union members, and finds a planted guest member', () => {
    expect(unionMembers("export type RecordShareRecipientType =\n  | 'user'\n  | 'guest';")).toEqual(['user', 'guest']);
    expect(unionMembers("export type SharingRuleRecipientType = 'user' | 'guest';")).toBeNull();
    // A member named only in a comment is not a member.
    expect(unionMembers("export type RecordShareRecipientType =\n  | 'user'\n  // | 'guest'\n  ;")).toEqual(['user']);
  });
});

describe('record-share guest recipient census — nothing inside the declared radius carries it', () => {
  it('no producer writes it, the select does not offer it, the union does not name it', () => {
    const producers: string[] = [];
    const liveProducers: string[] = [];
    const selects: { rel: string; options: string[] }[] = [];
    const unions: { rel: string; members: string[] }[] = [];
    let visited = 0;
    let recordShareFiles = 0;

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        const declared = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLES_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!declared) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        let text: string;
        try {
          text = fs.readFileSync(full, 'utf-8');
        } catch (err) {
          // Tolerate ONLY a path that vanished mid-walk (a concurrent build).
          if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
          throw err;
        }
        visited += 1;
        if (text.includes('sys_record_share')) recordShareFiles += 1;
        for (const line of producersIn(ext, text)) producers.push(`${rel}:${line}`);
        for (const line of producersIn(ext, text, 'user')) liveProducers.push(`${rel}:${line}`);
        if (ext === '.ts') {
          const options = recordShareSelectOptions(text);
          if (options) selects.push({ rel, options });
          const members = unionMembers(text);
          if (members) unions.push({ rel, members });
        }
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));

    // Lit controls: the walk covered the tree, it read the files that hold
    // record shares, and the producer matcher finds the LIVE value at scale.
    expect(visited).toBeGreaterThan(1000);
    expect(recordShareFiles).toBeGreaterThan(20);
    expect(liveProducers.length).toBeGreaterThan(20);
    // Leg 1.
    expect(producers, 'a recipient_type / recipientType written as guest is a share no gate honours (ADR-0138 D8)').toEqual([]);
    // Leg 2: exactly one declaration, which the matcher really read (`user` is there).
    expect(selects.map((s) => s.rel)).toEqual(['packages/plugins/plugin-sharing/src/objects/sys-record-share.object.ts']);
    expect(selects[0]!.options).toContain('user');
    expect(selects[0]!.options).not.toContain('guest');
    // Leg 3: exactly one declaration, likewise lit.
    expect(unions.map((u) => u.rel)).toEqual(['packages/spec/src/contracts/sharing-service.ts']);
    expect(unions[0]!.members).toContain('user');
    expect(unions[0]!.members).not.toContain('guest');
  });
});
