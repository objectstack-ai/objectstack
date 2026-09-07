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
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { loadDisabledPackageIds, packageStateFileName, setPackageDisabled } from './package-state-store.js';

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

/**
 * The naming convention, recomputed here rather than asked of the store.
 *
 * ⛔ This is the point of the block: `#15733` / PR #15968 settled a spelling for
 * "one project root, folded into a filename component" — a sanitised basename,
 * a `-`, and 12 hex of the sha256 of the RESOLVED root — and joined it to the
 * environment id with a `.`. Asking `packageStateFileName` what it produces
 * would pin nothing; an independent second computation is what makes a drift
 * away from that convention go red.
 */
function expectedProjectKey(root: string): string {
    const digest = createHash('sha256').update(root).digest('hex').slice(0, 12);
    const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return slug.length > 0 ? `${slug}-${digest}` : digest;
}

/** The name every project shared before this card. */
function legacyFile(environmentId: string): string {
    return join(home, 'package-state', `${environmentId}.json`);
}

function writeLegacy(environmentId: string, disabled: string[]): string {
    mkdirSync(join(home, 'package-state'), { recursive: true });
    const file = legacyFile(environmentId);
    writeFileSync(file, `${JSON.stringify({ disabled }, null, 2)}\n`, 'utf8');
    return file;
}

describe('the file name follows PR #15968\'s convention (#15969)', () => {
    it('is <environment>.<slug>-<digest>.json', () => {
        const name = packageStateFileName(ENVIRONMENT_ID, projectA);

        expect(name).toBe(`${ENVIRONMENT_ID}.${expectedProjectKey(projectA)}.json`);
        // The shape, spelled out: a `.` between the two identities, and the
        // project half is a slug, a `-`, and 12 lowercase hex.
        expect(name).toMatch(/^env_local\.[a-z0-9-]*[a-z0-9]-[0-9a-f]{12}\.json$/);
        expect(name.startsWith(`${ENVIRONMENT_ID}.`)).toBe(true);
    });

    it('separates two projects and two environments independently', () => {
        expect(packageStateFileName(ENVIRONMENT_ID, projectA))
            .not.toBe(packageStateFileName(ENVIRONMENT_ID, projectB));
        expect(packageStateFileName(ENVIRONMENT_ID, projectA))
            .not.toBe(packageStateFileName('env_staging', projectA));
    });

    it('resolves the root, so two spellings of one project key one file', () => {
        expect(packageStateFileName(ENVIRONMENT_ID, `${projectA}/`))
            .toBe(packageStateFileName(ENVIRONMENT_ID, projectA));
        expect(packageStateFileName(ENVIRONMENT_ID, join(projectB, '..', 'alpha')))
            .toBe(packageStateFileName(ENVIRONMENT_ID, projectA));
    });

    it('still keys a root whose basename sanitises away to nothing', () => {
        const odd = join(sandbox, '+++');
        mkdirSync(odd, { recursive: true });
        const name = packageStateFileName(ENVIRONMENT_ID, odd);

        expect(name).toMatch(/^env_local\.[0-9a-f]{12}\.json$/);
        expect(name).not.toBe(packageStateFileName(ENVIRONMENT_ID, projectA));
    });

    it('keeps the environment id sanitised, so it cannot escape the directory', () => {
        expect(packageStateFileName('../../etc/evil', projectA))
            .toBe(`.._.._etc_evil.${expectedProjectKey(projectA)}.json`);
    });

    it('names the file the store actually writes', () => {
        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', true));

        expect(stateFiles()).toEqual([packageStateFileName(ENVIRONMENT_ID, projectA)]);
    });
});

describe('legacy <environment>.json migration is READ-ONCE (#15969)', () => {
    it('reads the legacy file while this project has no file of its own', () => {
        writeLegacy(ENVIRONMENT_ID, ['com.acme.reporting']);

        expect(inProject(projectA, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set(['com.acme.reporting']));
    });

    it('writes the new key and LEAVES THE LEGACY FILE IN PLACE', () => {
        const legacy = writeLegacy(ENVIRONMENT_ID, ['com.acme.reporting']);
        const before = readFileSync(legacy, 'utf8');

        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.billing', true));

        // The legacy content came across, under the new name...
        const own = join(home, 'package-state', packageStateFileName(ENVIRONMENT_ID, projectA));
        expect(JSON.parse(readFileSync(own, 'utf8'))).toEqual({
            disabled: ['com.acme.billing', 'com.acme.reporting'],
        });
        // ...and the legacy file is untouched, byte for byte. ⛔ A release that
        // deletes it strands an operator who rolls back.
        expect(existsSync(legacy)).toBe(true);
        expect(readFileSync(legacy, 'utf8')).toBe(before);
    });

    it('stops consulting the legacy file once this project has written one', () => {
        const legacy = writeLegacy(ENVIRONMENT_ID, ['com.acme.reporting']);

        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', false));
        // The legacy file still says disabled; this project's own file does not.
        expect(JSON.parse(readFileSync(legacy, 'utf8'))).toEqual({ disabled: ['com.acme.reporting'] });
        expect(inProject(projectA, () => loadDisabledPackageIds(ENVIRONMENT_ID))).toEqual(new Set());
    });

    it('does not let one project\'s migration clobber another\'s legacy state', () => {
        writeLegacy(ENVIRONMENT_ID, ['com.acme.reporting']);

        inProject(projectA, () => setPackageDisabled(ENVIRONMENT_ID, 'com.acme.reporting', false));

        // B has not migrated yet, so B still reads the legacy record — unchanged.
        expect(inProject(projectB, () => loadDisabledPackageIds(ENVIRONMENT_ID)))
            .toEqual(new Set(['com.acme.reporting']));
    });

    it('is per environment: a legacy file for another environment is not read', () => {
        writeLegacy('env_staging', ['com.acme.reporting']);

        expect(inProject(projectA, () => loadDisabledPackageIds(ENVIRONMENT_ID))).toEqual(new Set());
        expect(inProject(projectA, () => loadDisabledPackageIds('env_staging')))
            .toEqual(new Set(['com.acme.reporting']));
    });
});
