// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Re-evaluate position- and team-recipient sharing rules when the MEMBERSHIP
 * behind the recipient changes.
 *
 * ## The invariant this module holds
 *
 * A sharing rule's grants are materialised per user (`sys_record_share`,
 * `recipient_type: 'user'`), so "who the rule reaches" is decided when the rule
 * is evaluated, not when a record is read. For a rule whose recipient is a
 * POSITION or a TEAM, who the rule reaches changes whenever a row in the table
 * that says who holds that recipient is written:
 *
 * | recipient_type | membership table    | recipient column | read by                                   |
 * |----------------|---------------------|------------------|-------------------------------------------|
 * | `position`     | `sys_user_position` | `position`       | `PositionGraphService` (source of truth, ADR-0057 D4) |
 * | `team`         | `sys_team_member`   | `team_id`        | `TeamGraphService.expandUsers`            |
 *
 * So when one of those rows is inserted, deleted, or updated in a column the
 * expansion reads, every rule whose recipient it names is re-evaluated FOR THE
 * USER the row names, in the same write path: a new holder gains the rule's
 * grants and a former holder loses them before the write returns. Nobody has to
 * re-evaluate the rule by hand, and nothing waits for the shared record's next
 * write.
 *
 * `bindRuleHooks` binds only on each rule's own `object_name`, and
 * `bu-tree-recompute.ts` covers the two recipient kinds that read the
 * business-unit graph; this module covers the kinds whose expansion reads a
 * membership table instead. `user` (a literal id), `queue` (expands to nobody)
 * and `field` (per record, re-derived by the record's own write) have no
 * membership table to watch.
 *
 * The position expansion also unions `sys_member.role`, the ADR-0057 D4
 * transition source. The holder check reads it — a user who still holds the
 * position there keeps the rule's grants when an assignment row goes — but its
 * writes are not watched here: its values are the closed set of membership
 * grades (ADR-0108), not business positions.
 *
 * ## Cost: scoped to one user and to the rules that name the recipient
 *
 * The BU module refuses to recompute every rule on every graph write, and
 * queues its grant half, because a BU write can move MANY recipients and the
 * re-grant fans out to (matched records × moved members). That reason is
 * honoured here by scoping, not by deferral. A membership row moves exactly the
 * user it names, so each write:
 *
 *  1. returns at once when it cannot have changed who holds what — an update
 *     whose patch touches none of the source's expansion columns
 *     ({@link writeCanChangeHolders});
 *  2. otherwise lists the rules once and keeps only those whose recipient is
 *     the position or team the row names (before or after the write), and —
 *     for an organization-scoped source — whose organization the row's
 *     organization can affect ({@link ruleReadsRowsOf}). A rule naming any
 *     other recipient is never touched;
 *  3. reconciles each kept rule for the named user alone
 *     (`SharingRuleService.reconcileRuleForUser`): an indexed holder check, that
 *     user's grants, and — only when the rule reaches the user — the rule's
 *     criteria read and the grants the user lacks.
 *
 * Nothing in that grows with how many OTHER users hold the recipient. A bulk
 * import of N rows dispatches these hooks once per row (the engine's per-row
 * contract, ADR-0058) and costs N user-scoped passes — work proportional to the
 * grants the import must produce anyway — never N whole-rule passes.
 *
 * Nothing is memoised across the rows of one write, deliberately, for the
 * reason `bu-tree-recompute.ts` gives: each row's verdict is read from the
 * state its own dispatch sees.
 *
 * ## Loops and ordering
 *
 * The handler writes only `sys_record_share`, and nothing that runs on a
 * `sys_record_share` write writes a membership table, so it cannot re-trigger
 * itself. `after`, not `before`: the verdict needs the membership as the write
 * leaves it. The rows it reads come from the engine's own hook context — the
 * inserted row (`result`), the pre-image (`previous`, bound on update and
 * delete since the per-row contract) and the post-image — never re-read, so a
 * delete still knows whose membership it removed.
 *
 * System writes are NOT skipped. The realistic producers of these rows are an
 * HRIS or directory sync, a seed, and — for team membership — better-auth's own
 * adapter, which writes through the engine as a system context. Skipping them would leave the
 * invariant false on the paths most likely to exercise it. The rule-hook
 * materialisation reached the same conclusion (`rule-hooks.ts`, the retired
 * `isSystem` skip).
 */

import type { SharingRuleRow, SharingRuleRecipientType } from '@objectstack/spec/contracts';
import type { OptionalSharingLogger } from './logger-shapes.js';
import type { SharingRuleReconcilePassResult } from './sharing-rule-service.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Package id for these hooks.
 *
 * Distinct from `SHARING_RULE_HOOK_PACKAGE` for the reason
 * `BU_TREE_RECOMPUTE_PACKAGE` is: `unbindAllRuleHooks` runs on every rule
 * rebind, and these hooks must survive it. They carry no rule snapshot — the
 * handler lists the rules live on every write — so a rule authored at runtime
 * is covered without a rebind.
 */
export const RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE = 'plugin-sharing:recipient-membership-recompute';

/** One membership table whose rows say who holds a rule recipient. */
export interface RecipientMembershipSource {
  /** The membership table. */
  readonly object: string;
  /** The rule recipient kind its rows feed. */
  readonly recipientType: SharingRuleRecipientType;
  /** The column naming the recipient: a position name, a team id. */
  readonly recipientColumn: string;
  /**
   * Whether the recipient expansion scopes these rows by `organization_id`:
   * an organization rule counts only rows of its own organization, a
   * platform-global rule counts every row. `false` = the expansion reads the
   * rows whatever their organization.
   */
  readonly organizationScoped: boolean;
  /**
   * The columns the expansion reads. An update whose patch touches none of
   * them cannot change who holds what, and is skipped.
   */
  readonly expansionColumns: readonly string[];
}

/**
 * The membership tables watched, measured against the expansions
 * `SharingRuleService.expandRecipient` runs (see the module table):
 *
 *  - `sys_user_position` — `PositionGraphService` filters on `position` and,
 *    for an organization rule, `organization_id`; it projects `user_id` and
 *    drops a holder outside `valid_from` / `valid_until` (ADR-0091 D2), so a
 *    change to the window moves the holding as surely as a change of user.
 *  - `sys_team_member` — `TeamGraphService.expandUsers` filters on `team_id`
 *    alone, with no organization scope.
 */
export const RECIPIENT_MEMBERSHIP_SOURCES: readonly RecipientMembershipSource[] = Object.freeze([
  {
    object: 'sys_user_position',
    recipientType: 'position',
    recipientColumn: 'position',
    organizationScoped: true,
    expansionColumns: ['user_id', 'position', 'organization_id', 'valid_from', 'valid_until'],
  },
  {
    object: 'sys_team_member',
    recipientType: 'team',
    recipientColumn: 'team_id',
    organizationScoped: false,
    expansionColumns: ['user_id', 'team_id'],
  },
]);

const MEMBERSHIP_EVENTS = ['afterInsert', 'afterUpdate', 'afterDelete'] as const;

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
}

