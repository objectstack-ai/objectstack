// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Artifact-pinned boot — `OS_ARTIFACT_URL` (#8368).
 *
 * Every acceptance criterion except #5 (the migration gate, which needs a live
 * SQL driver and is pinned in `packages/cli/src/utils/artifact-boot-migration.test.ts`)
 * and the end-to-end half of #1 (a real `os serve` child with no project
 * checkout, pinned in `packages/cli/test/artifact-pinned-boot.e2e.test.ts`).
 *
 * ## Two assertions here are written against a specific way of being wrong
 *
 * **#2 — "no cache-fallback logic" is tested by planting a cache that WOULD
 * work.** Asserting that an unpinned fetch failure throws proves almost
 * nothing: an implementation with a cache fallback also throws when the cache
 * is empty, which is the state a naive test leaves it in. So the unpinned
 * failure case below first writes a byte-identical artifact into the cache
 * directory and only then cuts the network. The refusal has to happen with a
 * usable copy sitting on disk, because that is the situation the criterion is
 * actually about.
 *
 * **#6 — an absence assertion needs a positive control.** `expect(text).not.toContain(secret)`
 * passes just as happily when `text` is `''`, when the code path never ran, or
 * when the message was about something else entirely. Every leak assertion
 * below is therefore paired with a positive control asserting that the SAME
 * captured text contains the host and path of the same URL — proving the text
 * really is the output that would have carried the credential.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';

import {
    ArtifactReferenceError,
    OS_ARTIFACT_URL_ENV,
    artifactCacheDir,
    makeArtifactUrlScrubber,
    parseArtifactReference,
    pinnedCachePath,
    redactArtifactUrl,
    resolveArtifactFetchTimeoutMs,
    resolveArtifactReference,
    sha256Hex,
} from './artifact-reference.js';

// ── Fixtures ─────────────────────────────────────────────────────────

/** An artifact declaring a protocol range this runtime satisfies. */
const COMPATIBLE_ARTIFACT = {
    manifest: {
        id: 'com.example.hotcrm',
        name: 'hotcrm',
        version: '2.2.2',
        type: 'app',
        engines: { protocol: `^${PROTOCOL_MAJOR}` },
    },
    objects: [],
    requires: [],
};

const artifactJson = (body: unknown = COMPATIBLE_ARTIFACT) => JSON.stringify(body, null, 2);
const digestOf = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex');

/**
 * A pre-signed reference: the credential IS the URL. `hunter2-userinfo` and
 * `s3cr3t-signature-value` are the two tokens no output may ever carry.
 */
const HOST = 'artifacts.example.com';
const ARTIFACT_PATH = '/releases/hotcrm-2.2.2.json';
const CREDENTIAL_QUERY = 'X-Amz-Signature=s3cr3t-signature-value&X-Amz-Credential=AKIAEXAMPLE';
const PRESIGNED = `https://svc-user:hunter2-userinfo@${HOST}${ARTIFACT_PATH}?${CREDENTIAL_QUERY}`;
const SECRET_TOKENS = ['s3cr3t-signature-value', 'hunter2-userinfo', 'AKIAEXAMPLE', 'svc-user'];

/** The positive control: text derived from this reference must name these. */
const expectNamesTheArtifact = (text: string) => {
    expect(text).toContain(HOST);
    expect(text).toContain(ARTIFACT_PATH);
};

const expectNoSecrets = (text: string) => {
    for (const token of SECRET_TOKENS) expect(text).not.toContain(token);
};

let home: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-artifact-ref-'));
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/** A `fetch` stand-in that answers once with `body`, then records the calls. */
function fetchServing(body: string, init: { status?: number } = {}) {
    const calls: string[] = [];
    const impl = vi.fn(async (input: any) => {
        calls.push(String(input));
        const status = init.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 200 ? 'OK' : 'Not Found',
            arrayBuffer: async () => {
                const buf = Buffer.from(body);
                return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            },
        } as any;
    });
    return { impl: impl as unknown as typeof globalThis.fetch, calls, spy: impl };
}

/** A `fetch` stand-in whose rejection carries the full URL, exactly as undici's does. */
function fetchFailingWithUrlInMessage(url: string) {
    return vi.fn(async () => {
        throw new Error(`request to ${url} failed, reason: ECONNREFUSED`);
    }) as unknown as typeof globalThis.fetch;
}

