/**
 * Unit coverage for the React-free environment entitlement decision layer:
 *   - entitlementDialogFromError: cloud 403 body → friendly dialog spec (or null)
 *   - decideEnvironmentCta: org state → which toolbar affordance
 */

import { describe, it, expect } from 'vitest';
import {
  isEntitlementErrorCode,
  entitlementDialogFromError,
  decideEnvironmentCta,
  type EnvironmentEntitlementsState,
} from '../entitlements';

/**
 * A server-supplied upgrade URL deliberately DIFFERENT from the retired
 * client-side default, so a CTA carrying it can only have come from the server.
 */
const SERVER_UPGRADE_URL = 'https://cloud.example.com/_console/apps/cloud_control/page/pricing';

const base = (over: Partial<EnvironmentEntitlementsState>): EnvironmentEntitlementsState => ({
  ready: true,
  hasProductionEnv: true,
  upgradeUrl: '/settings/billing',
  source: 'summary',
  ...over,
});

describe('isEntitlementErrorCode', () => {
  it('recognizes only the three entitlement codes', () => {
    expect(isEntitlementErrorCode('DEV_ENV_PLAN_LOCKED')).toBe(true);
    expect(isEntitlementErrorCode('DEV_ENV_LIMIT')).toBe(true);
    expect(isEntitlementErrorCode('PRODUCTION_ENV_LIMIT')).toBe(true);
    expect(isEntitlementErrorCode('SOMETHING_ELSE')).toBe(false);
    expect(isEntitlementErrorCode(undefined)).toBe(false);
  });
});

