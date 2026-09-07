// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15969 — package lifecycle state is keyed by the PROJECT as well as the
 * environment id, so two projects on one machine stop sharing one disable list.
 *
 * ## The collision, DRIVEN before it was repaired
 *
 * `package-state-store` is the only durable record of which packages an
 * operator has disabled, and `AppPlugin.start()` replays it at boot. Both
 * halves of where that record lived were machine-global:
 * {@link resolveObjectStackHome} takes NO arguments — `OS_HOME`, else
 * `~/.objectstack` — and an environment id is not a project identity. So two
 * different projects on one machine, both in the ordinary `env_local`
 * environment, addressed ONE file:
 *
 * ```text
 *   <OS_HOME>/package-state/env_local.json      ← written by BOTH projects
 * ```
 *
 * Driven here rather than reasoned, with two real project directories, one
 * home and one environment id. Two failures came out of that one file:
 *
 * ```text
 * LEAK    project B disables com.acme.billing
 *         → project A's BOOT READ now returns com.acme.billing as disabled,
 *           and A never installed, saw or disabled that package.
 * CLOBBER project A disables com.acme.reporting; project B enables it
 *         → A's disable is gone. A's operator intent was erased by an
 *           operator action taken in a different project.
 * ```
 *
 * ⛔ The second is the literal "second write clobbers the first". The first is
 * the one that makes this a shared BEHAVIOUR rather than a shared report:
 * `loadDisabledPackageIds` is read at boot (`app-plugin.ts`), so a disable in
 * project A takes a package out of project B's running system.
 *
 * ## Why the CWD, and why real directories
 *
 * The project identity this store can see is the process's working directory —
 * the same base every other path in a boot with no served-app anchor resolves
 * against. The two projects below are therefore two real directories the test
 * process actually stands in, one at a time: a `cwd` that is merely *named*
 * would prove nothing about a store that reads `process.cwd()` itself.
 *
 * ⛔ No boot, no server, no plugin chain. What is under test is which FILE a
 * disable lands in; a boot would add minutes and a plugin graph to a question
 * that has neither.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadDisabledPackageIds, setPackageDisabled } from './package-state-store.js';

const ENVIRONMENT_ID = 'env_local';

/** The ONE machine-global home both projects resolve to. */
let home: string;
/** Two projects on that one machine. Real directories — the test stands in them. */
let projectA: string;
let projectB: string;
let sandbox: string;

const originalCwd = process.cwd();
const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_ENVIRONMENT_ID: process.env.OS_ENVIRONMENT_ID };

/** Counters, printed by the assertions below: a drive that never ran is vacuous. */
let chdirsPerformed = 0;

/** Do one project's work while the process really stands in that project. */
function inProject<T>(root: string, work: () => T): T {
    process.chdir(root);
    chdirsPerformed += 1;
    try {
        return work();
    } finally {
        process.chdir(originalCwd);
    }
}

/** Every state file the shared home currently holds. */
function stateFiles(): string[] {
    const dir = join(home, 'package-state');
    return existsSync(dir) ? readdirSync(dir).sort() : [];
}

beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'os-15969-')));
    home = join(sandbox, 'home');
    projectA = join(sandbox, 'alpha');
    projectB = join(sandbox, 'beta');
    mkdirSync(home, { recursive: true });
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    process.env.OS_HOME = home;
    delete process.env.OS_ENVIRONMENT_ID;
});

afterEach(() => {
    process.chdir(originalCwd);
    rmSync(sandbox, { recursive: true, force: true });
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    if (envSnapshot.OS_ENVIRONMENT_ID === undefined) delete process.env.OS_ENVIRONMENT_ID;
    else process.env.OS_ENVIRONMENT_ID = envSnapshot.OS_ENVIRONMENT_ID;
});

describe('package state is keyed per project (#15969)', () => {
    // The control for every assertion below: the two projects really are two
    // different working directories, and the process really moves between them.
    it('stands in two distinct project roots', () => {
        const seen = [inProject(projectA, () => process.cwd()), inProject(projectB, () => process.cwd())];
        expect(seen[0]).toBe(projectA);
        expect(seen[1]).toBe(projectB);
        expect(seen[0]).not.toBe(seen[1]);
        expect(chdirsPerformed).toBeGreaterThanOrEqual(2);
    });

    // LEAK — the half that makes this a shared BEHAVIOUR: `loadDisabledPackageIds`
    // is the boot read, so a package B disabled must never come back disabled in A.
    it('does not leak project B\'s disable into project A\'s boot read', () => {
        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', true));
        inProject(projectB, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.billing', true));

        expect(inProject(projectA, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set(['com.acme.reporting']));
        expect(inProject(projectB, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set(['com.acme.billing']));
    });

    // CLOBBER — the literal "the second write must not clobber the first".
    it('does not let project B\'s enable erase project A\'s disable', () => {
        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', true));
        inProject(projectB, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', false));

        expect(inProject(projectA, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set(['com.acme.reporting']));
        expect(inProject(projectB, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set());
    });

    // The cause, stated as a file fact: one shared name is what produced both
    // failures above, so the repair has to be visible in the home directory.
    it('writes two files, one per project, for one environment id', () => {
        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', true));
        inProject(projectB, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.billing', true));

        const files = stateFiles();
        expect(files).toHaveLength(2);
        expect(files).not.toContain(`${ENVIRONMENT_ID}.json`);
        expect(new Set(files).size).toBe(2);
    });

    // The environment id keeps doing its own job: same project, two environments,
    // still two files. Neither identity is sufficient alone.
    it('still separates two environments within one project', () => {
        inProject(projectA, () => {
            setPackageDisabled('env_staging', 'com.acme.reporting', true);
            expect(loadDisabledPackageIds('env_staging')).toEqual(new Set(['com.acme.reporting']));
            expect(loadDisabledPackageIds('env_production')).toEqual(new Set());
        });
    });
});