/** Write a file and return its path. */
function writeFixture(name: string, text: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'os-artifact-src-'));
    const file = join(dir, name);
    writeFileSync(file, text);
    return file;
}

// ── Parsing: one variable, pin inside the fragment ───────────────────

describe('parseArtifactReference — one env var, SRI-style fragment pin', () => {
    it('extracts the pin from the fragment and keeps it out of the request target', () => {
        const sha = 'a'.repeat(64);
        const parsed = parseArtifactReference(`https://cdn.example.com/app.json#sha256=${sha}`);
        expect(parsed.kind).toBe('http');
        expect(parsed.expectedSha256).toBe(sha);
        // A fragment is client-side by standard; the target carries no trace of
        // it, which is the whole reason the pin can live there.
        expect(parsed.target).toBe('https://cdn.example.com/app.json');
        expect(parsed.target).not.toContain('sha256');
    });

    it('treats an absent fragment as unpinned (acceptance #2)', () => {
        expect(parseArtifactReference('https://cdn.example.com/app.json').expectedSha256).toBeNull();
        expect(parseArtifactReference('file:///srv/app/objectstack.json').expectedSha256).toBeNull();
    });

    it('normalizes an uppercase pin', () => {
        const parsed = parseArtifactReference(`https://cdn.example.com/app.json#sha256=${'A'.repeat(64)}`);
        expect(parsed.expectedSha256).toBe('a'.repeat(64));
    });

    it('resolves a file: URL to a filesystem path', () => {
        const parsed = parseArtifactReference('file:///srv/app/objectstack.json');
        expect(parsed.kind).toBe('file');
        expect(parsed.target).toBe('/srv/app/objectstack.json');
    });

    it('REFUSES a fragment that is not a well-formed pin, rather than booting unverified', () => {
        // The dangerous degradation: a truncated or misspelled pin silently
        // meaning "no verification", with every log line reporting success.
        for (const bad of ['#sha256=deadbeef', '#sha-256=' + 'a'.repeat(64), '#integrity', `#sha512=${'a'.repeat(64)}`]) {
            const err = (() => {
                try { parseArtifactReference(`https://cdn.example.com/app.json${bad}`); return null; }
                catch (e) { return e as ArtifactReferenceError; }
            })();
            expect(err, `fragment ${bad} must be refused`).toBeInstanceOf(ArtifactReferenceError);
            expect(err!.code).toBe('OS_ARTIFACT_URL_INVALID');
            expect(err!.message).toContain('#sha256=');
        }
    });

    it('refuses an unsupported scheme, naming the scheme', () => {
        try {
            parseArtifactReference('ftp://cdn.example.com/app.json');
            throw new Error('expected a refusal');
        } catch (e) {
            expect(e).toBeInstanceOf(ArtifactReferenceError);
            expect((e as ArtifactReferenceError).message).toContain("'ftp:'");
        }
    });

    it('refuses a relative value WITHOUT echoing it — a mistyped URL is still a credential', () => {
        try {
            parseArtifactReference('./dist/objectstack.json?token=s3cr3t-signature-value');
            throw new Error('expected a refusal');
        } catch (e) {
            const message = (e as ArtifactReferenceError).message;
            expect(message).toContain('value withheld');
            expectNoSecrets(message);
            // Positive control: the message is genuinely about this variable,
            // not an empty string that trivially "contains no secret".
            expect(message).toContain(OS_ARTIFACT_URL_ENV);
        }
    });

    it('refuses an empty value instead of silently falling back to the local artifact', () => {
        expect(() => parseArtifactReference('   ')).toThrow(/is set but empty/);
    });
});

// ── Acceptance #6: secrets discipline ────────────────────────────────

