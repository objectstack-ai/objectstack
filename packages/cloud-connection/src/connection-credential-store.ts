// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConnectionCredentialStore — where a SELF-HOSTED runtime keeps the
 * credential it received at bind time (cloud ADR-0008 consumption side).
 *
 * Cloud-hosted runtimes authenticate to the control plane with an
 * env→cloud service key (`OS_CLOUD_API_KEY`, injected by the cloud).
 * Self-hosted runtimes have no such key: their identity ceremony is the
 * RFC 8628 device-code bind, whose response carries a one-time
 * `runtime_token` (`oscc_…`). This store persists that bearer — plus the
 * environment id the binding established — in the instance's home, beside
 * the LocalManifestSource ledger ({@link resolveConnectionCredentialPath}):
 *
 *   | `OS_HOME`  | credential file                           |
 *   |------------|-------------------------------------------|
 *   | set        | `<OS_HOME>/cloud-connection.json`         |
 *   | unset      | `<cwd>/.objectstack/cloud-connection.json`|
 *
 * Like everything on the runtime's serving path, reads are local file
 * operations: presenting the credential is how the runtime reaches the
 * control plane for org-scoped catalog/install calls, but nothing at
 * boot or serve time DEPENDS on those calls succeeding.
 *
 * Treat the file as a secret (it is written 0600).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { readOsHome } from './local-manifest-source.js';

/** Persisted binding credential + context. */
export interface StoredConnectionCredential {
    /** The `oscc_…` runtime bearer returned ONCE by the bind route. */
    runtimeToken: string;
    /**
     * Cloud-minted durable runtime identity (ADR runtime-identity-binding).
     * Presented as a claim on re-bind so the registration survives token
     * rotation. Absent on stores written before v2.
     */
    runtimeId?: string;
    /**
     * Control-plane environment id — set only when the binding targeted a
     * cloud-hosted environment. Self-hosted v2 registrations have none.
     */
    environmentId?: string;
    /** Control-plane base URL the binding was made against. */
    controlPlaneUrl?: string;
    organizationId?: string;
    accountEmail?: string;
    boundAt?: string;
}

/**
 * The store location relative to the runtime's working directory — where the
 * file lives when `OS_HOME` is unset, and where every release before the file
 * followed `OS_HOME` wrote it ({@link resolveConnectionCredentialPath}).
 */
export const DEFAULT_CONNECTION_CREDENTIAL_PATH = '.objectstack/cloud-connection.json';

/** The file's name under `OS_HOME`. */
const HOME_CREDENTIAL_FILE = 'cloud-connection.json';

/** Where the credential file lives, and the earlier location it moves from once. */
export interface ConnectionCredentialLocation {
    /** The file the store reads and writes. */
    path: string;
    /**
     * The working-directory file a release before this one wrote, which
     * {@link ConnectionCredentialStore.moveLegacyFile} moves to {@link path}
     * once. `null` when it is {@link path} itself, or when `path` is under the
     * ephemeral home of an `os dev --fresh` run.
     */
    legacyPath: string | null;
}

/**
 * The ONE answer to "where is this single node's binding credential file".
 *
 * Set, `OS_HOME` is the home the rest of the instance's state follows (the
 * default database, the uploads root, the install ledger), and the shipped
 * image puts it on the data volume. The file used to resolve from the working
 * directory alone, which in a container is the image's own layer: a restart
 * kept the binding, a recreate (a compose recreate, an image upgrade) lost it,
 * and an online-licensed node fell back to Community until someone bound it
 * again. `os start` in project mode sets `OS_HOME` to `<cwd>/.objectstack`, so
 * its file is the one it always was.
 *
 * Unset, the file stays where it always was. `OS_HOME` is read the one way
 * the install ledger reads it ({@link readOsHome}).
 *
 * `legacyPath` names the working-directory file whenever the answer moved away
 * from it, so a binding an earlier release recorded there is moved once
 * instead of silently disappearing — except under the ephemeral home an
 * `os dev --fresh` run announces, which is deleted when the run exits: the
 * project's binding must not be moved into it.
 */
