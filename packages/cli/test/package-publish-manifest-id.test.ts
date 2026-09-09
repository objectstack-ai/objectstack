// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os package publish` decides what a manifest id is by PARSING THROUGH the
 * declaration, not by testing a hand-copied look-alike.
 *
 * Before this suite the command carried its own
 * `MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{0,254}$/i` (spelled here as text, in
 * `RETIRED_LOCAL_RULE`, so the anti-transcription pin below has a positive
 * control to fire on). It was looser than `PackageSchema.manifestId` on every
 * axis, so the local preflight ADMITTED what the control plane refuses.
 *
 * ## The two paths, and why they must be asserted separately
 *
 * There are two ways an id reaches the wire, and before the fix they had two
 * different strictnesses — neither of them the declared one:
 *
 *   explicit  `--manifest-id X` (or `manifestId` in objectstack.manifest.json)
 *             -> tested against the local rule only.
 *   derive    `deriveManifestId()` adopts `artifact.manifest.id`
 *             -> tested against the local rule AND `explicit.includes('.')`.
 *
 * That extra dot condition is why a bare `crm` was already blocked on the
 * derive path while the explicit path let it through: five of the six shapes
 * below held on both paths, `crm` on only one. After the fix both paths ask the
 * same schema, and the dot condition is gone because the schema subsumes it
 * (its pattern needs at least two segments).
 *
 * ## What separates a fix from a re-transcription
 *
 * Re-typing the schema's regex into this file would turn every refusal
 * assertion below green while reproducing the defect exactly. Two things rule
 * that out and neither is optional: the source pin (no second rule may live in
 * the command) and the negative control (a legal id still publishes, bytes
 * unchanged).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackageSchema } from '@objectstack/spec/cloud';
import PackagePublish, { deriveManifestId, isManifestId } from '../src/commands/package/publish.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISH_SRC = resolve(HERE, '../src/commands/package/publish.ts');

/** The declaration both paths must now answer to. */
const MANIFEST_ID = PackageSchema.shape.manifestId;

/**
 * The six shapes the retired local rule admitted, with the pre-fix reading of
 * WHICH path admitted each — triage's correction to the card, kept here because
 * it is the reason every case below is asserted per path rather than once.
 */
const RELAXATIONS: ReadonlyArray<{ id: string; why: string; admittedOnDerivePathBefore: boolean }> = [
  { id: 'crm',                  why: 'single segment',    admittedOnDerivePathBefore: false },
  { id: 'com.acme.repair_desk', why: 'underscore',        admittedOnDerivePathBefore: true },
  { id: 'COM.ACME.CRM',         why: 'upper case',        admittedOnDerivePathBefore: true },
  { id: '9foo.bar',             why: 'digit-first segment', admittedOnDerivePathBefore: true },
  { id: 'com..acme',            why: 'empty segment',     admittedOnDerivePathBefore: true },
  { id: 'com.acme.',            why: 'trailing dot',      admittedOnDerivePathBefore: true },
];

/** The negative control: a legal reverse-domain id. */
const LEGAL_ID = 'com.acme.crm';

type Call = { url: string; body: any };

function artifactJson(manifest: Record<string, unknown>): string {
  return JSON.stringify({ manifest, objects: [] });
}

/** Stub `fetch` so both publish POSTs succeed, and record what was sent. */
function stubCloud(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const data = url.endsWith('/versions')
      ? { id: 'ver_1', version: '1.2.0', listing_status: 'draft' }
      : { id: 'pkg_1', created: true, visibility: 'org' };
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) } as any;
  }));
  return calls;
}

