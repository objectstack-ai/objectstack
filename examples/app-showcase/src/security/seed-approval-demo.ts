// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval demo bootstrap — makes the marquee v16 approval features
 * (M-of-N quorum + per-group 会签, server-computed progress, decision
 * attachments, `?request=` deep links, viewer gating, the reassign picker)
 * demonstrable on a FRESH boot, with no manual setup.
 *
 * Why this exists (and can't be a seed):
 *  - The `approval` flow nodes route to `{ type: 'position', value: 'finance' |
 *    'legal' | 'manager' }`. Approver resolution reads `sys_user_position`
 *    (ADR-0090 D3), but users can't be seeded (they sign up) and position
 *    assignments are runtime admin actions — so out of the box NO ONE holds
 *    those positions and every request resolves to an empty slate and waits
 *    forever.
 *  - The seed loader SUPPRESSES record-change flows (#2661), so seeding an
 *    invoice as `sent` (or an expense as `submitted`) never opens a request.
 *  - `sys_approval_request` is engine-owned (ADR-0103: get/list only), so a
 *    request can't be inserted through the generic data API either.
 *
 * So we play the admin's part imperatively, exactly like `bind-position-sets.ts`:
 * on `kernel:bootstrapped` (after the security bootstrap has created the
 * position/permission rows and the automation engine is wired) we
 *   1. assign the dev-seeded admin to `manager` / `finance` / `legal` so they
 *      are a resolvable approver on every demo request (and can act in the
 *      inbox);
 *   2. provision the two demo personas — a phone-based user so the "phone
 *      sign-in surfaces" show a real number in the All Users list + record
 *      detail, and an auditor — AND give each a better-auth credential account
 *      so they can genuinely sign in (#9308 fixture 1), which is what makes any
 *      two-identity demo (会签, submitter-side gating, OOO delegation)
 *      observable without inventing accounts by hand;
 *   3. launch one flow per approval behavior through the real automation engine,
 *      so genuine, resumable pending requests land in the inbox — Invoice Dual
 *      Sign-off (`unanimous`: finance ∧ legal), High-Value Committee
 *      (`quorum`: 2-of-3), and Expense Sign-off (`per_group` 会签: one approval
 *      from each of the manager / finance groups).
 *
 * Everything is idempotent: a persistent DB keeps the assignments/requests, and
 * `openNodeRequest` rejects a duplicate pending request per (object, record),
 * which we swallow.
 */

/**
 * The identities this bootstrap provisions now live in `demo-personas.ts`,
 * because the SEED needs them too: the fields that feed the notify path
 * (`showcase_task.assignee`, `showcase_project.owner`) must name identities
 * this file really creates, or a reassignment writes an inbox row addressed to
 * nobody (#7746). One registry, two consumers — so the two cannot drift apart.
 */
import {
  ADMIN_EMAIL,
  PHONE_DEMO_USER,
  AUDITOR_DEMO_USER,
  DEMO_PERSONA_PASSWORD,
} from './demo-personas.js';

const SYS = { isSystem: true } as const;

/**
 * Positions the admin is granted so they resolve as an approver on the demos.
 * Covers every `{ type: 'position' }` the showcase approval flows route to and
 * expect the admin to hold — including `exec`, the SECOND tier of
 * `showcase_budget_approval` (manager → exec). Without `exec` a budget approval
 * that a user drives to step 2 routes to an unstaffed position and dead-ends
 * (framework#3424): undecidable request, record locked. Keep this in sync with
 * the position values authored in `automation/flows`.
 */
const ADMIN_APPROVAL_POSITIONS = ['manager', 'finance', 'legal', 'exec'] as const;

interface ApprovalDemoContext {
  ql: {
    find: (object: string, query: unknown, options?: unknown) => Promise<unknown>;
    insert: (object: string, data: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  getService?: <T = unknown>(name: string) => Promise<T>;
  logger?: { info?: (...a: unknown[]) => void; warn?: (...a: unknown[]) => void };
  hook?: (event: string, handler: () => Promise<void> | void) => void;
}

/**
 * The slice of better-auth's own `$context` this file uses to make a persona
 * LOGINABLE — the same two members `plugin-auth`'s admin `set-user-password`
 * endpoint reaches for when it provisions a credential for a user that arrived
 * without one (`admin-user-endpoints.ts` → `AuthContextLike`). Structural, so
 * the showcase gains no dependency on better-auth's types.
 */
interface AuthContextLike {
  password: { hash: (password: string) => Promise<string> };
  internalAdapter: {
    createAccount: (account: {
      userId: string;
      providerId: string;
      issuer: string;
      providerAccountId: string;
      password: string;
    }) => Promise<unknown>;
  };
}

/** The `auth` service `plugin-auth` registers (its `AuthManager`). */
interface AuthManagerLike {
  getAuthContext: () => Promise<AuthContextLike>;
}

/** Minimal shape of the automation engine we drive (see service-automation). */
interface AutomationEngineLike {
  execute: (
    flowName: string,
    context?: { record?: unknown; previous?: unknown; object?: string; organizationId?: string | null; [k: string]: unknown },
  ) => Promise<{ success?: boolean; error?: string; output?: unknown } | unknown>;
}

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const r = res as { records?: unknown[] } | null;
  return (r?.records as Array<Record<string, unknown>>) ?? [];
}

async function findOne(
  ctx: ApprovalDemoContext,
  object: string,
  where: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  try {
    const rows = asRows(await ctx.ql.find(object, { where, limit: 1, context: SYS }));
    return rows[0];
  } catch (err) {
    ctx.logger?.warn?.('[showcase] approval-demo lookup failed', {
      object,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Grant a user approval-routing positions (idempotent by stable id). */
async function assignPositions(
  ctx: ApprovalDemoContext,
  userId: string,
  positions: readonly string[],
  organizationId: string | null,
  idPrefix: string,
): Promise<void> {
  for (const position of positions) {
    const existing = await findOne(ctx, 'sys_user_position', {
      user_id: userId,
      position,
      ...(organizationId ? { organization_id: organizationId } : {}),
    });
    if (existing) continue;
    try {
      await ctx.ql.insert(
        'sys_user_position',
        {
          id: `usp_showcase_${idPrefix}_${position}`,
          user_id: userId,
          position,
          ...(organizationId ? { organization_id: organizationId } : {}),
          reason: 'Showcase approval demo — demo personas hold the approver positions so requests are actionable.',
        },
        { context: SYS },
      );
    } catch (err) {
      ctx.logger?.warn?.('[showcase] approval-demo position assign failed', {
        position,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Read the issuer better-auth actually minted for the DEV ADMIN's local
 * password account, so a persona's credential row is stamped with the same one.
 *
 * ## Why this is read and not written
 *
 * better-auth 1.7 keys account identity on `(issuer, providerAccountId)`:
 * `findAccountByKey` looks a credential up under the issuer better-auth mints
 * for itself, so a row carrying any other value — or none — is INVISIBLE and
 * sign-in fails `INVALID_EMAIL_OR_PASSWORD` behind a "User not found" warn that
 * points at the `sys_user` row, which is fine, rather than at the account, which
 * is not. That one field is the whole reason a hand-hashed password was never
 * enough, and it is what four checklist items had recorded as a knownGap.
 *
 * The value is `plugin-auth`'s to own (`CREDENTIAL_ISSUER` in
 * `backfill-account-issuer.ts`), and an example app re-spelling a platform
 * constant is how the two start disagreeing. So it is DERIVED from the admin
 * account this same runtime already minted: whatever better-auth used there is
 * by construction what a sign-in will look these personas up under.
 *
 * Undefined when it cannot be derived — never a guess. `backfill-account-issuer`
 * makes the same call for the same reason: "a wrong issuer is indistinguishable
 * from a missing one at sign-in, and it also occupies the unique slot the
 * correct row needs."
 */
async function credentialIssuerFromAdmin(
  ctx: ApprovalDemoContext,
  adminUserId: string,
): Promise<string | undefined> {
  const account = await findOne(ctx, 'sys_account', {
    user_id: adminUserId,
    provider_id: 'credential',
  });
  const issuer = account?.issuer;
  return typeof issuer === 'string' && issuer.length > 0 ? issuer : undefined;
}

/**
 * Give a provisioned persona a better-auth credential account, so it can
 * actually SIGN IN (#9308 fixture 1).
 *
 * Goes through better-auth's own `$context` — its hasher and its
 * `internalAdapter.createAccount` — rather than writing `sys_account` by hand:
 * the same path `plugin-auth`'s admin `set-user-password` takes for a user
 * onboarded without a credential (see `admin-user-endpoints.ts`). A raw insert
 * would have to reproduce better-auth's hash format and its id/column mapping,
 * which is two more things that can silently drift out of agreement with the
 * code that reads them back.
 *
 * Idempotent: a persona that already holds a credential account is left alone,
 * so a persistent dev database keeps whatever password its operator set.
 */
async function ensureCredentialAccount(
  ctx: ApprovalDemoContext,
  userId: string,
  issuer: string,
  password: string,
): Promise<boolean> {
  const existing = await findOne(ctx, 'sys_account', {
    user_id: userId,
    provider_id: 'credential',
  });
  if (existing) return false;
  try {
    const auth = await ctx.getService?.<AuthManagerLike>('auth');
    if (!auth || typeof auth.getAuthContext !== 'function') {
      ctx.logger?.warn?.('[showcase] approval-demo: no auth service — persona stays un-loginable', { userId });
      return false;
    }
    const authCtx = await auth.getAuthContext();
    const hashed = await authCtx.password.hash(password);
    await authCtx.internalAdapter.createAccount({
      userId,
      providerId: 'credential',
      issuer,
      providerAccountId: userId,
      password: hashed,
    });
    ctx.logger?.info?.('[showcase] approval-demo persona is now loginable', { userId });
    return true;
  } catch (err) {
    ctx.logger?.warn?.('[showcase] approval-demo credential provisioning failed (persona stays un-loginable)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Provision a demo persona row (best-effort). Returns the user id, whether it
 * was just created or already present, so callers can route positions at it.
 */
async function ensureDemoUser(
  ctx: ApprovalDemoContext,
  user: { id: string; name: string; email: string; phone_number?: string },
): Promise<string | undefined> {
  const existing = await findOne(ctx, 'sys_user', { email: user.email });
  if (existing?.id) return String(existing.id);
  try {
    // `sys_user` carries NO org column — org membership lives on `sys_member`
    // (see the resolution in `run` below). An `organization_id` key here is not
    // silently dropped: it reaches SQL as a real column and the insert dies with
    // "table sys_user has no column named organization_id", so the demo user is
    // never provisioned and its surfaces render empty.
    await ctx.ql.insert('sys_user', { ...user }, { context: SYS });
    ctx.logger?.info?.('[showcase] approval-demo persona provisioned', { email: user.email });
    return user.id;
  } catch (err) {
    // Non-fatal, and the whole persona is lost when it happens: with no row
    // there is nothing for `ensureCredentialAccount` to attach a credential to,
    // so the persona is neither visible in the All Users list nor routable as an
    // approver nor able to sign in.
    ctx.logger?.warn?.('[showcase] approval-demo persona insert failed (persona unavailable)', {
      email: user.email,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Launch a signoff flow on a record through the real automation engine, unless
 * a pending request already exists for it.
 */
async function launchSignoff(
  ctx: ApprovalDemoContext,
  engine: AutomationEngineLike,
  flowName: string,
  objectName: string,
  record: Record<string, unknown>,
  organizationId: string | null,
  /**
   * The record's status BEFORE it entered the trigger state, supplied as
   * `context.previous` so the start-node transition gate — e.g.
   * `status == "sent" && previous.status != "sent"` — is satisfied. The engine
   * only binds `previous` when the caller provides it (engine.ts), and a
   * record-change trigger normally would; an explicit launch must too, or the
   * start condition silently evaluates false and no request opens.
   */
  previousStatus: string,
  /**
   * Who is asking. The approval node stamps the request from `context.userId`
   * (`submitterId: context?.userId ?? null` in approval-node.ts). Without it
   * every seeded request has a null submitter, which renders as 申请人 `—`,
   * leaves the "我发起的" inbox tab empty for every user, and suppresses the
   * submitter-only affordances (recall / remind) — so the submitter half of
   * the approval UI is unreachable.
   */
  submitterId: string | null,
): Promise<void> {
  const recordId = String(record.id ?? '');
  if (!recordId) return;
  const pending = await findOne(ctx, 'sys_approval_request', {
    object_name: objectName,
    record_id: recordId,
    status: 'pending',
  });
  if (pending) {
    ctx.logger?.info?.('[showcase] approval-demo request already pending', { flow: flowName, record: recordId });
    return;
  }
  try {
    // The `object` + `organizationId` on the context are what a record-change
    // trigger supplies; the approval node reads `context.object` for its target
    // (approval-node.ts) and stamps the request's org from `context.organizationId`.
    const result = (await engine.execute(flowName, {
      record,
      previous: { ...record, status: previousStatus },
      object: objectName,
      organizationId,
      ...(submitterId ? { userId: submitterId } : {}),
    })) as { success?: boolean; error?: string; output?: { skipped?: boolean; reason?: string } };
    if (result?.success === false) {
      ctx.logger?.warn?.('[showcase] approval-demo flow returned an error', { flow: flowName, error: result.error });
    } else if (result?.output?.skipped) {
      ctx.logger?.warn?.('[showcase] approval-demo flow skipped (start condition not met)', {
        flow: flowName, reason: result.output.reason,
      });
    } else {
      ctx.logger?.info?.('[showcase] approval-demo launched', { flow: flowName, object: objectName, record: recordId });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('DUPLICATE_REQUEST')) return; // raced another launcher — fine
    ctx.logger?.warn?.('[showcase] approval-demo flow launch failed', { flow: flowName, error: msg });
  }
}

export function registerShowcaseApprovalDemo(ctx: ApprovalDemoContext): void {
  const run = async (): Promise<void> => {
    const admin = await findOne(ctx, 'sys_user', { email: ADMIN_EMAIL });
    if (!admin?.id) {
      // No dev-seeded admin (e.g. a real deployment) — nothing to demo against.
      ctx.logger?.info?.('[showcase] approval-demo skipped (no dev admin)');
      return;
    }
    const adminId = String(admin.id);
    // The active org lives on the better-auth membership (`sys_member`).
    // `sys_user` has no org column at all, so there is nothing to read off the
    // admin row first. Both the position rows AND the requests must carry this
    // org, or the org-scoped approver resolution (`sys_user_position` filtered
    // by org) and `getRequest` (the org-scoped read behind the inbox drawer)
    // silently return nothing.
    const ownerMember = await findOne(ctx, 'sys_member', { user_id: adminId, role: 'owner' });
    const anyMember = ownerMember ?? (await findOne(ctx, 'sys_member', { user_id: adminId }));
    const organizationId = (anyMember?.organization_id as string | undefined) ?? null;

    await assignPositions(ctx, adminId, ADMIN_APPROVAL_POSITIONS, organizationId, 'admin');
    // Mei holds no approval position, which makes her a clean *submitter* — a
    // requester who is never also one of her own approvers.
    const submitterId = (await ensureDemoUser(ctx, PHONE_DEMO_USER)) ?? null;
    // The auditor persona backs the `finance` group of the per-group demo. It
    // deliberately holds ONLY `auditor`, so the two groups have distinct
    // holders and the request stays open until each group has answered.
    const auditorId = await ensureDemoUser(ctx, AUDITOR_DEMO_USER);
    if (auditorId) await assignPositions(ctx, auditorId, ['auditor'], organizationId, 'auditor');

    // [#9308 fixture 1] Make both personas SIGN-INABLE. Provisioning them as
    // rows was never the hard half — the credential account was, and the issuer
    // is the one field that decides whether better-auth can find it. Derived
    // once from the admin's own account and reused for both personas; when it
    // cannot be derived, nothing is written (a wrong issuer is worse than an
    // absent one — see `credentialIssuerFromAdmin`).
    //
    // This is what turns "a second user exists" into "a second user can act":
    // the per-group 会签 demo needs Ada to decide the `finance` group under her
    // OWN identity rather than through the admin's override, the submitter-side
    // viewer gating needs Mei to look at her own pending request, and an
    // out-of-office delegation is only falsifiable when the delegate holds a
    // separate bearer token.
    const credentialIssuer = await credentialIssuerFromAdmin(ctx, adminId);
    if (!credentialIssuer) {
      ctx.logger?.warn?.(
        '[showcase] approval-demo: could not derive the credential issuer from the dev admin — '
        + 'demo personas stay un-loginable (sign in as the admin instead)',
      );
    } else {
      for (const personaId of [submitterId, auditorId]) {
        if (personaId) {
          await ensureCredentialAccount(ctx, personaId, credentialIssuer, DEMO_PERSONA_PASSWORD);
        }
      }
    }

    let engine: AutomationEngineLike | undefined;
    try {
      engine = await ctx.getService?.<AutomationEngineLike>('automation');
    } catch {
      engine = undefined;
    }
    if (!engine || typeof engine.execute !== 'function') {
      ctx.logger?.warn?.('[showcase] approval-demo: automation engine unavailable — requests not opened');
      return;
    }

    // `unanimous`: Invoice Dual Sign-off needs a `sent` invoice; the start gate
    // is `status == "sent" && previous.status != "sent"`, so it entered from
    // `draft`. Both named approvers must answer (not one-per-group — that is
    // the expense demo below).
    // Submitted by the ADMIN on purpose: it is the one request the logged-in dev
    // admin owns, so the "我发起的" tab is non-empty and the submitter-only
    // affordances (recall / remind) have somewhere to appear.
    const sentInvoice = await findOne(ctx, 'showcase_invoice', { status: 'sent' });
    if (sentInvoice) {
      await launchSignoff(
        ctx,
        engine,
        'showcase_invoice_signoff',
        'showcase_invoice',
        sentInvoice,
        organizationId,
        'draft',
        adminId,
      );
    }

    // Quorum (2-of-3): High-Value Committee needs a `submitted` report ≥ $5000;
    // the start gate is `status == "submitted" && previous.status != "submitted"
    // && total_amount >= 5000`, so it entered from `draft`.
    const demoExpense = await findOne(ctx, 'showcase_expense_report', { name: 'EXP-DEMO' });
    if (demoExpense) {
      await launchSignoff(
        ctx,
        engine,
        'showcase_committee_quorum',
        'showcase_expense_report',
        demoExpense,
        organizationId,
        'draft',
        submitterId,
      );
    }

    // 会签 (per_group): Expense Sign-off needs one approval from EACH of the
    // `manager` and `finance` groups. Deliberately routed at EXP-2001 ($1,500),
    // which sits UNDER the $5,000 committee threshold, so the quorum flow above
    // does not also open a request on the same record and blur the two demos.
    const perGroupExpense = await findOne(ctx, 'showcase_expense_report', { name: 'EXP-2001' });
    if (perGroupExpense) {
      await launchSignoff(
        ctx,
        engine,
        'showcase_expense_signoff',
        'showcase_expense_report',
        perGroupExpense,
        organizationId,
        'draft',
        submitterId,
      );
    }
  };

  if (typeof ctx.hook === 'function') {
    // `kernel:bootstrapped` — after every `kernel:ready` handler (the security
    // bootstrap that seeds positions, and the automation engine wiring) has
    // settled, so lookups resolve and the engine is ready.
    ctx.hook('kernel:bootstrapped', run);
  } else {
    setTimeout(() => void run(), 0);
  }
}
