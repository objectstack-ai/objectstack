// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocalManifestSource — the local desired-state ledger (cloud ADR-0007 ⑤).
 * Pure local file operations: list/read/has/write/remove, corrupt-file
 * tolerance AND corrupt-file REPORTING (#5413), and manifest-id sanitisation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
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
        expect(src.read('com.acme.crm')).toBeNull();
        expect(src.has('com.acme.crm')).toBe(false);
    });

    it('write → has/read/list round-trips and upserts by manifestId', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.crm'));
        expect(src.has('com.acme.crm')).toBe(true);
        expect(src.read('com.acme.crm')?.version).toBe('1.0.0');

        src.write(entry('com.acme.crm', '1.1.0')); // upsert, same file
        expect(src.list().entries).toHaveLength(1);
        expect(src.read('com.acme.crm')?.version).toBe('1.1.0');
    });

    it('remove deletes the entry and reports absence', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.crm'));
        expect(src.remove('com.acme.crm')).toBe(true);
        expect(src.remove('com.acme.crm')).toBe(false);
        expect(src.list()).toEqual({ entries: [], skipped: [] });
    });

    it('skips corrupt ledger files in list() and nulls them in read()', () => {
        const src = new LocalManifestSource(dir);
        src.write(entry('com.acme.good'));
        writeFileSync(join(dir, 'com.acme.bad.json'), '{not json', 'utf8');
        // Still skipped — that half was never the bug.
        expect(src.list().entries.map((e) => e.manifestId)).toEqual(['com.acme.good']);
        expect(src.read('com.acme.bad')).toBeNull();
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
