// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * ONE demo account an application declares for its development boot — the
 * people its seed data is dealt to.
 *
 * ## Why the platform creates it and the application only declares it
 *
 * A metadata app's demo seed hands records to named people (`owner_id:
 * 'Legal Counsel 1'`), and a seed cannot create a person: a `sys_user` row
 * written through `data` is refused (ADR-0092), and it could not sign in
 * anyway — signing in needs a hashed credential the auth pipeline mints. So
 * every application used to carry its own script that created the accounts
 * through the auth door, assigned their positions and permission sets, and
 * re-ran the seed so the deferred owners resolved. The maintainer ruled the
 * account creation the platform's (hotclm#28, letter D): "demo accounts are
 * the platform's to create; the app only declares them".
 *
 * ## What the platform does with an entry
 *
 * On a LOCAL DEVELOPMENT boot only (`os dev`), right after the development
 * admin is seeded, `@objectstack/plugin-auth` provisions each entry through
 * the same `signUpEmail` door the development admin goes through, assigns the
 * declared position and permission sets, and the application's seed then runs
 * with these accounts already present, so an `owner_id` naming one of them
 * resolves on the first boot. Idempotent: an entry whose address already has an account is
 * left as it is, and only its missing assignments are added.
 *
 * ## Development only — the security boundary
 *
 * An entry mints an account that can SIGN IN, with a password every developer
 * of the application knows. So:
 *
 * - `os build` never writes this list into the artifact, so a deployed
 *   artifact cannot carry it;
 * - a boot that is not a local development boot (production, a
 *   migrate-and-exit run, a server whose auth base URL is not a loopback
 *   address, an organization-walled tenancy posture) creates nothing and says
 *   why;
 * - a database with no sign-in yet gets none of these accounts, because under
 *   the `single` posture the first account that can sign in is promoted to
 *   platform admin, and that must never be a demo account;
 * - an entry carries no password: every demo account signs in with the
 *   development seed password (`os dev --admin-password`, default
 *   `admin123`), so no credential is committed to the application's
 *   repository.
 */
export const DemoStaffSchema = lazySchema(() => strictObject(
  {
    surface: 'a `demoStaff` entry',
    history:
      'This key is new in @objectstack/spec 18.2 and strict from birth — an unknown key here was '
      + 'never accepted.',
    aliases: {
      label: 'name',
      displayName: 'name',
      fullName: 'name',
      user: 'email',
      username: 'email',
      login: 'email',
      role: 'position',
      positions: 'position',
      permissions: 'permissionSets',
      permissionSet: 'permissionSets',
    },
    guidance: {
      password:
        'a `demoStaff` entry carries no password: every demo account signs in with the development '
        + 'seed password (`os dev --admin-password`, default `admin123`), so no credential is '
        + 'committed to the application\'s repository.',
      organization:
        'a demo account joins the deployment\'s Default Organization the way the development admin '
        + 'does; there is no per-entry organization.',
    },
  },
  {
    /**
     * The person's display name — the value a seed dataset names them by.
     *
     * Seed references to `sys_user` resolve by name, so a dataset row writing
     * `owner_id: 'Legal Counsel 1'` is dealt to the entry whose `name` is
     * exactly `Legal Counsel 1`. Unique within the composed stack.
     */
    name: z.string().trim().min(1).describe('Display name of the demo account — the value a seed dataset names it by in a sys_user reference such as owner_id'),

    /**
     * The address the account signs in with. Unique within the composed stack,
     * compared without regard to case, as sign-in compares it.
     */
    email: z.string().email().describe('Sign-in address of the demo account'),

    /**
     * A position this application declares in `positions`, assigned to the
     * account. Position-recipient sharing rules reach the account through this
     * assignment.
     */
    position: z.string().min(1).optional().describe('A position this application declares in `positions`, assigned to the demo account'),

    /**
     * Permission sets this application declares in `permissions`, granted to
     * the account directly. Only the application's own sets: a platform set
     * such as `admin_full_access` is refused, so a demo account never holds a
     * capability its application did not declare.
     */
    permissionSets: z.array(z.string().min(1)).optional().describe('Permission sets this application declares in `permissions`, granted to the demo account'),
  },
));

/** Authoring shape of one {@link DemoStaffSchema} entry. */
export type DemoStaff = z.input<typeof DemoStaffSchema>;
/** Post-parse shape of {@link DemoStaff} — defaults applied, transforms run (ADR-0122). */
export type DemoStaffParsed = z.infer<typeof DemoStaffSchema>;
