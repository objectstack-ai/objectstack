// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins `render-projection-diff.ts`, the pull-request half of the #22449 B′
// ruling's condition (1): the generated diff of the two ADR-0087 projections is
// rendered on the pull request, and a side that cannot be generated is red.
//
// The generators and the base checkout are injected (`generate`,
// `materializeBase`), so these cases need neither a git history nor a tsx run;
// the diff itself is the real `git diff --no-index`. The real wiring runs in the
// `Type Check · source gates` lane on every pull request.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARTIFACT_NAME,
  BASE_REGISTRY,
  SUMMARY_DIFF_CAP,
  describeDeltas,
  fenceFor,
  generateBaseRegistry,
  idDeltas,
  renderProjectionDiff,
  renderSummary,
  type Generate,
  type RunScript,
} from './render-projection-diff';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-projection-diff-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const migrated = (id: string) => ({ surface: 's', replacement: 'r', migrationId: id, toMajor: 18, rationale: 'why' });
const converted = (id: string) => ({ surface: 's', to: 't', conversionId: id, toMajor: 18 });

function manifest(migrationIds: string[], conversionIds: string[] = ['conv-a']): string {
  const record = (from: number, to: number) => ({
    from,
    to,
    added: [],
    converted: conversionIds.map(converted),
    migrated: migrationIds.map(migrated),
    removed: [],
  });
  return `${JSON.stringify({ protocolVersion: '18.0.0', supportFloor: 17, aggregate: record(17, 18), perMajor: [record(17, 18)] }, null, 2)}\n`;
}

const GUIDE = (rows: string[]) => `# Metadata protocol upgrade guide\n\n\`\`\`bash\nobjectstack migrate meta\n\`\`\`\n\n${rows.join('\n')}\n`;

/** Two fake trees whose generators emit the given bytes; `mode` bends one side's behaviour. */
function fixture(
  sides: { base: { json: string; guide: string }; head: { json: string; guide: string } },
  mode: { failSide?: 'base' | 'head'; legacySide?: 'base' | 'head' } = {},
) {
  const specDir = (side: string) => {
    const dir = path.join(tmp, side, 'packages', 'spec');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const head = specDir('head-tree');
  const base = specDir('base-tree');
  const generate: Generate = (dir, script, out) => {
    const side = dir === head ? 'head' : 'base';
    const isManifest = script === 'build-spec-changes.ts';
    if (mode.failSide === side) return { status: 1, output: `${script}: registry entry failed to parse` };
    const bytes = isManifest ? sides[side].json : sides[side].guide;
    if (mode.legacySide === side) {
      const legacy = path.join(dir, '..', '..', isManifest ? 'packages/spec/spec-changes.json' : 'docs/protocol-upgrade-guide.md');
      fs.mkdirSync(path.dirname(legacy), { recursive: true });
      fs.writeFileSync(legacy, bytes);
    } else {
      fs.writeFileSync(out, bytes);
    }
    return { status: 0, output: '' };
  };
  const outDir = path.join(tmp, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  return renderProjectionDiff({
    repoRoot: tmp,
    baseSha: 'b'.repeat(40),
    baseLabel: 'HEAD^1 = bbbbbbbbbb',
    outDir,
    headSpecDir: head,
    generate,
    materializeBase: () => base,
  });
}

const BASE = { json: manifest(['18.existing']), guide: GUIDE(['| `18.existing` |']) };
const ENTRY_ADDED = { json: manifest(['18.existing', '18.entry-only']), guide: GUIDE(['| `18.existing` |', '| `18.entry-only` |']) };

describe('render-projection-diff — the generated diff on a pull request', () => {
  it('a change that only adds a registry entry renders its id and the diff, and writes the artifact', () => {
    const result = fixture({ base: BASE, head: ENTRY_ADDED });

    expect(result.code).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.summary).toContain('+1 migrated (`18.entry-only`)');
    expect(result.summary).toContain('perMajor 17 → 18');
    expect(result.summary).toContain('"migrationId": "18.entry-only"');
    expect(result.headline).toContain('spec-changes.json +');
    const artifact = fs.readFileSync(path.join(tmp, 'out', 'spec-projections.diff'), 'utf8');
    expect(artifact).toContain('+| `18.entry-only` |');
    expect(artifact).toContain('"migrationId": "18.entry-only"');
  });

  it('an unchanged projection renders "no change" and writes no artifact', () => {
    const result = fixture({ base: BASE, head: BASE });

    expect(result.code).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.summary).toContain('| `spec-changes.json` | no change |');
    expect(result.summary).toContain('| `protocol-upgrade-guide.md` | no change |');
    expect(fs.existsSync(path.join(tmp, 'out', 'spec-projections.diff'))).toBe(false);
  });

  it('a head side that fails to generate is RED and names the projection', () => {
    const result = fixture({ base: BASE, head: ENTRY_ADDED }, { failSide: 'head' });

    expect(result.code).toBe(1);
    expect(result.summary).toContain('NOT rendered');
    expect(result.headline).toContain('head spec-changes.json: build-spec-changes.ts exited 1');
    expect(result.summary).toContain('build-spec-changes.ts: registry entry failed to parse');
  });

  it('a base side that fails to generate is RED too — nothing to diff against is not "no change"', () => {
    const result = fixture({ base: BASE, head: ENTRY_ADDED }, { failSide: 'base' });

    expect(result.code).toBe(1);
    expect(result.summary).not.toContain('no change');
  });

  it('a base whose generators predate --out is read from the path they write, and the summary says so', () => {
    const result = fixture({ base: BASE, head: ENTRY_ADDED }, { legacySide: 'base' });

    expect(result.code).toBe(0);
    expect(result.summary).toContain('+1 migrated (`18.entry-only`)');
    expect(result.summary).toContain('predate `--out`');
  });

  it('the head side never falls back to a committed path: a head generator that ignores --out is RED', () => {
    const result = fixture({ base: BASE, head: ENTRY_ADDED }, { legacySide: 'head' });

    expect(result.code).toBe(1);
    expect(result.headline).toContain('wrote neither');
  });
});

