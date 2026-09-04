import { describe, expect, it } from 'vitest';
import { runMetadataEval, type MetadataEvalCase } from '../src/lint/metadata-eval';
import { DEFAULT_METADATA_EVAL_CORPUS } from '../src/lint/corpus';
import { scoreMetadata } from '../src/lint/score';

describe('runMetadataEval — offline (golden corpus)', () => {
  it('every golden fixture clears the quality bar', async () => {
    const report = await runMetadataEval(DEFAULT_METADATA_EVAL_CORPUS);
    expect(report.mode).toBe('offline');
    expect(report.total).toBe(DEFAULT_METADATA_EVAL_CORPUS.length);
    // Surface which case failed (if any) for a useful assertion message.
    const failures = report.results.filter((r) => !r.passed).map((r) => `${r.id}=${r.score.score}`);
    expect(failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.meanScore).toBeGreaterThanOrEqual(90);
  });

  it('each golden fixture is schema-valid with no errors', async () => {
    for (const c of DEFAULT_METADATA_EVAL_CORPUS) {
      const s = scoreMetadata(c.fixture);
      expect(s.counts.schemaErrors, `${c.id} schema`).toBe(0);
      expect(s.counts.errors, `${c.id} lint errors`).toBe(0);
    }
  });

  it('the corpus exercises the key conventions', () => {
    const ids = DEFAULT_METADATA_EVAL_CORPUS.map((c) => c.id);
    expect(ids).toContain('invoice_with_line_items');
    expect(ids).toContain('blog_post_with_comments'); // association (no inlineEdit)
    expect(ids).toContain('crm_account_with_contacts'); // lookup (independent)
  });
});

