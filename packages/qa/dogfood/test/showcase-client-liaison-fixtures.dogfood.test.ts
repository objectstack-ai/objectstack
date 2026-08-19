// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9308 fixtures 2 + 4 — the two stock fixtures that arrived with the
// `client_liaison` persona, pinned on a real boot.
//
// Both were "declared nowhere", which is a worse state than "declared wrong":
// the platform shipped the capability, the checklist had an item for it, and
// the item could not be run at all because no stock object or permission set
// exercised the feature. Nothing was red; the coverage simply did not exist.
//
//   FIXTURE 2 — `publicSharing` (ADR-0047). Verified across
//   `examples/app-showcase/src` before this change: not one object set
//   `publicSharing.enabled`, so `POST /api/v1/share-links` answered
//   422 SHARING_NOT_ENABLED for EVERY showcase object and the whole downstream
//   half of `access-security.share-link-capability-tokens` — resolve, redaction,
//   the audience/password gates, fail-closed revoke — was unreachable.
//   `showcase_client_brief` opts in, and the seed carries both a `published` and
//   a `draft` brief so the declared `eligibility` predicate is falsifiable too.
//
//   FIXTURE 4 — a `readable: false` FLS grant. The showcase governed the same
//   three `showcase_project` budget figures with `readable: true, editable:
//   false` (the WRITE half of field-level security) and authored no read-withheld
//   grant anywhere, so `plugin-security/src/field-masker.ts` — the code that
//   STRIPS a withheld key on the way out — had no stock fixture.
//   `showcase_client_liaison` is that grant.
//
// ## What each assertion is guarding against
//
// The opt-in is per OBJECT, so the negative control matters as much as the
// positive: a fixture that made link-minting work everywhere would be a
// regression dressed as coverage. And the redaction assertion is about KEY
// ABSENCE, not about "I did not get the real value" — a nulled key and a
// deleted key are two different wire shapes, and only one of them is what
// `applyRedaction` and the field masker actually do.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const LIAISON_SET = 'showcase_client_liaison';
const LIAISON_EMAIL = 'client-liaison@verify.test';

/** The seeded briefs, by the `externalId` the seed keys them on. */
const PUBLISHED_BRIEF = 'Northwind — Website Relaunch brief';
const DRAFT_BRIEF = 'Fabrikam — Compliance Audit brief';