describe('secrets discipline (acceptance #6)', () => {
    it('redactArtifactUrl keeps scheme/host/path and drops userinfo, query and fragment', () => {
        const redacted = redactArtifactUrl(`${PRESIGNED}#sha256=${'a'.repeat(64)}`);
        expectNamesTheArtifact(redacted);   // positive control
        expectNoSecrets(redacted);
        expect(redacted).toContain('?<redacted>');
        expect(redacted).not.toContain('sha256=');
    });

    it('never throws on an unparsable value — it withholds it', () => {
        expect(redactArtifactUrl('not a url ?sig=s3cr3t-signature-value'))
            .toBe('<unparsable OS_ARTIFACT_URL (redacted)>');
    });

    it('the scrubber strips a URL that arrives inside someone ELSE\'s error text', () => {
        // This is the shape that leaks in practice: `fetch` rejects with the
        // whole URL in the message and a refusal helpfully quotes it.
        const scrub = makeArtifactUrlScrubber(PRESIGNED);
        const raw = `request to ${PRESIGNED} failed, reason: ECONNREFUSED`;
        // Positive control on the INPUT: the text really does carry the secret
        // before scrubbing, so its absence afterwards is the scrubber's doing.
        for (const token of SECRET_TOKENS) expect(raw).toContain(token);
        const scrubbed = scrub(raw);
        expectNoSecrets(scrubbed);
        expect(scrubbed).toContain('ECONNREFUSED');
    });

    it('strips a URL-shaped token the scrubber has never seen (the backstop)', () => {
        const scrub = makeArtifactUrlScrubber('https://cdn.example.com/app.json');
        const scrubbed = scrub('redirected to https://other.example.net/x?sig=leaked-elsewhere then failed');
        expect(scrubbed).not.toContain('leaked-elsewhere');
        expect(scrubbed).toContain('then failed');
    });

    it('the fetch-failure refusal carries no credential — on the real code path', async () => {
        const err = await resolveArtifactReference(PRESIGNED, {
            homeDir: home,
            fetchImpl: fetchFailingWithUrlInMessage(PRESIGNED),
            warn: () => {},
        }).catch((e) => e as ArtifactReferenceError);

        expect(err).toBeInstanceOf(ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_UNREACHABLE');
        expectNamesTheArtifact(err.message);   // positive control
        expectNoSecrets(err.message);
        // The structured detail is what a JSON log line would carry.
        expectNoSecrets(JSON.stringify(err.detail));
    });

    it('the integrity refusal and the cache warning carry no credential either', async () => {
        const body = artifactJson();
        const wrongPin = 'b'.repeat(64);
        const warnings: string[] = [];

        // (a) mismatch on the fetch path
        const mismatch = await resolveArtifactReference(`${PRESIGNED}#sha256=${wrongPin}`, {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
            warn: (m) => warnings.push(m),
        }).catch((e) => e as ArtifactReferenceError);
        expect(mismatch.code).toBe('OS_ARTIFACT_INTEGRITY_MISMATCH');
        expectNamesTheArtifact(mismatch.message);
        expectNoSecrets(mismatch.message);

        // (b) the degraded cache-fallback warning
        const pin = digestOf(body);
        mkdirSync(artifactCacheDir(home), { recursive: true });
        writeFileSync(pinnedCachePath(home, pin), body);
        await resolveArtifactReference(`${PRESIGNED}#sha256=${pin}`, {
            homeDir: home,
            fetchImpl: fetchFailingWithUrlInMessage(PRESIGNED),
            warn: (m) => warnings.push(m),
        });
        const warning = warnings.join('\n');
        expectNamesTheArtifact(warning);        // positive control
        expectNoSecrets(warning);
    });

    it('moves userinfo into an Authorization header — fetch cannot carry it in the URL', async () => {
        // Measured, not assumed: undici raises "Request cannot be constructed
        // from a URL that includes credentials" before a packet leaves, so a
        // reference of this shape is unusable until the credential is moved.
        const parsed = parseArtifactReference(PRESIGNED);
        expect(parsed.target).not.toContain('svc-user');
        expect(parsed.target).not.toContain('hunter2-userinfo');
        expect(parsed.authorization).toBe(
            `Basic ${Buffer.from('svc-user:hunter2-userinfo').toString('base64')}`,
        );

        const body = artifactJson();
        const { impl, spy } = fetchServing(body);
        await resolveArtifactReference(PRESIGNED, { homeDir: home, fetchImpl: impl });
        const init = spy.mock.calls[0]![1] as any;
        expect(init.headers.Authorization).toBe(parsed.authorization);
        // And the request line itself is clean — an access log on the artifact
        // host is a leak this process could never scrub afterwards.
        expect(String(spy.mock.calls[0]![0])).not.toContain('hunter2-userinfo');
    });

    it('the base64 form of userinfo is scrubbed too — a credential in a costume', () => {
        const scrub = makeArtifactUrlScrubber(PRESIGNED);
        const b64 = Buffer.from('svc-user:hunter2-userinfo').toString('base64');
        expect(scrub(`sending Authorization: Basic ${b64}`)).not.toContain(b64);
    });

    it('hands NO url downstream — the boot continues against a local path', async () => {
        const body = artifactJson();
        const resolved = await resolveArtifactReference(PRESIGNED, {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
            warn: () => {},
        });
        // The single strongest guarantee for #6: what the rest of the boot is
        // handed cannot leak a URL, because it is not one.
        expect(resolved.localPath.startsWith(home)).toBe(true);
        expectNoSecrets(resolved.localPath);
        expectNoSecrets(resolved.display);
        expectNamesTheArtifact(resolved.display);
    });
});

// ── Acceptance #1: both schemes boot ─────────────────────────────────

describe('resolveArtifactReference — both schemes (acceptance #1)', () => {
    it('file:// is read in place — the mounted file IS the booted file', async () => {
        const body = artifactJson();
        const file = writeFixture('objectstack.json', body);
        const resolved = await resolveArtifactReference(pathToFileURL(file).href, { homeDir: home });
        expect(resolved.origin).toBe('file');
        expect(resolved.localPath).toBe(file);
        expect(resolved.sha256).toBe(digestOf(body));
        expect((resolved.bundle as any).manifest.id).toBe('com.example.hotcrm');
    });

    it('https:// is fetched and materialised locally, byte-identical', async () => {
        const body = artifactJson();
        const resolved = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        });
        expect(resolved.origin).toBe('remote');
        expect(readFileSync(resolved.localPath, 'utf8')).toBe(body);
    });

    it('fetches EXACTLY ONCE — a pin that verifies a response nothing boots verifies nothing', async () => {
        const body = artifactJson();
        const { impl, calls } = fetchServing(body);
        await resolveArtifactReference(`https://cdn.example.com/app.json#sha256=${digestOf(body)}`, {
            homeDir: home,
            fetchImpl: impl,
        });
        expect(calls).toHaveLength(1);
        // And the fragment was not sent to the server.
        expect(calls[0]).toBe('https://cdn.example.com/app.json');
    });

    it('unwraps a { schemaVersion, metadata } envelope for inspection', async () => {
        const body = JSON.stringify({ schemaVersion: 2, metadata: COMPATIBLE_ARTIFACT });
        const resolved = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        });
        expect((resolved.bundle as any).manifest.name).toBe('hotcrm');
        // The materialised bytes stay the PUBLISHED bytes — that is what the
        // pin is computed over.
        expect(readFileSync(resolved.localPath, 'utf8')).toBe(body);
    });
});

