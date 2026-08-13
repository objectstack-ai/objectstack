// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Artifact-pinned boot — `OS_ARTIFACT_URL` (#8368).
 *
 * The missing half of a deployment model where the runtime image and the app
 * artifact are two independent release axes: a fixed runtime container plus one
 * env var naming the artifact *by reference* is a running app, and upgrading
 * the app is an env change plus a restart rather than an image rebuild.
 *
 * ## One variable, one value
 *
 *   OS_ARTIFACT_URL=https://cdn.example.com/hotcrm-2.2.2.json      fetched at boot
 *   OS_ARTIFACT_URL=file:///srv/app/objectstack.json               read directly
 *
 * The optional integrity pin is SRI-style and lives **inside the URL
 * fragment** — `…/hotcrm-2.2.2.json#sha256= ` + 64 hex chars. There is
 * deliberately no separate `OS_ARTIFACT_SHA256` variable. That is not a
 * stylistic choice: a fragment is client-side by standard and is never sent to
 * the server, so the pin rides along with the reference — one value to copy,
 * one value to rotate — without changing a single byte of what the artifact
 * host sees. Splitting it into a second variable makes "URL updated, hash not"
 * a reachable state; keeping it in the fragment makes that state unspellable.
 *
 * ## What this module refuses, and how loudly
 *
 * | condition                         | verdict                                        |
 * |-----------------------------------|------------------------------------------------|
 * | no `#sha256=` fragment            | no verification at all                          |
 * | fetch/read failure, unpinned      | refuse (orchestration retries) — no cache logic |
 * | fetch failure, pinned, cache hit  | serve the cache, loud warning                   |
 * | hash mismatch (network or cache)  | refuse, naming expected **and** actual          |
 * | `engines.protocol` excludes us    | refuse (the safety belt of the two-axis split)  |
 *
 * The cache fallback exists only on the pinned path, and the cached bytes are
 * re-hashed on every read: the pin — not the filename, not the fact that some
 * earlier boot wrote the file — is what admits a cached copy. An unpinned boot
 * has nothing to authenticate a cached copy *with*, which is why acceptance #2
 * says "no cache-fallback logic" rather than "a smaller cache-fallback".
 *
 * ## Secrets discipline (acceptance #6)
 *
 * The reference may be a pre-signed URL, i.e. the credential IS the URL. Two
 * structural defences, because a rule that depends on every future call site
 * remembering to redact is a rule that leaks:
 *
 *  1. **Nothing downstream ever sees the URL.** A remote artifact is
 *     materialised to a local file and the boot continues against that path,
 *     so the reference does not reach `MetadataPlugin`, the banner, the
 *     metadata service's artifact-source record, or any HTTP surface that
 *     reports where the app came from.
 *  2. **Every message this module produces is scrubbed**, including messages
 *     that originate in `fetch` — whose failures routinely carry the full URL,
 *     and which is the classic leak: a refusal that helpfully prints "could not
 *     fetch <the pre-signed URL>". {@link makeArtifactUrlScrubber} strips the
 *     known credential-bearing tokens and then removes any surviving absolute
 *     URL from the text, so a leak needs a *new* carrier, not just a new call
 *     site.
 *
 * A third defence falls out of a WHATWG rule rather than a decision: `fetch`
 * refuses outright to construct a request from a URL carrying userinfo, so a
 * `https://user:token@host/app.json` reference cannot work at all unless the
 * credential moves into a header. {@link parseArtifactReference} moves it to
 * `Authorization: Basic`, which also keeps it out of the artifact host's access
 * log — the one leak this process cannot scrub afterwards.
 *
 * Error codes here are SCREAMING_SNAKE per ADR-0112's casing rule but are
 * deliberately **not** registered in `ERROR_CODE_LEDGER`: that ledger governs
 * the code a failing *request* answers with, and every refusal below happens
 * before the HTTP server binds — none of them can ever reach a response
 * envelope. Registering one would create exactly the unemittable row the
 * ledger's "retiring a code" section calls a defect.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProtocolCompat } from '@objectstack/metadata-core';

/** The one environment variable this feature adds. */
export const OS_ARTIFACT_URL_ENV = 'OS_ARTIFACT_URL';

/** Schemes an artifact reference may use. */
const SUPPORTED_SCHEMES = ['https:', 'http:', 'file:'] as const;

/** `#sha256=<64 hex>` — the only fragment shape an artifact reference may carry. */
const SHA256_FRAGMENT = /^#sha256=([0-9a-fA-F]{64})$/;

