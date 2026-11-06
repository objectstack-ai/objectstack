// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The gallery exporter on a real run of the real crm card (`fixture.ts`): the
 * layout it writes, the pass rule it reads from the record, the generic-only
 * guard, re-export replacing what was there, an app that stops passing
 * leaving the gallery, the transcript joined with (and proven against) the
 * recording, and `index.json` validated and stable.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exportGallery, scratchProjectDir, type ExportOptions } from '../../src/export/exporter.js';
import { NO_GENERIC_MARKER, type GenericGuard } from '../../src/export/generic.js';
import { GalleryIndexSchema, parseIndex } from '../../src/export/manifest.js';
import { judgeRecord } from '../../src/export/pass.js';
import { readRunRecords, redactWorkDir, ScenarioRunRecordSchema, type ScenarioRunRecord } from '../../src/export/record.js';
import type { CaptureScreenshots } from '../../src/export/screenshots.js';
import { main, parseExportArgs, renderSummary } from '../../src/export/cli.js';
import type { Recording } from '../../src/runner/driver.js';
import { CARD_ID, loadAllCards, loadCrm, runCrm, tempDir, writeRecord, type FixtureRun } from './fixture.js';

/** The test's stand-in for the generic marker the card schema does not have yet. */
const GENERIC_DOUBLE: GenericGuard = () => ({ generic: true, reason: 'test double' });

const asRecord = (r: Record<string, unknown>) => ScenarioRunRecordSchema.parse(r) as ScenarioRunRecord;

