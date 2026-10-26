import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helpers. Their types are INFERRED from the .mjs sources by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import { closesFence, openFence, selfTest } from '../markdown-fence-scan.mjs';
import { maskComments } from '../js-comment-mask.mjs';
import { scanFences } from '../check-doc-expression-carriage.mjs';
import { scanDocs } from '../check-doc-component-types.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * ObjectUI — the fence-opening predicate has ONE authority (objectui#9194)
 *
 * ## The defect
 *
 * `check-doc-component-types.mjs` and `check-doc-expression-carriage.mjs` each
 * carried the same opening-fence predicate, verbatim, and the same wrong answer
 * with it: `(\S*)` greedy over non-space read a FOUR-backtick opener as a
 * three-backtick opener in a language named with a leading backtick. The
 * nesting then inverted — the four-backtick line opened, the real inner opener
 * closed, and the code between them was read as prose by both gates while the
 * per-language census grew a column for a language that does not exist and the
 * coverage figures counted two empty non-fences as successfully parsed.
 *
 * ## What this file pins, in the order the failures would arrive
 *
 *  1. **The rule**, on the module that now owns it — CommonMark's: a run of
 *     three or more opens, and only a run of the same character that is at least
 *     as long closes.
 *  2. **The shape, not the instance** — an ODD number of stray four-backtick
 *     markers is what desynchronises pairing for the rest of a file. The fixture
 *     below carries exactly one, and both gates are driven over it. Pinning only
 *     the even-count page that this card was filed for would pin the accident,
 *     not the hazard.
 *  3. **The corpus invariant** — no fence language on either gate's real scan
 *     surface may carry a backtick.
 *  4. **The recurrence guard** — neither gate may grow a private fence
 *     predicate again. That is the half the card's own closing sentence asks
 *     for: two copies that are separately correct today are two copies that
 *     drift silently tomorrow, and a fix applied to one can leave the other
 *     behind.
 */
