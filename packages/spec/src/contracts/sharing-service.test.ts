// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type {
  HierarchyScopeContext,
  RecordShareRecipientType,
  SharingRuleRecipientType,
} from './sharing-service';
import { ShareRecipientType } from '../security/sharing.zod';

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
      'grant',
      'listShares',
      'revoke',
    ]);

    for (const gate of ['canEdit', 'canDelete', 'canManageShares'] as const) {
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
 * in-repo producer filled `organizationId` from a `SharingExecutionContext`
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