/** Every file under `dir`, relative path → sha256. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

async function setup(run?: FixtureRun) {
  const fx = run ?? (await runCrm());
  const runs = tempDir('runs');
  const out = tempDir('out');
  writeRecord(runs, fx.record);
  const opts = (over: Partial<ExportOptions> = {}): ExportOptions => ({
    runsDir: runs,
    outDir: out,
    cards: [fx.scenario],
    recordings: [fx.recording],
    isGeneric: GENERIC_DOUBLE,
    screenshots: false,
    ...over,
  });
  return { fx, runs, out, opts };
}

describe('judgeRecord — "passed every half", read from the record', () => {
  it('a clean run passes: all six scratch halves and the three template iterate halves', async () => {
    const { record } = await runCrm();
    const j = judgeRecord(asRecord(record));
    expect(j.reasons).toEqual([]);
    expect(j.passed).toBe(true);
    expect(j.halves.map((h) => h.id)).toEqual([
      `${CARD_ID}.scratch.build`,
      `${CARD_ID}.scratch.run-ask`,
      `${CARD_ID}.scratch.run-operations`,
      `${CARD_ID}.scratch.iterate-build`,
      `${CARD_ID}.scratch.iterate-run-ask`,
      `${CARD_ID}.scratch.iterate-run-operations`,
      `${CARD_ID}.template.iterate-build`,
      `${CARD_ID}.template.iterate-run-ask`,
      `${CARD_ID}.template.iterate-run-operations`,
    ]);
    // Template mode's first rows are not-run by construction and are not asked.
    const rows = (record.results as Array<{ id: string; verdict: string }>).filter((r) => r.id === `${CARD_ID}.template.build`);
    expect(rows[0]!.verdict).toBe('not-run');
  });

  it('a not-run half is not a pass: a run without the iterate re-run fails', async () => {
    const { record } = await runCrm({ iterateRun: false, modes: ['scratch'] });
    const j = judgeRecord(asRecord(record));
    expect(j.passed).toBe(false);
    expect(j.reasons).toEqual([`${CARD_ID}.scratch.iterate-run-ask: not-run`, `${CARD_ID}.scratch.iterate-run-operations: not-run`]);
  });

  it('partial, fail and a missing row are not a pass; a record without the scratch mode is refused', async () => {
    const { record } = await runCrm();
    const results = (record.results as Array<{ id: string; verdict: string }>).map((r) =>
      r.id.endsWith('scratch.run-ask') ? { ...r, verdict: 'partial' } : r.id.endsWith('template.iterate-build') ? { ...r, verdict: 'fail' } : r,
    );
    const j = judgeRecord(asRecord({ ...record, results: results.filter((r) => !r.id.endsWith('scratch.run-operations')) }));
    expect(j.reasons).toEqual([`${CARD_ID}.scratch.run-ask: partial`, `${CARD_ID}.scratch.run-operations: missing`, `${CARD_ID}.template.iterate-build: fail`]);

    const cardRun = record.cardRun as { modes: Array<{ mode: string }> };
    const templateOnly = { ...record, cardRun: { ...cardRun, modes: cardRun.modes.filter((m) => m.mode === 'template') } };
    expect(judgeRecord(asRecord(templateOnly)).reasons[0]).toMatch(/no scratch mode/);
  });
});

describe('judgeRecord — ⛔ a not-measured turn is not a pass, even under a `pass` verdict', () => {
  it('a refused seed row leaves every half `pass` in the record, and the record still does not pass', async () => {
    // ct4 is a contact: every question on contacts, and every operation that names it, is not measured.
    const { record } = await runCrm({ refuse: ['democrm_contact/ct4'] });
    const verdicts = (record.results as Array<{ id: string; verdict: string }>).filter((r) => /scratch\.(run-ask|run-operations)$/.test(r.id)).map((r) => r.verdict);
    expect(verdicts).toEqual(['pass', 'pass']); // the scorecard counts not-measured turns in neither passed nor total
    const j = judgeRecord(asRecord(record));
    expect(j.passed).toBe(false);
    expect(j.halves.every((h) => h.verdict === 'pass')).toBe(true);
    expect(j.reasons.length).toBeGreaterThan(0);
    for (const r of j.reasons) expect(r).toMatch(/^crm_account_with_contacts\.(scratch|template)\.(run|iterate-run) (question|operation) \S+.*: not measured — seed: /);
    // Every Run half the record holds is read: scratch first run, scratch re-run, template re-run.
    expect(new Set(j.reasons.map((r) => r.split(' ')[0]))).toEqual(
      new Set([`${CARD_ID}.scratch.run`, `${CARD_ID}.scratch.iterate-run`, `${CARD_ID}.template.iterate-run`]),
    );
  });

  it('an operation marked not measured is a reason of its own', async () => {
    const { record } = await runCrm();
    const cardRun = record.cardRun as { modes: Array<{ mode: string; run: { operations: Array<Record<string, unknown>> } }> };
    const scratch = cardRun.modes.find((m) => m.mode === 'scratch')!;
    const [first, ...rest] = scratch.run.operations;
    const edited = { ...record, cardRun: { ...cardRun, modes: cardRun.modes.map((m) => (m === scratch ? { ...m, run: { ...m.run, operations: [{ ...first, notMeasured: 'seed: needs democrm_account ac1, which the app refused' }, ...rest] } } : m)) } };
    expect(judgeRecord(asRecord(edited)).reasons).toEqual([
      `${CARD_ID}.scratch.run operation ${String(first!.operation)} as ${String(first!.persona)}: not measured — seed: needs democrm_account ac1, which the app refused`,
    ]);
  });
});

describe('exportGallery — one passing, generic app', () => {
  it('writes the apps/<id>/ layout: source, run record, scorecard, transcript, README, and the index', async () => {
    const { out, fx, opts } = await setup();
    const s = await exportGallery(opts());
    expect(s.refused).toEqual([]);
    expect(s.exported.map((e) => e.id)).toEqual([CARD_ID]);
    expect(s.indexChanged).toBe(true);

    const files = Object.keys(tree(join(out, 'apps', CARD_ID))).sort();
    expect(files).toEqual([
      'README.md',
      'run-record.json',
      'scorecard.json',
      'scorecard.md',
      'source/objectstack.config.ts',
      'source/objectstack.manifest.json',
      'source/package.json',
      'source/src/objects/account.object.ts',
      'source/src/objects/contact.object.ts',
      'source/tsconfig.json',
      'transcript.json',
      'transcript.md',
    ]);

    // The run record, verbatim but for the local work directory.
    const recordText = readFileSync(join(out, 'apps', CARD_ID, 'run-record.json'), 'utf8');
    expect(recordText).not.toContain(fx.work);
    expect(recordText).toContain('$WORK');
    expect(JSON.parse(recordText).results).toEqual(fx.record.results);

    const index = parseIndex(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(index.apps).toEqual([
      {
        id: CARD_ID,
        code: 'crm',
        namespace: 'democrm',
        path: `apps/${CARD_ID}`,
        function: 'sales',
        title: { en: fx.scenario.card.title, zh: null },
        summary: { ...(fx.scenario.card.prompt.short.en ? { en: fx.scenario.card.prompt.short.en } : {}), ...(fx.scenario.card.prompt.short.zh ? { zh: fx.scenario.card.prompt.short.zh } : {}) },
        capabilities: [...fx.scenario.card.capabilities].sort(),
        screenshots: [],
        qa: { questions: 8, turns: 9, personas: 2 },
        operations: 5,
        framework: { version: '18.3.0', runner: 'abc1234' },
        runDate: '2026-11-06',
        run: `2026-11-06-scenario-${CARD_ID}`,
      },
    ]);
  });

  it('the transcript carries every persona answer with its grade, as JSON and as Markdown', async () => {
    const { out, opts } = await setup();
    await exportGallery(opts());
    const t = JSON.parse(readFileSync(join(out, 'apps', CARD_ID, 'transcript.json'), 'utf8'));
    expect(t.halves.map((h: { mode: string; phase: string }) => `${h.mode}/${h.phase}`)).toEqual(['scratch/run', 'scratch/iterate-run', 'template/iterate-run']);
    const first = t.halves[0].turns;
    expect(first).toHaveLength(9); // 8 questions, one of them asked as both personas
    for (const turn of first) {
      expect(turn.answer.replyText.length).toBeGreaterThan(0);
      expect(turn.grade).toMatchObject({ correct: true, cited: true, leaks: [] });
    }
    // Asked as the admin where a question names no persona, and as each persona it names.
    const askers = new Set(first.map((x: { persona: string | null }) => x.persona ?? 'admin'));
    expect([...askers].sort()).toEqual(['admin', 'partner_user', 'sdr']);
    const md = readFileSync(join(out, 'apps', CARD_ID, 'transcript.md'), 'utf8');
    expect(md).toContain('#### As sdr');
    expect(md).toContain('#### As partner_user');
    expect(md).toContain('✅ pass');
  });

  it('a re-export with no change is a no-op: the same bytes, file for file, and the index is not rewritten', async () => {
    const { out, opts } = await setup();
    await exportGallery(opts());
    const first = tree(out);
    const again = await exportGallery(opts());
    expect(again.indexChanged).toBe(false);
    expect(tree(out)).toEqual(first);
  });

  it('a re-export deletes the old directory first: nothing stale survives', async () => {
    const { out, opts } = await setup();
    await exportGallery(opts());
    writeFileSync(join(out, 'apps', CARD_ID, 'stale.txt'), 'left from an old release');
    mkdirSync(join(out, 'apps', CARD_ID, 'screenshots'), { recursive: true });
    writeFileSync(join(out, 'apps', CARD_ID, 'screenshots', 'old.png'), 'x');
    await exportGallery(opts());
    expect(existsSync(join(out, 'apps', CARD_ID, 'stale.txt'))).toBe(false);
    expect(existsSync(join(out, 'apps', CARD_ID, 'screenshots'))).toBe(false);
    expect(readdirSync(join(out, 'apps')).filter((n) => n.startsWith('.staging'))).toEqual([]);
  });

  it('an app whose newest record no longer passes leaves apps/ and the index; a directory the index never listed is left alone', async () => {
    const { out, runs, opts } = await setup();
    await exportGallery(opts());
    mkdirSync(join(out, 'apps', 'hand_made'));
    // The next release's run: the iterate re-run was skipped, so two halves are not-run.
    const later = await runCrm({ date: '2026-12-01', iterateRun: false });
    writeRecord(runs, later.record);
    const s = await exportGallery(opts({ recordings: [later.recording] }));
    expect(s.exported).toEqual([]);
    expect(s.removed).toEqual([{ id: CARD_ID, why: expect.stringContaining(`${CARD_ID}.scratch.iterate-run-ask: not-run`) }]);
    expect(existsSync(join(out, 'apps', CARD_ID))).toBe(false);
    expect(parseIndex(readFileSync(join(out, 'index.json'), 'utf8')).apps).toEqual([]);
    expect(s.unowned).toEqual(['hand_made']);
    expect(existsSync(join(out, 'apps', 'hand_made'))).toBe(true);
  });

  it('an app whose newest record has a not-measured turn is refused, and a previous export of it removed', async () => {
    const { out, runs, opts } = await setup();
    await exportGallery(opts());
    const later = await runCrm({ date: '2026-12-01', refuse: ['democrm_contact/ct4'] });
    writeRecord(runs, later.record);
    const s = await exportGallery(opts({ recordings: [later.recording] }));
    expect(s.exported).toEqual([]);
    expect(s.refused[0]!.reasons[0]).toMatch(/did not pass every half/);
    expect(s.refused[0]!.reasons.slice(1).every((r) => r.includes(': not measured — seed: '))).toBe(true);
    expect(s.removed).toEqual([{ id: CARD_ID, why: expect.stringContaining('not measured') }]);
    expect(existsSync(join(out, 'apps', CARD_ID))).toBe(false);
    expect(parseIndex(readFileSync(join(out, 'index.json'), 'utf8')).apps).toEqual([]);
  });

  it('the newest record decides, even when an older one passed', async () => {
    const { runs } = await setup();
    const later = await runCrm({ date: '2026-12-01', iterateRun: false });
    writeRecord(runs, later.record);
    const { newest } = readRunRecords(runs);
    expect(newest.get(CARD_ID)!.record.date).toBe('2026-12-01');
  });

  it('refuses, and touches nothing, when the previous index.json is not one it wrote', async () => {
    const { out, opts } = await setup();
    await exportGallery(opts());
    writeFileSync(join(out, 'index.json'), JSON.stringify({ apps: 'hand edited' }));
    const before = tree(out);
    await expect(exportGallery(opts())).rejects.toThrow(/not a gallery index this exporter wrote/);
    expect(tree(out)).toEqual(before);
  });

  it('⛔ a runs directory with no scenario record, over an index that lists apps, is a wrong --runs: it refuses and removes nothing', async () => {
    const { out, opts } = await setup();
    await exportGallery(opts());
    const before = tree(out);
    const empty = tempDir('empty-runs');
    writeFileSync(join(empty, 'checklist-run.json'), JSON.stringify({ runner: 'platform-checklist', results: [] }));
    await expect(exportGallery(opts({ runsDir: empty }))).rejects.toThrow(/holds no scenario run record, and .* lists 1 app\(s\), so nothing is touched/);
    expect(tree(out)).toEqual(before);
    // Through the CLI: the export rejects, so the process exits non-zero.
    await expect(main(['--runs', empty, '--out', out, '--no-screenshots'])).rejects.toThrow(/holds no scenario run record/);
    expect(tree(out)).toEqual(before);
    // With no previous index there is nothing to lose: an empty runs directory writes an empty index.
    const fresh = tempDir('out-fresh');
    expect((await exportGallery(opts({ runsDir: empty, outDir: fresh }))).exported).toEqual([]);
    expect(parseIndex(readFileSync(join(fresh, 'index.json'), 'utf8')).apps).toEqual([]);
  });

  it('refuses the whole export on an unreadable scenario-runner record, and ignores other JSON', async () => {
    const { runs, opts } = await setup();
    writeFileSync(join(runs, 'checklist-run.json'), JSON.stringify({ runner: 'platform-checklist', results: [] }));
    const s = await exportGallery(opts());
    expect(s.ignoredFiles.map((f) => f.slice(f.lastIndexOf('/') + 1))).toEqual(['checklist-run.json']);
    writeFileSync(join(runs, '2026-11-07-scenario-x.json'), JSON.stringify({ runner: 'scenario-runner', app: 'x' }));
    await expect(exportGallery(opts())).rejects.toThrow(/not a readable scenario run record/);
  });
});

describe('⛔ no local path: every work directory that names the run is redacted', () => {
  /** Every file under `dir`, relative path → its text. */
  function texts(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out[relative(dir, p)] = readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    return out;
  }

  it('under --work, a record from another machine: neither its evidenceDir nor --work appears anywhere in --out', async () => {
    const fx = await runCrm();
    const other = '/srv/ci-runner-7/scenario-work';
    // The record as the machine that ran it wrote it: every string that named its work directory names `other`.
    const moved = JSON.parse(JSON.stringify(fx.record).split(fx.work).join(other)) as Record<string, unknown>;
    expect(moved.evidenceDir).toBe(other);
    expect(JSON.stringify(moved).split(other).length - 1).toBeGreaterThan(1); // the build tails name it too
    const { out, opts } = await setup({ ...fx, record: moved });
    const s = await exportGallery(opts({ workDir: fx.work }));
    expect(s.exported.map((e) => e.id)).toEqual([CARD_ID]);

    const files = texts(out);
    for (const name of ['run-record.json', 'scorecard.json', 'scorecard.md', 'transcript.json', 'transcript.md', 'README.md']) expect(Object.keys(files)).toContain(`apps/${CARD_ID}/${name}`);
    for (const [name, text] of Object.entries(files)) {
      for (const dir of [other, fx.work, realpathSync(fx.work)]) expect(text.includes(dir), `${name} names ${dir}`).toBe(false);
    }
    expect(JSON.parse(files[`apps/${CARD_ID}/run-record.json`]!).evidenceDir).toBe('$WORK');
  });

  it('a directory is replaced only whole: `/tmp` never rewrites `/tmpfoo`, and the longer of two nested directories wins', () => {
    expect(redactWorkDir({ a: ['/tmp', '/tmp/x', 'ran in /tmp.', '"/tmp"', '/tmpfoo', '/tmp.d/x', '/var/tmp/y', 'x/tmp'] }, '/tmp/')).toEqual({
      a: ['$WORK', '$WORK/x', 'ran in $WORK.', '"$WORK"', '/tmpfoo', '/tmp.d/x', '/var/tmp/y', 'x/tmp'],
    });
    expect(redactWorkDir('/w/inner/p and /w/q', ['/w', '/w/inner'])).toBe('$WORK/p and $WORK/q');
    expect(redactWorkDir('/a/b', ['/', ''])).toBe('/a/b');
  });
});

