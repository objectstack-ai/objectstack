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
// thirteen rule ids this block carries. #7576 corrected the reason (measured,
// not inherited); #8307 (this file) is the slice the corrected reason named as
// ready — the ADR-0091 seed pair now DOES run at the door, `runtimeTypes:
// ['seed']`, and this file's job changes with it: cases 1-3 below still measure
// why `object` / `permission` / `book` remain undeclared (mirrored, since
// nothing wires them), and the seed cases now measure the REAL gate instead of
// a mirror of it.
//
// ## Why cases about unwired types consume the REAL snapshot builder
//
// No rule declares `object` / `permission` / `book` in `runtimeTypes` today —
// that is the state #8310 is about — so `runRuntimeAuthoringRules` cannot be
// asked what this block would find there: it filters the registry by declared
// type and correctly returns nothing for them. `wouldGateAdd()` below
// therefore drives `buildRuntimeWriteSnapshots` — the gate's OWN construction,
// exported under #8309 — through this block directly. Before #8309 this file
// kept a hand-written mirror of the snapshot logic instead, which is exactly
// the drift surface #8309's snapshot change would have invalidated silently;
// `the mirror still matches the real gate` keeps pinning builder-vs-gate
// parity against a type that IS wired.
//
// ## What each case is evidence FOR
//
//  1. `object` / `permission` / `book` / `position` / `app` still reach no rule
//     here — the residual state #8310 will change, stated once so the builder
//     cases below read as "what would happen", not "what happens".
//  2. `an OWD-less object write would be REFUSED` — the positive control for the
//     escalation. This is why the `object` half of the move is a strictness
//     rollout (#4001) and not a wiring fix: it is the shape the platform's own
//     runtime create door emits (`METADATA_CREATE_SEEDS.object` carries no
//     `sharingModel`), and declaring the type turned 26 writes into 422s across
//     8 files of `@objectstack/metadata-protocol`'s suite when measured.
//  3. `a permission-set write agrees with the whole-stack verdict` — #8309's
//     acceptance. The three cross-collection rules compare against sibling
//     collections the snapshot now carries (`permissions`/`books`), so the
//     per-write verdict for them equals the whole-stack one. The case ALSO
//     reproduces the pre-#8309 defect in miniature (an objects-only context
//     still invents the phantom finding — the 38-vs-4 mechanism, PR #7886),
//     which is the reverse verification kept live in-tree: deleting the
//     enrichment turns the agreement half red, in the predicted direction.
//  4. `the ADR-0091 seed pair now crosses the runtime publish gate (#8307)` —
//     the pair enforces for `seed`-typed writes through the REAL gate, on the
//     `seed` → `data` stack key corrected under #7886/#8308, and the diff
//     mechanism (baseline vs candidate) is proven to isolate the pair's own
//     findings from the other eleven rule ids this ONE registry entry also
//     carries — so declaring `runtimeTypes: ['seed']` on the whole
//     `validateSecurityPosture` entry, rather than splitting it into a
//     seed-only entry, is safe.

import { describe, it, expect } from 'vitest';

import { getMetadataCreateSeed } from '@objectstack/spec/kernel';

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
  type SecurityFinding,
} from './validate-security-posture.js';

type AnyRec = Record<string, unknown>;

const ENTRY = AUTHORING_RULES.find((r) => r.name === 'validateSecurityPosture')!;

/** Same identity `runtime-gate.ts` set-differences its two passes on. */
const fingerprint = (f: SecurityFinding) => `${f.rule}\u0000${f.where}\u0000${f.path}\u0000${f.message}`;