describe('os package publish — the manifest-id rule is the spec manifest-id rule', () => {
  let dir = '';
  const prevEnv = {
    url: process.env.OS_CLOUD_URL,
    key: process.env.OS_CLOUD_API_KEY,
    id: process.env.OS_PACKAGE_MANIFEST_ID,
  };
  const prevCwd = process.cwd();

  beforeEach(() => {
    delete process.env.OS_PACKAGE_MANIFEST_ID;
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.OS_CLOUD_URL = prevEnv.url;
    process.env.OS_CLOUD_API_KEY = prevEnv.key;
    if (prevEnv.id === undefined) delete process.env.OS_PACKAGE_MANIFEST_ID;
    else process.env.OS_PACKAGE_MANIFEST_ID = prevEnv.id;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  /** Write an artifact carrying `manifest` and chdir next to it. */
  async function artifactAt(manifest: Record<string, unknown>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'package-publish-mid-'));
    const path = join(dir, 'objectstack.json');
    await writeFile(path, artifactJson(manifest));
    process.chdir(dir);
    process.env.OS_CLOUD_URL = 'http://cloud.test';
    process.env.OS_CLOUD_API_KEY = 'tok_123';
    return path;
  }

  /** Run the command, capturing its printed output and its exit code. */
  async function runPublish(argv: string[]): Promise<{ exitCode?: number; output: string }> {
    const output: string[] = [];
    const sink = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
    vi.spyOn(console, 'error').mockImplementation(sink);
    vi.spyOn(console, 'log').mockImplementation(sink);
    let exitCode: number | undefined;
    try {
      await PackagePublish.run(argv);
    } catch (err: any) {
      exitCode = err?.oclif?.exit ?? err?.exitCode;
    }
    return { exitCode, output: output.join('\n') };
  }

  // -------------------------------------------------------------------------
  // The rule itself
  // -------------------------------------------------------------------------

  it('agrees with PackageSchema.manifestId on every case', () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      [LEGAL_ID, true],
      ['local.acme-crm', true],
      ['a.b', true],
      ['com.acme.crm-2', true],
      ...RELAXATIONS.map(({ id }) => [id, false] as const),
      ['', false],
      ['com.acme.crm ', false],
      ['-com.acme', false],
    ];
    const disagreements = cases.filter(([value, expected]) => {
      const cli = isManifestId(value);
      const spec = MANIFEST_ID.safeParse(value).success;
      return cli !== expected || spec !== expected;
    });
    expect(disagreements).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Path 1 — the explicit `--manifest-id` check
  // -------------------------------------------------------------------------

  describe('explicit --manifest-id path', () => {
    for (const { id, why } of RELAXATIONS) {
      it(`refuses '${id}' (${why}) before any network call`, async () => {
        const path = await artifactAt({ id: LEGAL_ID, name: 'Acme CRM', version: '1.2.0' });
        const calls = stubCloud();

        const { exitCode, output } = await runPublish([path, '--manifest-id', id]);

        expect(exitCode).toBe(1);
        expect(calls).toEqual([]);
        expect(output).toContain(`Invalid manifest-id '${id}'`);
      });
    }

    // Negative control. An implementation that merely re-transcribed the
    // schema's regex would pass every refusal above; this is half of what
    // separates the two (the source pin is the other half).
    it(`still publishes the legal id '${LEGAL_ID}', bytes unchanged`, async () => {
      const path = await artifactAt({ id: 'com.other.thing', name: 'Acme CRM', version: '1.2.0' });
      const calls = stubCloud();

      await PackagePublish.run([path, '--manifest-id', LEGAL_ID]);

      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
      expect(calls[0].body.manifest_id).toBe(LEGAL_ID);
    });
  });

  // -------------------------------------------------------------------------
  // Path 2 — the derive path (`artifact.manifest.id`)
  // -------------------------------------------------------------------------

  describe('derive path', () => {
    for (const { id, why, admittedOnDerivePathBefore } of RELAXATIONS) {
      it(`refuses to adopt '${id}' (${why}${admittedOnDerivePathBefore ? '' : ' — already blocked before the fix'})`, async () => {
        // Unit half: the deriver does not forward the illegal shape…
        const derived = deriveManifestId(
          { manifest: { id, name: 'Acme CRM' } },
          '/nowhere/objectstack.json',
        );
        expect(derived.id).not.toBe(id);
        expect(derived).toEqual({ id: 'local.acme-crm', source: 'artifact-manifest-name' });
        expect(isManifestId(derived.id)).toBe(true);

        // …and end to end, nothing resembling it reaches the wire.
        const path = await artifactAt({ id, name: 'Acme CRM', version: '1.2.0' });
        const calls = stubCloud();
        await PackagePublish.run([path]);

        expect(calls).toHaveLength(2);
        expect(calls[0].body.manifest_id).not.toBe(id);
        expect(MANIFEST_ID.safeParse(calls[0].body.manifest_id).success).toBe(true);
      });
    }

    // Negative control on this path too.
    it(`adopts the legal id '${LEGAL_ID}' unchanged`, async () => {
      expect(deriveManifestId({ manifest: { id: LEGAL_ID, name: 'Acme CRM' } }, '/nowhere/objectstack.json'))
        .toEqual({ id: LEGAL_ID, source: 'artifact-manifest-id' });

      const path = await artifactAt({ id: LEGAL_ID, name: 'Acme CRM', version: '1.2.0' });
      const calls = stubCloud();
      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      expect(calls[0].body.manifest_id).toBe(LEGAL_ID);
    });

    it('falls back to the artifact filename when the artifact names nothing usable', () => {
      expect(deriveManifestId({ manifest: { id: 'com..acme' } }, '/tmp/build/objectstack.json'))
        .toEqual({ id: 'local.objectstack', source: 'artifact-filename' });
    });
  });

  // -------------------------------------------------------------------------
  // The producer half — the CLI also MAKES ids, and slugify has no
  // letter-first rule (the filer's addendum).
  // -------------------------------------------------------------------------

  describe('a derived id the schema rejects is refused, not published and not rewritten', () => {
    it("refuses the digit-first id derived from a manifest named '2024 App'", async () => {
      const derived = deriveManifestId({ manifest: { name: '2024 App' } }, '/nowhere/objectstack.json');
      expect(derived).toEqual({ id: 'local.2024-app', source: 'artifact-manifest-name' });
      expect(isManifestId(derived.id)).toBe(false);

      const path = await artifactAt({ name: '2024 App', version: '1.2.0' });
      const calls = stubCloud();
      const { exitCode, output } = await runPublish([path]);

      expect(exitCode).toBe(1);
      expect(calls).toEqual([]);
      expect(output).toContain("Invalid manifest-id 'local.2024-app'");
      // The refusal says where the id came from and how to set one, because
      // the user never typed this string.
      expect(output).toContain('derived from the compiled artifact');
      expect(output).toContain('--manifest-id');
      // It is NOT normalised into some other permanent identifier: manifestId
      // is immutable once published.
      expect(output).not.toContain('local.a2024-app');
    });

    it('publishes when the same derivation lands on a legal id', async () => {
      const path = await artifactAt({ name: 'Acme CRM', version: '1.2.0' });
      const calls = stubCloud();

      await PackagePublish.run([path]);

      expect(calls).toHaveLength(2);
      expect(calls[0].body.manifest_id).toBe('local.acme-crm');
    });
  });

  // -------------------------------------------------------------------------
  // The error text
  // -------------------------------------------------------------------------

  describe('the refusal text is quoted from the schema, not written a second time', () => {
    it("reports the schema's own invalid_format issue and its description", async () => {
      const rejected = MANIFEST_ID.safeParse('com.acme.repair_desk');
      expect(rejected.success).toBe(false);
      const issue = rejected.success === false ? rejected.error.issues[0] : undefined;
      expect(issue?.code).toBe('invalid_format');

      const path = await artifactAt({ id: LEGAL_ID, name: 'Acme CRM', version: '1.2.0' });
      stubCloud();
      const { output } = await runPublish([path, '--manifest-id', 'com.acme.repair_desk']);

      expect(output).toContain(issue!.message);
      expect(output).toContain(MANIFEST_ID.description!);
    });

    it('no longer states the contract the CLI invented', async () => {
      const path = await artifactAt({ id: LEGAL_ID, name: 'Acme CRM', version: '1.2.0' });
      stubCloud();
      const { output } = await runPublish([path, '--manifest-id', 'com.acme.repair_desk']);

      // The retired sentence sent a stopped user to `com.acme.repair_desk` —
      // accepted locally, refused by the server. Following the error message
      // led to a second error.
      expect(output).not.toContain('a-z0-9._-');
    });
  });
});

