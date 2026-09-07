// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { DocumentSchema, ESignatureConfigSchema, type Document, type ESignatureConfig } from './document.zod';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

// ─── [#14477] the `ESignatureConfig` deadline pair is REMOVED ────────────────
//
// ADR-0049 enforce-or-remove. The 2026-09-02 ruling on #14477 (ruled A: retire
// per family) held `expirationDays` / `reminderDays` on one condition — a
// roadmapped e-signature consumer would have earned an
// `[EXPERIMENTAL — not enforced]` tag instead — and the maintainer answered it
// on 2026-09-05 (decision batch #40: no roadmap), so the ruling's own branch
// resolves to retirement. Two day-shaped keys on the published authorable
// surface (`data/ESignatureConfig`) and in the generated reference docs, read
// by NOTHING: no e-signature engine exists on the platform — no layer ever
// sent, expired or reminded a signature request — and the reader census over
// every package outside `packages/spec` (tests and changelogs excluded), over
// `examples/**` and `skills/**`, and over objectui at the pinned sha returned
// zero hits for `expirationDays`, `reminderDays`, `eSignature` and the
// `ESignatureConfig` names, with a lit control inside this package. Both
// carried defaults (30 / 7 days) that were materialized into every parsed
// configuration without ever being consulted.
//
// Route: `retiredKey()` tombstones, NOT plain deletion — `ESignatureConfigSchema`
// is not `.strict()`, so a bare deletion would make zod strip the key in
// silence (ADR-0104). Audible in two channels: `tsc` (the input type is
// `never`) and the parse (the prescription is the message). No D2 conversion:
// `DocumentSchema` is not a stack collection member and `document` is no
// metadata type, so the chain has no seam that ever runs (the
// `kernel/MetadataPluginConfig:additionalTypes` precedent) — the registration
// is two `RETIRED_KEYS_BY_MAJOR[18]` entries plus one D3 semantic entry.
//
// On the assertion set (the #8586 / #14676 / #14477 precedent): a schema
// refusal raises a `ZodError` whose issues carry `code` and `path` but no
// ADR-0112 `status` — that envelope belongs to the API error surface. So these
// pins assert the strongest set this surface really has: refusal, the issue
// `code`, the `path` naming WHICH site refused, and the prescription text
// (#5240: where the wording is the contract, pin the wording).

// ── Well-formed fixtures: every required key, neither of the retired ones ───

const CONFIG: ESignatureConfig = {
  provider: 'docusign',
  enabled: true,
  signers: [{ email: 'client@example.com', name: 'John Doe', role: 'Client', order: 1 }],
};
const DOCUMENT: Document = {
  id: 'doc_101',
  name: 'Contract for Signature',
  fileType: 'application/pdf',
  fileSize: 1536,
  eSignature: CONFIG,
};

interface RetiredSite {
  /** The exact `RETIRED_KEYS_BY_MAJOR` spelling. */
  registered: string;
  /** How the prescription opens (its backtick-wrapped qualified key). */
  qualified: string;
  schema: ZodTypeAny;
  wellFormed: unknown;
  authored: unknown;
  issuePath: (string | number)[];
  formerDefault: RegExp;
}

const SITES: RetiredSite[] = [
  {
    registered: 'data/ESignatureConfig:expirationDays',
    qualified: 'ESignatureConfig.expirationDays',
    schema: ESignatureConfigSchema,
    wellFormed: CONFIG,
    authored: { ...CONFIG, expirationDays: 30 },
    issuePath: ['expirationDays'],
    formerDefault: /default of 30 days/,
  },
  {
    registered: 'data/ESignatureConfig:reminderDays',
    qualified: 'ESignatureConfig.reminderDays',
    schema: ESignatureConfigSchema,
    wellFormed: CONFIG,
    authored: { ...CONFIG, reminderDays: 7 },
    issuePath: ['reminderDays'],
    formerDefault: /default of 7 days/,
  },
];

/** The same two keys through the one carrier that nests the config: `Document.eSignature`. */
const CARRIERS: Array<Pick<RetiredSite, 'qualified' | 'schema' | 'wellFormed' | 'authored' | 'issuePath'>> = [
  {
    qualified: 'ESignatureConfig.expirationDays',
    schema: DocumentSchema,
    wellFormed: DOCUMENT,
    authored: { ...DOCUMENT, eSignature: { ...CONFIG, expirationDays: 15 } },
    issuePath: ['eSignature', 'expirationDays'],
  },
  {
    qualified: 'ESignatureConfig.reminderDays',
    schema: DocumentSchema,
    wellFormed: DOCUMENT,
    authored: { ...DOCUMENT, eSignature: { ...CONFIG, reminderDays: 3 } },
    issuePath: ['eSignature', 'reminderDays'],
  },
];

