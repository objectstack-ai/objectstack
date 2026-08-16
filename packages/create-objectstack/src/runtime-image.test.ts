// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The gate for #9017. `dispatch-gates.mjs` reports "No check family names the
// given paths in its own source" for this surface, so the check farm will not
// catch a regression here — this file is the only thing that will.
//
// Every assertion below therefore runs against SCAFFOLDED OUTPUT, produced with
// the real `copyDir` + `syncObjectStackDeps` + `pinRuntimeImage`, never against
// the template's bytes. Grepping the template for a version string would prove
// nothing about what a user's generated app actually contains — the same class
// of mistake as asserting on a config object instead of what the client
// resolved. The defect being guarded is precisely a disagreement between two
// emitted files, so both have to be read out of a scaffold.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyDir } from './template-copy.js';
import { syncObjectStackDeps } from './pkg-utils.js';
import { readResolvedCliVersion, pinRuntimeImage } from './runtime-image.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blankTemplate = path.join(pkgRoot, 'src', 'templates', 'blank');
const ownVersion = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'),
).version;

/** The runtime tag of a scaffolded Dockerfile. */
function runtimeTag(dir: string): string | undefined {
  const line = fs
    .readFileSync(path.join(dir, 'Dockerfile'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('FROM ghcr.io/objectstack-ai/objectstack:'));
  return line?.split(':').pop()?.trim();
}

/** The `@objectstack/cli` range of a scaffolded package.json. */
function cliRange(dir: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return pkg.devDependencies['@objectstack/cli'];
}

/**
 * Does `version` satisfy the caret `range` the scaffolder writes? Deliberately
 * a satisfies-check and not an equality one: the emitted package.json carries
 * `^X.Y.Z` and the tag names the version npm RESOLVED inside that range, so
 * equality would be the wrong agreement predicate and would pass only by
 * accident on a freshly published major.
 */
function satisfiesCaret(range: string, version: string): boolean {
  const r = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!r || !v) return false;
  const [rMaj, rMin, rPat] = r.slice(1).map(Number);
  const [vMaj, vMin, vPat] = v.slice(1).map(Number);
  if (vMaj !== rMaj) return false;
  if (vMin !== rMin) return vMin > rMin;
  return vPat >= rPat;
}