export function resolveConnectionCredentialPath(
    opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): ConnectionCredentialLocation {
    const legacy = resolve(opts.cwd ?? process.cwd(), DEFAULT_CONNECTION_CREDENTIAL_PATH);
    const home = readOsHome(opts.env);
    if (!home) return { path: legacy, legacyPath: null };
    const path = join(home.dir, HOME_CREDENTIAL_FILE);
    if (path === legacy || home.ephemeral) return { path, legacyPath: null };
    return { path, legacyPath: legacy };
}

/** What {@link ConnectionCredentialStore.moveLegacyFile} moved, and where. */
export interface LegacyCredentialMove {
    /** The working-directory file the credential was moved from (now removed). */
    from: string;
    /** The file it was moved to. */
    to: string;
}

export class ConnectionCredentialStore {
    /** Resolved file path. */
    readonly path: string;
    /**
     * The earlier file location {@link moveLegacyFile} moves from — set only on
     * a default construction whose {@link resolveConnectionCredentialPath}
     * answer moved away from the working directory. An explicit path is the
     * host's own choice and moves nothing into it.
     */
    readonly legacyPath: string | null;

    constructor(path?: string) {
        if (path) {
            this.path = resolve(path);
            this.legacyPath = null;
        } else {
            const location = resolveConnectionCredentialPath();
            this.path = location.path;
            this.legacyPath = location.legacyPath;
        }
    }

    /**
     * Move the working-directory file an earlier release wrote to {@link path},
     * ONCE: only while {@link path} does not exist yet. When both exist the file
     * at {@link path} is the binding, and the old one is left exactly as it is.
     *
     * Answers `null` when there is nothing to move. The bytes land in a sibling
     * file written 0600 and renamed into place — the two locations are usually
     * on different filesystems (the image's layer and the data volume), where a
     * plain rename cannot reach — and the old file is removed only after the new
     * one is in place, so a failure part-way leaves the old file to move again
     * at the next boot. A failure throws: the caller reports it.
     *
     * Not called by {@link read}: a reader must not write. The plugin calls it
     * once, at boot.
     */
    moveLegacyFile(): LegacyCredentialMove | null {
        const from = this.legacyPath;
        if (!from || existsSync(this.path) || !existsSync(from)) return null;
        const bytes = readFileSync(from);
        mkdirSync(dirname(this.path), { recursive: true });
        const staging = join(dirname(this.path), `.${basename(this.path)}.${process.pid}.moving`);
        try {
            writeFileSync(staging, bytes, { mode: 0o600 });
            chmodSync(staging, 0o600);
            renameSync(staging, this.path);
        } catch (err) {
            try { unlinkSync(staging); } catch { /* never written */ }
            throw err;
        }
        unlinkSync(from);
        return { from, to: this.path };
    }

    /**
     * Read the stored credential; null when absent or unreadable.
     *
     * An IDENTITY RESIDUAL — `runtimeToken: ''` with a `runtimeId` — is a
     * valid record: unbind leaves one behind so a later re-bind to the same
     * org claims the same registration (ADR runtime-identity-binding §2.1).
     * Callers already treat the empty token as "no credential".
     */
    read(): StoredConnectionCredential | null {
        if (!existsSync(this.path)) return null;
        try {
            const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
            if (!parsed || typeof parsed.runtimeToken !== 'string') return null;
            if (!parsed.runtimeToken && !(typeof parsed.runtimeId === 'string' && parsed.runtimeId)) return null;
            return parsed as StoredConnectionCredential;
        } catch {
            return null;
        }
    }

    /** Persist (replace) the credential. Written 0600 — it is a secret. */
    write(credential: StoredConnectionCredential): void {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(credential, null, 2), { encoding: 'utf8', mode: 0o600 });
    }

    /** Remove the credential (unbind). Returns false when nothing was stored. */
    clear(): boolean {
        if (!existsSync(this.path)) return false;
        unlinkSync(this.path);
        return true;
    }
}