/** The slice of `SharingRuleService` this module drives. */
export interface RecipientMembershipRuleService {
  listRules(
    filter: { object?: string; activeOnly?: boolean },
    context: any,
  ): Promise<SharingRuleRow[]>;
  reconcileRuleForUser(rule: SharingRuleRow, userId: string): Promise<SharingRuleReconcilePassResult>;
}

/**
 * Could this write have changed who holds a recipient?
 *
 * Inserts and deletes always could. An update is judged on the columns its
 * patch carries; anything unreadable (a non-object payload, an absent one)
 * answers `true` — "cannot tell" must never collapse into "nothing changed",
 * which is the direction that would leave a former holder's grants in place.
 */
export function writeCanChangeHolders(source: RecipientMembershipSource, event: string, hookCtx: any): boolean {
  if (event !== 'afterUpdate') return true;
  const data = hookCtx?.input?.data;
  if (!isRecord(data)) return true;
  return source.expansionColumns.some((c) => Object.prototype.hasOwnProperty.call(data, c));
}

/**
 * Does `rule`'s expansion read membership rows of the given organizations?
 *
 * Mirrors the expansion's own scope: for an organization-scoped source, an
 * organization rule counts only rows stamped with its organization, while a
 * platform-global rule (`organization_id` null) counts every row. `orgs` is
 * `null` when a row's organization could not be read, which affects every rule
 * — again "cannot tell" never reads as "not affected".
 */
