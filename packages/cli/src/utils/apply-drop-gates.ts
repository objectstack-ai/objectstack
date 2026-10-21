// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24958] `os migrate apply`'s drop gates, as every door that names a remedy
 * for a drift entry reads them: the plan, and the listing and skip lines
 * `apply` prints around its prompt.
 *
 * ## The shape this closes
 *
 * The shared differ ends every orphaned column's finding with
 * `"os migrate apply --allow-destructive" to drop it.`, and `apply` offers a
 * re-run with that flag for every destructive entry it held back. Three of
 * those drops `apply` itself refuses on a database that has not met their
 * precondition, and it refuses the WHOLE `--allow-destructive` run while one
 * of them is in it, whatever flag is passed (ADR-0131 D10 item 5 for the
 * ceremony's; the same rule for the other two, each gate's header in
 * `commands/migrate/apply.ts`):
 *
 *  - `sys_account.issuer`, while its retirement pre-flight
 *    (`probeAccountIdentityCollisions`, `@objectstack/plugin-auth`) finds a
 *    `(provider_id, account_id)` key held by more than one row, or cannot read
 *    the table;
 *  - `sys_comment.reactions`, while no verified run of
 *    `os migrate comment-reactions --apply` is recorded
 *    (`readCommentReactionsConversion`);
 *  - every `organization_id` drop, while the organization-ownership ceremony
 *    has not verified (`ceremonyOrganizationColumnDrops` /
 *    `readOrganizationOwnershipMarker`).
 *
 * A door that offered `--allow-destructive` for one of those drops sent the
 * operator into a refusal. Each such drop is still listed and counted as
 * drift; its line names what it waits for, and the footer names the command
 * that moves the database on, never `--allow-destructive`.
 *
 * ## One source per gate
 *
 * Which entries a gate judges is the predicate `apply`'s gate asks — the two
 * that lived inline in `apply.ts` live here now, and `apply` asks them from
 * here — and whether it holds them is the very read that gate makes. There is
 * no second inventory, dialect or table list. {@link DropGateReads} makes that
 * read once per run, so the listing and the gate behind it can never answer
 * differently, and a gate never pays its read twice.
 *
 * ⛔ A NEW DROP GATE IN `apply.ts` GETS A ROW IN {@link APPLY_DROP_GATES}, and
 * one in the enumeration pin `test/migrate-drop-gate-remedies.pin.test.ts`,
 * which discovers `apply`'s refusals from its source and fails until both
 * exist. The refusal itself, its text and its `--json` document stay in
 * `apply.ts`; nothing here refuses anything.
 */

import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import { describeWithApplyLimits } from './schema-migrate.js';
import {
  COMMENT_OBJECT,
  REACTIONS_COLUMN,
  readCommentReactionsConversion,
} from './comment-reactions-conversion.js';
import { ceremonyOrganizationColumnDrops, readOrganizationOwnershipMarker } from './organization-ownership-drop-gate.js';

/** The fields of a drift entry the gates' predicates read. */
export type DropGateEntry = { table: string; op?: { type?: string; column?: string } };

/** The table, and the retired column on it, the `sys_account.issuer` gate guards. */
export const ACCOUNT_OBJECT = 'sys_account';
export const ISSUER_COLUMN = 'issuer';

/** [#17440] The entry the `sys_account.issuer` retirement pre-flight guards: the retired column's drop. */
export function isAccountIssuerDrop(d: DropGateEntry): boolean {
  return d.op?.type === 'drop_column' && d.table === ACCOUNT_OBJECT && d.op.column === ISSUER_COLUMN;
}

/** [#23281] The entry that waits for the reactions conversion: the retired `sys_comment.reactions` column's drop. */
export function isCommentReactionsDrop(d: DropGateEntry): boolean {
  return d.op?.type === 'drop_column' && d.table === COMMENT_OBJECT && d.op.column === REACTIONS_COLUMN;
}

/** [ADR-0131 D10 item 5] An `organization_id` drop the ceremony owns, as the drop gate's own function answers it. */
export function isCeremonyOrganizationDrop(d: DropGateEntry): boolean {
  return ceremonyOrganizationColumnDrops([d]).length > 0;
}

/** The retirement pre-flight's report, as `@objectstack/plugin-auth` returns it. */
type AccountIssuerPreflight = Awaited<ReturnType<typeof import('@objectstack/plugin-auth')['probeAccountIdentityCollisions']>>;

