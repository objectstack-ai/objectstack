// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `export-gallery --check DIR` (`check.ts`, `check-cli.ts`). The clean tree is
 * not hand-made: it is the exporter's own output for the real crm run
 * (`fixture.ts`), with screenshots, so a check that refused what the exporter
 * writes would fail here first. Every failing tree is that clean tree with one
 * defect put in; each finding code has at least one case. The published
 * `@objectstack/cli` versions are a list handed in: no case reaches npm.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../../src/bin.js';
import { checkGallery, FINDING_CODES, LOCAL_PATH, renderFinding, type FindingCode, type GalleryFinding } from '../../src/export/check.js';
import { mainCheck } from '../../src/export/check-cli.js';
import { main as exportCliMain } from '../../src/export/cli.js';
import { APP_LAYOUT } from '../../src/export/contract.js';
import { exportGallery } from '../../src/export/exporter.js';
import { parseIndex, serializeIndex, type GalleryApp } from '../../src/export/manifest.js';
import type { CaptureScreenshots } from '../../src/export/screenshots.js';
import { CARD_ID, runCrm, tempDir, writeRecord } from './fixture.js';

const PUBLISHED = ['18.2.0', '18.3.0'] as const;
/** A PNG's first bytes: the eight-byte signature carries no NUL, the IHDR length that follows does. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const APP = `apps/${CARD_ID}`;

let clean = '';

beforeAll(async () => {
  const fx = await runCrm();
  const runs = tempDir('check-runs');
  clean = tempDir('check-clean');
  writeRecord(runs, fx.record);
  const shoot: CaptureScreenshots = async (input) => {
    mkdirSync(join(input.dir, 'screenshots'), { recursive: true });
    writeFileSync(join(input.dir, 'screenshots', 'list.png'), PNG);
    return { shots: [{ kind: 'list', file: 'screenshots/list.png', path: '/_console/apps/democrm_crm/democrm_account', object: 'democrm_account' }], skipped: [] };
  };
  // Every card through: the crm card is a `control` card the real guard refuses (as in exporter.test.ts).
  const s = await exportGallery({ runsDir: runs, outDir: clean, cards: [fx.scenario], recordings: [fx.recording], guard: () => ({ eligible: true, reasons: [] }), screenshots: shoot });
  expect(s.exported.map((e) => e.id)).toEqual([CARD_ID]);
  // The gallery's own hand-written files sit beside the generated ones.
  writeFileSync(join(clean, 'README.md'), '# ObjectStack Gallery\n\nSee https://github.com/objectstack-ai/objectstack and /docs/start.\n');
  writeFileSync(join(clean, 'apps', 'README.md'), '# apps/\n\nOne directory per verified scenario.\n');
}, 60_000);

/** A copy of the clean tree to break. */
function tree(): string {
  const dir = tempDir('check-case');
  cpSync(clean, dir, { recursive: true });
  return dir;
}

function check(dir: string, versions: readonly string[] = PUBLISHED) {
  let asked = 0;
  const findings = checkGallery(dir, {
    publishedVersions: () => {
      asked++;
      return versions;
    },
  });
  return { findings, asked };
}

const codes = (fs: GalleryFinding[]) => fs.map((f) => f.code);
const only = (fs: GalleryFinding[], code: FindingCode) => {
  expect(codes(fs)).toEqual(fs.map(() => code));
  return fs;
};

/** Rewrite the index through the exporter's own serializer, so only the edited field is wrong. */
function editApp(dir: string, edit: (a: GalleryApp) => GalleryApp): void {
  const ix = parseIndex(readFileSync(join(dir, 'index.json'), 'utf8'));
  writeFileSync(join(dir, 'index.json'), serializeIndex(ix.apps.map(edit)));
}