// ---------------------------------------------------------------------------
// The source pin — no second copy of the rule may live in the command
// ---------------------------------------------------------------------------

/** The rule this card deleted, as text so the scanner has a positive control. */
const RETIRED_LOCAL_RULE = 'const MANIFEST_ID_RE = /^[a-z0-9][a-z0-9._-]{0,254}$/i;';

/**
 * Every fully anchored regex literal in `code` that matches a legal manifest
 * id. Any local rule for manifest ids must match `com.acme.crm` — that is what
 * makes it a rule about manifest ids — so this finds a transcription without
 * having to guess which transcription was written.
 */
function manifestIdShapedLiterals(code: string): string[] {
  const literals = code.match(/\/\^(?:[^/\\\n]|\\.)*\$\/[a-z]*/g) ?? [];
  return literals.filter((literal) => {
    const lastSlash = literal.lastIndexOf('/');
    const source = literal.slice(1, lastSlash);
    const flags = literal.slice(lastSlash + 1).replace(/[gy]/g, '');
    try {
      return new RegExp(source, flags).test(LEGAL_ID);
    } catch {
      return false;
    }
  });
}

describe('publish.ts keeps no local copy of the manifest-id rule', () => {
  it('scans for transcriptions (control: the retired rule is found)', () => {
    expect(manifestIdShapedLiterals(RETIRED_LOCAL_RULE)).toHaveLength(1);
    // …and on a transcription of the schema's own pattern, the shape a
    // "fix" that re-types the regex would take.
    expect(manifestIdShapedLiterals('const X = /^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$/;')).toHaveLength(1);
  });

  it('finds none in the command source', () => {
    const source = readFileSync(PUBLISH_SRC, 'utf8');
    expect(manifestIdShapedLiterals(source)).toEqual([]);
    expect(source).not.toContain('MANIFEST_ID_RE');
    // …and the declaration is reached by import, which is what makes the
    // absence above a fix rather than a deletion.
    expect(source).toContain('PackageSchema.shape.manifestId');
  });
});
