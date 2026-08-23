// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#11076] REFUSAL PIN — a non-admin cannot write `sys_file.mime_type` / `size`
// through the data API; a platform admin still can.
//
// ── What this file is, and what it deliberately is NOT ──────────────────────
//
// It is a PIN on the answer the platform gives today. It changes no behaviour
// and decides nothing. It is NOT the harness that measured the answer: the
// measurement's reproduction was withheld under the auth/authz carve-out and
// lives in QA session #10663. Nothing here restates it, and nothing added here
// later should — this file asserts the refusal ENVELOPE and the PERSISTED
// STATE, which is all a pin needs.
//
// ── Why an absence needs a gate ─────────────────────────────────────────────
//
// The refusal is object-level RBAC, not a protection of these two columns. The
// explicit-allow platform baseline `member_default` (#5491) NAMES no `sys_file`
// grant, and object access comes from OWDs plus profile / permission-set
// declarations only — so the refusal is produced by the baseline's SILENCE
// about this object. `sys_file` reinforces that from the schema side: it
// declares no ADR-0103 `managedBy` bucket at all (seven sibling platform
// objects in `platform-objects/src/audit` do — `sys_attachment` names
// `platform` outright, the rest name `engine-owned` / `append-only` / `config`),
// and neither `mime_type` nor `size` carries `readonly`, though `id` on the same
// object does. So nothing on the object itself is holding this line.
//
// An absence has no gate. A baseline change that hands members a `sys_file`
// grant — the shape a "while we are here" widening naturally takes — would
// today move a declared security property (the storage service's accept /
// maxSize re-check reads these columns) with every suite still green. This file
// is what reddens instead.
//
// ⛔ It does NOT decide whether `sys_file` SHOULD be engine-owned, or whether
// these columns should become readonly / system-managed. That is an un-ruled
// platform posture call — it removes an affordance from app authors — and this
// pin is written to survive every outcome of it: if the posture tightens the
// refusal stays a refusal, and if it never does, this file is what tells you
// when the absence stops holding.
//
// ── Three assertions, and why each one is load-bearing ──────────────────────
//
//   `code` AND `status` (ADR-0112). Status alone, or a bare "it threw", is not
//   a refusal assertion: it cannot tell a gate verdict apart from a payload the
//   server rejects for everyone.
//
//   The PLATFORM-ADMIN CONTRAST CONTROL, on the SAME row and the SAME two
//   columns, is part of the pin and not optional. Without it the refusal cases
//   pass just as well when the fixture never reaches the endpoint at all —
//   which is how a refusal pin rots into a tautology. This lane has the scar:
//   a `get-session` pin that answered `200` for anonymous (#10954).
//
//   The READ-BACK is asserted, not the response. A write that answers `403` and
//   lands anyway satisfies a response-only assertion perfectly. Every case below
//   re-reads the row under a system context and asserts the two columns.
//
// The stack boots the VANILLA platform baseline on purpose — `security: new
// SecurityPlugin()`, the documented opt-out from an app's declared default
// profile. The subject is the platform's own answer, so an app profile
// underneath it would make the verdict a statement about that app instead.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { StorageServicePlugin } from '@objectstack/service-storage';

/** A system context — the read-back's vantage point, above every RBAC/RLS layer. */
const SYS = { isSystem: true } as const;

/** The object and the two columns the pin is about. */
const OBJECT = 'sys_file';
const COLUMNS = ['mime_type', 'size'] as const;

/** The row every persona below addresses — one row, so the control is a real contrast. */
const ROW_ID = 'file_pin_11076';

/** The seeded values. Every refusal case asserts the read-back still equals THIS. */
const SEEDED = { mime_type: 'application/octet-stream', size: 11 } as const;

/**
 * An app that declares nothing. `sys_file` is a PLATFORM object registered by
 * the storage service, and the baseline under test is the platform's own, so an
 * app with objects of its own would only add noise the verdict does not depend on.
 */
const pinStack = defineStack({
  manifest: {
    id: 'com.dogfood.sys_file_write_refusal',
    namespace: 'sfp',
    version: '0.0.0',
    type: 'app',
    name: 'sys_file Write Refusal Pin',
    description: 'Platform-baseline fixture for the #11076 sys_file metadata write refusal pin.',
  },
  objects: [],
});

interface Answer {
  status: number;
  code: string | undefined;
  body: string;
}

