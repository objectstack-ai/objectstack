// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for how the reference-docs generator escapes `{…}` / `<…>` inside
 * `.describe()` prose — #5452.
 *
 * The escaper wrapped a delimited fragment in an inline-code span, but found
 * its closing partner with `indexOf`, i.e. the FIRST closer rather than the
 * MATCHING one. Nested delimiters are not an exotic input here — `{{var}}` is
 * the template-interpolation syntax the spec's own prose *teaches*, and a
 * filter map (`{ status: { $in: [...] } }`) is an ordinary example — so the
 * wrap ended at the inner `}` and the outer one fell outside the span:
 * `{{var}}` was published as `` `{{var}` `` plus a stray `}`.
 *
 * The issue counted three sites (`grep -rn '`{{' content/docs/references/`).
 * The corpus gate below counts FIVE, because that grep only sees the fragments
 * whose nesting starts at character one; `ai/solution-blueprint.mdx` and
 * `api/analytics.mdx` were cut in exactly the same place with a single leading
 * brace, and no grep for `` `{{ `` could have found them.
 *
 * MEASURED (reverse verification), both directions run:
 *   - restoring the old matcher (`raw.indexOf(close, i + 1)` in place of
 *     `findMatchingClose`) turns all five nested-delimiter unit cases red
 *     (`5 failed | 7 passed`), each reporting the split shape;
 *   - and, after re-running `gen:docs` over the restored escaper, the corpus
 *     gate goes red with 5 offenders — the same 5 that were on `main`.
 * The direction is the ordinary one (restore the defect → the new pins go red)
 * because these assert a POSITIVE output shape the fix produces, not the
 * absence of a finding. The single-delimiter and unmatched cases stay green
 * either way, which is exactly why the bug survived: the escaper was correct
 * on every shape anyone had thought to look at.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

import { describe, expect, it } from 'vitest';

import { escapeMdxDescription } from './lib/escape-mdx';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const REFERENCES = path.join(REPO, 'content/docs/references');

describe('escapeMdxDescription — nested delimiters (#5452)', () => {
  it('wraps `{{var}}` whole, leaving no stray closer outside the span', () => {
    expect(escapeMdxDescription('System prompt — supports {{var}} interpolation')).toBe(
      'System prompt — supports `{{var}}` interpolation',
    );
  });

  it('wraps a doubled brace inside parentheses (the automation/flow.mdx specimen)', () => {
    expect(
      escapeMdxDescription(
        'Downstream nodes read prior outputs via expressions ({{nodeId.field}}) regardless.',
      ),
    ).toBe('Downstream nodes read prior outputs via expressions (`{{nodeId.field}}`) regardless.');
  });

  it('wraps a singly-nested filter map whole (the ai/solution-blueprint.mdx specimen)', () => {
    // The variant `grep '`{{'` could not see: nesting that starts one char in.
    expect(escapeMdxDescription('e.g. { status: { $in: ["received"] } }.')).toBe(
      'e.g. `{ status: { $in: ["received"] } }`.',
    );
  });

  it('wraps nested angle delimiters whole', () => {
    // The span opens at the delimiter, not at the identifier in front of it —
    // pre-existing behaviour, and MDX-safe either way. What #5452 changes is
    // that BOTH closing `>` land inside the span instead of one leaking out.
    expect(escapeMdxDescription('Shaped as Array<Record<string, any>> at rest')).toBe(
      'Shaped as Array`<Record<string, any>>` at rest',
    );
  });

  it('wraps each of two independent doubled pairs on one line', () => {
    expect(escapeMdxDescription('render {{a.b}} then {{c}} here')).toBe(
      'render `{{a.b}}` then `{{c}}` here',
    );
  });
});

describe('escapeMdxDescription — shapes the fix must not disturb', () => {
  it('still wraps a single `{…}` pair', () => {
    expect(escapeMdxDescription('a {token} b')).toBe('a `{token}` b');
  });

  it('still wraps a `{<id>}` nest in ONE span (no inner backticks)', () => {
    expect(escapeMdxDescription('path {<id>} here')).toBe('path `{<id>}` here');
  });

  it('still entity-escapes a lone `<` with no partner (SemVer range)', () => {
    expect(escapeMdxDescription('supports >=4.0 <5 only')).toBe('supports >=4.0 &lt;5 only');
  });

  it('still entity-escapes a lone `{` with no partner', () => {
    expect(escapeMdxDescription('an unclosed { here')).toBe('an unclosed &#123; here');
  });

  it('still leaves fragments already inside an inline-code span untouched', () => {
    expect(escapeMdxDescription('see `{{var}}` above')).toBe('see `{{var}}` above');
  });
});

/**
 * Corpus gate over the generator's committed OUTPUT.
 *
 * The invariant is brace BALANCE inside an inline-code span, not the literal
 * `` `{{ ``-plus-stray-`}` string the issue grepped for. Balance is what the
 * defect actually violates — the wrap cut a pair in half — so it catches the
 * two sites whose nesting did not start at character one, and it keeps
 * catching them when the offending prose is reworded.
 *
 * Angle delimiters deliberately get NO corpus gate: `<`/`>` are also the
 * comparison operators, and validation-rule / SemVer examples legitimately
 * carry an unbalanced one inside a code span (`record.amount < 0`,
 * `>=1.2.3`) — 11 such spans, all correct. Nesting for angles is pinned by
 * the positive unit case above instead. Backslash-escaped delimiters are not
 * delimiters and are dropped before counting; that strip no longer has
 * anything to do in a span (#5553 stopped the module-JSDoc path escaping
 * braces inside code, where the backslash was content rather than an escape)
 * but it still guards the invariant against a future path that does.
 *
 * A span is extracted per PARAGRAPH, not per line. It used to be per line,
 * which was only ever right by accident: the module-JSDoc path made every
 * source line its own paragraph, so no span could span lines. #5553 restored
 * that layout, and a span may now wrap — `automation/flow-function` opens one
 * on one line and closes it on the next. Splitting per line saw the opening
 * half alone (`` `update_record fields: {` ``) and read a wrapped span as an
 * unbalanced one. A blank line is still a hard boundary, since a code span
 * cannot cross one, so the paragraph is the correct unit — and #5452's own
 * defect, a pair cut in half WITHIN one line, is reported exactly as before.
 */
describe('published reference pages keep inline-code braces balanced (#5452)', () => {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mdx')) pages.push(full);
    }
  };
  walk(REFERENCES);

  it('finds the generated reference corpus', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it('has no inline-code span with an unbalanced brace', () => {
    const offenders: string[] = [];
    for (const file of pages) {
      const rel = path.relative(REPO, file);
      // Fenced blocks are not inline code and their braces are not ours to
      // balance, so blank them before the paragraphs are cut.
      let fenced = false;
      const prose = fs.readFileSync(file, 'utf-8').split('\n').map(line => {
        if (/^\s*(?:`{3,}|~{3,})/.test(line)) { fenced = !fenced; return ''; }
        return fenced ? '' : line;
      });

      let buffer: string[] = [];
      let start = 0;
      const check = () => {
        if (!buffer.length) return;
        // Odd segments of a backtick split are the inline-code spans.
        const segments = buffer.join('\n').split('`');
        for (let i = 1; i < segments.length; i += 2) {
          const span = segments[i].replace(/\\[{}]/g, '');
          const opens = span.split('{').length - 1;
          const closes = span.split('}').length - 1;
          if (opens !== closes) offenders.push(`${rel}:${start + 1}  \`${segments[i]}\``);
        }
        buffer = [];
      };
      prose.forEach((line, index) => {
        if (line.trim() === '') { check(); return; }
        if (!buffer.length) start = index;
        buffer.push(line);
      });
      check();
    }
    expect(offenders).toEqual([]);
  });
});