// ── Acceptance #2: unpinned means unverified, and failures are loud ──

describe('unpinned references (acceptance #2)', () => {
    it('performs no verification at all', async () => {
        const body = artifactJson();
        const resolved = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        });
        expect(resolved.expectedSha256).toBeNull();
        // The digest is still computed and reported — "not verified" is a
        // statement about admission, not about knowing what booted.
        expect(resolved.sha256).toBe(digestOf(body));
    });

    it('fails the boot loudly on a fetch failure EVEN THOUGH a usable cached copy exists', async () => {
        // The sharp version of "no cache-fallback logic": an implementation
        // that grew one would pass a test that merely cuts the network with an
        // empty cache. So the cache is planted with byte-identical content
        // first, and the refusal has to happen anyway.
        const body = artifactJson();
        mkdirSync(artifactCacheDir(home), { recursive: true });
        writeFileSync(pinnedCachePath(home, digestOf(body)), body);
        writeFileSync(join(artifactCacheDir(home), 'staged-anything.json'), body);

        const err = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchFailingWithUrlInMessage('https://cdn.example.com/app.json'),
        }).catch((e) => e as ArtifactReferenceError);

        expect(err).toBeInstanceOf(ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_UNREACHABLE');
    });

    it('fails loudly on an HTTP error status, naming the status', async () => {
        const err = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing('nope', { status: 404 }).impl,
        }).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_UNREACHABLE');
        expect(err.message).toContain('HTTP 404');
    });

    it('fails loudly when a file:// reference does not exist', async () => {
        const err = await resolveArtifactReference('file:///definitely/not/here/objectstack.json', {
            homeDir: home,
        }).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_UNREACHABLE');
        expect(err.message).toContain('must not invent an empty one');
    });
});