describe('checkGallery — clean trees', () => {
  it("the exporter's own output, with screenshots and the hand-written READMEs, has no finding", () => {
    const { findings, asked } = check(clean);
    expect(findings).toEqual([]);
    expect(asked).toBe(1);
  });

  it("today's gallery — no index.json, only apps/README.md — is an empty gallery: no finding, and npm is never asked", () => {
    const dir = tempDir('check-empty');
    writeFileSync(join(dir, 'README.md'), '# ObjectStack Gallery\n');
    mkdirSync(join(dir, 'apps'));
    writeFileSync(join(dir, 'apps', 'README.md'), '# apps/\n');
    expect(check(dir)).toEqual({ findings: [], asked: 0 });
  });
});

describe('checkGallery — index.json', () => {
  it('not JSON', () => {
    const dir = tree();
    writeFileSync(join(dir, 'index.json'), '{ "schemaVersion": 1,');
    const fs = only(check(dir).findings, 'index-json');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.message).toMatch(/^not JSON: /);
  });

  it('a key the exporter never writes, an unsorted list and a wrong schema version: one finding per schema issue', () => {
    const dir = tree();
    const ix = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { schemaVersion: number; apps: Array<Record<string, unknown>> };
    ix.schemaVersion = 2;
    ix.apps[0]!.stars = 5;
    writeFileSync(join(dir, 'index.json'), JSON.stringify(ix));
    const fs = only(check(dir).findings, 'index-json');
    expect(fs.map((f) => f.message.split(':')[0])).toEqual(['schemaVersion', 'apps.0']);
  });

  it('an index that does not validate is not read for apps: the app checks wait for the schema', () => {
    const dir = tree();
    const ix = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { apps: Array<Record<string, unknown>> };
    ix.apps.push({ ...ix.apps[0]!, id: 'aaa_first' }); // unsorted, and its path is not apps/<id>
    writeFileSync(join(dir, 'index.json'), JSON.stringify(ix));
    const { findings, asked } = check(dir);
    expect(new Set(codes(findings))).toEqual(new Set(['index-json']));
    expect(asked).toBe(0);
  });
});

describe('checkGallery — complete app directories', () => {
  it('an entry with no directory', () => {
    const dir = tree();
    rmSync(join(dir, APP), { recursive: true });
    expect(check(dir).findings).toEqual([{ code: 'app-missing', path: APP, message: `index.json lists \`${CARD_ID}\`, and there is no ${APP}/ directory` }]);
  });

  it.each([APP_LAYOUT.readme, APP_LAYOUT.runRecord, APP_LAYOUT.scorecardJson, APP_LAYOUT.scorecardMd, APP_LAYOUT.transcriptJson, APP_LAYOUT.transcriptMd])('an app directory without %s', (file) => {
    const dir = tree();
    rmSync(join(dir, APP, file));
    expect(only(check(dir).findings, 'app-incomplete').map((f) => f.path)).toEqual([`${APP}/${file}`]);
  });

  it('an app directory whose source/ lacks objectstack.config.ts, or has no source/ at all', () => {
    const dir = tree();
    rmSync(join(dir, APP, 'source', 'objectstack.config.ts'));
    expect(only(check(dir).findings, 'app-incomplete').map((f) => f.path)).toEqual([`${APP}/source`]);
    rmSync(join(dir, APP, 'source'), { recursive: true });
    expect(only(check(dir).findings, 'app-incomplete').map((f) => f.path)).toEqual([`${APP}/source`]);
  });

  it('a directory under apps/ that no entry lists, a staging directory included', () => {
    const dir = tree();
    mkdirSync(join(dir, 'apps', 'service_desk'));
    mkdirSync(join(dir, 'apps', `.staging-${CARD_ID}`));
    expect(only(check(dir).findings, 'app-unlisted').map((f) => f.path)).toEqual([`apps/.staging-${CARD_ID}`, 'apps/service_desk']);
  });
});