describe('entitlementDialogFromError', () => {
  it('returns null for non-entitlement errors (so a normal toast still fires)', () => {
    expect(entitlementDialogFromError({ error: 'Boom' })).toBeNull();
    expect(entitlementDialogFromError(null)).toBeNull();
    expect(entitlementDialogFromError({ error: { code: 'VALIDATION' } })).toBeNull();
  });

  it('maps DEV_ENV_PLAN_LOCKED to an upgrade dialog with the upgrade_url from error.details', () => {
    const spec = entitlementDialogFromError({
      success: false,
      error: {
        code: 'DEV_ENV_PLAN_LOCKED',
        message: 'Development environments are a paid feature...',
        httpStatus: 403,
        details: { upgrade_url: '/settings/billing', plan: 'free' },
      },
    });
    expect(spec).not.toBeNull();
    expect(spec!.code).toBe('DEV_ENV_PLAN_LOCKED');
    expect(spec!.title).toBe('Development environments are a paid feature');
    expect(spec!.message).toContain('Your free plan includes one production environment');
    expect(spec!.cta).toEqual({ label: 'Upgrade plan', url: '/settings/billing' });
  });

  it('names a paid plan in the plan-locked copy', () => {
    const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_PLAN_LOCKED', details: { plan: 'team' } } });
    expect(spec!.message).toContain('Your team plan includes');
  });

  it('maps DEV_ENV_LIMIT to an upgrade dialog (limit-reached title)', () => {
    const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_LIMIT', details: { upgrade_url: '/u' } } });
    expect(spec!.title).toBe('Development environment limit reached');
    expect(spec!.cta!.url).toBe('/u');
    expect(spec!.message).toContain('Capacity scales with AI seats');
  });

  it('quotes the seat-pool usage when the server reports counts', () => {
    const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_LIMIT', details: { current: 3, limit: 3 } } });
    expect(spec!.message).toContain('using 3 of 3 development environments');
  });

  // ─── strictness pins (cloud#1046 / objectui#3329) ──────────────────────────
  //
  // `error.details` is the ONLY accepted home for entitlement context. These
  // pins are the "provably strict" half: they fail the moment anyone
  // reintroduces a `??` chain to an older location. `code` / `message` are
  // declared `ApiErrorSchema` fields and legitimately stay on `error` itself.
  describe('reads error.details and nowhere else', () => {
    it('ignores entitlement keys sitting as undeclared siblings of `code`', () => {
      // The pre-cloud#1046 wire shape. `code` is declared, so the dialog still
      // opens — but every context key reads as absent, proving none of them is
      // read from the old top-level position (a sibling `upgrade_url` would
      // otherwise have produced a CTA to it).
      const spec = entitlementDialogFromError({
        success: false,
        error: {
          code: 'DEV_ENV_LIMIT',
          message: 'Development environment limit reached.',
          httpStatus: 403,
          upgrade_url: '/sibling-upgrade',
          current: 3,
          limit: 3,
          seatCount: 2,
        },
      });
      expect(spec!.cta).toBeUndefined();
      expect(spec!.message).not.toContain('3 of 3');
      // …the no-counts copy ("— add an AI seat" is the with-counts variant).
      expect(spec!.message).toContain('Capacity scales with AI seats. Add an AI seat');
    });

    it('ignores a sibling `plan`, so the plan-locked copy degrades to the free-plan phrase', () => {
      const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_PLAN_LOCKED', plan: 'team' } });
      expect(spec!.message).toContain('Your free plan includes');
      expect(spec!.message).not.toContain('team plan');
    });

    it('ignores a sibling `contact_url`, so PRODUCTION_ENV_LIMIT drops its CTA', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'PRODUCTION_ENV_LIMIT', contact_url: 'mailto:sales@objectos.ai' },
      });
      expect(spec!.cta).toBeUndefined();
    });

    it('returns null for the legacy FLAT body — the dual-dialect tolerance is gone', () => {
      // Pre-cloud#948: `error` is a string and `code` rides the top level. The
      // `body?.error ?? body` fallback that used to accept this is deleted, so
      // this now takes the caller's generic error path (no dialog).
      expect(
        entitlementDialogFromError({
          success: false,
          error: 'Development environments are a paid feature. …',
          code: 'DEV_ENV_PLAN_LOCKED',
          upgrade_url: '/legacy',
        }),
      ).toBeNull();
    });

    it('returns null for a bare body with no `error` envelope at all', () => {
      expect(
        entitlementDialogFromError({ code: 'DEV_ENV_PLAN_LOCKED', upgrade_url: '/legacy', plan: 'free' }),
      ).toBeNull();
    });

    it('tolerates a non-object `details` without reaching for another location', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'DEV_ENV_PLAN_LOCKED', details: 'not-an-object', upgrade_url: '/sibling' },
      });
      expect(spec!.cta).toBeUndefined();
    });
  });

  // cloud#959 — the dialog is a paid-conversion surface, so its copy comes from
  // the Console's own locale bundle rather than the (possibly older, possibly
  // English-only) control plane.
  it('renders localized copy when a translator is supplied, ignoring server prose', () => {
    const zh = (key: string, o?: any) =>
      ({
        'environment.entitlement.planLockedTitle': '开发环境是付费功能',
        'environment.entitlement.planLockedBody': `${o?.plan}包含一个生产环境。升级后即可添加开发环境。`,
        'environment.entitlement.freePlan': '免费版',
        'environment.entitlement.upgradeCta': '升级套餐',
      })[key] ?? key;
    const spec = entitlementDialogFromError(
      {
        error: {
          code: 'DEV_ENV_PLAN_LOCKED',
          message: 'Development environments are a paid feature.',
          details: { upgrade_url: SERVER_UPGRADE_URL },
        },
      },
      zh,
    );
    expect(spec!.title).toBe('开发环境是付费功能');
    expect(spec!.message).toBe('免费版包含一个生产环境。升级后即可添加开发环境。');
    expect(spec!.cta!.label).toBe('升级套餐');
  });

  it('maps PRODUCTION_ENV_LIMIT to a contact-sales dialog (no upgrade CTA)', () => {
    const spec = entitlementDialogFromError({
      error: {
        code: 'PRODUCTION_ENV_LIMIT',
        message: 'You already have your production environment.',
        details: { contact_url: 'mailto:sales@objectos.ai' },
      },
    });
    expect(spec!.cta).toEqual({ label: 'Contact sales', url: 'mailto:sales@objectos.ai' });
  });

  // objectui#10437 — the upgrade destination is the control plane's to name.
  // With no `upgrade_url` the dialog still explains the gate, but offers no
  // link: the retired client-side default pointed at a path no router serves.
  describe('no server upgrade_url ⇒ no upgrade CTA (objectui#10437)', () => {
    it('DEV_ENV_PLAN_LOCKED without upgrade_url keeps its copy and drops the CTA', () => {
      const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_PLAN_LOCKED', details: { plan: 'free' } } });
      expect(spec!.title).toBe('Development environments are a paid feature');
      expect(spec!.message).toContain('Your free plan includes one production environment');
      expect(spec!.cta).toBeUndefined();
    });

    it('DEV_ENV_LIMIT without upgrade_url keeps its copy and drops the CTA', () => {
      const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_LIMIT', details: { current: 3, limit: 3 } } });
      expect(spec!.message).toContain('using 3 of 3 development environments');
      expect(spec!.cta).toBeUndefined();
    });

    it('an empty-string upgrade_url is no URL', () => {
      const spec = entitlementDialogFromError({ error: { code: 'DEV_ENV_PLAN_LOCKED', details: { upgrade_url: '' } } });
      expect(spec!.cta).toBeUndefined();
    });

    it('control: a server-supplied upgrade_url becomes the CTA verbatim', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'DEV_ENV_PLAN_LOCKED', details: { upgrade_url: SERVER_UPGRADE_URL } },
      });
      expect(spec!.cta).toEqual({ label: 'Upgrade plan', url: SERVER_UPGRADE_URL });
    });
  });
});

describe('decideEnvironmentCta', () => {
  it('no production env → set up production (the never-error path)', () => {
    expect(decideEnvironmentCta(base({ hasProductionEnv: false }))).toBe('setup_production');
  });
  it('has prod + dev allowed → add development', () => {
    expect(decideEnvironmentCta(base({ canCreateDevelopmentEnv: true }))).toBe('add_development');
  });
  it('has prod + dev NOT allowed → the locked plan-tier mark (no POST, no dialog)', () => {
    expect(decideEnvironmentCta(base({ canCreateDevelopmentEnv: false }))).toBe('upgrade_for_development');
  });
  it('has prod + dev unknown (no summary) → add development (POST + dialog decides)', () => {
    expect(decideEnvironmentCta(base({ canCreateDevelopmentEnv: undefined, source: 'derived' }))).toBe('add_development');
  });
});
