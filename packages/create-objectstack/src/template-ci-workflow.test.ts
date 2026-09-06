// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// The bundled template's own CI workflow (#16330).
//
// The scaffolder already creates a `.github/` directory at runtime — for one
// file, `copilot-instructions.md` — while the template's gates (`validate`,
// `typecheck`) shipped as npm scripts nothing ever ran. A scaffolded project
// therefore started with zero CI, and the product claim that metadata mistakes
// surface at authoring time rested entirely on a human remembering to type the
// command. `.github/workflows/ci.yml` is the fix; this file is what keeps it
// honest.
//
// Three properties, each of which failed silently before it was pinned:
//
//   1. The file is real YAML. A workflow GitHub cannot parse is not reported as
//      a broken workflow to the user who just scaffolded — it is reported as no
//      CI at all, which is indistinguishable from the defect being fixed here.
//   2. Every `pnpm <script>` step names a script the template's own
//      package.json declares. This is not hypothetical: the template shipped no
//      `lint` script while the card asked for a `pnpm lint` step, and that step
//      would have failed on the first push of every scaffolded project with
//      `Command "lint" not found`. The template now declares `lint` — measured
//      green against a real scaffold before the step was added — and this pin
//      is what keeps the step list and the script list from drifting apart
//      again, in either direction.
//   3. `.github/` survives the copy. It is the first dot-DIRECTORY the template
//      has ever carried, and dotfiles have been a packaging problem here before
//      (`_gitignore`; see TEMPLATE_FILE_ALIASES). The tarball half of that
//      question is answered by the packing ratchet in
//      `template-consistency.test.ts`, which packs for real; this file covers
//      the scaffold-copy half.
//
// On the YAML dependency: the sibling `scaffold-e2e-boot-probe.test.ts`
// deliberately hand-parses a workflow instead of importing a parser, because it
// needs a `run:` block's bytes verbatim and a parser would normalise a
// malformed file away. Here the parse IS the assertion, so that reasoning
// inverts — and `yaml` is a devDependency, which never reaches the published
// tarball (`files` ships `dist` alone).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { copyDir } from './template-copy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(HERE, '..');
const blankDir = path.join(pkgRoot, 'src', 'templates', 'blank');

/** Where the workflow lives in the template, and where it must land in a scaffold. */
const WORKFLOW_REL = '.github/workflows/ci.yml';
const workflowPath = path.join(blankDir, ...WORKFLOW_REL.split('/'));

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const readWorkflow = (): Record<string, any> =>
  parseYaml(fs.readFileSync(workflowPath, 'utf8')) as Record<string, any>;

/**
 * The `on:` block.
 *
 * Read through a fallback because `on` is a YAML **1.1** boolean literal: a
 * parser on that schema returns the trigger block under the key `true`, not
 * `"on"`. This package parses with `yaml`, which defaults to the 1.2 core
 * schema and keeps the string — the fallback is here so a schema change
 * downgrades to a still-correct read instead of an assertion about `undefined`.
 */
const triggersOf = (doc: Record<string, any>): unknown =>
  doc.on ?? doc[true as unknown as string];

const stepsOf = (doc: Record<string, any>): WorkflowStep[] =>
  Object.values(doc.jobs as Record<string, { steps?: WorkflowStep[] }>).flatMap(
    (job) => job.steps ?? [],
  );