describe('markdown fence scanning has one authority (objectui#9194)', () => {
  it('passes its own controls', () => {
    expect(selfTest()).toEqual([]);
  });

  describe('the CommonMark run rule', () => {
    it('reads the real language off a four-backtick opener', () => {
      expect(openFence('````markdown')).toMatchObject({ marker: '`', run: 4, lang: 'markdown' });
    });

    it('does not let a shorter run close a longer fence', () => {
      const outer = openFence('````markdown')!;
      expect(closesFence('```javascript', outer)).toBe(false);
      expect(closesFence('```', outer)).toBe(false);
      expect(closesFence('````', outer)).toBe(true);
    });

    it('lets a longer run close a shorter fence', () => {
      const inner = openFence('```json')!;
      expect(closesFence('````', inner)).toBe(true);
      expect(closesFence('`````', inner)).toBe(true);
    });

    it('never produces a language carrying a backtick — the error is unrepresentable', () => {
      // The greedy capture this replaced would answer '`markdown' here. There is
      // no spelling of a backtick fence whose captured language holds a backtick:
      // the run is consumed greedily, and an info string containing one is not an
      // opener at all (CommonMark).
      for (const line of ['```markdown', '````markdown', '`````markdown', '``````js', '```js`x', '``` `x']) {
        expect(openFence(line)?.lang ?? '').not.toContain('`');
      }
    });

    it('does not confuse the two marker characters', () => {
      const tilde = openFence('~~~json')!;
      expect(closesFence('```', tilde)).toBe(false);
      expect(closesFence('~~~', tilde)).toBe(true);
    });
  });

  /**
   * The lit control. ⛔ The corpus instance this card was filed for has an EVEN
   * number of stray markers, so its pairing happens to resynchronise afterwards —
   * verifying against it alone cannot show what goes wrong. This fixture carries
   * exactly ONE stray four-backtick marker, inside a five-backtick wrapper that
   * is legitimately teaching it.
   *
   * Against the replaced predicate this file read: two phantom languages
   * ('``markdown' and '``'), the prose paragraph as a fence BODY, the quoted
   * example as a real judged json fence, `omega` as prose, and an unterminated
   * fence at end of file. Every one of those is a wrong answer delivered with a
   * healthy-looking parse rate.
   */
  describe('an odd number of stray four-backtick markers', () => {
    const source = [
      '# Odd stray four-backtick markers',
      '',
      '```json',
      '{ "type": "alpha" }',
      '```',
      '',
      '`````markdown',
      '````markdown',
      '```json',
      '{ "type": "quoted-inside-the-wrapper" }',
      '```',
      '`````',
      '',
      'Prose paragraph that is not code.',
      '',
      '```json',
      '{ "type": "omega" }',
      '```',
      '',
    ].join('\n');

    const withFixture = <T,>(run: (root: string) => T): T => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objectui-9194-'));
      try {
        fs.mkdirSync(path.join(dir, 'content', 'docs'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'content', 'docs', 'odd.mdx'), source, 'utf8');
        return run(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    it('carries exactly one such marker, which is what makes it odd', () => {
      const strays = source.split('\n').filter((line) => /^````(?:[^`]|$)/.test(line));
      expect(strays).toHaveLength(1);
      expect(strays[0]).toBe('````markdown');
    });

    it('does not desynchronise the expression-carriage gate', () => {
      const fences = withFixture((root) => scanFences(root).fences);
      expect(fences.map((f) => [f.line, f.lang, f.scanned])).toEqual([
        [3, 'json', true],
        [7, 'markdown', false],
        [16, 'json', true],
      ]);
      // The stray marker and the quoted example are BODY of the wrapper, not
      // boundaries — so the fence after them still pairs correctly...
      expect(fences[2].body).toEqual(['{ "type": "omega" }']);
      // ...and nothing runs off the end of the file.
      expect(fences.filter((f) => f.reason === 'unterminated-fence')).toEqual([]);
      expect(fences.filter((f) => f.lang.includes('`'))).toEqual([]);
    });

    it('does not desynchronise the component-types gate', () => {
      const docs = withFixture((root) => scanDocs(root));
      expect(docs.sites.map((s) => [s.line, s.lang, s.value])).toEqual([
        [4, 'json', 'alpha'],
        [10, 'markdown', 'quoted-inside-the-wrapper'],
        [17, 'json', 'omega'],
      ]);
      expect(docs.counters.codeBlocks).toBe(3);
      expect(docs.sites.some((s) => s.unterminated)).toBe(false);
    });
  });

  describe('the real scan surface', () => {
    it('carries no fence language holding a backtick', () => {
      const languages = new Set(scanFences(ROOT).fences.map((f) => f.lang));
      expect([...languages].filter((lang) => lang.includes('`'))).toEqual([]);
    });

    it('reads a page that teaches nested fences as one fence, not three', () => {
      const page = 'content/docs/plugins/plugin-markdown.mdx';
      const fences = scanFences(ROOT).fences.filter((f) => f.file === page);
      const nested = fences.filter((f) => f.body.some((line) => line.trim().startsWith('```')));
      // Whatever else the page grows, a block quoted INSIDE a longer fence is
      // that fence's body: it never becomes a fence of its own, and it never
      // leaves a zero-length phantom behind.
      expect(nested.every((f) => f.body.length > 0)).toBe(true);
      expect(fences.filter((f) => f.body.length === 0 && f.lang.includes('markdown'))).toEqual([]);
    });
  });

  /**
   * The recurrence guard. A gate that re-spells the predicate locally is the
   * defect coming back, whatever the new spelling gets right — that is why this
   * looks for the SHAPE of an anchored fence-matching regex literal rather than
   * for the one wrong pattern that was removed.
   *
   * Comments are masked first: these files describe the old predicate at length,
   * and prose about a regex is not a regex (`js-comment-mask.mjs`, objectui#8560's
   * family).
   */
  describe('neither gate re-spells the predicate', () => {
    const GATES = [
      'scripts/check-doc-component-types.mjs',
      'scripts/check-doc-expression-carriage.mjs',
      // objectui#9331 — the same two wrong answers, one gate each: a toggle that
      // flipped on any run, and a non-greedy match that ended a block at the
      // first three-backtick run after it.
      'scripts/check-prompt-component-keys.mjs',
      'scripts/check-doc-example-shared-reader.mjs',
    ];

    /**
     * A regex literal that matches a run of fence markers.
     *
     * ⚠️ The anchor is OPTIONAL, and that is objectui#9331's correction to this
     * guard. It required `/^` and so could only ever have caught the toggle;
     * `check-doc-example-shared-reader.mjs` spelled its predicate UNANCHORED
     * (`/\`\`\`(?:tsx?|jsx?|typescript)\n/`) and would have walked straight
     * past a guard looking for anchored literals only. A recurrence guard that
     * matches one of the two shapes the defect actually takes is not a guard.
     */
    const LOCAL_PREDICATE = /\/\^?[^\n/]*(?:`{3}|`\{\d|~{3}|~\{\d)/;

    it.each(GATES)('%s imports the shared authority', (gate) => {
      const source = fs.readFileSync(path.join(ROOT, gate), 'utf8');
      expect(source).toContain("from './markdown-fence-scan.mjs'");
    });

    it.each(GATES)('%s spells no fence predicate of its own', (gate) => {
      const source = maskComments(fs.readFileSync(path.join(ROOT, gate), 'utf8'));
      expect(LOCAL_PREDICATE.test(source)).toBe(false);
    });

    it('the guard would catch every predicate that was removed', () => {
      // The positive control, so a guard that stopped matching anything at all
      // cannot pass by describing nothing. One line per spelling actually
      // deleted from this tree.
      expect(LOCAL_PREDICATE.test('const fence = /^\\s*```(\\S*)\\s*$/.exec(lines[i]);')).toBe(true);
      expect(LOCAL_PREDICATE.test('const fence = /^([ \\t]*)(`{3,}|~{3,})([^\\n]*)\\n/gm;')).toBe(true);
      // objectui#9331, the toggle...
      expect(LOCAL_PREDICATE.test('const FENCE = /^\\s*(?:```|~~~)/;')).toBe(true);
      // ...and the unanchored one, which the pre-#9331 guard shape MISSED.
      expect(
        LOCAL_PREDICATE.test('body.matchAll(/```(?:tsx?|jsx?|typescript)\\n([\\s\\S]*?)```/g)'),
      ).toBe(true);
    });

    it('does not fire on a regex that merely mentions backticks', () => {
      // The negative control. Dropping the anchor widened this predicate, and a
      // guard that reds on any backtick-bearing regex would force the gates to
      // stop reading inline code — `check-prompt-component-keys.mjs` really
      // carries this one, and it is not a fence predicate.
      expect(LOCAL_PREDICATE.test('const BACKTICKED = /`([^`]+)`/g;')).toBe(false);
      expect(LOCAL_PREDICATE.test("const NOT_A_REGEX = 'see ``` in prose';")).toBe(false);
    });
  });
});