// ── Acceptance #3: the pin, and the one cache fallback it permits ────

describe('pinned references (acceptance #3)', () => {
    it('admits content whose digest matches', async () => {
        const body = artifactJson();
        const resolved = await resolveArtifactReference(
            `https://cdn.example.com/app.json#sha256=${digestOf(body)}`,
            { homeDir: home, fetchImpl: fetchServing(body).impl },
        );
        expect(resolved.origin).toBe('remote');
        expect(resolved.sha256).toBe(resolved.expectedSha256);
    });

    it('refuses a mismatch naming BOTH the expected and the actual digest', async () => {
        const body = artifactJson();
        const expected = 'c'.repeat(64);
        const err = await resolveArtifactReference(
            `https://cdn.example.com/app.json#sha256=${expected}`,
            { homeDir: home, fetchImpl: fetchServing(body).impl },
        ).catch((e) => e as ArtifactReferenceError);

        expect(err.code).toBe('OS_ARTIFACT_INTEGRITY_MISMATCH');
        // Both, not "it threw": an operator who is told only that it failed
        // cannot tell a republished artifact from a compromised one.
        expect(err.message).toContain(expected);
        expect(err.message).toContain(digestOf(body));
        expect(err.detail.expected).toBe(expected);
        expect(err.detail.actual).toBe(digestOf(body));
    });

    it('does not poison the cache with content that failed verification', async () => {
        const body = artifactJson();
        const expected = 'c'.repeat(64);
        await resolveArtifactReference(`https://cdn.example.com/app.json#sha256=${expected}`, {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        }).catch(() => undefined);
        expect(existsSync(pinnedCachePath(home, expected))).toBe(false);
        expect(existsSync(pinnedCachePath(home, digestOf(body)))).toBe(false);
    });

    it('refuses a file:// mismatch too, naming both digests', async () => {
        const body = artifactJson();
        const file = writeFixture('objectstack.json', body);
        const expected = 'd'.repeat(64);
        const err = await resolveArtifactReference(
            `${pathToFileURL(file).href}#sha256=${expected}`,
            { homeDir: home },
        ).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_INTEGRITY_MISMATCH');
        expect(err.message).toContain(expected);
        expect(err.message).toContain(digestOf(body));
    });

    it('falls back to a cached copy on a fetch failure — with a loud warning', async () => {
        const body = artifactJson();
        const pin = digestOf(body);
        mkdirSync(artifactCacheDir(home), { recursive: true });
        writeFileSync(pinnedCachePath(home, pin), body);

        const warnings: string[] = [];
        const resolved = await resolveArtifactReference(
            `https://cdn.example.com/app.json#sha256=${pin}`,
            {
                homeDir: home,
                fetchImpl: fetchFailingWithUrlInMessage('https://cdn.example.com/app.json'),
                warn: (m) => warnings.push(m),
            },
        );
        expect(resolved.origin).toBe('cache');
        expect(resolved.sha256).toBe(pin);
        expect(warnings.join('\n')).toContain('running on cached content');
    });

    it('refuses a cached copy whose content no longer matches the pin', async () => {
        const pin = digestOf(artifactJson());
        mkdirSync(artifactCacheDir(home), { recursive: true });
        // A corrupt / tampered cache entry sitting at the content-addressed
        // name. The NAME is not the authority — the bytes are re-hashed.
        writeFileSync(pinnedCachePath(home, pin), artifactJson({ manifest: { id: 'com.evil' } }));

        const err = await resolveArtifactReference(
            `https://cdn.example.com/app.json#sha256=${pin}`,
            {
                homeDir: home,
                fetchImpl: fetchFailingWithUrlInMessage('https://cdn.example.com/app.json'),
                warn: () => {},
            },
        ).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_INTEGRITY_MISMATCH');
        expect(err.detail.source).toMatch(/^cache /);
    });

    it('refuses when the fetch fails and no cached copy exists', async () => {
        const err = await resolveArtifactReference(
            `https://cdn.example.com/app.json#sha256=${'e'.repeat(64)}`,
            {
                homeDir: home,
                fetchImpl: fetchFailingWithUrlInMessage('https://cdn.example.com/app.json'),
                warn: () => {},
            },
        ).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_UNREACHABLE');
    });

    it('a verified fetch populates the cache the fallback later reads', async () => {
        const body = artifactJson();
        const pin = digestOf(body);
        await resolveArtifactReference(`https://cdn.example.com/app.json#sha256=${pin}`, {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        });
        expect(readFileSync(pinnedCachePath(home, pin), 'utf8')).toBe(body);
    });
});