/** The object's declared `redactFields` — never served through a token. */
const REDACTED = ['internal_notes', 'deal_value'];
/** The client-facing half — a resolve that strips these has over-redacted. */
const PUBLIC_FIELDS = ['title', 'summary'];
/** The three figures `showcase_client_liaison` withholds. */
const MASKED_FIELDS = ['budget', 'spent', 'budget_remaining'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (b: any): any[] => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
/** Unwrap a by-id read — same shape helper the sibling FLS proof uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recordOf = (b: any): Record<string, unknown> => b?.record ?? b?.data ?? b;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('showcase client-liaison fixtures (#9308 fixtures 2 + 4)', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let adminTok = '';
  let liaisonTok = '';
  let publishedBriefId = '';
  let draftBriefId = '';
  let noteId = '';
  let projectId = '';

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    liaisonTok = await stack.signUp(LIAISON_EMAIL);
    const set = await ql.findOne('sys_permission_set', { where: { name: LIAISON_SET }, context: SYS });
    expect(set?.id, `${LIAISON_SET} is seeded by the security bootstrap`).toBeTruthy();
    const uid = (await ql.findOne('sys_user', { where: { email: LIAISON_EMAIL }, context: SYS }))?.id;
    await ql.insert('sys_user_permission_set', { user_id: uid, permission_set_id: set.id }, { context: SYS });

    const briefBy = async (title: string) =>
      String((await ql.findOne('showcase_client_brief', { where: { title }, context: SYS }))?.id ?? '');
    publishedBriefId = await briefBy(PUBLISHED_BRIEF);
    draftBriefId = await briefBy(DRAFT_BRIEF);
    expect(publishedBriefId && draftBriefId, 'both seeded briefs exist').toBeTruthy();

    projectId = String((await ql.find('showcase_project', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    expect(projectId, 'a seeded project to read the masked figures off').toBeTruthy();

    // A note the admin owns, for the "an object that did NOT opt in" control.
    const note = await stack.apiAs(adminTok, 'POST', '/data/showcase_private_note', {
      title: `share-link-control-${Date.now()}`,
    });
    noteId = String(idOf(await note.json()));
    expect(noteId, 'the control record').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── FIXTURE 2 ────────────────────────────────────────────────────────────

  it('the opt-in is per OBJECT: an object that does not declare publicSharing still answers 422 SHARING_NOT_ENABLED', async () => {
    const res = await stack.apiAs(adminTok, 'POST', '/share-links', {
      object: 'showcase_private_note',
      recordId: noteId,
    });
    expect(res.status, 'showcase_private_note declares no publicSharing').toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'SHARING_NOT_ENABLED' } });
  });

  it('the declared eligibility predicate is ENFORCED: a draft brief cannot be link-shared', async () => {
    const res = await stack.apiAs(liaisonTok, 'POST', '/share-links', {
      object: 'showcase_client_brief',
      recordId: draftBriefId,
    });
    expect(
      res.status,
      "publicSharing.eligibility is record.status == 'published'; the draft brief must be refused",
    ).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'RECORD_NOT_ELIGIBLE' } });
  });

  it('a published brief MINTS a capability token, and the anonymous resolve renders it MINUS redactFields', async () => {
    const minted = await stack.apiAs(liaisonTok, 'POST', '/share-links', {
      object: 'showcase_client_brief',
      recordId: publishedBriefId,
    });
    const mintedBody = await minted.json();
    expect(minted.status, `mint: ${JSON.stringify(mintedBody)}`).toBeLessThan(300);
    const token = String(mintedBody?.token ?? mintedBody?.data?.token ?? '');
    expect(token, 'the mint returns an opaque token').toBeTruthy();

    // ANONYMOUS — no Authorization header at all. This is the whole point of a
    // capability token: the URL is the credential.
    const resolved = await stack.api(`/share-links/${encodeURIComponent(token)}/resolve`);
    const body = await resolved.json();
    expect(resolved.status, `anonymous resolve: ${JSON.stringify(body)}`).toBe(200);
    const record = (body?.record ?? body?.data?.record) as Record<string, unknown>;
    expect(record, 'the resolve carries the record').toBeTruthy();

    for (const field of PUBLIC_FIELDS) {
      expect(record, `the client-facing field '${field}' survives redaction`).toHaveProperty(field);
    }
    for (const field of REDACTED) {
      // Key ABSENCE, not "not the real value": `applyRedaction` deletes the key.
      // A nulled key would pass a looser assertion and pin nothing.
      expect(
        Object.keys(record),
        `'${field}' is declared in publicSharing.redactFields and must never leave the server through a token`,
      ).not.toContain(field);
    }
  });

  // ── FIXTURE 4 ────────────────────────────────────────────────────────────

  it('readable:false STRIPS the budget figures for the liaison — by id, in lists, and through an explicit select', async () => {
    const byId = await stack.apiAs(liaisonTok, 'GET', `/data/showcase_project/${projectId}`);
    expect(byId.status, 'the ROW is still served — FLS is a field gate, not a row gate').toBe(200);
    const record = recordOf(await byId.json());
    expect(record?.name, 'the unrestricted fields still arrive').toBeTruthy();
    for (const field of MASKED_FIELDS) {
      expect(Object.keys(record), `'${field}' is withheld by readable:false — the KEY is stripped`).not.toContain(field);
    }

    const listed = await stack.apiAs(liaisonTok, 'GET', '/data/showcase_project');
    const rows = rowsOf(await listed.json());
    expect(rows.length, 'the liaison reads projects').toBeGreaterThan(0);
    for (const row of rows) {
      for (const field of MASKED_FIELDS) {
        expect(Object.keys(row), `'${field}' is stripped from every listed row too`).not.toContain(field);
      }
    }

    const selected = await stack.apiAs(liaisonTok, 'GET', `/data/showcase_project?$select=name,budget`);
    if (selected.status === 200) {
      for (const row of rowsOf(await selected.json())) {
        expect(
          Object.keys(row),
          "naming the withheld field in `$select` must not hand it back",
        ).not.toContain('budget');
      }
    } else {
      // A refusal is also honest — what must never happen is a 200 carrying it.
      expect(selected.status, 'a select naming a withheld field is refused, not served').toBeGreaterThanOrEqual(400);
    }
  });

  it('the ENTITLED contrast: the admin reads the same row WITH the budget figures', async () => {
    const res = await stack.apiAs(adminTok, 'GET', `/data/showcase_project/${projectId}`);
    expect(res.status).toBe(200);
    const record = recordOf(await res.json());
    for (const field of MASKED_FIELDS) {
      expect(
        Object.keys(record),
        `'${field}' is present for a caller holding no withholding set — the lock keys on the CALLER, not the field`,
      ).toContain(field);
    }
  });
});