describe('render-projection-diff — a base whose migration registry is git-ignored', () => {
  /** A base `packages/spec` laid out as its archive would be: the generator and/or the registry, or neither. */
  function baseSpecDir(has: { generator: boolean; registry: boolean }): string {
    const dir = path.join(tmp, 'base-tree', 'packages', 'spec');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    if (has.generator) fs.writeFileSync(path.join(dir, 'scripts', BASE_REGISTRY.generator), '');
    if (has.registry) {
      fs.mkdirSync(path.dirname(path.join(dir, BASE_REGISTRY.file)), { recursive: true });
      fs.writeFileSync(path.join(dir, BASE_REGISTRY.file), '// committed\n');
    }
    return dir;
  }

  /** A fake runner that records each call and, unless told otherwise, writes the registry the way the generator does. */
  function recorder(result: { status: number; write: boolean; output?: string }) {
    const calls: [string, string][] = [];
    const run: RunScript = (dir, script) => {
      calls.push([dir, script]);
      if (result.write) fs.writeFileSync(path.join(dir, BASE_REGISTRY.file), '// generated\n');
      return { status: result.status, output: result.output ?? '' };
    };
    return { calls, run };
  }

  it('an archive with the generator but no registry runs the BASE generator in the base tree', () => {
    const dir = baseSpecDir({ generator: true, registry: false });
    fs.mkdirSync(path.dirname(path.join(dir, BASE_REGISTRY.file)), { recursive: true });
    const { calls, run } = recorder({ status: 0, write: true });

    expect(generateBaseRegistry(dir, run)).toBe(true);
    expect(calls).toEqual([[dir, 'build-migration-registry.ts']]);
    expect(fs.readFileSync(path.join(dir, BASE_REGISTRY.file), 'utf8')).toBe('// generated\n');
  });

  it('a base that committed its registry keeps it, and a base without the generator is left as it is', () => {
    for (const has of [{ generator: true, registry: true }, { generator: false, registry: true }, { generator: false, registry: false }]) {
      fs.rmSync(path.join(tmp, 'base-tree'), { recursive: true, force: true });
      const dir = baseSpecDir(has);
      const { calls, run } = recorder({ status: 0, write: true });

      expect(generateBaseRegistry(dir, run)).toBe(false);
      expect(calls).toEqual([]);
      if (has.registry) expect(fs.readFileSync(path.join(dir, BASE_REGISTRY.file), 'utf8')).toBe('// committed\n');
    }
  });

  it('a base registry generator that fails, or exits 0 without writing, is thrown with its output', () => {
    const dir = baseSpecDir({ generator: true, registry: false });

    // First line names the generator and its exit; the generator's output follows it — the
    // shape the failure summary splits on.
    expect(() => generateBaseRegistry(dir, recorder({ status: 1, write: false, output: 'entry failed to parse' }).run)).toThrow(
      /^build-migration-registry\.ts exited 1\b[^\n]*\nentry failed to parse$/,
    );
    expect(() => generateBaseRegistry(dir, recorder({ status: 0, write: false }).run)).toThrow(
      /^build-migration-registry\.ts exited 0\b[^\n]*src\/migrations\/registry\.ts/,
    );
  });

  it('a base whose registry cannot be generated is RED, named as the base', () => {
    const dir = baseSpecDir({ generator: true, registry: false });
    const generate: Generate = (_dir, script, out) => {
      fs.writeFileSync(out, script === 'build-spec-changes.ts' ? BASE.json : BASE.guide);
      return { status: 0, output: '' };
    };
    const head = path.join(tmp, 'head-tree', 'packages', 'spec');
    fs.mkdirSync(head, { recursive: true });
    const outDir = path.join(tmp, 'out');
    const result = renderProjectionDiff({
      repoRoot: tmp,
      baseSha: 'b'.repeat(40),
      baseLabel: 'HEAD^1 = bbbbbbbbbb',
      outDir,
      headSpecDir: head,
      generate,
      materializeBase: () => {
        generateBaseRegistry(dir, recorder({ status: 1, write: false, output: 'entry failed to parse' }).run);
        return dir;
      },
    });

    expect(result.code).toBe(1);
    expect(result.headline).toContain('base HEAD^1 = bbbbbbbbbb: build-migration-registry.ts exited 1');
    expect(result.summary).toContain('entry failed to parse');
  });

  it('the default runner executes the base generator by its own path, with the base package as cwd', () => {
    const dir = baseSpecDir({ generator: true, registry: false });
    // Resolves its package root from its own path, as the real generator does.
    fs.writeFileSync(
      path.join(dir, 'scripts', BASE_REGISTRY.generator),
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname, join } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        "const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');",
        "mkdirSync(join(pkgRoot, 'src', 'migrations'), { recursive: true });",
        "writeFileSync(join(pkgRoot, 'src', 'migrations', 'registry.ts'), `// cwd ${process.cwd()}\\n`);",
        '',
      ].join('\n'),
    );

    expect(generateBaseRegistry(dir)).toBe(true);
    expect(fs.readFileSync(path.join(dir, BASE_REGISTRY.file), 'utf8')).toBe(`// cwd ${fs.realpathSync(dir)}\n`);
  });
});