/** Default remote fetch timeout, overridable via `OS_ARTIFACT_FETCH_TIMEOUT_MS`. */
export const DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS = 60_000;

export type ArtifactReferenceKind = 'http' | 'file';

export interface ParsedArtifactReference {
    kind: ArtifactReferenceKind;
    /**
     * What is actually requested — the reference with the fragment removed.
     * For `file:` references this is the decoded filesystem path.
     */
    target: string;
    /** Lowercased hex digest from the fragment, or `null` when unpinned. */
    expectedSha256: string | null;
    /** Log-safe rendering: userinfo dropped, query masked, fragment dropped. */
    redacted: string;
    /**
     * `Authorization` header value, when the reference carried userinfo.
     *
     * Present only for `http(s)` references — see the note at the point of
     * construction for why userinfo cannot stay in the request URL.
     */
    authorization?: string;
}

export type ArtifactReferenceErrorCode =
    | 'OS_ARTIFACT_URL_INVALID'
    | 'OS_ARTIFACT_UNREACHABLE'
    | 'OS_ARTIFACT_INTEGRITY_MISMATCH'
    | 'OS_ARTIFACT_MALFORMED'
    | 'OS_PROTOCOL_INCOMPATIBLE';

/**
 * A refusal to boot from the referenced artifact.
 *
 * `message` is already scrubbed — it is safe to print, log and hand to an
 * operator. Construct it through the helpers below rather than directly, so
 * the scrubbing cannot be forgotten at a call site.
 */
export class ArtifactReferenceError extends Error {
    override readonly name = 'ArtifactReferenceError';
    constructor(
        readonly code: ArtifactReferenceErrorCode,
        message: string,
        readonly detail: Record<string, unknown> = {},
    ) {
        super(message);
    }
}

/** sha-256 of raw bytes, lowercase hex — the same digest `sha256sum` prints. */
export function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Log-safe rendering of an artifact reference.
 *
 * Keeps scheme, host and path — the part an operator needs to recognise which
 * artifact was named — and drops the two places credentials actually live in a
 * pre-signed URL: the userinfo and the query string. The fragment is dropped
 * too; the pin is reported as its own field rather than inside a URL, so no
 * caller has to decide which half of a URL is safe to print.
 *
 * Never throws: an unparsable reference cannot be selectively redacted, so it
 * is replaced wholesale rather than echoed.
 */
export function redactArtifactUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return '<unparsable OS_ARTIFACT_URL (redacted)>';
    }
    const query = url.search ? '?<redacted>' : '';
    if (url.protocol === 'file:') return `file://${url.pathname}${query}`;
    return `${url.protocol}//${url.host}${url.pathname}${query}`;
}

/**
 * Build a scrubber that removes every credential-bearing token of `raw` from
 * arbitrary text, then removes any absolute URL still standing in it.
 *
 * The second pass is what makes this hold against text this module did not
 * write. `fetch` rejections name the URL (`TypeError: fetch failed` carries it
 * on the cause; an HTTP error line built upstream carries it inline), and those
 * strings are precisely what a refusal message wants to quote. Rather than
 * trusting each call site to quote only safe parts, anything URL-shaped that
 * survives token removal is replaced outright.
 */
export function makeArtifactUrlScrubber(raw: string): (text: string) => string {
    const tokens = new Set<string>();
    const add = (t: string | undefined | null) => {
        // Short tokens would match unrelated substrings of a message; a real
        // credential is never 3 characters.
        if (t && t.length >= 4) tokens.add(t);
    };
    add(raw);
    try {
        const url = new URL(raw);
        add(url.username);
        add(url.password);
        add(url.search);
        add(url.search.replace(/^\?/, ''));
        for (const value of url.searchParams.values()) add(value);
        const noHash = new URL(raw);
        noHash.hash = '';
        add(noHash.toString());
        if (url.username !== '' || url.password !== '') {
            // The derived form too: userinfo becomes `Authorization: Basic
            // <base64>` (see parseArtifactReference), and a base64 blob is a
            // credential in a costume, not a redaction.
            add(Buffer.from(
                `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
            ).toString('base64'));
        }
        // The userinfo-stripped target is deliberately NOT added as a token:
        // the backstop below already replaces it, and with the *readable*
        // redaction rather than a bare marker. Adding it here would trade a
        // message an operator can act on for one that says only `<redacted>`.
    } catch {
        // Unparsable: the whole string is the only token we can be sure of.
    }
    // Longest first, so a broad token is removed before its own substrings.
    const ordered = [...tokens].sort((a, b) => b.length - a.length);
    const safe = redactArtifactUrl(raw);
    return (text: string): string => {
        let out = text;
        for (const token of ordered) out = out.split(token).join('<redacted>');
        // Backstop: any absolute URL that survived is replaced wholesale. It
        // can only have come from this reference (these messages describe one
        // fetch), and guessing which query parameters of an unknown signing
        // scheme are secret is exactly the judgement call that leaks.
        return out.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s'"`)]+/g, safe);
    };
}