describe('checkGallery — screenshots', () => {
  it('⛔ an entry with no screenshot fails, and the file it no longer lists is named too', () => {
    const dir = tree();
    editApp(dir, (a) => ({ ...a, screenshots: [] }));
    expect(only(check(dir).findings, 'app-screenshots').map((f) => f.path)).toEqual([`${APP}/screenshots`, `${APP}/screenshots/list.png`]);
  });

  it('a listed screenshot that is not on disk', () => {
    const dir = tree();
    rmSync(join(dir, APP, 'screenshots', 'list.png'));
    expect(only(check(dir).findings, 'app-screenshots').map((f) => f.path)).toEqual([`${APP}/screenshots/list.png`]);
  });

  it('a file in screenshots/ the entry does not list', () => {
    const dir = tree();
    writeFileSync(join(dir, APP, 'screenshots', 'kanban.png'), PNG);
    expect(only(check(dir).findings, 'app-screenshots').map((f) => f.path)).toEqual([`${APP}/screenshots/kanban.png`]);
  });
});

describe('checkGallery — framework.version', () => {
  it('a prerelease is not a stable release, and npm is not asked about it', () => {
    const dir = tree();
    editApp(dir, (a) => ({ ...a, framework: { ...a.framework, version: '18.4.0-next.1' } }));
    const { findings, asked } = check(dir);
    expect(only(findings, 'framework-version')[0]!.message).toBe(`${CARD_ID}: framework.version \`18.4.0-next.1\` is not a stable MAJOR.MINOR.PATCH release of @objectstack/cli`);
    expect(asked).toBe(0);
  });

  it('a range is not a version', () => {
    const dir = tree();
    editApp(dir, (a) => ({ ...a, framework: { ...a.framework, version: '^18.3.0' } }));
    only(check(dir).findings, 'framework-version');
  });

  it('a stable-shaped version npm never published', () => {
    const dir = tree();
    editApp(dir, (a) => ({ ...a, framework: { ...a.framework, version: '18.9.9' } }));
    expect(only(check(dir).findings, 'framework-version')[0]!.message).toBe(`${CARD_ID}: framework.version \`18.9.9\` is not a published @objectstack/cli version`);
    // The same tree passes once the list carries it: the list decides, not the shape.
    expect(check(dir, [...PUBLISHED, '18.9.9']).findings).toEqual([]);
  });
});

describe('checkGallery — stray files, anywhere in the tree', () => {
  it('.env files, at the root and inside an app', () => {
    const dir = tree();
    writeFileSync(join(dir, '.env'), 'OS_AUTH_SECRET=x\n');
    writeFileSync(join(dir, APP, 'source', '.env.local'), 'X=1\n');
    writeFileSync(join(dir, APP, 'source', '.envrc'), 'export X=1\n');
    expect(only(check(dir).findings, 'env-file').map((f) => f.path)).toEqual(['.env', `${APP}/source/.env.local`, `${APP}/source/.envrc`]);
  });

  it('a node_modules directory, named once and not walked', () => {
    const dir = tree();
    mkdirSync(join(dir, APP, 'source', 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(dir, APP, 'source', 'node_modules', 'left-pad', 'index.js'), "module.exports = '/home/someone/x';\n");
    expect(check(dir).findings).toEqual([{ code: 'node-modules', path: `${APP}/source/node_modules`, message: 'an installed dependency tree never belongs in the gallery' }]);
  });

  it('a symbolic link, which is not followed', () => {
    const dir = tree();
    symlinkSync('/etc', join(dir, APP, 'source', 'etc'));
    expect(only(check(dir).findings, 'symlink').map((f) => f.path)).toEqual([`${APP}/source/etc`]);
  });

  it.each([
    ['a Linux home', '/home/runner/work/gallery/x'],
    ['a macOS home', '/Users/dana/scratch/x'],
    ['a temp directory', '/tmp/gallery-work-1/x'],
    ['a macOS temp directory', '/var/folders/zz/abc/T/x'],
    ['a file URL', 'file:///opt/x'],
    ['a Windows path, JSON-escaped', 'C:\\\\Users\\\\dana\\\\x'],
  ])('a local absolute path in a text file: %s', (_, path) => {
    const dir = tree();
    const f = join(dir, APP, 'run-record.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"$WORK', `"${path}`));
    const fs = only(check(dir).findings, 'local-path');
    expect(fs).toHaveLength(1);
    expect(fs[0]!.path).toMatch(new RegExp(`^${APP}/run-record\\.json:\\d+$`));
  });

  it('is not tripped by a URL path, a route, a relative path or a Q: line', () => {
    for (const text of ['https://example.com/home/x', 'GET /api/v1/data/democrm_account', 'see ./src/objects and ../home/x', '"Q:\\nwhich account"', '$WORK/crm-scratch/democrm']) {
      expect(LOCAL_PATH.test(text), text).toBe(false);
    }
  });

  it('does not read a binary file for paths: a screenshot is checked by name only', () => {
    const dir = tree();
    writeFileSync(join(dir, APP, 'screenshots', 'list.png'), Buffer.concat([PNG, Buffer.from('/home/runner/x')]));
    expect(check(dir).findings).toEqual([]);
  });
});

