// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The identities the showcase actually PROVISIONS — the one place that answers
 * "which `sys_user` rows exist on a fresh boot of this app?".
 *
 * ## Why this module exists (#7746)
 *
 * `sys_user` rows cannot be seeded — they come from sign-up — so for a long time
 * the seed simply wrote plausible-looking emails (`ada@example.com`,
 * `linus@example.com`, `sam@example.com`) into the fields that FEED THE NOTIFY
 * PATH: `showcase_task.assignee` and `showcase_project.owner`. Those fields are
 * `Field.text`, so nothing rejected the values, and every view rendered happily.
 *
 * The cost showed up one layer down. `RecipientResolver` (ADR-0030 P1) resolves
 * an email-shaped recipient by looking it up in `sys_user` and, on a MISS,
 * **keeps the string verbatim** as the recipient id
 * (`service-messaging/src/recipient-resolver.ts` — "no 'sys_user' matched email
 * '…'; keeping verbatim"). So the stock reassignment demo
 * (`showcase_task_assigned_notify`) persisted a `sys_inbox_message` whose
 * `user_id` was the literal text `ada@example.com`: a row addressed to nobody,
 * which no authenticated user can ever read. The reference app's marquee
 * "reassign a task and watch the inbox" story quietly delivered into a void.
 *
 * The fix is to address those fields to identities that REALLY EXIST. On a fresh
 * dev boot that set is exactly three rows, and this module is their registry:
 *
 *   1. {@link ADMIN_EMAIL} — the dev admin seeded by `plugin-auth`
 *      (`OS_SEED_ADMIN_EMAIL`, default below). The only LOGINABLE one.
 *   2. {@link PHONE_DEMO_USER} / 3. {@link AUDITOR_DEMO_USER} — the personas
 *      `seed-approval-demo.ts` provisions on `kernel:bootstrapped`.
 *
 * ## The honest limits of that set
 *
 * Both persona rows are **display/routing identities, not accounts**: they carry
 * no better-auth credential, so they cannot sign in (see `ensureDemoUser`). They
 * are enough to make a recipient RESOLVE — which is the whole of this defect —
 * and enough to make the inbox row addressable to a real user id, but reading
 * that row as that persona still needs the sign-up the showcase deliberately
 * leaves to the operator.
 *
 * And all three are DEV-ONLY: the dev admin is gated on
 * `NODE_ENV === 'development'`, and the two personas are provisioned only when
 * that admin exists. In a real deployment a fresh showcase has NO users at all,
 * so nothing here could resolve — that is a property of the environment, not a
 * defect in the seed, and no seed value can repair it.
 *
 * ## What is deliberately NOT addressed to these, and why
 *
 * `showcase_team.lead` is display-only — it reaches no notify recipient, so it
 * carries none of this defect and keeps its `ada@`-style email.
 *
 * `showcase_invoice.owner` is the harder case, and it is left alone KNOWINGLY
 * rather than because it is safe. It genuinely does reach a notify recipient
 * (`showcase_invoice_lifecycle` sends to `{record.owner}`), so it is the same
 * defect class as the fields fixed above. But those three emails are also the
 * fixture for the ADR-0055 controlled-by-parent isolation demo, whose whole
 * point is that an operator SIGNS UP as `ada@example.com` and then sees only
 * their own invoices — `qa/dogfood/test/showcase-invoice-seed-isolation.
 * dogfood.test.ts` does exactly that, and pins the seeded owners.
 *
 * Repointing invoices at the personas above would not fix that demo, it would
 * DELETE it: these personas hold no credential, so nobody can sign in as one
 * and observe the row-level scoping. Making them loginable, or giving the
 * showcase a set of real signup-able contributor accounts, is a larger design
 * decision than this defect — so it is reported on #7746 rather than guessed
 * at here, and `test/inert-wirings.test.ts` §5 carries the exemption with the
 * same reasoning attached.
 */

/** The dev admin `plugin-auth` seeds when `NODE_ENV === 'development'`. */
export const ADMIN_EMAIL = 'admin@objectos.ai';

/** A phone-based demo persona (§6 "phone sign-in surfaces"). */
export const PHONE_DEMO_USER = {
  id: 'usr_showcase_phone_demo',
  name: 'Mei Phone (demo)',
  email: 'phone.demo@example.com',
  phone_number: '+8613800138000',
} as const;

/**
 * A second persona holding ONLY `auditor`, which is the position behind the
 * `finance` group of the per-group (会签) demo. It has to be a *different* user
 * from the admin: with one user in both groups a single decision would satisfy
 * both tallies at once, and "one approval per group" would never be observable.
 */
export const AUDITOR_DEMO_USER = {
  id: 'usr_showcase_auditor_demo',
  name: 'Ada Auditor (demo)',
  email: 'auditor.demo@example.com',
} as const;

/**
 * Every email a fresh boot of this app turns into a real `sys_user` row.
 *
 * This is the allow-list a seed value must come from before it may be written
 * to a field the notify path reads as a recipient — pinned by
 * `test/inert-wirings.test.ts` §5, so re-introducing a made-up persona fails a
 * test instead of shipping another unreadable inbox row.
 */
export const PROVISIONED_USER_EMAILS: readonly string[] = [
  ADMIN_EMAIL,
  PHONE_DEMO_USER.email,
  AUDITOR_DEMO_USER.email,
];
