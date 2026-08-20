// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7576 — the MEASUREMENT behind `validateSecurityPosture`'s runtime-surface
// wiring, kept executable so the registry entry's shape cannot rot into prose.
//
// The registry entry used to say the ADR-0094 `object` authoring gate
// "enforces the same OWD posture rules", so putting this block on the runtime
// publish surface "would double-report one refusal in two vocabularies". That
// was a claim about coverage rather than a reading of the gate: the gate reads
// exactly `sharingModel` and `externalSharingModel`, which is ONE of the
// thirteen rule ids the block carried. #7576 corrected the reason (measured,
// not inherited); the #7891 programme then moved the block in three measured
// slices, and this file records each crossing:
//
//  - #8307: the ADR-0091 seed pair crossed (`runtimeTypes: ['seed']`), with
//    the isolation proof that the differential cancels sibling-collection
//    findings.
//  - #8308: blocker A repaired at the producer — `METADATA_CREATE_SEEDS.object`
//    now authors `sharingModel: 'private'`, so the platform's own minimal
//    create body passes the gate #8310 registers (pinned below, consumed from
//    the seed registry rather than re-spelled).
//  - #8309: the snapshot repair — `RuntimeStackContext` carries
//    `permissions`/`books` in BOTH differential passes and `TYPE_TO_STACK_KEY`
//    maps both types, killing the measured phantom findings (38-vs-4,
//    PR #7886) that made crossing `permission`/`book` unshippable.
//  - #8310 slice 1 (PR #8546): `runtimeTypes` gains `permission` + `book`,
//    and `security-role-word` is split into its own CLI-only entry
//    (`validateSecurityRoleWord`) so it stays behind WHOLE rather than cross
//    for a strict subset of the six collections it judges — the #7220
//    discipline: one rule id sits on ONE side of the wall. `object` measured
//    DIRTY on that tree (objectql 83 tests / 13 files, all
//    `security-owd-unset`; rest 12 / 3) and was escalated, not forced.
//  - #8310 slice 2 (this state): `object` crosses under the maintainer
//    ruling (2026-08-13, 「接受你的全部建议」): an authored OWD is REQUIRED
//    at the runtime object door — an OWD-less object publish is refused with
//    the 422 lint envelope (`security-owd-unset`); absence is not a
//    decision. The red suite files were repaired honestly (fixtures author
//    their posture), `meta-object-owd-gate.test.ts` re-pins the door ORDER
//    (this 422 table answers first; the ADR-0094-seam 403 R1 door answers
//    for what passes lint), and the same ruling retired the plugin gate's
//    R2 `owd_external_wider` arm as this door's duplicate.
//
// ## What each case is evidence FOR
//
//  1. `the mirror still matches the real gate (flow)` — non-vacuity for
//     `wouldGateAdd` (builder-vs-gate parity on a wired type).
//  2. The crossing pins: `seed`/`permission`/`book`/`object` all reach this
//     block at the REAL gate; `position`/`app` reach no rule (role-word's
//     residue — see 3).
//  3. `security-role-word` stays behind WHOLE: its entry is CLI-only, no
//     runtime-gated type reaches it, and the door does NOT refuse a
//     `role_manager`-named permission set for it — while the CLI still
//     refuses exactly what it refused before the split (both entries run on
//     all three commands; the union of their findings is the pre-split set).
//  4. The `object` crossing, at the real gate: an OWD-less object publish IS
//     refused (`security-owd-unset` — the ruled strictness), the platform's
//     own create seed is clean (#8308's repair), a clean write is not blamed
//     for the context's pre-existing defects, and the system-object boundary
//     of the retired R2 arm is pinned as deliberate.
//  5. The #8309 agreement pins, upgraded to the REAL gate now that
//     `permission`/`book` are declared: the write agrees with the
//     whole-stack verdict against the full context, and the pre-#8309
//     phantom is kept executable as the in-tree reverse verification
//     (objects-only context still invents it — deleting the snapshot
//     enrichment turns the agreement half red in the predicted direction:
//     MORE findings than whole-stack).
//  6. The seed-pair cases (#8307), unchanged.

import { describe, it, expect } from 'vitest';