const SEMANTIC_ID = 'esignature-config-deadline-keys-retired';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectTombstoneRefusal(site: Pick<RetiredSite, 'qualified' | 'schema' | 'authored' | 'issuePath'>) {
  const result = site.schema.safeParse(site.authored);
  expect(result.success, `${site.qualified} must be refused`).toBe(false);
  if (result.success) return; // narrowing; the assertion above already failed

  const wanted = site.issuePath.join('.');
  const issue = result.error.issues.find((i) => i.path.join('.') === wanted);
  expect(issue, `the refusal must surface at ${wanted}`).toBeDefined();
  // The machine-readable half of the envelope this surface actually has: a
  // `retiredKey()` tombstone raises `invalid_type` from its `z.never()`.
  expect(issue!.code).toBe('invalid_type');
  expect(issue!.path).toEqual(site.issuePath);
  // The prescription IS the migration doc for whoever hits it — contract, not
  // commentary: it opens with the qualified key, names the version and the
  // ADR, says why the key was inert, and tells the author what to do.
  expect(issue!.message).toMatch(
    new RegExp('^`' + escapeRegExp(site.qualified) + '` was removed in @objectstack/spec 17 \\(ADR-0049 enforce-or-remove\\) — nothing ever read it'),
  );
  expect(issue!.message).toMatch(/Delete the key/);
  expect(issue!.message).toMatch(/no e-signature engine exists/);
  // Customer-facing text carries the ADR, never an issue id.
  expect(issue!.message).not.toMatch(/#\d{3,}/);
  // Deliberately NO `os migrate meta` sentence: no conversion covers this
  // schema (not a stack collection member), so the sentence would promise an
  // edit list the tool cannot produce (`retired-key.ts`: the sentence must be
  // TRUE of the tool).
  expect(issue!.message).not.toMatch(/os migrate meta/);
}

describe('[#14477] ESignatureConfig deadline pair retirement — refusal at every site', () => {
  for (const site of SITES) {
    it(`REJECTS an authored \`${site.qualified}\` at path \`${site.issuePath.join('.')}\`, carrying the prescription`, () => {
      expectTombstoneRefusal(site);
      // Attribution control: the same config WITHOUT the key is accepted, so
      // the refusal above is attributable to the retired key and nothing else.
      expect(site.schema.safeParse(site.wellFormed).success, `${site.qualified}: well-formed control must parse`).toBe(true);
    });
  }

  for (const carrier of CARRIERS) {
    it(`REJECTS \`${carrier.qualified}\` through \`Document.eSignature\`, at path \`${carrier.issuePath.join('.')}\``, () => {
      expectTombstoneRefusal(carrier);
      expect(carrier.schema.safeParse(carrier.wellFormed).success).toBe(true);
    });
  }

  it('every prescription names the default it used to materialize', () => {
    for (const site of SITES) {
      const result = site.schema.safeParse(site.authored);
      expect(result.success).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path.join('.') === site.issuePath.join('.'))!;
      expect(issue.message, site.qualified).toMatch(site.formerDefault);
    }
  });
});

describe('[#14477] no-materialize: parsed configurations carry neither key and neither former default', () => {
  it('on the base schema', () => {
    const parsed = ESignatureConfigSchema.parse(CONFIG);
    expect(parsed).not.toHaveProperty('expirationDays');
    expect(parsed).not.toHaveProperty('reminderDays');
    // Attribution: the surviving default still materializes, so the absence
    // above is the tombstone's doing and not a broken parse.
    expect(ESignatureConfigSchema.parse({ provider: 'custom', signers: CONFIG.signers }).enabled).toBe(false);
  });

  it('through `Document.eSignature`', () => {
    const parsed = DocumentSchema.parse(DOCUMENT);
    expect(parsed.eSignature).toBeDefined();
    expect(parsed.eSignature).not.toHaveProperty('expirationDays');
    expect(parsed.eSignature).not.toHaveProperty('reminderDays');
  });
});

describe('[#14477] the tsc channel: the input type of both retired keys is `never`', () => {
  it('fails tsc at both authoring sites', () => {
    const config: ESignatureConfig = {
      ...CONFIG,
      // @ts-expect-error — `expirationDays` is a retiredKey() tombstone: its input type is `never`.
      expirationDays: 30,
      // @ts-expect-error — `reminderDays` is a retiredKey() tombstone.
      reminderDays: 7,
    };
    const document: Document = {
      ...DOCUMENT,
      eSignature: {
        ...CONFIG,
        // @ts-expect-error — the tombstone reaches through the carrier.
        expirationDays: 15,
      },
    };
    // The literals above are typed, so tsc is the assertion; at runtime the
    // same values are refused, which keeps this case from being vacuous.
    for (const [schema, value] of [
      [ESignatureConfigSchema, config],
      [DocumentSchema, document],
    ] as Array<[ZodTypeAny, unknown]>) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe('[#14477] ADR-0087 registration', () => {
  it('declares both sites under major 18, with the D3 semantic entry wired and no D2 conversion', () => {
    for (const site of SITES) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${site.registered} must be declared`).toContain(site.registered);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    const entry = step!.semantic.find((s) => s.id === SEMANTIC_ID);
    expect(entry, `${SEMANTIC_ID} must be wired into the step-18 chain`).toBeDefined();
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    // The route is stated where the next reader looks: why D3 semantic and
    // not D2 — no stack seam (the additionalTypes precedent).
    expect(entry!.reason).toMatch(/not a D2 conversion/);
    // Deliberately no mechanical conversion.
    expect(step!.conversionIds.filter((id) => /signature|document/.test(id))).toEqual([]);
  });
});
