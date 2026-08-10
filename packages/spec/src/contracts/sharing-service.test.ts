// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type {
  HierarchyScopeContext,
  ISharingRuleService,
  ISharingService,
  RecordShareRecipientType,
  SharingRuleRecipientType,
  SharingWriteVerdict,
} from './sharing-service';
import type { IApprovalService } from './approval-service';
import type { IReportService } from './report-service';
import type { ExecutionContext } from '../kernel/execution-context.zod';
import { ShareRecipientType } from '../security/sharing.zod';

/** Type-level identity: true iff A and B are the same type. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
/** Compile error when the argument is not `true`. */
type Assert<T extends true> = T;
/** Compile error when the argument is not `false`. */
type Refute<T extends false> = T;

/**
 * [#4539] `RecordShareRecipientType` (né `ShareRecipientType`) pins.
 *
 * The contract type used to be named `ShareRecipientType` while
 * `spec/security` exported a zod enum `ShareRecipientType` for a DIFFERENT
 * concept (sharing-RULE recipients) with a diverged value set — the #4411
 * dual-source trap, worsened by the type≠const kind split. The contract side
 * was renamed; these pins keep the two vocabularies honest about what they
 * each describe.
 */
describe('Sharing Service Contract — recipient vocabularies (#4539)', () => {
  it('RecordShareRecipientType matches the sys_record_share recipient_type select', () => {
    // The storage select on SysRecordShare (`@objectstack/plugin-sharing`) is
    // the gate on what a row can contain; the contract type mirrors it 1:1.
    // `role` — the value the old contract type carried — was never
    // persistable there and is NOT a member.
    const rowRecipients: RecordShareRecipientType[] = [
      'user',
      'group',
      'position',
      'unit_and_subordinates',
      'guest',
    ];
    // @ts-expect-error `role` never was a persistable recipient_type value
    const notARowRecipient: RecordShareRecipientType = 'role';
    expect(rowRecipients).toHaveLength(5);
    expect(notARowRecipient).toBe('role');
  });

  it('security ShareRecipientType is the RULE vocabulary and shares no declaration', () => {
    // The authorable rule-recipient enum: SharingRuleRecipientType minus the
    // reserved `queue`. Distinct concept, distinct values — `group` / `guest`
    // were deliberately removed from it (ADR-0078) while the record-share ROW
    // vocabulary keeps persisting them for forward compatibility.
    expect(ShareRecipientType.options).toEqual([
      'user',
      'team',
      'position',
      'unit_and_subordinates',
      'business_unit',
    ]);
    const ruleRecipient: SharingRuleRecipientType = 'queue';
    // @ts-expect-error `queue` is reserved to the runtime rule contract — not authorable
    const notAuthorable: (typeof ShareRecipientType.options)[number] = 'queue';
    expect(ruleRecipient).toBe(notAuthorable);
  });
});

/**
 * [#5125] The three WRITE gates must all document the `modifyAllRecords`
 * super-user bypass.
 *
 * #4647 made the bypass EXPLICIT on the enforcement side: `canEdit`,
 * `canDelete` and `canManageShares` all fold through the one
 * `ISecurityService.hasWriteBypass` predicate (`hasModifyAllBypass` in
 * `@objectstack/plugin-sharing`'s `SharingService`). Two of the three
 * docstrings said so; `canEdit`'s did not, and its omission read as a
 * deliberate exclusion — the exact opposite of the implementation, and
 * strictly worse than silence because `canDelete` sits four lines below
 * naming the bypass it supposedly does not share.
 *
 * A prose pin rather than a behavioural one, because prose is what drifted:
 * nothing type-checks a doc comment, and this interface's whole job is to be
 * the thing cross-package callers read instead of the plugin. Deleting the
 * sentence again turns this red.
 */