export function ruleReadsRowsOf(
  source: RecipientMembershipSource,
  rule: Pick<SharingRuleRow, 'organization_id'>,
  orgs: ReadonlySet<string | null> | null,
): boolean {
  if (!source.organizationScoped || orgs === null) return true;
  if (rule.organization_id == null || rule.organization_id === '') return true;
  return orgs.has(String(rule.organization_id));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function present(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

/**
 * The membership row(s) a hook context describes: the inserted row, the
 * pre-image and post-image of an update, the pre-image of a delete. The engine
 * binds all three (`result` on insert and update, `previous` on update and
 * delete); `missing` reports a context that lacks one, so the caller can say
 * so instead of silently reconciling half a move.
 */
function membershipRowsOf(event: string, hookCtx: any): { rows: Record<string, unknown>[]; missing: boolean } {
  const previous = isRecord(hookCtx?.previous) ? hookCtx.previous : null;
  const result = isRecord(hookCtx?.result) ? hookCtx.result : null;
  if (event === 'afterInsert') return { rows: result ? [result] : [], missing: !result };
  if (event === 'afterDelete') return { rows: previous ? [previous] : [], missing: !previous };
  // afterUpdate — the post-image is the pre-image overlaid with the result,
  // so a result carrying only the written columns still names the user.
  const rows: Record<string, unknown>[] = [];
  if (previous) rows.push(previous);
  if (result) rows.push(previous ? { ...previous, ...result } : result);
  return { rows, missing: !previous || !result };
}

/**
 * Bind the recipient-membership recompute hooks: `afterInsert` /
 * `afterUpdate` / `afterDelete` on each of {@link RECIPIENT_MEMBERSHIP_SOURCES}.
 */
export function bindRecipientMembershipRecompute(
  engine: MinimalEngine,
  service: RecipientMembershipRuleService,
  logger?: OptionalSharingLogger,
): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE);
  }

  const onMembershipWrite = (source: RecipientMembershipSource, event: string) => async (hookCtx: any): Promise<void> => {
    try {
      if (!writeCanChangeHolders(source, event, hookCtx)) return;
      const { rows, missing } = membershipRowsOf(event, hookCtx);
      if (missing) {
        logger?.warn?.(
          '[sharing-rule] a membership write reached the recompute without the row it changed — the rules naming '
            + 'its recipient are re-evaluated only for the user that could be read; re-evaluate them to converge',
          { object: source.object, event },
        );
      }
      const users = [...new Set(rows.map((r) => present(r.user_id)).filter((v): v is string => v !== null))];
      const recipients = new Set(rows.map((r) => present(r[source.recipientColumn])).filter((v): v is string => v !== null));
      if (users.length === 0 || recipients.size === 0) return;
      const orgs: Set<string | null> | null = rows.every((r) => Object.prototype.hasOwnProperty.call(r, 'organization_id'))
        ? new Set(rows.map((r) => present(r.organization_id)))
        : null;

      const rules = await service.listRules({}, SYSTEM_CTX as any);
      const affected = (rules ?? []).filter(
        (rule) =>
          rule.recipient_type === source.recipientType
          && recipients.has(String(rule.recipient_id))
          && ruleReadsRowsOf(source, rule, orgs),
      );
      for (const rule of affected) {
        for (const userId of users) {
          // One rule failing for one user must not stop the rest: the next pair
          // may be the withdrawal this write exists to deliver.
          try {
            const pass = await service.reconcileRuleForUser(rule, userId);
            if (pass.grantsCreated > 0 || pass.grantsUpdated > 0 || pass.grantsRevoked > 0) {
              logger?.info?.('[sharing-rule] recipient membership changed — re-evaluated the rule for the user', {
                rule: rule.name ?? rule.id,
                object: source.object,
                event,
                user: userId,
                grantsCreated: pass.grantsCreated,
                grantsUpdated: pass.grantsUpdated,
                grantsRevoked: pass.grantsRevoked,
              });
            }
          } catch (err: any) {
            logger?.warn?.(
              '[sharing-rule] recipient membership re-evaluation failed — this user\'s grants of the rule may not '
                + 'match their membership until the rule is re-evaluated (any write to the rule, or a restart)',
              { rule: rule.name ?? rule.id, object: source.object, event, user: userId, error: err?.message },
            );
          }
        }
      }
    } catch (err: any) {
      // A hook must not fail an operator's write.
      logger?.warn?.('[sharing-rule] recipient membership recompute failed', {
        object: source.object,
        event,
        error: err?.message,
      });
    }
  };

  for (const source of RECIPIENT_MEMBERSHIP_SOURCES) {
    for (const event of MEMBERSHIP_EVENTS) {
      engine.registerHook(event, onMembershipWrite(source, event), {
        object: source.object,
        packageId: RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE,
        // Behind the rule recompute's own 180, beside the BU recompute's 190.
        priority: 190,
      });
    }
  }

  logger?.info?.('[sharing-rule] recipient membership recompute hooks bound', {
    objects: RECIPIENT_MEMBERSHIP_SOURCES.map((s) => s.object),
  });
}

export function unbindRecipientMembershipRecompute(engine: MinimalEngine): number {
  if (typeof engine.unregisterHooksByPackage !== 'function') return 0;
  return engine.unregisterHooksByPackage(RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE);
}