// ── Acceptance #4: the engines.protocol safety belt ──────────────────

describe('engines.protocol validation (acceptance #4)', () => {
    const withProtocol = (range: string) =>
        artifactJson({ ...COMPATIBLE_ARTIFACT, manifest: { ...COMPATIBLE_ARTIFACT.manifest, engines: { protocol: range } } });

    it('refuses an artifact whose declared range excludes this runtime', async () => {
        const body = withProtocol(`^${PROTOCOL_MAJOR - 1}`);
        const err = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        }).catch((e) => e as ArtifactReferenceError);

        expect(err).toBeInstanceOf(ArtifactReferenceError);
        expect(err.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
        expect(err.message).toContain(`^${PROTOCOL_MAJOR - 1}`);
        // The refusal is about the two RELEASE AXES, so it has to prescribe
        // both ways out rather than only "migrate your metadata".
        expect(err.message).toContain(OS_ARTIFACT_URL_ENV);
        expect(err.detail.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
    });

    it('refuses BEFORE anything is materialised — no half-booted state on disk', async () => {
        const body = withProtocol(`^${PROTOCOL_MAJOR - 1}`);
        const pin = digestOf(body);
        await resolveArtifactReference(`https://cdn.example.com/app.json#sha256=${pin}`, {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        }).catch(() => undefined);
        expect(existsSync(pinnedCachePath(home, pin))).toBe(false);
    });

    it('admits the current major', async () => {
        const body = withProtocol(`^${PROTOCOL_MAJOR}`);
        await expect(resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        })).resolves.toMatchObject({ origin: 'remote' });
    });

    it('admits an artifact that declares no range — grandfathering, never a false rejection', async () => {
        const body = artifactJson({ manifest: { id: 'com.example.legacy', name: 'legacy', version: '1.0.0' }, objects: [] });
        await expect(resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing(body).impl,
        })).resolves.toMatchObject({ origin: 'remote' });
    });

    it('refuses malformed JSON rather than booting an empty platform', async () => {
        const err = await resolveArtifactReference('https://cdn.example.com/app.json', {
            homeDir: home,
            fetchImpl: fetchServing('{ not json').impl,
        }).catch((e) => e as ArtifactReferenceError);
        expect(err.code).toBe('OS_ARTIFACT_MALFORMED');
    });
});

// ── Shared knobs ─────────────────────────────────────────────────────

describe('resolveArtifactFetchTimeoutMs', () => {
    it('honours only a positive numeric OS_ARTIFACT_FETCH_TIMEOUT_MS', () => {
        expect(resolveArtifactFetchTimeoutMs({ OS_ARTIFACT_FETCH_TIMEOUT_MS: '5000' })).toBe(5000);
        expect(resolveArtifactFetchTimeoutMs({ OS_ARTIFACT_FETCH_TIMEOUT_MS: '0' })).toBe(60_000);
        expect(resolveArtifactFetchTimeoutMs({ OS_ARTIFACT_FETCH_TIMEOUT_MS: 'soon' })).toBe(60_000);
        expect(resolveArtifactFetchTimeoutMs({})).toBe(60_000);
    });
});

describe('sha256Hex', () => {
    it('matches what sha256sum prints for the same bytes', () => {
        expect(sha256Hex(Buffer.from('hello'))).toBe(
            '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        );
    });
});
