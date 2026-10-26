import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#4160 — `next dev` mints agent-rules files into `apps/site`, and this
 * repo must be in one of the two end states Next.js expects (ignored, or
 * committed) rather than neither.
 *
 * What happens without this: from next 16.3 — the #4094 bump; on 16.2 the docs
 * were bundled but nothing was generated — `next dev` calls
 * `ensureAgentRulesForDev` (`node_modules/next/dist/server/lib/app-info-log.js`),
 * which asks `@vercel/detect-agent` whether an AI coding agent is driving the
 * session (CLAUDECODE / CURSOR / CODEX / AI_AGENT / ... in the environment — all
 * true for the agents that work this repo) and then writes `AGENTS.md` and
 * `CLAUDE.md` beside the app's `next.config`. They were neither tracked nor
 * ignored, so they surfaced as `??` in `git status` from merely RUNNING the app,
 * and the generated block says "committing it with your work keeps the tree
 * clean" — an untracked file that appears on its own and asks to be committed is
 * exactly what `git add -A` sweeps into an unrelated PR (the objectui#3430
 * shape). `apps/site/CLAUDE.md` is a bare `@AGENTS.md` import, so committing it
 * would also splice framework-owned prose into this repo's binding instruction
 * chain.
 *
 * The fix has two independent halves and this file pins both, because each
 * covers the other's failure mode:
 *
 *  - `agentRules: false` in `apps/site/next.config.mjs` — the upstream opt-out,
 *    which stops the write instead of hiding it. Upstream-owned: a later next
 *    release may rename or drop the key, and an unknown key in that
 *    `z.strictObject` config schema only warns.
 *  - the two paths gitignored (repo root `.gitignore` + `apps/site/.gitignore`,
 *    matching how this repo ignores the app's other dev-time artifacts) — ours,
 *    and still correct if the flag stops working or another entry point
 *    (`create-next-app`, `@next/codemod agents-md`) writes the files.
 *
 * Reverse verification (direction predicted before running — the two halves fail
 * DIFFERENTLY, which is the point):
 *  - drop `agentRules: false` and re-run `next dev`: the files are minted again,
 *    but `git status --short` stays clean because the ignore catches them;
 *    the config case here goes red.
 *  - drop the ignore lines: `next dev` mints nothing (the flag holds), so the
 *    tree looks fine — nothing observable regresses until the flag stops
 *    working. That silence is why the ignore is pinned here rather than left to
 *    a dev-server run to notice.
 *
 * The filenames are upstream literals, so they are not hardcoded as the only
 * source of truth: the last case reads them back out of the installed next and
 * fails if it starts minting a name this repo does not ignore.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE_DIR = path.join(repoRoot, 'apps/site');
const NEXT_CONFIG = path.join(SITE_DIR, 'next.config.mjs');

/** Repo-relative paths `next dev` writes today. */
const MINTED = ['apps/site/AGENTS.md', 'apps/site/CLAUDE.md'] as const;

/** `git check-ignore` exits 0 when ignored, 1 when not, >1 on error. */
function isIgnored(relPath: string): boolean {
  const result = spawnSync('git', ['check-ignore', '-q', '--', relPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relPath}: ${result.stderr ?? ''}`);
  }
  return result.status === 0;
}

function isTracked(relPath: string): boolean {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', relPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0;
}

/**
 * Directory of the `next` package as `apps/site` resolves it. Under pnpm's
 * strict linker this is the app's own copy, which is the one `next dev` loads.
 */
function resolveNextDir(): string {
  const require = createRequire(path.join(SITE_DIR, 'noop.js'));
  return path.dirname(require.resolve('next/package.json'));
}

describe('objectui#4160 — the agent-rules files `next dev` mints in apps/site are ignored, not committed', () => {
  it.each(MINTED)('%s is gitignored', (relPath) => {
    expect(
      isIgnored(relPath),
      `${relPath} is minted by \`next dev\` (agent detected) and is not gitignored, so it ` +
        'shows up as an untracked file after merely running the docs site — and its own text ' +
        'invites the reader to commit it. Restore the entry in the repo root .gitignore.'
    ).toBe(true);
  });

  it.each(MINTED)('%s is not tracked either — the decision was ignore, not commit', (relPath) => {
    // The other end state Next.js offers. Committing it would pin tool-minted
    // prose that the next `next` bump rewrites, inside this repo's instruction
    // namespace; a tracked copy would also go dirty on every dev-server run.
    expect(
      isTracked(relPath),
      `${relPath} is tracked. objectui#4160 chose to IGNORE these files: the block is minted ` +
        "per next version and conflicts with this repo's own AGENTS.md authority chain. " +
        'If that decision is being reversed, this case and the .gitignore entries go together.'
    ).toBe(false);
  });

  it('turns the minting off at the source with `agentRules: false`', () => {
    const source = fs.readFileSync(NEXT_CONFIG, 'utf8');
    expect(
      /^\s*agentRules:\s*false\s*,/m.test(source),
      'apps/site/next.config.mjs no longer sets `agentRules: false`, so `next dev` writes ' +
        'AGENTS.md and CLAUDE.md again on every run. The gitignore entries keep them out of ' +
        '`git status`, but the files still land in the working tree.'
    ).toBe(true);
  });
});

describe('objectui#4160 — the pin still matches the installed next', () => {
  const nextDir = resolveNextDir();
  const generator = path.join(nextDir, 'dist/server/lib/generate-agent-files.js');
  const configSchema = path.join(nextDir, 'dist/server/config-schema.js');

  it('finds the generator this pin is about', () => {
    // A zero-hit lookup would make the next case vacuously green — the
    // empty-fixture trap. If next restructures its dist, this is the signal to
    // re-check where the agent files come from, not something to delete.
    expect(
      fs.existsSync(generator),
      `${path.relative(repoRoot, generator)} is gone. Re-verify whether \`next dev\` still ` +
        'mints agent files (and under what names) before trusting the entries in .gitignore.'
    ).toBe(true);
  });

  it('ignores every filename the installed next actually writes', () => {
    // Read the names back out of upstream rather than trusting our own list: a
    // next bump that renames AGENTS.md, or adds a third file, would otherwise
    // re-expose the trap through a path nothing here covers.
    const source = fs.readFileSync(generator, 'utf8');
    const written = [...new Set(Array.from(source.matchAll(/'([\w.-]+\.md)'/g), (m) => m[1]))].sort();

    expect(written.length, 'no .md filename literals found in the generator').toBeGreaterThan(0);

    const uncovered = written.filter((name) => !isIgnored(`apps/site/${name}`));
    expect(
      uncovered,
      `next ${JSON.stringify(written)} mints ${JSON.stringify(uncovered)} under apps/site, ` +
        'which nothing in this repo ignores. Add the path(s) to the root .gitignore and to ' +
        'apps/site/.gitignore.'
    ).toEqual([]);
  });

  it('still accepts the `agentRules` opt-out key', () => {
    // next validates next.config against a `z.strictObject`; an unknown key only
    // WARNS at dev-server startup. So a bump that renames or removes this key
    // silently turns the opt-out back on, and only the gitignore half survives.
    const schema = fs.readFileSync(configSchema, 'utf8');
    expect(
      /\bagentRules\s*:/.test(schema),
      'the installed next no longer declares `agentRules` in its config schema, so the opt-out ' +
        'in apps/site/next.config.mjs is now an unrecognized key (a startup warning, not an ' +
        'error) and the files are being minted again. Find the replacement flag; the gitignore ' +
        'entries are the only thing holding until then.'
    ).toBe(true);
  });
});
