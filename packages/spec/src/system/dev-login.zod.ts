// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * ONE first-run credential an application contributes to the development boot
 * banner (#17556 — suggestion 1 of #17081).
 *
 * ## Why an app has to be the one to say this
 *
 * `os dev` seeds a platform admin on an empty DB and the banner prints it as
 * the ONLY credential a first-run operator is handed. That account holds every
 * PLATFORM capability (`ADMIN_FULL_ACCESS_CAPABILITIES`) and no APP-declared
 * one, because a capability an app declares is the app's to grant. So in any
 * application that gates its apps/tabs/nav on `requiredPermissions` it is by
 * construction the account that resolves to an empty menu — measured on a
 * downstream app where four of five personas rendered their group and the one
 * the banner named rendered none.
 *
 * `packages/cli` cannot fix that from its own side: the platform can describe
 * the account it seeds, and it cannot know that an application's `Hiring` group
 * needs a position or which of five personas a demo should open with. The
 * application knows. This key is the channel it says so through.
 *
 * ## What it is NOT
 *
 * ⛔ Not an identity, not a seed, and not an authorization: declaring an entry
 * here CREATES NOTHING. It is presentation — the application naming accounts it
 * seeds by some other means (`data` fixtures, an `onEnable` hook, its own
 * script) so the banner can point the operator at one that shows something.
 * An entry naming an account nothing seeds prints a credential that does not
 * work, exactly as a README line would.
 *
 * ## Read only in development
 *
 * The consuming banner prints this block only on a development boot
 * (`os dev`, `objectstack serve --dev`, or `NODE_ENV=development`). A
 * production boot renders byte-identically to one that declares nothing.
 */
export const DevLoginSchema = lazySchema(() => strictObject(
  {
    surface: 'a `devLogins` entry',
    history:
      'This key is new in @objectstack/spec 17.5 and strict from birth — an unknown key here was '
      + 'never accepted.',
    aliases: {
      user: 'email',
      username: 'email',
      login: 'email',
      account: 'email',
      name: 'label',
      persona: 'label',
      role: 'label',
      description: 'label',
      note: 'label',
      hint: 'label',
      secret: 'password',
      pass: 'password',
    },
    guidance: {
      permissions:
        'a `devLogins` entry grants nothing — it only names an account for the boot banner to '
        + 'print. Grant capabilities with a permission set (`permissions`) or a position '
        + '(`positions`), and seed the account itself in `data`.',
      capabilities:
        'a `devLogins` entry grants nothing — it only names an account for the boot banner to '
        + 'print. Declare capabilities in `capabilities` and distribute them with `positions` / '
        + '`permissions`; seed the account itself in `data`.',
      seed:
        'a `devLogins` entry creates no account. Seed the user record in the stack\'s `data` '
        + 'fixtures (or in `onEnable`) and name it here so the banner can print it.',
    },
  },
  {
    /**
     * The address the operator types into the sign-in form.
     *
     * Required, because an entry that cannot be signed in with is a line of
     * banner text pretending to be a credential. Validated as an email for the
     * same reason the identity schemas are: `sys_user.email` is what the
     * sign-in form and every seeded fixture key on, so a value that is not one
     * names an account the operator cannot reach.
     */
    email: z.string().email().describe('Email of an account this application seeds — printed by the development boot banner'),

    /**
     * The password to print beside {@link DevLogin.email}.
     *
     * OPTIONAL, and omitted deliberately rather than defaulted: a development
     * deployment may sign in by magic link, by SSO, or with a password the
     * operator supplies, and inventing one would print a credential that fails.
     * Omitted → the banner prints the address alone.
     *
     * ⚠️ Whatever is written here is committed to the application's repository
     * and printed to a terminal. It is a DEVELOPMENT fixture — ⛔ never a real
     * secret, and ⛔ never a value that also opens a deployed environment.
     */
    password: z.string().optional().describe('Development-fixture password printed beside the address; omit when the account signs in another way'),

    /**
     * What this account SEES, in a few words — the whole point of the key.
     *
     * The defect this family exists for is an operator holding a credential
     * with no idea what audience it belongs to, so `Hiring admin` or
     * `Job seeker` is the part that repairs it; the address alone repeats the
     * failure one account over. Omitted → the banner prints the credential with
     * no audience column.
     */
    label: z.string().optional().describe('The audience this account belongs to (e.g. `Hiring admin`) — printed before the address'),
  },
));

/** Authoring shape of one {@link DevLoginSchema} entry. */
export type DevLogin = z.input<typeof DevLoginSchema>;
/** Post-parse shape of {@link DevLogin} — defaults applied, transforms run (ADR-0122). */
export type DevLoginParsed = z.infer<typeof DevLoginSchema>;