describe('exportGallery — what it refuses', () => {
  it('⛔ generic only: with the default guard every card is refused and nothing is written but an empty index', async () => {
    const { out, opts } = await setup();
    const s = await exportGallery({ ...opts(), isGeneric: undefined });
    expect(s.exported).toEqual([]);
    expect(s.refused).toEqual([{ id: CARD_ID, reasons: [expect.stringMatching(/^not marked generic: the card schema carries no explicit generic marker/)] }]);
    expect(readdirSync(join(out, 'apps'))).toEqual([]);
    expect(GalleryIndexSchema.parse(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))).apps).toEqual([]);
  });

  it('the default guard refuses every card of the open library: none carries a generic marker', () => {
    const cards = loadAllCards();
    expect(cards.length).toBeGreaterThanOrEqual(9);
    for (const c of cards) expect(NO_GENERIC_MARKER(c)).toMatchObject({ generic: false });
  });

  it('an asked turn with no recorded reply is refused: a grade is never shown without its answer', async () => {
    const { out, opts } = await setup();
    const s = await exportGallery(opts({ recordings: [] }));
    expect(s.refused[0]!.reasons[0]).toMatch(/^no recorded reply for `crm_account_with_contacts\/scratch\/run\//);
    expect(existsSync(join(out, 'apps', CARD_ID))).toBe(false);
  });

  it("a recording that is not this run's is refused: its replies grade differently from the record", async () => {
    const { fx, opts } = await setup();
    const turns = { ...fx.recording.turns };
    const key = Object.keys(turns).find((k) => k.startsWith(`${CARD_ID}/scratch/run/`) && !k.includes('/author/'))!;
    turns[key] = { ...turns[key]!, replyText: 'No idea.' };
    const other: Recording = { ...fx.recording, turns };
    const s = await exportGallery(opts({ recordings: [other] }));
    expect(s.refused[0]!.reasons[0]).toBe(`the recorded reply for \`${key}\` grades differently from the run record: the recording is not this run's`);
  });

  it("the run's project gone, or a card no longer loaded, is a refusal", async () => {
    const { fx, opts } = await setup();
    expect((await exportGallery(opts({ cards: [] }))).refused[0]!.reasons[0]).toMatch(/^no loaded card `crm_account_with_contacts`/);
    const elsewhere = tempDir('moved');
    expect((await exportGallery(opts({ workDir: elsewhere }))).refused[0]!.reasons[0]).toBe(`the run's scratch project is gone: ${scratchProjectDir(elsewhere, fx.scenario.card)}`);
  });
});