describe('[#11076] `sys_file.mime_type` / `size` are not writable by a non-admin', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let ownerTok: string;
  let strangerTok: string;
  let ownerId: string;

  /**
   * One by-id write through the data API, reduced to the two things ADR-0112
   * makes assertable. Both envelope spellings are read: `/data` answers a
   * denial flat (`{error, code, object}`) while other surfaces nest it under
   * `error`, and a pin that knew only one spelling would read a real refusal as
   * "no code".
   */
  const write = async (token: string, patch: Record<string, unknown>): Promise<Answer> => {
    const res = await stack.apiAs(token, 'PATCH', `/data/${OBJECT}/${ROW_ID}`, patch);
    const body = await res.text();
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as any;
      code = parsed?.error?.code ?? parsed?.code;
    } catch {
      code = undefined;
    }
    return { status: res.status, code, body: body.slice(0, 300) };
  };

  /** The two columns as they are actually STORED, read above every access layer. */
  const stored = async (): Promise<{ mime_type: unknown; size: unknown }> => {
    const row = await ql.findOne(OBJECT, { where: { id: ROW_ID }, context: SYS });
    expect(row, 'the row under test still exists').toBeTruthy();
    return { mime_type: row.mime_type, size: row.size };
  };

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sysfile-pin-'));
    stack = await bootStack(pinStack, {
      // The vanilla platform baseline — see the header. `new SecurityPlugin()`
      // is the documented way to ask for it.
      security: new SecurityPlugin(),
      // `sys_file` exists because the storage service registers it.
      // `bindToSettings: false` keeps the constructor rootDir.
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });

    // The seeded dev admin is the platform admin; a fresh sign-up is a plain
    // member carrying the baseline and nothing else.
    adminTok = await stack.signIn();
    ownerTok = await stack.signUp('sysfile-owner@verify.test');
    strangerTok = await stack.signUp('sysfile-stranger@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');
    ownerId = (await ql.findOne('sys_user', { where: { email: 'sysfile-owner@verify.test' }, context: SYS }))?.id;
    expect(ownerId, 'the owner persona resolved to a real user').toBeTruthy();

    await ql.insert(
      OBJECT,
      {
        id: ROW_ID,
        key: `pin/${ROW_ID}`,
        name: 'pin.bin',
        status: 'committed',
        scope: 'private',
        owner_id: ownerId,
        ...SEEDED,
      },
      { context: { ...SYS, userId: ownerId } },
    );
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('the fixture really is what the cases below assume (seed control)', async () => {
    // Stated as its own case so a seed that silently landed differently fails
    // HERE, naming itself, instead of making a later refusal look like a pass.
    const row = await ql.findOne(OBJECT, { where: { id: ROW_ID }, context: SYS });
    expect(row.owner_id, 'the owner persona owns the row').toBe(ownerId);
    expect({ mime_type: row.mime_type, size: row.size }).toEqual({ ...SEEDED });
  });

  // Both non-admin personas, so the pin says what it means: the answer does not
  // turn on ownership. The owner is the row's `owner_id`; the stranger is an
  // ordinary authenticated member who owns nothing here.
  const NON_ADMINS = [
    { persona: 'the file owner', token: () => ownerTok },
    { persona: 'an authenticated non-owner', token: () => strangerTok },
  ] as const;

  // A value write and a null write. The null half matters on its own: clearing a
  // column is the cheaper way to disarm a re-check that reads it, and a pin that
  // only ever probed a value write would not cover it.
  const WRITES = [
    { shape: 'a value write', patch: { mime_type: 'text/x-pin-11076', size: 424_242 } },
    { shape: 'a null write', patch: { mime_type: null, size: null } },
  ] as const;

  for (const { persona, token } of NON_ADMINS) {
    for (const { shape, patch } of WRITES) {
      it(`${persona} is refused ${shape} on ${COLUMNS.join(' / ')}`, async () => {
        const before = await stored();

        const answer = await write(token(), { ...patch });

        // ADR-0112: the status AND the code. Either alone is satisfied by
        // answers that are not this refusal.
        expect(answer.status, `status — body: ${answer.body}`).toBe(403);
        expect(answer.code, `code — body: ${answer.body}`).toBe('PERMISSION_DENIED');

        // The half a response-only assertion cannot see: a 403 that lands anyway.
        const after = await stored();
        expect(after, 'the stored columns are untouched').toEqual(before);
        expect(after).toEqual({ ...SEEDED });
      });
    }
  }

  // ── The contrast control. Part of the pin, not a nicety. ───────────────────
  //
  // Last on purpose: it is the only case that changes the row, so every refusal
  // above ran against the seeded values, and this one still addresses the SAME
  // row and the SAME two columns they did. Without it, all four cases above pass
  // unchanged if the fixture stops reaching the endpoint — a request that never
  // arrives is refused by nothing and looks exactly like a gate holding.
  it('a platform admin still succeeds on the same row and the same columns', async () => {
    const ADMIN_WRITE = { mime_type: 'text/x-admin-11076', size: 777 } as const;
    expect(ADMIN_WRITE, 'the control must actually move the columns').not.toEqual({ ...SEEDED });

    const answer = await write(adminTok, { ...ADMIN_WRITE });
    expect(answer.status, `admin status — body: ${answer.body}`).toBe(200);

    // Persisted, read back the same way the refusals were: the control proves a
    // write of these columns REACHES and LANDS, so the 403s above are a verdict
    // about the caller and not about the request.
    expect(await stored()).toEqual({ ...ADMIN_WRITE });
  });
});