/**
 * The reads `apply`'s drop gates make, each made at most once per run and
 * shared by whoever asks first: the listing above the prompt, or the gate.
 * A read that throws is remembered as thrown — the issuer pre-flight's
 * refusal discipline depends on it (a read that fails is not a clean read).
 *
 * Every method takes the `objectql` service its caller resolved; a run has one
 * stack, so the first caller's is the one read.
 */
export class DropGateReads {
  private issuer: Promise<AccountIssuerPreflight> | undefined;
  private reactions: ReturnType<typeof readCommentReactionsConversion> | undefined;
  private marker: ReturnType<typeof readOrganizationOwnershipMarker> | undefined;

  /** `probeAccountIdentityCollisions` — throws when `sys_account` cannot be enumerated. */
  accountIssuerPreflight(engine: unknown): Promise<AccountIssuerPreflight> {
    this.issuer ??= (async () => {
      const { probeAccountIdentityCollisions } = await import('@objectstack/plugin-auth');
      return probeAccountIdentityCollisions(engine as never);
    })();
    return this.issuer;
  }

  /** `readCommentReactionsConversion` — the recorded verdict of `os migrate comment-reactions --apply`. */
  commentReactionsConversion(engine: unknown): ReturnType<typeof readCommentReactionsConversion> {
    this.reactions ??= readCommentReactionsConversion(engine as never);
    return this.reactions;
  }

  /** `readOrganizationOwnershipMarker` — the ceremony's verified marker. */
  organizationOwnershipMarker(engine: unknown): ReturnType<typeof readOrganizationOwnershipMarker> {
    this.marker ??= readOrganizationOwnershipMarker(engine as never);
    return this.marker;
  }
}

/** What a gate read on this database, when it holds its drops. */
interface Hold {
  /** For the footer: the gate's own words for what it read. */
  why?: string;
}

/** One of `apply`'s drop gates, as the doors that name a remedy read it. */
export interface ApplyDropGate {
  /** The drop it guards, as an operator reads it. */
  readonly id: 'sys_account.issuer' | 'sys_comment.reactions' | 'organization_id';
  /** Which entries it judges: the predicate `apply`'s gate asks. */
  readonly judges: (d: DropGateEntry) => boolean;
  /** Whether it holds them on this database: the read `apply`'s gate makes, judged as it judges it. */
  readonly holds: (reads: DropGateReads, engine: unknown) => Promise<Hold | null>;
  /** The listing line's tail after the finding, for a held entry. */
  readonly entry: string;
  /** The footer line: `held` entries, `waiting` other destructive entries the refusal holds back too. */
  readonly footer: (held: number, waiting: number, hold: Hold) => string;
}

const andTheOthers = (waiting: number): string =>
  (waiting > 0 ? ` (the other ${waiting} destructive change(s) above wait for it too)` : '');

const REFUSES = '"os migrate apply --allow-destructive" refuses every run until';

/**
 * `apply`'s drop gates, in the order `apply` asks them. ⛔ A new gate there is
 * a new row here (see this file's header).
 */
export const APPLY_DROP_GATES: readonly ApplyDropGate[] = [
  {
    id: 'sys_account.issuer',
    judges: isAccountIssuerDrop,
    // A pre-flight that could not read is not a pre-flight that passed: `apply` refuses both.
    holds: async (reads, engine) => {
      try {
        const preflight = await reads.accountIssuerPreflight(engine);
        return preflight.ok ? null : { why: `finds ${preflight.collisions.length} (provider_id, account_id) key(s) held by more than one row` };
      } catch {
        return { why: 'could not read sys_account' };
      }
    },
    entry: 'a drop that waits for its retirement pre-flight, "os migrate account-issuer", which does not pass on this database (see below).',
    footer: (_held, waiting, hold) =>
      `sys_account.issuer above is the retired account issuer, and its retirement pre-flight ${hold.why} on this `
      + `database, so ${REFUSES} it passes${andTheOthers(waiting)}. Run "os migrate account-issuer" for its report, `
      + 'resolve what it lists, then re-run it as the post-check.',
  },
  {
    id: 'sys_comment.reactions',
    judges: isCommentReactionsDrop,
    holds: async (reads, engine) => ((await reads.commentReactionsConversion(engine)).verified ? null : {}),
    entry: 'a drop that waits for "os migrate comment-reactions" to carry the reactions stored in it into '
      + 'sys_comment_reaction records, and no verified run is recorded on this database (see below).',
    footer: (_held, waiting) =>
      'sys_comment.reactions above holds the reactions stored before they became sys_comment_reaction records, and no '
      + `verified run of "os migrate comment-reactions --apply" is recorded on this database, so ${REFUSES} one is`
      + `${andTheOthers(waiting)}. Run "os migrate comment-reactions" to preview, then "os migrate comment-reactions `
      + '--apply"; it carries them into records and records the run verified.',
  },
  {
    id: 'organization_id',
    judges: isCeremonyOrganizationDrop,
    holds: async (reads, engine) => ((await reads.organizationOwnershipMarker(engine)).verified ? null : {}),
    entry: 'a drop the organization-ownership ceremony owns, and it has not verified on this database: the ceremony '
      + 'drops it itself (see below).',
    footer: (held, waiting) =>
      `${held} organization_id drop(s) above are the organization-ownership ceremony's, and it has not verified on `
      + `this database, so ${REFUSES} it has${andTheOthers(waiting)}. Run "os migrate organization-ownership --out `
      + 'PLAN" to write and review its plan, take a backup, then "os migrate organization-ownership --apply '
      + '--plan-file PLAN --backup-taken"; it drops these columns itself.',
  },
];