describe('runMetadataEval — live seam', () => {
  const oneCase: MetadataEvalCase[] = [
    { id: 'c1', prompt: 'invoice with lines', fixture: { manifest: { id: 'a', namespace: 'aa', version: '1.0.0', name: 'A', type: 'app' } } },
  ];

  it('scores the generated stack (not the fixture) when a generator is injected', async () => {
    // Generator returns a broken stack → the case fails under the rubric.
    const badGen = () => ({
      objects: [{ name: 'BadName', fields: { Status: { type: 'select' } } }],
    });
    const report = await runMetadataEval(oneCase, { generate: badGen });
    expect(report.mode).toBe('live');
    expect(report.results[0].source).toBe('generated');
    expect(report.results[0].passed).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('a generator that produces a clean stack passes', async () => {
    const goodGen = () => ({
      objects: [
        // A "clean" stack declares OWD — the D7 security linter (ADR-0090)
        // errors on custom objects with an unset sharingModel.
        { name: 'invoice', label: 'Invoice', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name', required: true } } },
        { name: 'invoice_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true, deleteBehavior: 'cascade', inlineEdit: true }, amount: { type: 'currency', label: 'Amount', required: true } } },
      ],
    });
    const report = await runMetadataEval(oneCase, { generate: goodGen });
    expect(report.results[0].passed).toBe(true);
  });

  it('a generation error becomes a failed case (never throws)', async () => {
    const throwingGen = () => { throw new Error('model unavailable'); };
    const report = await runMetadataEval(oneCase, { generate: throwingGen });
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].generationError).toContain('model unavailable');
  });

  it('respects per-case minScore', async () => {
    const cases: MetadataEvalCase[] = [{ ...oneCase[0], minScore: 100 }];
    // The empty-ish fixture scores 100, so minScore 100 still passes offline.
    const report = await runMetadataEval(cases);
    expect(report.results[0].minScore).toBe(100);
  });
});

/**
 * `runMetadataEval` promises totality in writing — *"Never throws"* — and the
 * promise was false as written. Its `try` wrapped only `options.generate(...)`;
 * `scoreMetadata(stack)` sat OUTSIDE it. So a generator that THREW became a
 * failed case, while a generator that RETURNED a value nobody could walk took
 * the whole process down. Driven on the published binary before the fix:
 *
 *     os lint --eval --json --generator ./poison.mjs
 *     exit 1 · stdout 0 bytes · stderr "    Error: poison getter"
 *
 * ⇒ a caller that asked for `--json` got no document at all.
 *
 * ## Two throw sites, which is why the guard is HERE and not in `score.ts`
 *
 * `scoreMetadata` walks the stack twice, and BOTH walks are driven below:
 *
 *   - `normalizeStackInput` spreads the TOP level (`{ ...input }`) — a poisoned
 *     getter on a top-level key throws there;
 *   - `ObjectStackDefinitionSchema.safeParse` walks everything BELOW it — a
 *     poisoned getter one level deeper survives the shallow spread and throws
 *     inside zod instead.
 *
 * `nested poison` is the control for that second site. A guard placed around
 * `normalizeStackInput` alone would leave it red, which is the measurement that
 * chose this file: one `try` around the whole call covers both walks, and every
 * future one, without touching `scoreMetadata`'s other caller (`os lint
 * --score`, which already sits inside the command's catch-all JSON exit).
 *
 * ## ⛔ The trap these tests exist to keep shut
 *
 * A guard that swallowed the throw and scored the poisoned stack as PASSING
 * would be worse than the crash — a loud failure turned into a quiet wrong
 * answer. So the assertions below are not "it did not throw": they require the
 * case to FAIL, the report to say `ok: false`, and the cause to be NAMED. And
 * `unscorable is not scored as an empty stack` is the control that goes red if
 * anyone later substitutes `scoreMetadata({})` for the sentinel — the empty
 * stack scores 100 / A / `valid: true`, so that substitution would put a
 * clean-looking verdict on a stack that was never parsed.
 */
describe('runMetadataEval — a stack that cannot be scored is a FAILED case, not a crash', () => {
  const oneCase: MetadataEvalCase[] = [
    { id: 'c1', prompt: 'invoice with lines', fixture: { manifest: { id: 'a', namespace: 'aa', version: '1.0.0', name: 'A', type: 'app' } } },
  ];

  /** Poison on a TOP-LEVEL key: throws inside `normalizeStackInput`'s spread. */
  const topLevelPoison = () => ({
    name: 'poison',
    get objects(): never {
      throw new Error('poison getter');
    },
  });

  /** Poison one level DOWN: survives the shallow spread, throws inside zod. */
  const nestedPoison = () => ({
    name: 'poison_nested',
    objects: [
      {
        name: 'account',
        label: 'Account',
        get fields(): never {
          throw new Error('nested poison getter');
        },
      },
    ],
  });

  it('a top-level poisoned getter fails its case and names the cause', async () => {
    const report = await runMetadataEval(oneCase, { generate: topLevelPoison });

    expect(report.results[0].generationError).toContain('poison getter');
    expect(report.results[0].passed).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.failed).toBe(report.total);
  });

  it('a poisoned getter BELOW the top level fails too — the schema parse walks there', async () => {
    // The site control: this one never reaches `normalizeStackInput`'s throw.
    const report = await runMetadataEval(oneCase, { generate: nestedPoison });

    expect(report.results[0].generationError).toContain('nested poison getter');
    expect(report.results[0].passed).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('⛔ an unscorable stack is NOT scored as an empty stack', async () => {
    // `scoreMetadata({})` is 100 / A / valid — the shape a silent swallow would
    // produce. Requiring the opposite is what keeps the swallow out.
    expect(scoreMetadata({}).score).toBe(100);
    expect(scoreMetadata({}).valid).toBe(true);

    const report = await runMetadataEval(oneCase, { generate: topLevelPoison });
    const only = report.results[0];

    expect(only.score.valid).toBe(false);
    expect(only.score.score).toBe(0);
    expect(only.score.grade).toBe('F');
    expect(report.meanScore).toBe(0);
  });

  it('the guard is not live-only — an unscorable FIXTURE fails offline too', async () => {
    // Offline has no reachable throw with the shipped corpus, but the promise
    // is not mode-conditional: the guard sits below the `if (live)` branch, so
    // a fixture that cannot be scored fails its case rather than the process.
    const poisonedFixture: MetadataEvalCase[] = [
      { id: 'offline_poison', prompt: 'anything', fixture: topLevelPoison() },
    ];

    const report = await runMetadataEval(poisonedFixture);

    expect(report.mode).toBe('offline');
    expect(report.results[0].source).toBe('fixture');
    expect(report.results[0].generationError).toContain('poison getter');
    expect(report.results[0].generationError).toContain('fixture');
    expect(report.results[0].passed).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('a scorable case in the same run is still scored on its own merits', async () => {
    // The guard is PER CASE: one poisoned stack must not blank the others.
    const twoCases: MetadataEvalCase[] = [
      { ...oneCase[0], id: 'poisoned' },
      { ...oneCase[0], id: 'fine' },
    ];
    const generate = (_prompt: string, id: string) =>
      id === 'poisoned' ? topLevelPoison() : { manifest: { id: 'b', namespace: 'bb', version: '1.0.0', name: 'B', type: 'app' } };

    const report = await runMetadataEval(twoCases, { generate });

    expect(report.results.map((r) => r.id)).toEqual(['poisoned', 'fine']);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[1].generationError).toBeUndefined();
    expect(report.results[1].passed).toBe(true);
    expect(report.ok).toBe(false);
  });
});