/**
 * Parse `OS_ARTIFACT_URL` into its request target and optional integrity pin.
 *
 * Refuses, rather than degrading, on a fragment that is present but is not a
 * well-formed `#sha256=` pin. A typo'd or truncated pin that silently meant
 * "unverified" would be the worst possible failure mode for this feature: the
 * operator believes the boot is pinned, every log line agrees that the boot
 * succeeded, and nothing ever says the verification did not happen.
 */
export function parseArtifactReference(raw: string): ParsedArtifactReference {
    const trimmed = raw.trim();
    if (trimmed === '') {
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_URL_INVALID',
            `${OS_ARTIFACT_URL_ENV} is set but empty. Unset it to boot from the local artifact, `
            + `or give it an https:// or file:// URL.`,
        );
    }

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        // The value is not echoed: an unparsable string cannot be redacted
        // field-by-field, and a mistyped pre-signed URL is still a credential.
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_URL_INVALID',
            `${OS_ARTIFACT_URL_ENV} is not an absolute URL (value withheld — it may carry credentials). `
            + `Expected https://host/path/objectstack.json or file:///absolute/path/objectstack.json, `
            + `optionally pinned with #sha256=<64 hex chars>.`,
        );
    }

    if (!(SUPPORTED_SCHEMES as readonly string[]).includes(url.protocol)) {
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_URL_INVALID',
            `${OS_ARTIFACT_URL_ENV} uses unsupported scheme '${url.protocol}'. `
            + `Supported schemes: ${SUPPORTED_SCHEMES.join(', ')}.`,
            { scheme: url.protocol },
        );
    }

    let expectedSha256: string | null = null;
    if (url.hash !== '') {
        const match = SHA256_FRAGMENT.exec(url.hash);
        if (!match) {
            throw new ArtifactReferenceError(
                'OS_ARTIFACT_URL_INVALID',
                `${OS_ARTIFACT_URL_ENV} carries a fragment that is not an integrity pin. `
                + `The only supported fragment is '#sha256=<64 hex chars>'. `
                + `Refusing rather than booting unverified — a malformed pin that silently meant `
                + `'no verification' is the one outcome an operator can never detect.`,
                { redacted: redactArtifactUrl(trimmed) },
            );
        }
        expectedSha256 = match[1]!.toLowerCase();
    }

    const withoutFragment = new URL(trimmed);
    withoutFragment.hash = '';

    if (url.protocol !== 'file:' && (url.username !== '' || url.password !== '')) {
        // `fetch` REFUSES a URL carrying userinfo outright — undici raises
        // "Request cannot be constructed from a URL that includes credentials"
        // before a single packet leaves, per the WHATWG Fetch spec. So a
        // `https://user:token@host/app.json` reference is not merely
        // untidy, it cannot work at all unless the credential is moved into a
        // header. It is moved here, to `Authorization: Basic`, which is also
        // where it belongs: a credential in the request line lands in the
        // artifact host's access log, and this is the one place that can still
        // decide otherwise.
        const credentials = Buffer.from(
            `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
        ).toString('base64');
        withoutFragment.username = '';
        withoutFragment.password = '';
        return {
            kind: 'http',
            target: withoutFragment.toString(),
            expectedSha256,
            redacted: redactArtifactUrl(trimmed),
            authorization: `Basic ${credentials}`,
        };
    }

    if (url.protocol === 'file:') {
        let filePath: string;
        try {
            filePath = fileURLToPath(withoutFragment);
        } catch {
            throw new ArtifactReferenceError(
                'OS_ARTIFACT_URL_INVALID',
                `${OS_ARTIFACT_URL_ENV} is a file: URL that does not name a local path `
                + `(${redactArtifactUrl(trimmed)}). Use file:///absolute/path/objectstack.json.`,
            );
        }
        return {
            kind: 'file',
            target: filePath,
            expectedSha256,
            redacted: redactArtifactUrl(trimmed),
        };
    }

    return {
        kind: 'http',
        target: withoutFragment.toString(),
        expectedSha256,
        redacted: redactArtifactUrl(trimmed),
    };
}