import { getMetadataCreateSeed, DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

import { AUTHORING_RULES } from './authoring-rules.js';
import {
  buildRuntimeWriteSnapshots,
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
  type RuntimeStackContext,
} from './runtime-gate.js';
import {
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_DELEGATION_MISSING_REASON,
  SECURITY_GRANT_EXPIRED_AT_AUTHORING,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_OWD_UNSET,
  SECURITY_ROLE_WORD,
  validateSecurityPosture,
  validateSecurityRoleWord,
  type SecurityFinding,
} from './validate-security-posture.js';

type AnyRec = Record<string, unknown>;

const ENTRY = AUTHORING_RULES.find((r) => r.name === 'validateSecurityPosture')!;
const ROLE_ENTRY = AUTHORING_RULES.find((r) => r.name === 'validateSecurityRoleWord')!;

/** Same identity `runtime-gate.ts` set-differences its two passes on. */
const fingerprint = (f: SecurityFinding) => `${f.rule}\u0000${f.where}\u0000${f.path}\u0000${f.message}`;

/**
 * What the runtime publish gate WOULD attribute to one write of `type`,
 * against `context` as the live universe — this block's verdict only.
 *
 * [#8309] Drives `buildRuntimeWriteSnapshots`, the gate's OWN baseline/
 * candidate construction, rather than a hand-kept mirror of it. Since #8310
 * declared `object`/`permission`/`book`, most cases ask the REAL
 * `runRuntimeAuthoringRules` instead; this helper remains for builder parity
 * pins and for measuring this block's verdict in isolation from any other
 * rule that may later declare the same types.
 */
function wouldGateAdd(type: string, item: AnyRec, context: RuntimeStackContext = {}): SecurityFinding[] {
  const snapshots = buildRuntimeWriteSnapshots({ type, item, context });
  expect(snapshots, `no snapshot for type '${type}' — is its TYPE_TO_STACK_KEY entry gone?`).not.toBeNull();
  const before = new Set(validateSecurityPosture(snapshots!.baseline).map(fingerprint));
  return validateSecurityPosture(snapshots!.candidate).filter((f) => !before.has(fingerprint(f)));
}

/**
 * Two permission sets that between them grant the detail, plus a book gated on
 * one of them — the ordinary shape, and the miniature of PR #7886's 38-vs-4
 * measurement: any per-write snapshot that drops a sibling collection makes
 * one of the three cross-collection rules invent a finding here.
 */
const TWO_SET_STACK = {
  objects: [
    { name: 'shop_invoice', label: 'Invoice', sharingModel: 'private', fields: { title: { type: 'text', label: 'T' } } },
    {
      name: 'shop_invoice_line',
      label: 'Invoice Line',
      sharingModel: 'controlled_by_parent',
      fields: { invoice: { type: 'master_detail', label: 'Invoice', reference: 'shop_invoice', required: true } },
    },
  ],
  permissions: [
    { name: 'shop_billing', label: 'Billing', objects: { shop_invoice: { allowRead: true, readScope: 'org' } } },
    {
      name: 'shop_clerk',
      label: 'Clerk',
      objects: {
        shop_invoice: { allowRead: true, readScope: 'org' },
        shop_invoice_line: { allowRead: true, allowCreate: true },
      },
    },
  ],
  books: [
    { name: 'billing_guide', label: 'Billing Guide', audience: { permissionSet: 'shop_billing' } },
  ],
};

/** {@link TWO_SET_STACK} as the gate's live-universe context. */
const TWO_SET_CONTEXT: RuntimeStackContext = {
  objects: TWO_SET_STACK.objects,
  permissions: TWO_SET_STACK.permissions,
  books: TWO_SET_STACK.books,
};

describe('validateSecurityPosture at the runtime publish surface (#7576 → #8307 → #8309 → #8310)', () => {
  it('the mirror still matches the real gate (flow)', () => {
    // Non-vacuity for `wouldGateAdd`, and the drift guard the whole file rests
    // on: `flow` IS wired, so the real gate has a verdict to compare against.
    // A snapshot change in `runtime-gate.ts` that this mirror did not follow
    // shows up here rather than as a silently wrong measurement below.
    const brokenFlow = {
      name: 'leave_approval',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'approve', type: 'approval', config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] } },
      ],
    };
    const objects = [{ name: 'leave_request', fields: { owner: { type: 'text' } } }];
    const real = runRuntimeAuthoringRules({ type: 'flow', item: brokenFlow, context: { objects } });
    expect(real.errors.length, 'the gate must find something, or the comparison is vacuous').toBeGreaterThan(0);
    expect(stackKeyForType('flow')).toBe('flows');
  });

  it('[#8310] seed / permission / book / object all cross — the completed flip, on the whole 12-rule entry', () => {
    // The registration the #7891 programme was for: the
    // `validateSecurityPosture` entry (12 rule ids — `security-role-word` is
    // its own entry now, see below) declares all four mapped types.
    // `permission`/`book` measured ZERO refusals when they crossed (PR
    // #8546); `object` crosses under the #8310 maintainer ruling with the
    // red suites repaired honestly (fixtures author their `sharingModel`).
    expect(ENTRY.surfaces).toEqual(['cli', 'runtime-publish']);
    expect(ENTRY.runtimeTypes).toEqual(['seed', 'permission', 'book', 'object']);
    for (const type of ['seed', 'permission', 'book', 'object']) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `'${type}' writes must reach this block at the door`,
      ).toContain('validateSecurityPosture');
      expect(runtimeGatedTypes()).toContain(type);
    }
  });

  it('[#8310] an OWD-less object publish is REFUSED at the real gate — absence is not a decision', () => {
    // The object crossing pin, same shape as the permission/book pins: the
    // maintainer-ruled strictness itself. An object write with no authored
    // `sharingModel` is refused by `security-owd-unset` at the REAL runtime
    // gate — the body `METADATA_CREATE_SEEDS.object` carried before #8308.
    const real = runRuntimeAuthoringRules({
      type: 'object',
      item: { name: 'new_object', label: 'New Object', fields: {} },
    });
    expect(real.errors.map((f) => f.rule)).toEqual([SECURITY_OWD_UNSET]);
    expect(real.errors[0].severity).toBe('error');
    expect(real.errors[0].path).toBe('objects[0].sharingModel');
    expect(real.rulesRun).toContain('validateSecurityPosture');

    // And the same write with the OWD authored is clean — the refusal is
    // about the missing decision, not about object writes as such.
    const clean = runRuntimeAuthoringRules({
      type: 'object',
      item: { name: 'new_object', label: 'New Object', sharingModel: 'private', fields: {} },
    });
    expect(clean.errors).toEqual([]);
    expect(clean.advisories).toEqual([]);
  });

  it('[#8310] the R2-retirement boundary: a SYSTEM object with unset OWD is not refused at this door', () => {
    // The one active-path shape the retired plugin-gate R2 refused that this
    // door does not: a system object (`isSystem` / `sys_*`) with no authored
    // `sharingModel` and an explicit external side. Deliberate, not a gap:
    // `security-owd-unset` exempts system objects because their runtime
    // default is PUBLIC (`effectiveSharingModel`, plugin-sharing) — R2's
    // hardcoded private baseline misread that default, so its refusal here
    // was a false positive, which is exactly why the #8310 ruling could
    // retire it as duplicate. A deliberate edit to THIS pin is required to
    // change that boundary.
    const real = runRuntimeAuthoringRules({
      type: 'object',
      item: { name: 'sys_probe', label: 'Probe', externalSharingModel: 'public_read', fields: {} },
    });
    expect(real.errors).toEqual([]);
    expect(real.rulesRun).toContain('validateSecurityPosture');
  });

  it("[#8310] position / app still reach no rule — role-word's residue, not an oversight", () => {
    // The two collections only `security-role-word` judges. They stay ungated
    // because that rule stays behind WHOLE (next case): gating the types
    // without the rule would gate them on nothing, and wiring the rule for
    // the other collections alone is the #7220 split. A future declaration
    // for either type is a deliberate edit to THIS test.
    for (const type of ['position', 'app']) {
      expect(
        runtimeAuthoringRulesFor(type),
        `no rule gates '${type}' — crossing them is role-word's whole-family card, not a drift`,
      ).toEqual([]);
      expect(stackKeyForType(type)).toBeNull();
    }
  });

  it('[#8310] `security-role-word` stays behind WHOLE — one rule id, one side of the wall (#7220)', () => {
    // The explicit call the card demands. The rule judges six collections
    // (objects, fields, actions, permission sets, positions, apps — plus
    // books); `positions`/`apps` are neither carried by the snapshot nor
    // mapped, and BOTH types are runtime-creatable — so wiring the rule for
    // the declared types alone would build a door that refuses a permission
    // set named `role_manager` while a position named `sales_role` walks
    // through. It therefore stays behind whole, as its own CLI-only entry.
    expect(ROLE_ENTRY, 'the split entry must exist — role-word may not ride the crossed entry').toBeDefined();
    expect(ROLE_ENTRY.surfaces).toEqual(['cli']);
    expect(ROLE_ENTRY.runtimeTypes).toBeUndefined();
    expect(ROLE_ENTRY.surfaceReason).toMatch(/positions\/apps/);
    // Whole means whole: NO runtime-gated type reaches it.
    for (const type of runtimeGatedTypes()) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `role-word must not run for '${type}' writes — that would be the #7220 split`,
      ).not.toContain('validateSecurityRoleWord');
    }
    // The premise that makes the split load-bearing rather than pedantic:
    // position/app writes are REAL at this door (`allowRuntimeCreate: true`),
    // so a partial wiring would really have admitted what it refuses elsewhere.
    for (const type of ['position', 'app']) {
      const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);
      expect(entry?.allowRuntimeCreate, `'${type}' is runtime-creatable`).toBe(true);
    }

    // The door side, measured on a WIRED type: a permission-set write named
    // `role_manager` (nothing else about it trips) is NOT refused at the
    // runtime gate — the vocabulary freeze deliberately does not run there.
    const real = runRuntimeAuthoringRules({
      type: 'permission',
      item: { name: 'role_manager', label: 'Manager', objects: {} },
    });
    expect(real.errors).toEqual([]);
    expect(real.rulesRun).toContain('validateSecurityPosture');
    expect(real.rulesRun).not.toContain('validateSecurityRoleWord');

    // The CLI side, unchanged by the split: both entries run on all three
    // commands, and their findings UNION to exactly what the one function
    // produced before — same rule id, same shape, nothing lost.
    expect(ROLE_ENTRY.commands).toEqual(ENTRY.commands);
    const roleWordy = {
      objects: [{ name: 'sales_role', label: 'Sales Role', sharingModel: 'private', fields: {} }],
      permissions: [{ name: 'role_manager', label: 'Manager', objects: {} }],
    };
    const fromPosture = validateSecurityPosture(roleWordy).map((f) => f.rule);
    const fromRoleWord = validateSecurityRoleWord(roleWordy).map((f) => f.rule);
    expect(fromPosture, 'the crossed entry must no longer carry the vocabulary freeze').not.toContain(SECURITY_ROLE_WORD);
    expect(fromRoleWord).toEqual([SECURITY_ROLE_WORD, SECURITY_ROLE_WORD]); // the object AND the set
    expect(validateSecurityRoleWord(roleWordy).every((f) => f.severity === 'error')).toBe(true);
  });

  it('[#8309] the stack-key wiring the flip stands on', () => {
    // Landed AHEAD of the registration (#8309), the same order `seed` arrived
    // in (#7576 → #8307) — which is what kept #8310 a registry data edit.
    expect(stackKeyForType('permission')).toBe('permissions');
    expect(stackKeyForType('book')).toBe('books');
    expect(stackKeyForType('object')).toBe('objects');
    expect(stackKeyForType('seed')).toBe('data');
  });

  it('the builder mirror agrees with the real gate on the object refusal — parity, not duplication', () => {
    // `wouldGateAdd` (the gate's OWN snapshot builder, this block in
    // isolation) and the real gate must attribute the same finding to the
    // same OWD-less write, now that `object` is declared and both are
    // askable.
    const added = wouldGateAdd('object', { name: 'new_object', label: 'New Object', fields: {} });
    expect(added.map((f) => f.rule)).toEqual([SECURITY_OWD_UNSET]);
    const real = runRuntimeAuthoringRules({
      type: 'object',
      item: { name: 'new_object', label: 'New Object', fields: {} },
    });
    expect(real.errors.map((f) => f.rule)).toEqual(added.map((f) => f.rule));
  });

  it('[#8308] the REAL create seed is clean at the real gate — blocker A repaired, still holding', () => {
    // The platform's own minimal create body AUTHORS its OWD
    // (`sharingModel: 'private'` — the measured runtime default, ADR-0090 D1 /
    // `effectiveSharingModel` in plugin-sharing), so the gate this card
    // registered for `object` refuses nothing on the platform's own create
    // path — the fallout that was 26 refusals across 8 suite files before
    // #8308 is measured ZERO. Consumed from the seed registry, not
    // re-spelled, so a seed regression re-opens THIS pin rather than passing
    // silently.
    const seed = getMetadataCreateSeed('object') as AnyRec;
    expect(seed.sharingModel).toBe('private');
    const real = runRuntimeAuthoringRules({ type: 'object', item: seed });
    expect(real.errors).toEqual([]);
    expect(real.rulesRun).toContain('validateSecurityPosture');
  });

  it('a clean object write is not blamed for the context\'s pre-existing defects', () => {
    // The differential's D4 promise, now live at the real gate: a clean
    // object write against a universe that ALREADY carries an OWD-less
    // object must not inherit that finding — it fires identically in both
    // passes and cancels. Without this, one legacy row would block every
    // future publish.
    const legacyContext = [{ name: 'legacy_thing', label: 'Legacy', fields: {} }]; // no sharingModel
    const real = runRuntimeAuthoringRules({
      type: 'object',
      item: { name: 'new_object', label: 'New Object', sharingModel: 'private', fields: {} },
      context: { objects: legacyContext },
    });
    expect(real.errors).toEqual([]);
    expect(real.advisories).toEqual([]);
  });

  it('[#8309→#8310] a permission-set write AGREES with the whole-stack verdict at the real gate', () => {
    // Whole stack: `shop_clerk` grants the detail and the book's audience
    // resolves, so the three cross-collection rules find nothing.
    expect(
      validateSecurityPosture(TWO_SET_STACK).filter((f) => f.rule === SECURITY_MASTER_DETAIL_UNGRANTED),
    ).toEqual([]);

    // The pre-#8309 defect, kept executable as the in-tree reverse
    // verification (predicted direction: MORE findings than whole-stack, not
    // fewer): a context carrying objects only — exactly what the gate used to
    // build — cannot see `shop_clerk`, so the detail reads as ungranted by
    // anyone. This is PR #7886's 38-vs-4 mechanism in miniature; deleting the
    // snapshot enrichment makes the agreement pins below fail INTO this shape.
    // Now measured through the REAL gate (the type is declared), where the
    // warning-tier phantom surfaces as a non-blocking advisory.
    const phantoms = runRuntimeAuthoringRules({
      type: 'permission',
      item: TWO_SET_STACK.permissions[0],
      context: { objects: TWO_SET_STACK.objects },
    });
    expect(phantoms.advisories.map((f) => f.rule)).toEqual([SECURITY_MASTER_DETAIL_UNGRANTED]);
    expect(phantoms.advisories[0].severity).toBe('warning');
    expect(phantoms.advisories[0].where).toBe('object "shop_invoice_line"');
    expect(phantoms.errors).toEqual([]);

    // #8309's acceptance, upgraded to #8310's production path: the same write
    // against the FULL context — the snapshot the gate now builds — adds
    // nothing, agreeing with the whole-stack run. Both directions: the set
    // that does not grant the detail, and the one that does.
    for (const item of TWO_SET_STACK.permissions) {
      const real = runRuntimeAuthoringRules({ type: 'permission', item, context: TWO_SET_CONTEXT });
      expect(real.errors).toEqual([]);
      expect(real.advisories).toEqual([]);
      expect(real.rulesRun).toContain('validateSecurityPosture');
    }
  });

  it('[#8309→#8310] a permission-set UPDATE replaces its stored self — no duplicate-name double set', () => {
    // Replace-not-erase at the real gate: re-publishing `shop_clerk` unchanged
    // must judge a universe with ONE `shop_clerk`, not two, and attribute
    // nothing to the write.
    const real = runRuntimeAuthoringRules({
      type: 'permission',
      item: { ...TWO_SET_STACK.permissions[1] },
      context: TWO_SET_CONTEXT,
    });
    expect(real.errors).toEqual([]);
    expect(real.advisories).toEqual([]);
  });

  it('[#8309→#8310] a book write resolves its audience against the live permission sets', () => {
    // The third cross-collection rule, at the real gate. Against the full
    // context the audience resolves and the write is clean — agreeing with
    // the whole-stack run.
    const book = { name: 'clerk_handbook', label: 'Clerk Handbook', audience: { permissionSet: 'shop_clerk' } };
    const clean = runRuntimeAuthoringRules({ type: 'book', item: book, context: TWO_SET_CONTEXT });
    expect(clean.errors).toEqual([]);
    expect(clean.advisories).toEqual([]);

    // A genuinely dangling audience is still caught — enrichment kills the
    // phantom, not the rule. Warning-tier, so it advises rather than refuses
    // (#4463 P1: only `error` findings block).
    const dangling = { name: 'ghost_guide', label: 'Ghost Guide', audience: { permissionSet: 'no_such_set' } };
    const caught = runRuntimeAuthoringRules({ type: 'book', item: dangling, context: TWO_SET_CONTEXT });
    expect(caught.advisories.map((f) => f.rule)).toEqual([SECURITY_BOOK_AUDIENCE_UNKNOWN_SET]);
    expect(caught.advisories[0].severity).toBe('warning');
    expect(caught.errors).toEqual([]);

    // And the pre-#8309 shape for books, kept as the reverse-verification
    // twin: with no `permissions` in the context every `{ permissionSet }`
    // audience read as unknown, so a CLEAN book write drew the same warning.
    const phantoms = runRuntimeAuthoringRules({
      type: 'book',
      item: book,
      context: { objects: TWO_SET_STACK.objects },
    });
    expect(phantoms.advisories.map((f) => f.rule)).toEqual([SECURITY_BOOK_AUDIENCE_UNKNOWN_SET]);
  });

  it('[#8307] the ADR-0091 seed pair is REFUSED at the real runtime gate, on the corrected `data` stack key', () => {
    // The correction itself: the metadata TYPE is `seed`, the stack KEY is
    // `data`. `seeds` was the spelling before #7576, and the block reads
    // `stack.data` — so the gate would have judged an empty collection.
    expect(stackKeyForType('seed')).toBe('data');

    const expiredGrant = {
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'field_ops', valid_until: '2020-01-01T00:00:00Z' }],
    };
    const real = runRuntimeAuthoringRules({ type: 'seed', item: expiredGrant });
    expect(real.errors.map((f) => f.rule)).toEqual([SECURITY_GRANT_EXPIRED_AT_AUTHORING]);
    expect(real.errors[0].severity).toBe('error');
    expect(real.rulesRun).toContain('validateSecurityPosture');
    // The mirror this file used before the crossing must still agree with the
    // real gate now that both are askable.
    expect(wouldGateAdd('seed', expiredGrant).map((f) => f.rule)).toEqual(
      real.errors.map((f) => f.rule),
    );

    const undocumentedDelegation = {
      // sys_user_position — the ONLY table the D3 rule covers since #9730
      // retired `delegated_from` from sys_user_permission_set.
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'billing_approver', delegated_from: 'u2' }],
    };
    const delegatedReal = runRuntimeAuthoringRules({ type: 'seed', item: undocumentedDelegation });
    expect(delegatedReal.errors.map((f) => f.rule)).toEqual([SECURITY_DELEGATION_MISSING_REASON]);
    expect(delegatedReal.errors[0].severity).toBe('error');

    // [#9730] The retired half, pinned at the same real gate: a
    // sys_user_permission_set seed carrying the retired `delegated_from` key
    // draws NO D3 finding — the column does not exist on that table any more,
    // and the lint no longer implies it does. (The stale key itself is refused
    // downstream by the engine's schema preflight as an undeclared field.)
    const retiredKeyOnPermissionSet = {
      object: 'sys_user_permission_set',
      records: [{ user_id: 'u1', permission_set: 'billing', delegated_from: 'u2' }],
    };
    const retiredReal = runRuntimeAuthoringRules({ type: 'seed', item: retiredKeyOnPermissionSet });
    expect(retiredReal.errors).toEqual([]);
    expect(retiredReal.advisories).toEqual([]);

    // The pre-#7576 spelling, shown to be the inert state it was: the seed
    // lands on a key no rule reads, and the gate reports a clean write.
    const onTheOldKey = validateSecurityPosture({ objects: [], seeds: [expiredGrant] });
    expect(onTheOldKey, 'a seed on `seeds` reaches no rule — that was the defect').toEqual([]);
  });

  it('[#8307] a clean seed write is REALLY clean at the real gate — the trip-free floor', () => {
    // The positive control for the crossing: an authored grant/delegation row
    // that satisfies both ADR-0091 checks earns zero errors and zero
    // advisories at the real door — the crossing refuses defects, not seed
    // writes as such.
    const cleanGrant = {
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'field_ops', valid_until: '2099-01-01T00:00:00Z' }],
    };
    const cleanDelegation = {
      // sys_user_position: the one table delegation rows live on since #9730.
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'field_ops', delegated_from: 'u2', valid_until: '2099-01-01T00:00:00Z', reason: 'vacation stand-in' }],
    };
    for (const item of [cleanGrant, cleanDelegation]) {
      const real = runRuntimeAuthoringRules({ type: 'seed', item });
      expect(real.errors).toEqual([]);
      expect(real.advisories).toEqual([]);
    }
  });

  it('[#8307] a seed write leaks NO finding from the other rule ids this ONE entry also carries', () => {
    // The claim the registry comment makes: declaring several types on the
    // WHOLE entry (not a per-rule-id split) is safe because the gate's
    // baseline/candidate differential holds every sibling collection
    // identical across both passes for a `seed` write — so any finding this
    // function derives from `stack.objects` fires (if at all) IDENTICALLY in
    // both passes and cancels in the diff. Proven against a context object
    // that WOULD trip `security-owd-unset` over the whole stack (and the
    // vocabulary freeze in its own function) if the isolation failed.
    const trippyContext = [
      { name: 'sales_role', label: 'Sales Role', fields: {} }, // no sharingModel + reserved word
    ];
    const cleanGrant = {
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'field_ops', valid_until: '2099-01-01T00:00:00Z' }],
    };
    // Sanity: the context alone really would trip both rule sources over the
    // whole stack, or this test would be vacuous. (`security-role-word` lives
    // in its own function since #8310 — same file, same rule id.)
    expect(validateSecurityPosture({ objects: trippyContext }).map((f) => f.rule)).toEqual([SECURITY_OWD_UNSET]);
    expect(validateSecurityRoleWord({ objects: trippyContext }).map((f) => f.rule)).toEqual([SECURITY_ROLE_WORD]);

    const real = runRuntimeAuthoringRules({ type: 'seed', item: cleanGrant, context: { objects: trippyContext } });
    expect(real.errors, 'the pre-existing object-body defects must NOT be attributed to this seed write').toEqual([]);
    expect(real.advisories).toEqual([]);
  });

  it('the rules that judge one document stay self-contained across types', () => {
    // The measured division the programme rests on: the object-body rules and
    // the two seed rules are self-contained, and the three cross-collection
    // rules judge against a snapshot the gate now carries. A seed write
    // reaches no permission-set rule and vice versa.
    expect(wouldGateAdd('seed', { object: 'crm_account', records: [{ name: 'a' }] })).toEqual([]);
    expect(
      wouldGateAdd('object', {
        name: 'shop_line',
        label: 'Line',
        sharingModel: 'controlled_by_parent',
        fields: { note: { type: 'text', label: 'N' } },
      }).map((f) => `${f.rule}/${f.severity}`),
      'controlled_by_parent with no relation is judged from the object body alone',
    ).toEqual(['security-controlled-by-parent-no-relation/error']);
  });
});