describe('[#5125] ISharingService write-gate bypass documentation parity', () => {
  it('canEdit / canDelete / canManageShares each name the `modifyAllRecords` bypass', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const file = resolve(dirname(fileURLToPath(import.meta.url)), 'sharing-service.ts');
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    const iface = source.statements.find(
      (s): s is import('typescript').InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === 'ISharingService',
    );
    expect(iface, 'ISharingService must still be an interface in this file').toBeDefined();

    // `getFullText` carries a member's LEADING TRIVIA — its doc comment — so
    // the pin reads exactly what an IDE shows on hover, with no assumption
    // about how the comment is wrapped.
    const docOf = new Map<string, string>();
    for (const member of iface!.members) {
      if (!ts.isMethodSignature(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      docOf.set(member.name.text, member.getFullText(source));
    }

    // Anti-vacuity 1: the enumeration found the real contract surface, so a
    // rename cannot quietly empty the assertions below.
    expect([...docOf.keys()].sort()).toEqual([
      'buildReadFilter',
      'canDelete',
      'canEdit',
      'canManageShares',
      // [#6428] The tri-state primaries. Enumerated here so a gate can never be
      // added to this interface without deciding whether it documents the
      // bypass — the loop below is what that decision is written into.
      'checkDelete',
      'checkEdit',
      'grant',
      'listShares',
      'revoke',
    ]);

    for (const gate of ['canEdit', 'canDelete', 'canManageShares', 'checkEdit', 'checkDelete'] as const) {
      expect(docOf.get(gate), `${gate} must document the modifyAllRecords bypass`)
        .toContain('modifyAllRecords');
    }

    // Anti-vacuity 2: the search DISCRIMINATES — it is not matching text every
    // member happens to carry. `buildReadFilter` is the honest negative: the
    // read path has no `hasWriteBypass` branch at all (a View/Modify All Data
    // holder reaches every row because the security layer resolves read DEPTH
    // to `org`, which short-circuits the filter before sharing is consulted),
    // so naming the write bypass there would itself be drift.
    expect(docOf.get('buildReadFilter')).not.toContain('modifyAllRecords');
  });
});

/**
 * [#5858] `HierarchyScopeContext` names ONE authoritative tenancy field.
 *
 * The interface declared `organizationId?` and `tenantId?` side by side with no
 * doc saying which one carries the caller's active organization. The single
 * in-repo producer filled `organizationId` from a six-field sharing context
 * that only has `tenantId`, so the read was structurally always `null`; the
 * real consumer (cloud `security-enterprise`) reads `organizationId`, saw
 * `null`, and skipped tenant isolation. Both ends were "contract-compliant" and
 * the pair leaked across organizations (#5852).
 *
 * The fix is on the contract, not on either consumer: `organizationId` is the
 * authority (repo convention — #3280 blessed the name, #3290 removed the
 * `session.tenantId` alias, `scripts/check-org-identifier.mjs` gates it) and is
 * now REQUIRED, so a producer that forgets it fails to compile rather than
 * handing every resolver an `undefined` org. `tenantId` survives as a
 * deprecated alias — removal is its own retirement, not a rider here.
 *
 * Two kinds of pin below, because the change has two halves: type-level ones
 * that tsc evaluates (`tsconfig.test.json` compiles this file — #5286), and
 * prose ones, because prose is the other half of what was missing.
 */
describe('[#5858] HierarchyScopeContext tenancy authority', () => {
  it('requires `organizationId` and keeps `tenantId` optional (compile-time)', () => {
    // A caller with no active org states so EXPLICITLY. `null` is a value the
    // contract carries (platform/unscoped), never an omission.
    const platformScoped: HierarchyScopeContext = {
      userId: 'usr_1',
      organizationId: null,
      posture: 'single',
    };
    const orgScoped: HierarchyScopeContext = {
      userId: 'usr_1',
      organizationId: 'org_east',
      posture: 'isolated',
      tenantId: 'env_prod',
    };

    // THE pin for the required-ness. Omitting the authoritative field is the
    // exact producer bug #5852 measured; it must not compile. Deleting the `?`
    // again turns this directive into an unused-`@ts-expect-error` error, and
    // this file carries no entry in `test-typecheck-debt.json` — so its budget
    // is zero and the gate goes red.
    // @ts-expect-error `organizationId` is REQUIRED — omitting it must not compile (#5858)
    const missingOrg: HierarchyScopeContext = { userId: 'usr_1', posture: 'single' };

    // The deprecated alias is NOT a substitute: supplying only `tenantId`
    // leaves the authoritative field unstated, which is the same defect.
    // @ts-expect-error `tenantId` does not satisfy the authoritative field (#5858)
    const tenantOnly: HierarchyScopeContext = { userId: 'usr_1', tenantId: 'env_prod', posture: 'single' };

    // [#6139] `posture` is REQUIRED on the same terms, for the symmetrical
    // reason: without it a resolver cannot tell a legitimately org-less
    // `single` deployment from a walled one whose organization went missing,
    // so it must guess. One guess leaks across organizations (#5852); the other
    // silently retires enterprise DEPTH. Neither is acceptable, so neither is
    // reachable — the producer states the posture or does not compile.
    // @ts-expect-error `posture` is REQUIRED — omitting it must not compile (#6139)
    const missingPosture: HierarchyScopeContext = { userId: 'usr_1', organizationId: null };

    expect(platformScoped.organizationId).toBeNull();
    expect(platformScoped.posture).toBe('single');
    expect(orgScoped.organizationId).toBe('org_east');
    expect(orgScoped.posture).toBe('isolated');
    expect(missingOrg.userId).toBe('usr_1');
    expect(tenantOnly.tenantId).toBe('env_prod');
    expect(missingPosture.organizationId).toBeNull();
  });

  it('pins WHICH keys are mandatory, in both directions (compile-time)', () => {
    // `-?` strips optionality, then `object extends Pick<T, K>` is true exactly
    // when K was optional — so the union is the mandatory keys.
    type RequiredKeys<T> = {
      [K in keyof T]-?: object extends Pick<T, K> ? never : K;
    }[keyof T];

    // [#6139] `posture` joins the mandatory set. It is not decoration on the
    // side of `organizationId` — the two are read TOGETHER, and a resolver
    // holding one without the other cannot reach a correct verdict.
    const mandatory: Array<RequiredKeys<HierarchyScopeContext>> = [
      'userId',
      'organizationId',
      'posture',
    ];

    // The other direction, and the ⛔-not-deleted guard in one: `tenantId` is
    // still a member (a removal breaks the reference below) and still OPTIONAL
    // (making the deprecated alias mandatory would be the mirror mistake).
    // @ts-expect-error `tenantId` stays optional — it is a deprecated alias, not a second authority (#5858)
    const notMandatory: RequiredKeys<HierarchyScopeContext> = 'tenantId';

    expect(mandatory).toEqual(['userId', 'organizationId', 'posture']);
    expect(notMandatory).toBe('tenantId');
  });

  it('documents the authority, the deprecation, and the fail-closed obligation', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const file = resolve(dirname(fileURLToPath(import.meta.url)), 'sharing-service.ts');
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    const memberDocs = (name: string): Map<string, string> => {
      const iface = source.statements.find(
        (s): s is import('typescript').InterfaceDeclaration =>
          ts.isInterfaceDeclaration(s) && s.name.text === name,
      );
      expect(iface, `${name} must still be an interface in this file`).toBeDefined();
      const out = new Map<string, string>();
      for (const member of iface!.members) {
        if (!member.name || !ts.isIdentifier(member.name)) continue;
        // `getFullText` carries leading trivia — the doc comment an IDE shows
        // on hover — with no assumption about how it is wrapped.
        out.set(member.name.text, member.getFullText(source));
      }
      return out;
    };

    const ctx = memberDocs('HierarchyScopeContext');
    // Anti-vacuity 1: the enumeration found the real members, so a rename or a
    // deletion cannot quietly empty the assertions. `tenantId` being listed IS
    // the "not removed" pin — its retirement is a separate, deliberate change.
    expect([...ctx.keys()]).toEqual(['userId', 'organizationId', 'posture', 'tenantId']);

    expect(ctx.get('organizationId')).toContain('AUTHORITATIVE');
    expect(ctx.get('organizationId')).toContain('platform/unscoped');
    expect(ctx.get('organizationId')).toContain('MUST scope its owner set by this field');

    // [#6139] The posture's prose must carry BOTH readings of a `null`
    // organization, because carrying only one is how the contradiction arose:
    // the field is useless unless it says what each value licenses.
    expect(ctx.get('posture')).toContain('REQUIRED');
    expect(ctx.get('posture')).toContain('ONE implicit tenant');
    expect(ctx.get('posture')).toContain('MISSING');
    // …and it must NOT offer `single` as the safe default for an unknown
    // posture — that is the exact misreading that would re-open #5852.
    expect(ctx.get('posture')).toContain('strictest');

    expect(ctx.get('tenantId')).toContain('@deprecated');
    expect(ctx.get('tenantId')).toContain('Not the authority for hierarchy scoping');

    // Anti-vacuity 2: the search DISCRIMINATES. `userId` is the honest negative
    // — it is identity, not tenancy, and calling it authoritative would itself
    // be drift.
    expect(ctx.get('userId')).not.toContain('AUTHORITATIVE');

    const resolver = memberDocs('IHierarchyScopeResolver');
    expect([...resolver.keys()]).toEqual(['resolveOwnerIds']);
    // A `null` organization is "no org", never "every org".
    expect(resolver.get('resolveOwnerIds')).toContain('Fail CLOSED');
    expect(resolver.get('resolveOwnerIds')).toContain('never widen');

    // [#6139] Both halves of the posture-conditional obligation, pinned
    // together — stating either alone is what produced two accepted positions
    // that contradicted each other. The walled half must still read as
    // unconditional…
    expect(resolver.get('resolveOwnerIds')).toContain('STRICT');
    // …and the `single` half must be an explicit MUST NOT refuse, so a
    // resolver author cannot read "fail closed" as the whole rule and kill
    // single-posture DEPTH while believing they were being careful.
    expect(resolver.get('resolveOwnerIds')).toContain('MUST NOT be refused');
    expect(resolver.get('resolveOwnerIds')).toContain('Read the two fields TOGETHER');
  });
});

