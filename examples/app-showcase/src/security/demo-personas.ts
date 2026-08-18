// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The identities the showcase actually PROVISIONS — the one place that answers
 * "which `sys_user` rows exist on a fresh boot of this app?", and "which of
 * them can SIGN IN".
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
 *      (`OS_SEED_ADMIN_EMAIL`, default below).
 *   2. {@link PHONE_DEMO_USER} / 3. {@link AUDITOR_DEMO_USER} — the personas
 *      `seed-approval-demo.ts` provisions on `kernel:bootstrapped`.
 *
 * ## All three are LOGINABLE (#9308 fixture 1)
 *
 * The two persona rows used to be **display/routing identities, not accounts**:
 * they carried no better-auth credential, so they could not sign in. That was
 * enough to make a recipient RESOLVE and to make an inbox row addressable, but
 * every checklist item needing a SECOND session — per-group 会签 decided by two
 * distinct people, a submitter who is not an approver, an out-of-office
 * delegation decided under the delegate's own identity — was stuck on it, and
 * each rediscovered the same non-obvious cause: a password hash is not enough.
 * better-auth 1.7 keys accounts on `(issuer, providerAccountId)`, so a
 * credential row whose `issuer` is not the local credential issuer is INVISIBLE
 * to sign-in, which then fails `INVALID_EMAIL_OR_PASSWORD` behind a misleading
 * "User not found" — pointing at the row, which is fine, instead of at the
 * account, which is not.
 *
 * `seed-approval-demo.ts` now provisions the credential account too
 * (`ensureCredentialAccount`), through better-auth's own `$context` — its
 * hasher, its `internalAdapter.createAccount`, and the issuer READ OFF the dev
 * admin's own credential row rather than re-spelled here. Reading it is what
 * keeps this app from carrying a second copy of a constant `plugin-auth` owns:
 * whatever better-auth minted for the admin in THIS runtime is by construction
 * the issuer a sign-in will look the personas up under.
 *
 * Both sign in with {@link DEMO_PERSONA_PASSWORD}.
 *
 * And all three are DEV-ONLY: the dev admin is gated on
 * `NODE_ENV === 'development'`, and the two personas are provisioned only when
 * that admin exists — so the well-known password below can never be minted in a
 * production boot. In a real deployment a fresh showcase has NO users at all, so
 * nothing here could resolve — that is a property of the environment, not a
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
 * Repointing invoices at the personas above would still DELETE that demo rather
 * than fix it, and #9308 fixture 1 does not change that. The reason moved, so it
 * is restated rather than dropped: the demo's subject is an operator who SIGNS
 * UP as one of those three addresses and then sees only their own invoices, and
 * the dogfood proof pins those exact seeded owners. What used to make repointing
 * impossible was "the personas hold no credential"; what makes it wrong NOW is
 * that the owners are the fixture. `test/inert-wirings.test.ts` §5 carries the
 * exemption with this reasoning attached.
 */

/** The dev admin `plugin-auth` seeds when `NODE_ENV === 'development'`. */
export const ADMIN_EMAIL = 'admin@objectos.ai';

/**
 * The password both demo personas sign in with (#9308 fixture 1).
 *
 * Well-known ON PURPOSE — it is the same contract as the dev admin's
 * `admin123`: a demo credential exists so a reviewer, a browser dogfood run or
 * a checklist runner can drive a SECOND identity without a sign-up detour. It
 * is not a secret and is not treated as one.
 *
 * Its safety comes from WHERE it can be minted, not from what it is:
 * `seed-approval-demo.ts` provisions these accounts only once the dev admin row
 * exists, and that admin is itself hard-gated on `NODE_ENV === 'development'`
 * (`plugin-auth` → `maybeSeedDevAdmin`). A production boot has no dev admin, so
 * the personas are never provisioned and this password is never written
 * anywhere. Long enough to clear better-auth's `minPasswordLength` (8).
 */
export const DEMO_PERSONA_PASSWORD = 'showcase123';

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