/** Scaffold the blank template the way index.ts does, up to the install. */
function scaffold(dir: string): void {
  copyDir(blankTemplate, dir, []);
  const pkgPath = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = 'my-app';
  syncObjectStackDeps(pkg, ownVersion);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/** Plant an installed `@objectstack/cli`, i.e. what `npm install` leaves. */
function installCli(dir: string, version: string): void {
  const cliDir = path.join(dir, 'node_modules', '@objectstack', 'cli');
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(
    path.join(cliDir, 'package.json'),
    JSON.stringify({ name: '@objectstack/cli', version }) + '\n',
  );
}

describe('scaffolded Dockerfile runtime image tag (#9017)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-runtime-image-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('with dependencies installed (the default path)', () => {
    // The version npm resolved is deliberately NOT the range's floor: that is
    // the normal case (`^17.0.0` installs the newest 17.x) and it is the case
    // that would go unnoticed if the tag were taken from package.json instead.
    const resolved = `${String(ownVersion).split('.')[0]}.4.2`;

    beforeEach(() => {
      scaffold(dir);
      installCli(dir, resolved);
      const result = pinRuntimeImage(dir, readResolvedCliVersion(dir)!);
      expect(result.pinned, 'pinRuntimeImage refused the scaffolded Dockerfile').toBe(true);
    });

    it('pins the FROM tag to the @objectstack/cli the project resolved', () => {
      expect(runtimeTag(dir)).toBe(resolved);
    });

    it('emits a tag that agrees with the emitted package.json range', () => {
      const range = cliRange(dir);
      const tag = runtimeTag(dir)!;
      expect(
        satisfiesCaret(range, tag),
        `scaffolded Dockerfile pins :${tag} but the scaffolded package.json ` +
          `asks for "${range}" — the generated app would run a runtime image ` +
          'that is not the CLI building its artifact (#9017)',
      ).toBe(true);
    });

    it('never leaves the floating tag behind', () => {
      expect(runtimeTag(dir)).not.toBe('latest');
    });

    // The whole defect was a comment and a line disagreeing. Pinning the line
    // while leaving an instruction to pin by hand would move the contradiction
    // rather than remove it.
    it('stops instructing a manual pin the scaffolder just performed', () => {
      const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
      expect(dockerfile).not.toMatch(/pin it to that version/i);
      expect(dockerfile).not.toMatch(/could not be resolved for you/i);
      expect(dockerfile).toMatch(/Pinned at scaffold time/);
    });

    it('leaves the rest of the Dockerfile intact', () => {
      const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('FROM node:22-slim AS build');
      expect(dockerfile).toContain(
        'COPY --from=build --chown=node:node /app/dist/objectstack.json /srv/app/objectstack.json',
      );
      expect(dockerfile).toContain('# ── Runtime: the official ObjectStack runtime image');
      // The build stage's FROM must not be touched by the runtime rewrite.
      expect(dockerfile.match(/^FROM /gm)).toHaveLength(2);
    });
  });

  describe('with --skip-install (no resolved version to pin to)', () => {
    beforeEach(() => {
      scaffold(dir);
    });

    it('has no resolved CLI version to read', () => {
      expect(readResolvedCliVersion(dir)).toBeUndefined();
    });

    // Honest fallback: nothing was resolved, so nothing is pinned — and the
    // comment's imperative is TRUE on this path, because the user really does
    // have to pin by hand.
    it('keeps `latest` and keeps telling the reader to pin it', () => {
      expect(runtimeTag(dir)).toBe('latest');
      const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toMatch(/pin it to\s+# that version/s);
      expect(dockerfile).not.toMatch(/Pinned at scaffold time/);
    });

    // The scaffold-e2e workflow scaffolds with --skip-install and builds the
    // generated Dockerfile against a runtime image it tags with the tag it
    // reads out of that very file. A tag it cannot parse would break that leg,
    // so the unpinned shape has to stay machine-readable too.
    it('leaves a FROM line the e2e can read a tag out of', () => {
      const line = fs
        .readFileSync(path.join(dir, 'Dockerfile'), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('FROM ghcr.io/objectstack-ai/objectstack:'));
      expect(line).toBeDefined();
      expect(
        /^FROM ghcr\.io\/objectstack-ai\/objectstack:[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(line!),
      ).toBe(true);
    });
  });

  describe('pinRuntimeImage refusals', () => {
    it('refuses a non-version tag instead of writing garbage', () => {
      scaffold(dir);
      const result = pinRuntimeImage(dir, 'latest');
      expect(result.pinned).toBe(false);
      expect(runtimeTag(dir)).toBe('latest');
    });

    it('reports a missing Dockerfile rather than throwing', () => {
      const result = pinRuntimeImage(dir, '17.0.0');
      expect(result.pinned).toBe(false);
      expect(result.pinned === false && result.reason).toMatch(/no Dockerfile/);
    });

    // The anchor is the FROM line. If a future template edit removes or
    // re-spells it, the pin must report that rather than silently no-op.
    it('reports a missing anchor rather than silently doing nothing', () => {
      scaffold(dir);
      const dockerfile = path.join(dir, 'Dockerfile');
      fs.writeFileSync(
        dockerfile,
        fs
          .readFileSync(dockerfile, 'utf8')
          .replace(/^FROM ghcr\.io.*$/m, 'FROM some-other-registry/objectstack:latest'),
      );
      const result = pinRuntimeImage(dir, '17.0.0');
      expect(result.pinned).toBe(false);
      expect(result.pinned === false && result.reason).toMatch(/no `FROM ghcr\.io/);
    });
  });

  // The tests above call pinRuntimeImage directly, so on their own they would
  // stay green if the scaffolder simply stopped calling it — every user would
  // get `latest` and nothing would go red. index.ts cannot be imported to close
  // that behaviourally (it calls program.parse() at module scope), so its TEXT
  // is asserted, the same compromise template-consistency.test.ts already makes
  // for the skills-install command.
  describe('scaffolder wiring', () => {
    const source = fs.readFileSync(path.join(pkgRoot, 'src', 'index.ts'), 'utf8');

    it('resolves and pins after installing', () => {
      expect(
        source,
        'index.ts no longer reads the resolved CLI version — the scaffolded ' +
          'Dockerfile would keep the floating `latest` tag (#9017)',
      ).toContain('readResolvedCliVersion(targetDir)');
      expect(
        source,
        'index.ts no longer pins the runtime image — the scaffolded Dockerfile ' +
          'would keep the floating `latest` tag (#9017)',
      ).toContain('pinRuntimeImage(targetDir, resolved)');
    });

    it('pins only when the install actually succeeded', () => {
      // Without node_modules there is no resolved version, so a pin attempted
      // after a FAILED install would silently do nothing while the comment
      // still promised it had happened.
      expect(source).toMatch(/if \(installed\)[\s\S]{0,400}pinRuntimeImage/);
    });
  });

  describe('readResolvedCliVersion', () => {
    it('reads the installed CLI version', () => {
      installCli(dir, '17.4.2');
      expect(readResolvedCliVersion(dir)).toBe('17.4.2');
    });

    it('reads a prerelease, which ghcr publishes as its own exact tag', () => {
      installCli(dir, '18.0.0-rc.3');
      expect(readResolvedCliVersion(dir)).toBe('18.0.0-rc.3');
    });

    it('ignores a version it cannot turn into a tag', () => {
      installCli(dir, 'workspace:*');
      expect(readResolvedCliVersion(dir)).toBeUndefined();
    });
  });
});