/** A held entry: the gate that holds it, and what that gate read. */
export interface HeldBy {
  gate: ApplyDropGate;
  hold: Hold;
}

/** The entries `apply` refuses to drop on this database, each with the gate that holds it. */
export type HeldDrops = ReadonlyMap<ManagedDriftEntry, HeldBy>;

/**
 * Ask each gate that judges an entry of `drift` whether it holds them here.
 * A gate that judges none is never read, and neither is the `objectql`
 * service when no gate judges anything: every other database reads nothing it
 * did not read before. Empty when nothing is held, and then every door reads
 * as it always has.
 */
export async function readHeldDrops(
  reads: DropGateReads,
  engineOf: () => unknown,
  drift: readonly ManagedDriftEntry[],
): Promise<HeldDrops> {
  const held = new Map<ManagedDriftEntry, HeldBy>();
  let engine: { value: unknown } | undefined;
  for (const gate of APPLY_DROP_GATES) {
    const judged = drift.filter((d) => gate.judges(d));
    if (judged.length === 0) continue;
    engine ??= { value: engineOf() };
    const hold = await gate.holds(reads, engine.value);
    if (hold) for (const d of judged) held.set(d, { gate, hold });
  }
  return held;
}

/**
 * The `renderPlan` line under each entry, or `undefined` for the differ's own
 * message on every one: a held entry's finding without its `--allow-destructive`
 * sentence, then what its gate waits for; a driver's declared apply limit
 * (`describeWithApplyLimits`) for the rest. Held wins where both apply, as it
 * is the reason the run is refused. The driver package is imported at the
 * point of use, never statically (`schema-migrate.lazy-driver-import.test.ts`).
 */
export async function describeDriftEntries(
  limits: ReadonlyMap<ManagedDriftEntry, string>,
  held: HeldDrops,
): Promise<((d: ManagedDriftEntry) => string) | undefined> {
  if (limits.size === 0 && held.size === 0) return undefined;
  const otherwise = limits.size === 0 ? (d: ManagedDriftEntry) => d.message : await describeWithApplyLimits(limits);
  if (held.size === 0) return otherwise;
  const { driftFindingWithoutRemedy } = await import('@objectstack/driver-sql');
  return (d) => {
    const by = held.get(d);
    return by ? `${driftFindingWithoutRemedy(d)} — ${by.gate.entry}` : otherwise(d);
  };
}

/**
 * One footer line per gate that holds a drop here, in `apply`'s order: what it
 * holds, why `--allow-destructive` is refused, and the command that moves the
 * database on. `waiting` counts, per gate, the other destructive entries a
 * refused run holds back with it — every one but its own and those a
 * driver's declared limit keeps from any run.
 */
export function describeHeldDrops(
  held: HeldDrops,
  drift: readonly ManagedDriftEntry[],
  limits: ReadonlyMap<ManagedDriftEntry, string>,
): string[] {
  const lines: string[] = [];
  for (const gate of APPLY_DROP_GATES) {
    const own = drift.filter((d) => held.get(d)?.gate === gate);
    if (own.length === 0) continue;
    const waiting = drift.filter(
      (d) => d.category === 'destructive' && held.get(d)?.gate !== gate && (held.has(d) || !limits.has(d)),
    ).length;
    lines.push(gate.footer(own.length, waiting, held.get(own[0]!)!.hold));
  }
  return lines;
}