describe('render-projection-diff — the pieces', () => {
  it('idDeltas names ids gained and lost per record, and skips records that did not move', () => {
    const deltas = idDeltas(manifest(['a', 'b'], ['c1']), manifest(['b', 'z'], ['c1', 'c2']));

    expect(describeDeltas(deltas)).toEqual([
      'perMajor 17 → 18: +1 converted (`c2`); +1 migrated (`z`); −1 migrated (`a`)',
      'aggregate 17 → 18: +1 converted (`c2`); +1 migrated (`z`); −1 migrated (`a`)',
    ]);
    expect(idDeltas(manifest(['a']), manifest(['a']))).toEqual([]);
  });

  it('the diff fence outruns any backtick run in the content (the guide carries fences of its own)', () => {
    expect(fenceFor('no ticks')).toBe('```');
    expect(fenceFor('```bash\nx\n```')).toBe('````');
    expect(fenceFor('a ````` b')).toBe('``````');
  });

  it('a diff over the summary cap is truncated in the summary and points at the artifact', () => {
    const diff = `--- a/x\n+++ b/x\n${'+line\n'.repeat(Math.ceil(SUMMARY_DIFF_CAP / 6) + 10)}`;
    const summary = renderSummary('HEAD^1', [{ name: 'protocol-upgrade-guide.md', diff, headline: [], legacyBase: false }]);

    expect(summary).toContain(`Truncated at ${SUMMARY_DIFF_CAP}`);
    expect(summary).toContain(`\`${ARTIFACT_NAME}\``);
    expect(summary.length).toBeLessThan(SUMMARY_DIFF_CAP + 2_000);
  });
});