/**
 * [#5817] The MODULE HEADER must route each write verb to its own gate.
 *
 * The header's "Per-record gating" item predates ADR-0111 D3 and still said
 * `canEdit()` answered `update` / `delete` — the exact semantics D3 rejects,
 * contradicting the `canDelete()` doc 140 lines below it (delete is ownership
 * or `modifyAllRecords` ONLY; an `edit` share widens which ROWS a principal
 * reaches, never which VERBS). The header is the first thing a cross-package
 * caller reads, so following it meant treating an `edit` share as delete
 * authorization, or not knowing `canDelete` exists.
 *
 * A prose pin like #5125's, for the same reason: nothing type-checks a doc
 * comment, and the drift is only visible against the method docs a reader may
 * never scroll to. This pins the FILE-level comment rather than a member's, so
 * it reads the leading comment ranges instead of an interface member.
 */
describe('[#5817] ISharingService module header — one gate per write verb', () => {
  it('routes `update` to canEdit() and `delete` to canDelete(), not both to canEdit()', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const file = resolve(dirname(fileURLToPath(import.meta.url)), 'sharing-service.ts');
    const text = readFileSync(file, 'utf8');

    // The module header is one of the comments preceding the first statement;
    // it identifies itself by the module path it documents (the copyright line
    // and the first type's own doc are the other two).
    const header = (ts.getLeadingCommentRanges(text, 0) ?? [])
      .map((range) => text.slice(range.pos, range.end))
      .find((comment) => comment.includes('@objectstack/spec/contracts/sharing-service'));
    expect(header, 'the module header must still open this file').toBeDefined();
    // Anti-vacuity 1: this really is the header with its numbered concerns, so
    // a rewrite cannot empty the assertions below by moving the text elsewhere.
    expect(header).toContain('Per-record gating');

    // THE pin: the header names the gate ADR-0111 D3 split `delete` out to.
    // Restoring the pre-D3 sentence turns this red.
    expect(header).toContain('canDelete()');

    // ...and does not hand `delete` back to `canEdit()`. Both indices resolve
    // in order, so the slice is never empty (a vacuous pass).
    const editAt = header!.indexOf('canEdit()');
    const deleteAt = header!.indexOf('canDelete()');
    expect(editAt, 'canEdit() must still be named in the header').toBeGreaterThan(-1);
    expect(deleteAt, 'canDelete() must be named AFTER canEdit()').toBeGreaterThan(editAt);
    expect(
      header!.slice(editAt, deleteAt),
      "canEdit()'s clause must not claim the `delete` verb (ADR-0111 D3)",
    ).not.toMatch(/\bdelete\b/);

    // Anti-vacuity 2: the negative above DISCRIMINATES — the lower-case verb is
    // still in the header, now attributed to `canDelete()`, so the assertion
    // cannot pass by `delete` having disappeared from the file altogether.
    expect(header).toMatch(/\bdelete\b/);
  });
});

