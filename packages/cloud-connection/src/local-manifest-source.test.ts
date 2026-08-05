// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocalManifestSource — the local desired-state ledger (cloud ADR-0007 ⑤).
 * Pure local file operations: list/read/has/write/remove, corrupt-file
 * tolerance AND corrupt-file REPORTING on BOTH read paths — `list()` (#5413)
 * and `read()` (#5426) — and manifest-id sanitisation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalManifestSource, type InstalledManifestEntry } from './local-manifest-source.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lms-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const entry = (manifestId: string, version = '1.0.0'): InstalledManifestEntry => ({
    packageId: `pkg_${manifestId}`,
    versionId: version,
    manifestId,
    version,
    manifest: { id: manifestId, version },
    installedAt: '2026-06-12T00:00:00.000Z',
    installedBy: 'user-1',
});

describe('LocalManifestSource', () => {
    it('starts empty and lists nothing for a missing directory', () => {
        const src = new LocalManifestSource(join(dir, 'does-not-exist-yet'));
        expect(src.list()).toEqual({ entries: [], skipped: [] });
        // #5426 — absence carries NO failure. That is the whole distinction:
        // `{ entry: null }` means "never installed", and a consumer can tell it
        // apart from "installed, unreadable" without guessing.
        expect(src.read('com.acme.crm')).toEqual({ entry: null });
        expect(src.has('com.acme.crm')).toBe(false);
    });

    it('write → has/read/list round-trips and upserts by manifestId', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.crm'));
        expect(src.has('com.acme.crm')).toBe(true);
        expect(src.read('com.acme.crm').entry?.version).toBe('1.0.0');
        // A clean read reports no failure either — `failure` is a finding, not
        // a status field that is always present.
        expect(src.read('com.acme.crm').failure).toBeUndefined();

        src.write(entry('com.acme.crm', '1.1.0')); // upsert, same file
        expect(src.list().entries).toHaveLength(1);
        expect(src.read('com.acme.crm').entry?.version).toBe('1.1.0');
    });

    it('remove deletes the entry and reports absence', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.crm'));
        expect(src.remove('com.acme.crm')).toBe(true);
        expect(src.remove('com.acme.crm')).toBe(false);
        expect(src.list()).toEqual({ entries: [], skipped: [] });
    });

    it('tolerates a corrupt ledger file in both read paths — one bad file costs only itself', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.good'));
        writeFileSync(join(dir, 'com.acme.bad.json'), '{not json', 'utf8');

        // Tolerance was never the bug and has not changed: `list()` still hands
        // back the good entry, and `read()` still refuses to throw at a caller
        // that asked for the bad one.
        expect(src.list().entries.map((e) => e.manifestId)).toEqual(['com.acme.good']);
        expect(src.read('com.acme.bad').entry).toBeNull();
    });

    // ── #5426 — read()'s null said WHICH of the two things it meant ─────
    //
    // ⚠️ FIXTURE NOTE: the assertion above used to be this file's whole
    // statement about a corrupt single read — `expect(src.read('com.acme.bad'))
    // .toBeNull()`, which is the exact limb this issue removed and would have
    // stayed green for the wrong reason (a merged null is null either way).
    // Tolerance keeps its assertion above; the tests below pin the fact the old
    // one could not see.

    it('separates "never installed" from "installed but unreadable"', () => {
        const src = new LocalManifestSource(dir);
        // The issue's repro: a truncated ledger file for an installed package.
        writeFileSync(join(dir, 'com.acme.crm.json'), '{"manifestId":"com.acme.crm","manifest":{', 'utf8');

        const absent = src.read('com.acme.never-installed');
        const corrupt = src.read('com.acme.crm');

        // Both still hand back no entry — the tolerant half is unchanged.
        expect(absent.entry).toBeNull();
        expect(corrupt.entry).toBeNull();
        // …and they are now TELLABLE APART, which is the entire issue. Two
        // handlers check `has()` first, so for them only the second can happen,
        // and they had nothing to say about it but "Failed to read manifest
        // cache."
        expect(absent.failure).toBeUndefined();
        expect(corrupt.failure).toBeDefined();
        expect(corrupt.failure!.file).toBe('com.acme.crm.json');
        // The THROWN object, not a sentence this class invented.
        expect(corrupt.failure!.cause).toBeInstanceOf(Error);
        expect(String((corrupt.failure!.cause as Error).message)).toMatch(/JSON/i);
    });

    it('read(): reports an UNREADABLE file, not only an unparseable one', () => {
        const src = new LocalManifestSource(dir);
        // A directory where the ledger file should be: `readFileSync` throws
        // EISDIR. Same swallowed null before #5426, entirely different repair —
        // which is why the cause travels instead of a summary.
        mkdirSync(join(dir, 'com.acme.crm.json'));

        const { entry, failure } = src.read('com.acme.crm');

        expect(entry).toBeNull();
        expect((failure!.cause as NodeJS.ErrnoException).code).toBe('EISDIR');
    });

    it('names the SANITISED filename, so the reported path is the real one', () => {
        // `read()` reports the file it actually opened, not the manifest id it
        // was handed — a consumer joins it onto the ledger dir and tells the
        // operator what to repair. A hostile/odd id must not produce a path
        // that points at nothing.
        const src = new LocalManifestSource(dir);
        writeFileSync(join(dir, 'com_acme_crm@bad.json'.replace('@', '_')), 'nope', 'utf8');

        const { failure } = src.read('com_acme_crm@bad');

        expect(failure!.file).toBe('com_acme_crm_bad.json');
        expect(existsSync(join(dir, failure!.file))).toBe(true);
    });

    // ── #5413 — a skipped file is REPORTED, not merely skipped ──────────
    //
    // Before this, `list()` returned a bare array: a short list carried no
    // difference in the return value, no log and no count, so `rehydrate()`
    // dropped an installed app out of a runtime in silence, `handleList()`
    // served the console a list that looked whole, and `os doctor` printed
    // `✓ Unique scope` over manifests it had never parsed.

    it('names every file it could not parse, and what parsing threw', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.good'));
        // The issue's repro verbatim: truncated mid-object.
        writeFileSync(join(dir, 'broken.json'), '{"manifestId":"broken","manifest":{"objects":[{"name":"acct"', 'utf8');

        const { entries, skipped } = src.list();

        expect(entries.map((e) => e.manifestId)).toEqual(['com.acme.good']);
        expect(skipped).toHaveLength(1);
        expect(skipped[0]!.file).toBe('broken.json');
        // The THROWN object, not a sentence this class invented — the consumer
        // quotes it (`os doctor` folds it onto a report row).
        expect(skipped[0]!.cause).toBeInstanceOf(Error);
        expect(String((skipped[0]!.cause as Error).message)).toMatch(/JSON/i);
    });

    it('reports an unreadable file, not only an unparseable one', () => {
        const src = new LocalManifestSource(dir);
        // A directory named `*.json` inside the ledger: `readFileSync` throws
        // EISDIR. Same silent drop before #5413, different operational fix —
        // which is exactly why the cause is carried rather than summarised.
        mkdirSync(join(dir, 'notafile.json'));

        const { entries, skipped } = src.list();

        expect(entries).toEqual([]);
        expect(skipped.map((s) => s.file)).toEqual(['notafile.json']);
        expect((skipped[0]!.cause as NodeJS.ErrnoException).code).toBe('EISDIR');
    });

    it('reports EVERY corrupt file, not just the first', () => {
        const src = new LocalManifestSource(dir);
        writeFileSync(join(dir, 'a.json'), '{oops', 'utf8');
        writeFileSync(join(dir, 'b.json'), 'also not json', 'utf8');

        const { entries, skipped } = src.list();

        expect(entries).toEqual([]);
        // An all-corrupt ledger is the worst case of this bug — every installed
        // app missing — and it must not be the quiet one.
        expect(skipped.map((s) => s.file).sort()).toEqual(['a.json', 'b.json']);
    });

    it('reports nothing skipped for a wholly intact ledger', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.crm'));
        src.write(entry('com.acme.hr'));
        // Non-`.json` files are ignored, not "skipped" — nothing was lost.
        writeFileSync(join(dir, 'README.txt'), 'not a ledger file', 'utf8');

        const { entries, skipped } = src.list();

        expect(entries).toHaveLength(2);
        expect(skipped).toEqual([]);
    });

    it('still THROWS when the directory itself cannot be enumerated', () => {
        // The #5412 boundary, pinned from the producer's side: "nothing at all
        // was read" is a different fact from "some of it was", and `os doctor`
        // reports them as different rows. Making `list()` total by catching
        // here would collapse them back into one.
        const notADir = join(dir, 'ledger');
        writeFileSync(notADir, 'this is a file, not the ledger directory\n', 'utf8');

        expect(() => new LocalManifestSource(notADir).list()).toThrow(/ENOTDIR|ENOENT/);
    });

    it('sanitises hostile manifest ids into safe filenames', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('../../etc/passwd'));
        // Stored INSIDE the ledger dir, traversal characters replaced.
        const files = readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(files[0]).not.toContain('/');
        expect(src.has('../../etc/passwd')).toBe(true);
    });
});
