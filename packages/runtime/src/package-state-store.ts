/**
 * Package lifecycle-state persistence (local-first).
 *
 * The in-memory {@link SchemaRegistry} loses package enable/disable state on
 * every restart because packages are re-registered from the compiled artifact
 * (always enabled). This store persists the *runtime lifecycle state* (which
 * packages an operator has disabled) outside the artifact so the choice
 * survives restarts.
 *
 * Storage is a small JSON file under the ObjectStack home directory, keyed by
 * BOTH the environment id and the project, so a disable leaks neither between
 * environments (`env_local` vs staging) nor between two projects that happen to
 * share one machine and one environment id:
 *
 *   <OS_HOME>/package-state/<environmentId>.<project>.json  →  { "disabled": ["id", …] }
 *
 * This is intentionally a flat file rather than a `sys_*` object: package
 * lifecycle state is runtime/operational state, not project metadata, and the
 * local-first install path already keeps per-environment data under OS_HOME.
 *
 * ## Why the project half exists (#15969 — driven, not reasoned)
 *
 * The name used to be `<environmentId>.json`, and both halves of where that
 * lived were machine-global: {@link resolveObjectStackHome} takes NO arguments
 * — `OS_HOME`, else `~/.objectstack` — and an environment id is not a project
 * identity. Two projects on one machine, both in the ordinary `env_local`
 * environment, therefore wrote ONE file. Driven with two real project roots,
 * one home and one environment id, that produced two failures with one cause:
 *
 * ```text
 * LEAK    B disables com.acme.billing → A's BOOT READ answers
 *         { com.acme.billing, com.acme.reporting } — A never installed,
 *         saw or disabled com.acme.billing.
 * CLOBBER A disables com.acme.reporting, B enables it → A reads {}.
 *         A's operator intent was erased from another project.
 * ```
 *
 * ⛔ Unlike the sibling supervision file (#15733), sharing here is not a wrong
 * *answer* — `loadDisabledPackageIds` is read at boot by `AppPlugin.start()`,
 * so it is a package taken out of another project's RUNNING SYSTEM. That is
 * why the maintainer's ruling (decision batch #57) is per-project keying: two
 * projects deployed to the same environment id must never share or overwrite
 * one state file.
 *
 * ## Which project, and the boundary that follows
 *
 * The identity is `process.cwd()` — the base every path in a boot with no
 * served-app anchor already resolves against, and the only project identity
 * this store is handed. ⚠️ Stated rather than fixed: `os serve` anchors host
 * resolution at the CONFIG's directory when that directory carries a
 * `package.json` (`servedAppRootOrCwd`, #11185), so `os serve /srv/app/x.ts`
 * run from elsewhere keys this file by the working directory while the CLI's
 * own supervision file keys by `/srv/app`. Both are internally consistent and
 * neither collides; unifying the two roots needs a project-root seam through
 * `AppPlugin`, which is a separate change.
 *
 * ## Migration: READ-ONCE, and the legacy file is NOT deleted
 *
 * A pre-existing `<environmentId>.json` is still read when this project has no
 * per-project file yet, and the first write lands under the new key. ⛔ The
 * legacy file is never deleted here — a machine that rolls back to the previous
 * release must still find its operator's disables where that release looks.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

import { resolveObjectStackHome } from './standalone-stack.js';

const DEFAULT_ENVIRONMENT_ID = 'default';

interface PackageStateFile {
    disabled?: string[];
}

function sanitizeEnvironmentId(environmentId?: string): string {
    const raw = (environmentId ?? process.env.OS_ENVIRONMENT_ID ?? DEFAULT_ENVIRONMENT_ID).trim();
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe.length > 0 ? safe : DEFAULT_ENVIRONMENT_ID;
}

/**
 * The project half of the file name: one project root folded into a single
 * filename-safe component.
 *
 * ⛔ Deliberately the SAME convention `os serve`'s runtime state file settled
 * on in #15733 / PR #15968 — a sanitised basename plus a 12-hex digest of the
 * resolved root, joined to the environment id with a `.` — because a second
 * spelling for one idea is the fork this repo has already paid for elsewhere.
 * The digest is what makes the name unique; the slug is what makes a home
 * directory legible to whoever is standing in front of it, and it is DERIVED,
 * never trusted: a root whose basename sanitises away to nothing is still
 * keyed correctly, it just reads as the digest alone.
 */
function projectStateKey(projectRoot: string): string {
    const absolute = resolve(projectRoot);
    const digest = createHash('sha256').update(absolute).digest('hex').slice(0, 12);
    const slug = basename(absolute).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return slug.length > 0 ? `${slug}-${digest}` : digest;
}

/**
 * The state file's name: `<environmentId>.<project>.json`.
 *
 * Neither identity is sufficient alone — the environment id keeps a staging
 * disable from reaching a local boot, and {@link projectStateKey} keeps ANOTHER
 * PROJECT's disable from reaching this one.
 *
 * Exported for the tests that pin the naming; ⛔ not re-exported from the
 * package index — this store is internal to `@objectstack/runtime`.
 */
export function packageStateFileName(environmentId: string | undefined, projectRoot: string): string {
    return `${sanitizeEnvironmentId(environmentId)}.${projectStateKey(projectRoot)}.json`;
}

function stateDir(): string {
    return join(resolveObjectStackHome(), 'package-state');
}

function stateFilePath(environmentId?: string): string {
    return join(stateDir(), packageStateFileName(environmentId, process.cwd()));
}

/**
 * The name every project shared before #15969. Read as a fallback while it
 * exists, ⛔ never written and ⛔ never deleted — see the migration note above.
 */
function legacyStateFilePath(environmentId?: string): string {
    return join(stateDir(), `${sanitizeEnvironmentId(environmentId)}.json`);
}

function readFileState(file: string): PackageStateFile | undefined {
    if (!existsSync(file)) return undefined;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as PackageStateFile;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        // Corrupt/partial file — treat as empty rather than crashing boot.
        return {};
    }
}

function readState(environmentId?: string): PackageStateFile {
    // This project's own file wins outright. The legacy name is consulted only
    // while this project has never written one, which is the read-once half of
    // the migration: the next write lands under the new key and this fallback
    // stops being reached.
    return readFileState(stateFilePath(environmentId)) ?? readFileState(legacyStateFilePath(environmentId)) ?? {};
}

function writeState(environmentId: string | undefined, state: PackageStateFile): void {
    const file = stateFilePath(environmentId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** Set of package ids currently persisted as disabled for this environment and project. */
export function loadDisabledPackageIds(environmentId?: string): Set<string> {
    const disabled = readState(environmentId).disabled;
    return new Set(Array.isArray(disabled) ? disabled.filter((id) => typeof id === 'string') : []);
}

/**
 * Persist the disabled/enabled state of a single package. Best-effort: failures
 * are surfaced to the caller so the HTTP layer can log, but disabling already
 * took effect in-memory regardless.
 */
export function setPackageDisabled(environmentId: string | undefined, packageId: string, disabled: boolean): void {
    const ids = loadDisabledPackageIds(environmentId);
    if (disabled) ids.add(packageId);
    else ids.delete(packageId);
    writeState(environmentId, { disabled: Array.from(ids).sort() });
}