describe('every finding code has a case above', () => {
  it('the codes are the ones the header lists', () => {
    expect([...FINDING_CODES]).toEqual(['index-json', 'app-missing', 'app-incomplete', 'app-screenshots', 'app-unlisted', 'framework-version', 'env-file', 'node-modules', 'symlink', 'local-path']);
  });
});

describe('export-gallery --check — the command line', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };

  it('a clean tree: exit 0 and one closing line', () => {
    const c = capture();
    expect(mainCheck(['--check', clean], { io: c.io, publishedVersions: () => PUBLISHED })).toBe(0);
    expect(c.out).toEqual([`gallery check: clean · ${clean}`]);
  });

  it('a broken tree: exit 1, one line per finding, then the count', () => {
    const dir = tree();
    writeFileSync(join(dir, '.env'), 'X=1\n');
    rmSync(join(dir, APP, APP_LAYOUT.transcriptMd));
    const c = capture();
    expect(mainCheck(['--check', dir], { io: c.io, publishedVersions: () => PUBLISHED })).toBe(1);
    expect(c.out).toEqual([
      `app-incomplete ${APP}/transcript.md: a complete app directory holds transcript.md, and this one has none`,
      '.env: an environment file never belongs in the gallery'.replace(/^/, 'env-file '),
      `gallery check: 2 finding(s) · ${dir}`,
    ]);
    expect(renderFinding({ code: 'env-file', path: '.env', message: 'a\n  b' })).toBe('env-file .env: a b');
  });

  it('usage errors exit 2: no directory, a missing one, or another flag beside it', () => {
    for (const argv of [['--check'], ['--check', join(clean, 'nope')], ['--check', clean, '--out', clean], ['--out', clean, '--check', clean]]) {
      const c = capture();
      expect(mainCheck(argv, { io: c.io, publishedVersions: () => PUBLISHED }), argv.join(' ')).toBe(2);
      expect(c.out).toEqual([]);
    }
  });

  it('the checkout door (`pnpm … export-gallery --check DIR`) is the same check, before any card is loaded', async () => {
    const dir = tree();
    rmSync(join(dir, APP), { recursive: true });
    const c = capture();
    expect(await exportCliMain(['--check', dir], { check: { io: c.io, publishedVersions: () => PUBLISHED } })).toBe(1);
    expect(c.out[0]).toBe(`app-missing ${APP}: index.json lists \`${CARD_ID}\`, and there is no ${APP}/ directory`);
  });

  it('the published door (`objectstack-scenarios export-gallery --check DIR`) on an empty gallery, with no network', async () => {
    const dir = tempDir('check-bin');
    mkdirSync(join(dir, 'apps'));
    const c = capture();
    expect(await runCli(['export-gallery', '--check', dir], c.io)).toBe(0);
    expect(c.out).toEqual([`gallery check: clean · ${dir}`]);
    const bad = capture();
    expect(await runCli(['export-gallery', '--runs', dir], bad.io)).toBe(2);
    expect(bad.err[0]).toContain('the export itself runs from a checkout');
  });
});