describe('exportGallery — screenshots', () => {
  it('runs the screenshot step against the scratch project and lists every shot in the index', async () => {
    const { out, fx, opts } = await setup();
    const seen: string[] = [];
    const shoot: CaptureScreenshots = async (input) => {
      seen.push(input.projectDir);
      mkdirSync(join(input.dir, 'screenshots'), { recursive: true });
      writeFileSync(join(input.dir, 'screenshots', 'list.png'), 'png');
      return { shots: [{ kind: 'list', file: 'screenshots/list.png', path: '/_console/apps/democrm_crm/democrm_account', object: 'democrm_account' }], skipped: [{ kind: 'dashboard', reason: 'the build declares no dashboard' }] };
    };
    const s = await exportGallery(opts({ screenshots: shoot }));
    expect(seen).toEqual([scratchProjectDir(fx.work, fx.scenario.card)]);
    expect(s.exported[0]!.skippedShots).toEqual([{ kind: 'dashboard', reason: 'the build declares no dashboard' }]);
    expect(statSync(join(out, 'apps', CARD_ID, 'screenshots', 'list.png')).isFile()).toBe(true);
    const index = parseIndex(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(index.apps[0]!.screenshots).toEqual([{ kind: 'list', path: `apps/${CARD_ID}/screenshots/list.png`, object: 'democrm_account' }]);
    expect(readFileSync(join(out, 'apps', CARD_ID, 'README.md'), 'utf8')).toContain('no dashboard screenshot: the build declares no dashboard');
  });

  it('⛔ an export without screenshots never replaces one that had them: the old directory and entry are kept, and the summary says so', async () => {
    const { out, runs, opts } = await setup();
    const shoot: CaptureScreenshots = async (input) => {
      mkdirSync(join(input.dir, 'screenshots'), { recursive: true });
      writeFileSync(join(input.dir, 'screenshots', 'list.png'), 'png');
      return { shots: [{ kind: 'list', file: 'screenshots/list.png', path: '/_console/apps/democrm_crm/democrm_account', object: 'democrm_account' }], skipped: [] };
    };
    await exportGallery(opts({ screenshots: shoot }));
    const before = tree(out);
    const s = await exportGallery(opts({ screenshots: false }));
    expect(s.exported).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(s.kept).toEqual([{ id: CARD_ID, why: expect.stringContaining('the previous export has 1: it is kept as it was') }]);
    expect(s.indexChanged).toBe(false);
    expect(tree(out)).toEqual(before);
    expect(renderSummary(s)).toContain(`kept     ${CARD_ID} · ${s.kept[0]!.why}`);
    expect(renderSummary(s).slice(-1)[0]).toBe('index.json unchanged · 0 exported, 0 refused, 0 removed, 1 kept');
    // It keeps nothing that no longer passes: a newer failing record still removes the app.
    const later = await runCrm({ date: '2026-12-01', iterateRun: false });
    writeRecord(runs, later.record);
    const t = await exportGallery(opts({ screenshots: false, recordings: [later.recording] }));
    expect(t.kept).toEqual([]);
    expect(t.removed.map((r) => r.id)).toEqual([CARD_ID]);
    expect(existsSync(join(out, 'apps', CARD_ID))).toBe(false);
  });

  it('a screenshot step that fails refuses the app instead of exporting it without its proof', async () => {
    const { out, opts } = await setup();
    const s = await exportGallery(opts({ screenshots: async () => Promise.reject(new Error('objectstack dev exited before it was ready')) }));
    expect(s.refused).toEqual([{ id: CARD_ID, reasons: ['objectstack dev exited before it was ready'] }]);
    expect(existsSync(join(out, 'apps', CARD_ID))).toBe(false);
  });
});

describe('index.json — the schema', () => {
  const app = (id: string) => ({
    id,
    code: 'crm',
    namespace: 'democrm',
    path: `apps/${id}`,
    function: 'sales',
    title: { en: 'CRM', zh: null },
    summary: { en: 'Build a CRM.' },
    capabilities: [],
    screenshots: [],
    qa: { questions: 8, turns: 9, personas: 2 },
    operations: 5,
    framework: { version: '18.3.0', runner: 'abc1234' },
    runDate: '2026-11-06',
    run: 'r',
  });
  it('accepts a sorted index and refuses an unsorted one, a duplicate, a wrong path and an unknown key', () => {
    expect(GalleryIndexSchema.safeParse({ schemaVersion: 1, apps: [app('a_card'), app('b_card')] }).success).toBe(true);
    expect(GalleryIndexSchema.safeParse({ schemaVersion: 1, apps: [app('b_card'), app('a_card')] }).success).toBe(false);
    expect(GalleryIndexSchema.safeParse({ schemaVersion: 1, apps: [app('a_card'), app('a_card')] }).success).toBe(false);
    expect(GalleryIndexSchema.safeParse({ schemaVersion: 1, apps: [{ ...app('a_card'), path: 'apps/other' }] }).success).toBe(false);
    expect(GalleryIndexSchema.safeParse({ schemaVersion: 1, apps: [{ ...app('a_card'), generatedAt: 'now' }] }).success).toBe(false);
  });
});

describe('export-gallery CLI', () => {
  it('requires --out and refuses an unknown flag', () => {
    expect(() => parseExportArgs(['--runs', 'r'])).toThrow(/--out DIR is required/);
    expect(() => parseExportArgs(['--out', 'o', '--generic'])).toThrow(/unknown flag `--generic`/);
    expect(parseExportArgs(['--out', 'o', '--recording', 'a', '--recording', 'b', '--no-screenshots'])).toMatchObject({ out: 'o', recordings: ['a', 'b'], screenshots: false });
  });

  it('end to end over the real card directory: today it refuses every card, so the gallery stays empty', async () => {
    const { fx, runs, out } = await setup();
    const recording = join(tempDir('rec'), 'recording.json');
    writeFileSync(recording, JSON.stringify(fx.recording));
    const errors: string[] = [];
    const log = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(' '));
    try {
      expect(await main(['--runs', runs, '--out', out, '--recording', recording, '--no-screenshots'])).toBe(0);
    } finally {
      console.error = log;
    }
    expect(errors.some((l) => l.startsWith(`refused  ${CARD_ID} · not marked generic`))).toBe(true);
    expect(parseIndex(readFileSync(join(out, 'index.json'), 'utf8')).apps).toEqual([]);
    expect(loadCrm().card.id).toBe(CARD_ID);
  });
});