/** Where a resolved artifact's bytes came from. */
export type ArtifactOrigin = 'remote' | 'file' | 'cache';

export interface ResolvedArtifactReference {
    /** Local filesystem path the rest of the boot reads. Never a URL. */
    localPath: string;
    /** Log-safe description of the reference, for banners and diagnostics. */
    display: string;
    origin: ArtifactOrigin;
    /** The pin, when the reference carried one. */
    expectedSha256: string | null;
    /** Digest of the bytes actually booted — always computed. */
    sha256: string;
    /** Parsed artifact, envelope already unwrapped. */
    bundle: unknown;
}

export interface ResolveArtifactReferenceOptions {
    /** ObjectStack home — the cache and staging directory live under it. */
    homeDir: string;
    fetchTimeoutMs?: number;
    /** Injectable for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof globalThis.fetch;
    /** Loud channel for the degraded (cache-fallback) path. */
    warn?: (message: string) => void;
    /** Runtime protocol version to hand the handshake; defaults to this build's. */
    runtimeProtocolVersion?: string;
}

/** `<home>/artifacts` — verified cache and unpinned staging. */
export function artifactCacheDir(homeDir: string): string {
    return resolvePath(homeDir, 'artifacts');
}

/** Content-addressed cache path for a pinned artifact. */
export function pinnedCachePath(homeDir: string, sha256: string): string {
    return resolvePath(artifactCacheDir(homeDir), `sha256-${sha256.toLowerCase()}.json`);
}

/**
 * Staging path for an UNPINNED remote artifact.
 *
 * Keyed off the redacted reference so no credential material reaches a
 * filename, and deliberately named differently from the pinned cache: the
 * fallback lookup constructs only `sha256-<hex>.json` names, so a staged file
 * is not reachable as a cache entry even by accident. It is overwritten on
 * every boot and never read back.
 */
export function stagedArtifactPath(homeDir: string, redacted: string): string {
    const key = createHash('sha256').update(redacted).digest('hex').slice(0, 32);
    return resolvePath(artifactCacheDir(homeDir), `staged-${key}.json`);
}

/** Write bytes to `target` atomically (temp file + rename). */
function writeArtifactFile(target: string, bytes: Uint8Array): void {
    mkdirSync(resolvePath(target, '..'), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
}

/**
 * Unwrap the `{ schemaVersion, metadata }` envelope `os build` may emit, so the
 * handshake reads the same shape `loadArtifactBundle({ unwrapEnvelope: true })`
 * hands the kernel.
 */
function unwrapEnvelope(parsed: any): any {
    return parsed?.schemaVersion != null && parsed?.metadata !== undefined ? parsed.metadata : parsed;
}

/**
 * Validate the artifact's declared `engines.protocol` against this runtime
 * (acceptance #4).
 *
 * `AppPlugin` runs the same handshake when it loads a bundle, and that check
 * stays — but it fires during kernel Phase 1, after the datasource has
 * connected, and its diagnostic names the *package*. On the artifact-pinned
 * path the operator's mistake is about the *reference* ("this image cannot run
 * that artifact version"), and the refusal is worth having before anything is
 * connected, so it is raised here and names both.
 *
 * Absent and unparsable ranges are admitted, exactly as the shared handshake
 * admits them — this is a safety belt against a genuine major break, never a
 * new "must declare a range" requirement smuggled in at boot.
 */
export function assertArtifactProtocolCompatible(
    bundle: unknown,
    display: string,
    runtimeProtocolVersion?: string,
): void {
    const manifest = (bundle as any)?.manifest ?? bundle;
    if (!manifest || typeof manifest !== 'object') return;
    const result = checkProtocolCompat(manifest as any, runtimeProtocolVersion);
    if (result.status !== 'incompatible') return;
    throw new ArtifactReferenceError(
        'OS_PROTOCOL_INCOMPATIBLE',
        `Refusing to boot ${display}: ${result.diagnostic.message} `
        + `The runtime image and the app artifact are independent release axes — `
        + `either point ${OS_ARTIFACT_URL_ENV} at an artifact built for protocol `
        + `${result.runtimeMajor}, or run a runtime image for protocol ${result.diagnostic.targetMajor ?? 'the artifact\'s'}.`,
        { ...result.diagnostic },
    );
}

/** Read bytes for a `file:` reference. */
async function readLocalArtifact(
    ref: ParsedArtifactReference,
    scrub: (t: string) => string,
): Promise<Uint8Array> {
    try {
        return await readFile(ref.target);
    } catch (err: any) {
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_UNREACHABLE',
            `Cannot read the artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}): `
            + `${scrub(String(err?.message ?? err))}. `
            + `Refusing to boot — a runtime told to serve a specific artifact must not invent an empty one.`,
            { redacted: ref.redacted },
        );
    }
}