/**
 * [#6428] The write gates are TRI-STATE, and the two-state projection stays.
 *
 * `canEdit()` answered one `true` for two different facts — "I permit this
 * write" and "I do not enforce on this row at all" — which is safe only for a
 * caller that ADDS this gate to whatever else guards the row. #5492's E2
 * experiment delegated a pre-image write gate to it and measured the cost: on
 * objects with **no `owner_id` column**, an ordinary member's cross-creator
 * UPDATE came back `ok: true` where `main` answers 403, because the platform's
 * `created_by` ownership floor was that object's only row-level write gate and
 * an abstaining `true` overrode it.
 *
 * Two kinds of pin, because the change has two halves: compile-time ones that
 * tsc evaluates (`tsconfig.test.json` compiles this file — #5286), and prose
 * ones, because the compatibility rule ("`canEdit` is `verdict !== 'deny'`")
 * and the fail-closed rule ("a failed lookup is `deny`, never `abstain`") are
 * obligations on IMPLEMENTERS that no type can carry.
 */
describe('[#6428] ISharingService tri-state write verdict', () => {
  it('SharingWriteVerdict names exactly allow / abstain / deny (compile-time)', () => {
    const everyVerdict: SharingWriteVerdict[] = ['allow', 'abstain', 'deny'];
    // A fourth state would leave a composing caller with a case it cannot map
    // onto an authorization decision — the union is deliberately closed.
    // @ts-expect-error `unknown` is not a verdict this contract defines
    const notAVerdict: SharingWriteVerdict = 'unknown';
    expect(everyVerdict).toHaveLength(3);
    expect(notAVerdict).toBe('unknown');
  });

  it('checkEdit/checkDelete answer the verdict; canEdit/canDelete stay boolean (compile-time)', () => {
    // THE shape pin. An implementation must offer BOTH forms — the tri-state
    // primary and the boolean projection existing callers already read — so
    // the migration can never be "the interface promises a verdict nobody
    // implements", which is the declared-not-delivered window this card's
    // cross-domain exception exists to avoid.
    const gates: Pick<
      ISharingService,
      'checkEdit' | 'checkDelete' | 'canEdit' | 'canDelete'
    > = {
      checkEdit: async () => 'allow',
      checkDelete: async () => 'abstain',
      canEdit: async () => true,
      canDelete: async () => false,
    };

    // The projection is ONE-WAY: a boolean cannot stand in for a verdict, or
    // "I abstain" would be spellable as `true` again.
    // @ts-expect-error boolean is not assignable to Promise<SharingWriteVerdict>
    const collapsed: Pick<ISharingService, 'checkEdit'> = { checkEdit: async () => true };

    expect(typeof gates.checkEdit).toBe('function');
    expect(typeof collapsed.checkEdit).toBe('function');
  });

  it('the contract writes down the fail-closed rule and the projection rule', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const file = resolve(dirname(fileURLToPath(import.meta.url)), 'sharing-service.ts');
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    const verdictDoc = source.statements
      .filter((s): s is import('typescript').TypeAliasDeclaration => ts.isTypeAliasDeclaration(s))
      .find((s) => s.name.text === 'SharingWriteVerdict')
      ?.getFullText(source);
    expect(verdictDoc, 'SharingWriteVerdict must still be declared in this file').toBeDefined();

    // Anti-vacuity: this really is the documented type, not an empty match.
    expect(verdictDoc).toContain('abstain');

    // THE pin the card names: a failed lookup must NOT be dressed up as "no
    // opinion", because `abstain` hands the row to another authority while
    // `deny` ends it. Deleting this sentence turns the contract silent on the
    // exact confusion that produced the fail-open.
    expect(verdictDoc).toContain('never `abstain`');
    // …and `abstain` must be stated as NOT a permission, so a consumer cannot
    // read "no opinion" as "allowed".
    expect(verdictDoc).toMatch(/\*\*Not a permission\.\*\*/);

    const iface = source.statements.find(
      (s): s is import('typescript').InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === 'ISharingService',
    );
    const docOf = new Map<string, string>();
    for (const member of iface!.members) {
      if (!ts.isMethodSignature(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      docOf.set(member.name.text, member.getFullText(source));
    }

    // The compatibility clause, in writing: the boolean form is defined AS the
    // projection, so an implementer cannot "improve" it into denying an
    // abstain and silently tighten every existing caller.
    for (const projection of ['canEdit', 'canDelete'] as const) {
      expect(docOf.get(projection), `${projection} must declare itself a projection`)
        .toContain('PROJECTION');
      expect(docOf.get(projection), `${projection} must say which verdict maps to false`)
        .toMatch(/not (a )?`deny`/);
    }

    // Anti-vacuity: the search DISCRIMINATES. `buildReadFilter` contributes a
    // filter, not a write verdict, and naming the write vocabulary there would
    // itself be drift.
    expect(docOf.get('buildReadFilter')).not.toContain('abstain');
  });
});

/**
 * [#6523 / #6206 ruling default] The shared enforcement context is the FULL
 * envelope — the fourth and widest narrow twin, converged.
 *
 * ## What the ruling decided, and what this card applied it to
 *
 * #6206 (maintainer, 2026-08-07) set the governance default: enforcement
 * converges on the complete `resolveAuthzContext` envelope and keeps NO
 * per-site subset contracts. Its sweep reached one site — share-link (#6430 /
 * PR #6511). `SharingExecutionContext` (exported from `sharing-service.ts`
 * until #7218 retired it) was the fourth and by far the widest
 * twin: six declared fields serving **36 signatures across three contracts**
 * (`ISharingService` + `ISharingRuleService` here, `IApprovalService`,
 * `IReportService`), every one of them adjudicating access, with
 * `accessible_org_ids` / `org_user_ids` / `posture` / `tabPermissions` absent.
 *
 * ## The MIRROR direction — why this twin cost something different
 *
 * At the share-link site the caller trimmed the VALUE before enforcement saw
 * it. Here nothing was trimmed: `plugin-sharing`'s engine middleware hands the
 * whole execution context down (`buildReadFilter(ctx.object, exec ?? {})`), so
 * the values always arrived complete — it was the declared TYPE that was
 * narrow, so an implementation could not read what it had been given without
 * casting out of its own contract. The specimen on `main` when this card was
 * written, in `plugin-approvals`' privileged-override gate:
 *
 *     const posture = (context as any).posture;   // isOverrideActor()
 *
 * ## What is pinned here, and what deliberately is NOT
 *
 * PINNED: (1) the context parameter of every adjudicating method across the
 * three contracts is `ExecutionContext`, BY TYPE IDENTITY, so re-narrowing it
 * to anything — the old type included — goes red; (2) the SHAPE WITNESS: an
 * implementation typed by the contract reads `accessible_org_ids` / `posture`
 * / `org_user_ids` / `tabPermissions` with **no `as any`**, which under the old
 * signature was TS2339 on each field (TS2551 on `tabPermissions` — tsc
 * suggests `permissions`, the very near-miss the narrow type invited) — that
 * is this file's before-red direction, and it is the MIRROR of PR #6511's,
 * which was TS2353 at a call site stating a trimmed envelope; (3) that the
 * narrow shape stays RETIRED — #7218 deleted the exported type once every
 * implementation had been re-annotated, and the specimen below keeps the
 * refusal enforceable so the convergence cannot be undone by re-declaring the
 * six-field subset under any name.
 *
 * NOT PINNED, on purpose, and for exactly the reason PR #6511 recorded: there
 * is no `@ts-expect-error` asserting that a six-field context is REJECTED
 * where an `ExecutionContext` is expected, because it is not.
 * Structural subtyping accepts it — all six fields exist in the wider type
 * with compatible types, and nothing there is required. A pin shaped like
 * compiler enforcement where only a declaration exists would read as verified
 * and be worse than saying so.
 */
/**
 * [#7218] The RETIRED six-field shape, kept HERE as a SPECIMEN.
 *
 * `SharingExecutionContext` was exported from `./sharing-service.ts` until
 * #7218 deleted it. This local declaration is a deliberate COPY, not an import
 * — nothing may depend on the retired export again, and copying is what makes
 * the deletion permanent while the pins below stay meaningful. Without it the
 * `Refute` assertions in the first case would have had nothing to refute and
 * would have been dropped, which is the quiet way a convergence gets undone:
 * re-declaring these six fields under a new name is exactly the per-site
 * subset the #6206 ruling removed, and this type is what makes that re-narrowing
 * red instead of invisible.
 *
 * ⛔ Not a vocabulary to reach for, and not to be exported from this file.
 */
type RetiredSharingContextSpecimen = {
  userId?: string;
  tenantId?: string;
  positions?: string[];
  permissions?: string[];
  systemPermissions?: string[];
  isSystem?: boolean;
};

describe('[#6523] sharing / approval / report enforcement takes the full ExecutionContext', () => {
  it('declares the full envelope on every adjudicating signature, by type identity', () => {
    // Type-level assertions are the substance of this case; the runtime
    // expectation below only keeps vitest from reporting an empty test. tsc
    // compiles this file (tsconfig.test.json, #5286), so these are checked.
    type SharingCtx = Parameters<ISharingService['buildReadFilter']>[1];
    type EditCtx = Parameters<ISharingService['checkEdit']>[2];
    type GrantCtx = Parameters<ISharingService['grant']>[1];
    type RuleCtx = Parameters<ISharingRuleService['evaluateRule']>[1];
    type ApprovalCtx = Parameters<IApprovalService['decide']>[2];
    type ReportCtx = Parameters<IReportService['run']>[1];

    type _Pins = [
      Assert<Eq<SharingCtx, ExecutionContext>>,
      Assert<Eq<EditCtx, ExecutionContext>>,
      Assert<Eq<GrantCtx, ExecutionContext>>,
      Assert<Eq<RuleCtx, ExecutionContext>>,
      Assert<Eq<ApprovalCtx, ExecutionContext>>,
      Assert<Eq<ReportCtx, ExecutionContext>>,
      // …and none of them is the six-field twin any more — measured against
      // the retired shape itself (the specimen above), so re-declaring that
      // subset under a fresh name is caught, not just re-importing the name
      // #7218 deleted.
      Refute<Eq<SharingCtx, RetiredSharingContextSpecimen>>,
      Refute<Eq<ApprovalCtx, RetiredSharingContextSpecimen>>,
      Refute<Eq<ReportCtx, RetiredSharingContextSpecimen>>,
    ];
    const pinned: _Pins = [true, true, true, true, true, true, false, false, false];
    expect(pinned).toHaveLength(9);
  });

  it('lets an implementation READ the envelope it is handed — no `as any` (shape witness)', async () => {
    // The witness for the mirror direction. `context` is typed BY THE CONTRACT
    // — `Parameters<ISharingService['buildReadFilter']>[1]`, not by a local
    // annotation — so if the contract re-narrows, the four reads below stop
    // compiling (TS2339: "Property 'accessible_org_ids' does not exist on type
    // '…'", as measured against the six-field shape). That is precisely the wall
    // `plugin-approvals` climbed with `(context as any).posture`.
    const seen: Array<Record<string, unknown>> = [];
    const buildReadFilter: ISharingService['buildReadFilter'] = async (object, context) => {
      seen.push({
        object,
        // ADR-0105 D2 — under the `group` posture this set IS the Layer 0 wall.
        accessible_org_ids: context.accessible_org_ids,
        // ADR-0095 D2 — resolved once upstream and carried, never re-derived here.
        posture: context.posture,
        org_user_ids: context.org_user_ids,
        tabPermissions: context.tabPermissions,
      });
      return null;
    };

    // The call site, spelled the way `plugin-sharing`'s engine middleware
    // spells it: the whole resolved envelope, resolved once and handed straight
    // down as a VARIABLE — not as an inline literal. That is deliberate, and it
    // is why reverting this card produces no TS2353 here: excess-property
    // checking would fire only on an inline literal, and inline-literal damage
    // is PR #6511's direction (a caller stating a trimmed envelope), not this
    // one. Here the value was always whole and always assignable; only the
    // READ above was blocked. Measured on the revert: 22 errors on this file,
    // TS2339/TS2551 on the four reads and TS2344/TS2322 on the identity pins,
    // and zero TS2353.
    const envelope: ExecutionContext = {
      userId: 'usr_1',
      tenantId: 'org_plant_a',
      positions: ['sales'],
      permissions: ['standard_user'],
      systemPermissions: ['manage_sharing'],
      accessible_org_ids: ['org_plant_a', 'org_plant_b'],
      org_user_ids: ['usr_1', 'usr_2'],
      posture: 'MEMBER',
      tabPermissions: { crm: 'visible' },
    };
    expect(await buildReadFilter('account', envelope)).toBeNull();

    // Anti-vacuity: the values really travelled, and were really readable.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      object: 'account',
      accessible_org_ids: ['org_plant_a', 'org_plant_b'],
      posture: 'MEMBER',
      org_user_ids: ['usr_1', 'usr_2'],
      tabPermissions: { crm: 'visible' },
    });
  });

  it('keeps the narrow twin RETIRED — and states why tsc cannot be the wall', () => {
    // [#7218] The twin is gone from the contract surface: nothing in
    // `packages/spec` declares it and `@objectstack/plugin-sharing` no longer
    // re-exports it. What survives is the specimen above, and it exists to keep
    // this refusal enforceable — re-narrowing an enforcement parameter to these
    // six fields (under ANY name) turns the `Refute` pins in the first case
    // red. Widening the specimen field by field instead would rebuild the
    // per-site subset the ruling removed, so its shape is pinned too.
    type SpecimenKeys = keyof RetiredSharingContextSpecimen;
    type _ShapeUnchanged = Assert<
      Eq<SpecimenKeys, 'userId' | 'tenantId' | 'positions' | 'permissions' | 'systemPermissions' | 'isSystem'>
    >;
    const shapeUnchanged: _ShapeUnchanged = true;

    // The honest half, exactly as PR #6511 recorded it for its own twin: this
    // assignment is LEGAL and compiles. Six optional fields, all present in the
    // wider type — so the boundary is held by the declared parameter type and
    // the caller's obligation, never by tsc. An `@ts-expect-error` here would
    // be unsatisfied and fail the build. Deleting the exported type changed
    // nothing about that: retirement removes the READY-MADE narrow spelling,
    // it does not make narrowing a compile error.
    const residue: RetiredSharingContextSpecimen = { userId: 'usr_1', isSystem: false };
    const widened: ExecutionContext = residue;
    expect(shapeUnchanged).toBe(true);
    expect(widened.userId).toBe('usr_1');
    expect(widened.accessible_org_ids).toBeUndefined();
  });
});