describe('bundled template CI workflow', () => {
  it('ships a workflow at .github/workflows/ci.yml', () => {
    expect(
      fs.existsSync(workflowPath),
      `the blank template must carry ${WORKFLOW_REL} — without it every scaffolded ` +
        'project starts with no CI and its validate/typecheck scripts are advisory',
    ).toBe(true);
  });

  it('parses as YAML and declares at least one job with steps', () => {
    const doc = readWorkflow();
    expect(typeof doc, 'the workflow did not parse to a mapping').toBe('object');
    expect(doc.name).toBeTruthy();

    const jobs = doc.jobs as Record<string, { steps?: unknown[] }>;
    expect(Object.keys(jobs).length, 'the workflow declares no jobs').toBeGreaterThan(0);
    for (const [id, job] of Object.entries(jobs)) {
      expect(Array.isArray(job.steps), `job "${id}" declares no steps`).toBe(true);
      expect(job.steps!.length, `job "${id}" has an empty step list`).toBeGreaterThan(0);
    }
  });

  it('runs on push and on pull_request', () => {
    const triggers = triggersOf(readWorkflow());
    const names = Array.isArray(triggers)
      ? triggers.map(String)
      : Object.keys(triggers as Record<string, unknown>);
    expect(names).toContain('push');
    expect(names).toContain('pull_request');
  });

  // The load-bearing one. A workflow step naming a script the project does not
  // declare fails with `Command "<script>" not found` on the first push — a
  // scaffold whose CI is red out of the box teaches the user to ignore CI,
  // which is worse than shipping none. Derived from the template's real
  // package.json rather than restated, so adding a step for a script that does
  // not exist (or deleting a script a step runs) reds here.
  it('runs only package.json scripts the template actually declares', () => {
    const templatePkg = JSON.parse(
      fs.readFileSync(path.join(blankDir, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    const invoked: string[] = [];
    for (const step of stepsOf(readWorkflow())) {
      if (!step.run) continue;
      for (const line of step.run.split('\n')) {
        // `pnpm <word>` where <word> is not a pnpm builtin is a script run.
        const m = /^\s*pnpm(?:\s+run)?\s+([a-z][a-z0-9:_-]*)/i.exec(line);
        if (!m) continue;
        const word = m[1];
        if (word === 'install' || word === 'exec' || word === 'dlx') continue;
        invoked.push(word);
      }
    }

    expect(invoked.length, 'the workflow runs no project script at all').toBeGreaterThan(0);
    for (const script of invoked) {
      expect(
        Object.keys(templatePkg.scripts),
        `${WORKFLOW_REL} runs \`pnpm ${script}\`, but the blank template's package.json ` +
          'declares no such script — the step would fail on the first push of every ' +
          'scaffolded project. Add the script to the template (and to the other ' +
          'scaffolder, packages/cli/src/commands/init.ts) or drop the step.',
      ).toContain(script);
    }

    // The three gates this workflow exists to run. `lint` is here on a
    // MEASUREMENT, not on the card's wording: scaffolded for real from the
    // repo-built scaffolder, `npm install` against the registry, then
    // `npm run lint` -> exit 0, "All checks passed". It is not a second
    // spelling of `validate` either — `validate.ts` and `lint.ts` share the
    // authoring-rule engine but only `lint.ts` imports `checkHookBodyLowering`,
    // so dropping this step drops that rule from every scaffolded project.
    expect(invoked).toContain('validate');
    expect(invoked).toContain('lint');
    expect(invoked).toContain('typecheck');
  });

  // Derived from the Dockerfile's build stage rather than restated: the
  // template states its Node floor there (its `engines` block carries only a
  // pnpm floor), so these are the same declaration and must not drift.
  it('pins the same Node major the template Dockerfile builds on', () => {
    const dockerfile = fs.readFileSync(path.join(blankDir, 'Dockerfile'), 'utf8');
    const fromNode = /^FROM\s+node:(\d+)[-\s]/m.exec(dockerfile);
    expect(fromNode, 'the template Dockerfile no longer builds on a node: base image').toBeTruthy();

    const setupNode = stepsOf(readWorkflow()).find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setupNode, 'the workflow has no actions/setup-node step').toBeTruthy();
    expect(
      String(setupNode!.with!['node-version']),
      "the workflow's Node pin and the Dockerfile's build image are one declaration",
    ).toBe(fromNode![1]);
  });

  // pnpm must be on PATH before setup-node runs, because `cache: pnpm` makes
  // setup-node shell out to pnpm to locate the store. Getting the order wrong
  // does not degrade — it kills the job in the setup step.
  it('acquires pnpm before the setup-node step that caches through it', () => {
    const steps = stepsOf(readWorkflow());
    const pnpmAt = steps.findIndex((s) => s.uses?.startsWith('pnpm/action-setup@'));
    const nodeAt = steps.findIndex((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(pnpmAt, 'the workflow never acquires pnpm').toBeGreaterThanOrEqual(0);
    expect(nodeAt).toBeGreaterThanOrEqual(0);
    if (String(steps[nodeAt].with?.cache ?? '') === 'pnpm') {
      expect(
        pnpmAt,
        'setup-node with `cache: pnpm` shells out to pnpm; acquiring pnpm after it ' +
          'fails the job with "Unable to locate executable file: pnpm"',
      ).toBeLessThan(nodeAt);
    }
  });

  it('pins every action to a version tag', () => {
    for (const step of stepsOf(readWorkflow())) {
      if (!step.uses) continue;
      expect(step.uses, `unpinned action reference: ${step.uses}`).toMatch(/@v\d+/);
    }
  });

  // The dot-DIRECTORY half of the packaging question. `.github/` is the first
  // one this template has carried; `copyDir` is what materialises a scaffold,
  // so this is the real copy, not a re-implementation of it. The tarball half
  // — whether `npm pack` strips the directory — is answered by the packing
  // ratchet in template-consistency.test.ts, which packs for real.
  it('lands in a scaffold under its real dot-directory name', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-ci-'));
    try {
      const collected: string[] = [];
      copyDir(blankDir, out, collected);

      const landed = path.join(out, ...WORKFLOW_REL.split('/'));
      expect(fs.existsSync(landed), `${WORKFLOW_REL} did not survive the scaffold copy`).toBe(true);
      expect(collected).toContain(WORKFLOW_REL);
      expect(fs.readFileSync(landed, 'utf8')).toBe(fs.readFileSync(workflowPath, 'utf8'));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