/** Fetch bytes for an `http(s):` reference. Throws a scrubbed error on failure. */
async function fetchRemoteArtifact(
    ref: ParsedArtifactReference,
    opts: ResolveArtifactReferenceOptions,
    scrub: (t: string) => string,
): Promise<Uint8Array> {
    const doFetch = opts.fetchImpl ?? globalThis.fetch;
    const timeoutMs = opts.fetchTimeoutMs ?? DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await doFetch(ref.target, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
                ...(ref.authorization ? { Authorization: ref.authorization } : {}),
            },
        });
        if (!res.ok) {
            // `res.statusText` and the status are safe; the URL is not, and is
            // never interpolated here.
            throw new ArtifactReferenceError(
                'OS_ARTIFACT_UNREACHABLE',
                `HTTP ${res.status} ${res.statusText} fetching the artifact named by `
                + `${OS_ARTIFACT_URL_ENV} (${ref.redacted}).`,
                { status: res.status, redacted: ref.redacted },
            );
        }
        return new Uint8Array(await res.arrayBuffer());
    } catch (err: any) {
        if (err instanceof ArtifactReferenceError) throw err;
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_UNREACHABLE',
            `Cannot fetch the artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}): `
            + `${scrub(String(err?.message ?? err))}.`,
            { redacted: ref.redacted },
        );
    } finally {
        clearTimeout(timer);
    }
}

/** Refusal carrying BOTH digests — the operator cannot act on "it did not match". */
function integrityMismatch(
    ref: ParsedArtifactReference,
    expected: string,
    actual: string,
    source: string,
): ArtifactReferenceError {
    return new ArtifactReferenceError(
        'OS_ARTIFACT_INTEGRITY_MISMATCH',
        `Integrity check FAILED for the artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}).\n`
        + `  expected sha256: ${expected}\n`
        + `  actual   sha256: ${actual}\n`
        + `  source:          ${source}\n`
        + `Refusing to boot. Either the artifact was republished under the same name `
        + `(pin the new digest) or the content is not what was published.`,
        { expected, actual, source, redacted: ref.redacted },
    );
}

/** Parse the bytes, refusing loudly on anything that is not a JSON artifact. */
function parseArtifactBytes(bytes: Uint8Array, ref: ParsedArtifactReference): unknown {
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_MALFORMED',
            `The artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}) is not valid UTF-8 text.`,
            { redacted: ref.redacted },
        );
    }
    try {
        return unwrapEnvelope(JSON.parse(text));
    } catch (err: any) {
        throw new ArtifactReferenceError(
            'OS_ARTIFACT_MALFORMED',
            `The artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}) is not valid JSON: `
            + `${String(err?.message ?? err)}.`,
            { redacted: ref.redacted },
        );
    }
}

/**
 * Resolve `OS_ARTIFACT_URL` to a verified, local artifact file.
 *
 * The returned `localPath` is what the rest of the boot uses. For a remote
 * reference that is deliberate and load-bearing twice over: it keeps the URL
 * out of every downstream surface (acceptance #6), and it means the bytes that
 * were hashed are the bytes that boot. Handing the URL onwards instead would
 * re-fetch it later, and a pin that verifies one response while a second
 * response is what actually boots verifies nothing at all.
 */