/**
 * What the runtime publish gate WOULD attribute to one write of `type`,
 * against `context` as the live universe — this block's verdict only.
 *
 * [#8309] Drives `buildRuntimeWriteSnapshots`, the gate's OWN baseline/
 * candidate construction, rather than a hand-kept mirror of it: same
 * replace-not-erase rule when the written type IS a context collection, same
 * set difference. `the mirror still matches the real gate (flow)` pins this
 * helper against `runRuntimeAuthoringRules` on a wired type, so the two ways
 * of asking cannot drift apart.
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

describe('validateSecurityPosture at the runtime publish surface (#7576, crossed for `seed` under #8307)', () => {
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

  it("object / permission / book / position / app still reach no rule here — #8310's residue", () => {
    // Only the ADR-0091 seed pair crossed under #8307. The other five metadata
    // types this block could in principle judge remain UNDECLARED — #8310, and
    // still blocked for the reasons the comment above the registry entry names
    // (a strictness rollout on `object`, RUNTIME_NEEDS_FULL_SNAPSHOT on
    // `permission`/`book`). Asserted so a future declaration for any of these
    // is a deliberate edit to THIS test, not a silent widening.
    for (const type of ['object', 'permission', 'book', 'position', 'app']) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `no rule gates '${type}' yet — that is #8310, not this card`,
      ).not.toContain('validateSecurityPosture');
    }
  });

  it('[#8307] the ADR-0091 seed pair now crosses the runtime publish gate, on the whole registry entry', () => {
    // The registration this card makes: the WHOLE `validateSecurityPosture`
    // entry (all 13 rule ids) declares `runtimeTypes: ['seed']` — there is no
    // per-rule-id split in `authoring-rules.ts`. The isolation cases below are
    // what makes that a safe crossing rather than an over-wide one.
    expect(ENTRY.surfaces).toEqual(['cli', 'runtime-publish']);
    expect(ENTRY.runtimeTypes).toEqual(['seed']);
    expect(runtimeAuthoringRulesFor('seed').map((r) => r.name)).toContain('validateSecurityPosture');
    expect(runtimeGatedTypes()).toContain('seed');
  });

  it('[#8309] the gate can now address `permission` and `book` — the wiring half of the card', () => {
    // Until #8309 this case pinned the OPPOSITE: `stackKeyForType` answered
    // null for both, so declaring either in `runtimeTypes` would have wired
    // the rules onto nothing (the state the wiring guard's `every
    // runtime-gated metadata type maps to a stack key` case refuses). The
    // mappings now exist AHEAD of the registration — the `seed` order (#7576 →
    // #8307) repeated — so #8310's flip is a registry data edit. The entries
    // are inert until then: `runRuntimeAuthoringRules` filters by declared
    // type before consulting the table, and case 1 above pins that nothing
    // declares these types yet.
    expect(stackKeyForType('permission')).toBe('permissions');
    expect(stackKeyForType('book')).toBe('books');
    expect(stackKeyForType('object')).toBe('objects');
    expect(stackKeyForType('seed')).toBe('data');
    // The collections this block reads that stay UNMAPPED, measured: only the
    // excluded-by-family `security-role-word` reads `positions`/`apps`, so
    // #8309 deliberately does not carry or map them (whole family or not at
    // all — #8310's call).
    expect(stackKeyForType('position')).toBeNull();
    expect(stackKeyForType('app')).toBeNull();
  });

  it('an OWD-less object write WOULD be refused — the strictness #8310 would escalate', () => {
    // The body `METADATA_CREATE_SEEDS.object` carried BEFORE #8308: name,
    // label, pluralLabel, fields — and no `sharingModel`. Kept literal as the
    // refusal's positive control.
    const added = wouldGateAdd('object', { name: 'new_object', label: 'New Object', fields: {} });
    expect(added.map((f) => f.rule)).toEqual([SECURITY_OWD_UNSET]);
    expect(added[0].severity).toBe('error');
    expect(added[0].path).toBe('objects[0].sharingModel');

    // And the same write with the OWD authored is clean, so the refusal is
    // about the missing decision and not about object writes as such.
    expect(
      wouldGateAdd('object', { name: 'new_object', label: 'New Object', sharingModel: 'private', fields: {} }),
    ).toEqual([]);
  });

  it('[#8308] the REAL create seed is clean at this gate — blocker A repaired', () => {
    // The platform's own minimal create body now AUTHORS its OWD
    // (`sharingModel: 'private'` — the measured runtime default, ADR-0090 D1 /
    // `effectiveSharingModel` in plugin-sharing), so the gate that #8310 will
    // register for `object` refuses nothing on the platform's own create path.
    // Consumed from the seed registry, not re-spelled, so a seed regression
    // re-opens THIS pin rather than passing silently.
    const seed = getMetadataCreateSeed('object') as AnyRec;
    expect(seed.sharingModel).toBe('private');
    expect(wouldGateAdd('object', seed)).toEqual([]);
  });

  it('[#8309] a permission-set write AGREES with the whole-stack verdict — the phantom is gone', () => {
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
    // snapshot enrichment makes the agreement half below fail INTO this shape.
    const phantoms = wouldGateAdd('permission', TWO_SET_STACK.permissions[0], {
      objects: TWO_SET_STACK.objects,
    });
    expect(phantoms.map((f) => f.rule)).toEqual([SECURITY_MASTER_DETAIL_UNGRANTED]);
    expect(phantoms[0].severity).toBe('warning');
    expect(phantoms[0].where).toBe('object "shop_invoice_line"');

    // #8309's acceptance: the same write against the FULL context — the
    // snapshot the gate now builds — adds nothing, agreeing with the
    // whole-stack run. Both directions: the set that does not grant the
    // detail, and the one that does.
    expect(wouldGateAdd('permission', TWO_SET_STACK.permissions[0], TWO_SET_CONTEXT)).toEqual([]);
    expect(wouldGateAdd('permission', TWO_SET_STACK.permissions[1], TWO_SET_CONTEXT)).toEqual([]);
  });

  it('[#8309] a permission-set UPDATE replaces its stored self — no duplicate-name double set', () => {
    // Replace-not-erase now applies to `permissions` the way it always did to
    // `objects`: re-publishing `shop_clerk` unchanged must judge a universe
    // with ONE `shop_clerk`, not two, and attribute nothing to the write.
    expect(wouldGateAdd('permission', { ...TWO_SET_STACK.permissions[1] }, TWO_SET_CONTEXT)).toEqual([]);
  });

  it('[#8309] a book write resolves its audience against the live permission sets', () => {
    // The third cross-collection rule. Against the full context the audience
    // resolves and the write is clean — agreeing with the whole-stack run.
    const book = { name: 'clerk_handbook', label: 'Clerk Handbook', audience: { permissionSet: 'shop_clerk' } };
    expect(wouldGateAdd('book', book, TWO_SET_CONTEXT)).toEqual([]);

    // A genuinely dangling audience is still caught — enrichment kills the
    // phantom, not the rule.
    const dangling = { name: 'ghost_guide', label: 'Ghost Guide', audience: { permissionSet: 'no_such_set' } };
    const added = wouldGateAdd('book', dangling, TWO_SET_CONTEXT);
    expect(added.map((f) => f.rule)).toEqual([SECURITY_BOOK_AUDIENCE_UNKNOWN_SET]);
    expect(added[0].severity).toBe('warning');

    // And the pre-#8309 shape for books, kept as the reverse-verification
    // twin: with no `permissions` in the context every `{ permissionSet }`
    // audience read as unknown, so a CLEAN book write drew the same warning.
    const phantoms = wouldGateAdd('book', book, { objects: TWO_SET_STACK.objects });
    expect(phantoms.map((f) => f.rule)).toEqual([SECURITY_BOOK_AUDIENCE_UNKNOWN_SET]);
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
    // Real gate, not the mirror — `seed` is wired now, so the production
    // function under test is `runRuntimeAuthoringRules` itself.
    const real = runRuntimeAuthoringRules({ type: 'seed', item: expiredGrant });
    expect(real.errors.map((f) => f.rule)).toEqual([SECURITY_GRANT_EXPIRED_AT_AUTHORING]);
    expect(real.errors[0].severity).toBe('error');
    expect(real.rulesRun).toContain('validateSecurityPosture');
    // The mirror this file used before the crossing must still agree with the
    // real gate now that both are askable — this is the mirror/gate parity
    // pin `the mirror still matches the real gate (flow)` establishes for
    // `flow`, repeated for the type this card actually wires.
    expect(wouldGateAdd('seed', expiredGrant).map((f) => f.rule)).toEqual(
      real.errors.map((f) => f.rule),
    );

    const undocumentedDelegation = {
      object: 'sys_user_permission_set',
      records: [{ user_id: 'u1', permission_set: 'billing', delegated_from: 'u2' }],
    };
    const delegatedReal = runRuntimeAuthoringRules({ type: 'seed', item: undocumentedDelegation });
    expect(delegatedReal.errors.map((f) => f.rule)).toEqual([SECURITY_DELEGATION_MISSING_REASON]);
    expect(delegatedReal.errors[0].severity).toBe('error');

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
      object: 'sys_user_permission_set',
      records: [{ user_id: 'u1', permission_set: 'billing', delegated_from: 'u2', reason: 'vacation stand-in' }],
    };
    for (const item of [cleanGrant, cleanDelegation]) {
      const real = runRuntimeAuthoringRules({ type: 'seed', item });
      expect(real.errors).toEqual([]);
      expect(real.advisories).toEqual([]);
    }
  });

  it('[#8307] a seed write leaks NO finding from the other 11 rule ids this ONE entry also carries', () => {
    // The claim the registry comment makes: `runtimeTypes: ['seed']` is safe to
    // declare on the WHOLE `validateSecurityPosture` entry (not a per-rule-id
    // split) because the gate's baseline/candidate differential holds
    // `stack.objects` identical across both passes for a `seed` write — so any
    // finding this function derives from `stack.objects` fires (if at all)
    // IDENTICALLY in both passes and cancels in the diff. Proven here against a
    // context objects array that WOULD trip `security-owd-unset` and
    // `security-role-word` if this block's other rules leaked through.
    const trippyContext = [
      { name: 'sales_role', label: 'Sales Role', fields: {} }, // no sharingModel + reserved word
    ];
    const cleanGrant = {
      object: 'sys_user_position',
      records: [{ user_id: 'u1', position: 'field_ops', valid_until: '2099-01-01T00:00:00Z' }],
    };
    // Sanity: the context alone really would trip two rules over the whole
    // stack, or this test would be vacuous.
    const wholeStack = validateSecurityPosture({ objects: trippyContext });
    expect(wholeStack.map((f) => f.rule).sort()).toEqual([SECURITY_OWD_UNSET, SECURITY_ROLE_WORD]);

    const real = runRuntimeAuthoringRules({ type: 'seed', item: cleanGrant, context: { objects: trippyContext } });
    expect(real.errors, 'the pre-existing object-body defects must NOT be attributed to this seed write').toEqual([]);
    expect(real.advisories).toEqual([]);
  });

  it('neither blocker touches the rules that judge one document', () => {
    // The measured division the surfaceReason rests on: the five object-body
    // rules and the two seed rules are self-contained, and it is the THREE
    // cross-collection rules that need a snapshot the gate does not build. A
    // seed write reaches no permission-set rule and vice versa.
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