export async function resolveArtifactReference(
    raw: string,
    opts: ResolveArtifactReferenceOptions,
): Promise<ResolvedArtifactReference> {
    const ref = parseArtifactReference(raw);
    const scrub = makeArtifactUrlScrubber(raw);
    const warn = opts.warn ?? ((m: string) => console.warn(m));

    // ── file: — the volume-mount workflow ────────────────────────────
    // Read in place. There is nothing to cache (the source IS local) and
    // nothing to materialise, so the mounted file stays the booted file.
    if (ref.kind === 'file') {
        const bytes = await readLocalArtifact(ref, scrub);
        const actual = sha256Hex(bytes);
        if (ref.expectedSha256 && ref.expectedSha256 !== actual) {
            throw integrityMismatch(ref, ref.expectedSha256, actual, ref.redacted);
        }
        const bundle = parseArtifactBytes(bytes, ref);
        assertArtifactProtocolCompatible(bundle, ref.redacted, opts.runtimeProtocolVersion);
        return {
            localPath: ref.target,
            display: ref.redacted,
            origin: 'file',
            expectedSha256: ref.expectedSha256,
            sha256: actual,
            bundle,
        };
    }

    // ── http(s): — fetched at boot ───────────────────────────────────
    let bytes: Uint8Array;
    let origin: ArtifactOrigin = 'remote';
    try {
        bytes = await fetchRemoteArtifact(ref, opts, scrub);
    } catch (fetchErr) {
        // Acceptance #2: with no pin there is nothing to authenticate a cached
        // copy with, so there is no fallback to attempt. Fail loudly and let
        // container orchestration retry — a runtime that quietly serves last
        // week's app because today's fetch flaked is the failure this refusal
        // exists to prevent.
        if (!ref.expectedSha256) throw fetchErr;

        // Acceptance #3: a pinned reference MAY fall back to a cached copy —
        // but only one whose content still hashes to the pin, re-verified here
        // rather than trusted because of where it sits.
        const cachePath = pinnedCachePath(opts.homeDir, ref.expectedSha256);
        if (!existsSync(cachePath)) throw fetchErr;
        let cached: Uint8Array;
        try {
            cached = readFileSync(cachePath);
        } catch {
            throw fetchErr;
        }
        const cachedDigest = sha256Hex(cached);
        if (cachedDigest !== ref.expectedSha256) {
            // The cache is corrupt. Report the mismatch rather than the fetch
            // failure: "your cache does not match the pin" is a different
            // operator action from "the artifact host is down".
            throw integrityMismatch(ref, ref.expectedSha256, cachedDigest, `cache ${cachePath}`);
        }
        warn(
            `[artifact] ⚠ Could not fetch ${ref.redacted} — booting from the locally cached copy at `
            + `${cachePath}, which matches the pinned sha256 ${ref.expectedSha256}. `
            + `The artifact host is unreachable; this instance is running on cached content. `
            + `Cause: ${(fetchErr as Error)?.message ?? String(fetchErr)}`,
        );
        bytes = cached;
        origin = 'cache';
    }

    const actual = sha256Hex(bytes);
    if (ref.expectedSha256 && ref.expectedSha256 !== actual) {
        throw integrityMismatch(ref, ref.expectedSha256, actual, ref.redacted);
    }

    const bundle = parseArtifactBytes(bytes, ref);
    assertArtifactProtocolCompatible(bundle, ref.redacted, opts.runtimeProtocolVersion);

    // Materialise. A verified (pinned) artifact lands in the content-addressed
    // cache, which is also what a later degraded boot may fall back to; an
    // unpinned one lands in staging, which nothing ever reads back.
    const localPath = ref.expectedSha256
        ? pinnedCachePath(opts.homeDir, ref.expectedSha256)
        : stagedArtifactPath(opts.homeDir, ref.redacted);
    if (origin !== 'cache') {
        try {
            writeArtifactFile(localPath, bytes);
        } catch (err: any) {
            throw new ArtifactReferenceError(
                'OS_ARTIFACT_UNREACHABLE',
                `Fetched the artifact named by ${OS_ARTIFACT_URL_ENV} (${ref.redacted}) but could not `
                + `write it to ${localPath}: ${scrub(String(err?.message ?? err))}. `
                + `The boot needs a local copy so the verified bytes are the bytes that run.`,
                { redacted: ref.redacted },
            );
        }
    }

    return {
        localPath,
        display: ref.redacted,
        origin,
        expectedSha256: ref.expectedSha256,
        sha256: actual,
        bundle,
    };
}

/**
 * Read the artifact-fetch timeout from the environment.
 *
 * Shares `OS_ARTIFACT_FETCH_TIMEOUT_MS` with the metadata service's remote
 * artifact source rather than inventing a second knob for the same concept —
 * and honours only a positive numeric value, the same way that reader does.
 */
export function resolveArtifactFetchTimeoutMs(
    env: Record<string, string | undefined> = process.env,
): number {
    const raw = Number(env.OS_ARTIFACT_FETCH_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS;
}
