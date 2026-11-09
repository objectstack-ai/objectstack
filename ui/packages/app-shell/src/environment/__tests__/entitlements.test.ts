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
 * A server-supplied contact URL, so a CTA carrying it can only have come from
 * the server.
 */
const SERVER_CONTACT_URL = 'https://cloud.example.com/contact-sales';

const base = (over: Partial<EnvironmentEntitlementsState>): EnvironmentEntitlementsState => ({
  ready: true,
  hasProductionEnv: true,
  upgradeUrl: '/settings/billing',
  source: 'summary',
  ...over,
});

describe('isEntitlementErrorCode', () => {
  it('recognizes only PRODUCTION_ENV_LIMIT', () => {
    expect(isEntitlementErrorCode('PRODUCTION_ENV_LIMIT')).toBe(true);
    expect(isEntitlementErrorCode('SOMETHING_ELSE')).toBe(false);
    expect(isEntitlementErrorCode(undefined)).toBe(false);
  });

  // objectstack-ai/cloud#3487 D: the development type is retired, and with it
  // every development refusal the Console used to render as a dialog.
  it.each(['DEV_ENV_PLAN_LOCKED', 'DEV_ENV_LIMIT', 'DEV_ENV_RETIRED'])(
    'the retired development code %s is not an entitlement code',
    (code) => {
      expect(isEntitlementErrorCode(code)).toBe(false);
    },
  );
});

describe('entitlementDialogFromError', () => {
  it('returns null for non-entitlement errors (so a normal toast still fires)', () => {
    expect(entitlementDialogFromError({ error: 'Boom' })).toBeNull();
    expect(entitlementDialogFromError(null)).toBeNull();
    expect(entitlementDialogFromError({ error: { code: 'VALIDATION' } })).toBeNull();
  });

  it.each(['DEV_ENV_PLAN_LOCKED', 'DEV_ENV_LIMIT', 'DEV_ENV_RETIRED'])(
    'returns null for the retired development code %s (no development dialog survives)',
    (code) => {
      expect(
        entitlementDialogFromError({
          success: false,
          error: { code, message: '…', httpStatus: 403, details: { upgrade_url: SERVER_CONTACT_URL, plan: 'free' } },
        }),
      ).toBeNull();
    },
  );

  it('maps PRODUCTION_ENV_LIMIT to a contact-sales dialog (no upgrade CTA)', () => {
    const spec = entitlementDialogFromError({
      error: {
        code: 'PRODUCTION_ENV_LIMIT',
        message: 'You already have your production environment.',
        details: { contact_url: 'mailto:sales@objectos.ai' },
      },
    });
    expect(spec!.code).toBe('PRODUCTION_ENV_LIMIT');
    expect(spec!.title).toBe('You already have your production environment');
    expect(spec!.message).toContain('Each organization includes exactly one production environment');
    expect(spec!.cta).toEqual({ label: 'Contact sales', url: 'mailto:sales@objectos.ai' });
    expect(spec!.secondaryCta).toBeUndefined();
  });

  // ─── strictness pins (cloud#1046 / objectui#3329) ──────────────────────────
  //
  // `error.details` is the ONLY accepted home for entitlement context. These
  // pins are the "provably strict" half: they fail the moment anyone
  // reintroduces a `??` chain to an older location. `code` / `message` are
  // declared `ApiErrorSchema` fields and legitimately stay on `error` itself.
  describe('reads error.details and nowhere else', () => {
    it('ignores a sibling `contact_url`, so PRODUCTION_ENV_LIMIT drops its CTA', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'PRODUCTION_ENV_LIMIT', contact_url: 'mailto:sales@objectos.ai' },
      });
      expect(spec).not.toBeNull();
      expect(spec!.cta).toBeUndefined();
    });

    it('returns null for the legacy FLAT body — the dual-dialect tolerance is gone', () => {
      // Pre-cloud#948: `error` is a string and `code` rides the top level. The
      // `body?.error ?? body` fallback that used to accept this is deleted, so
      // this now takes the caller's generic error path (no dialog).
      expect(
        entitlementDialogFromError({
          success: false,
          error: 'You already have your production environment. …',
          code: 'PRODUCTION_ENV_LIMIT',
          contact_url: '/legacy',
        }),
      ).toBeNull();
    });

    it('returns null for a bare body with no `error` envelope at all', () => {
      expect(entitlementDialogFromError({ code: 'PRODUCTION_ENV_LIMIT', contact_url: '/legacy' })).toBeNull();
    });

    it('tolerates a non-object `details` without reaching for another location', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'PRODUCTION_ENV_LIMIT', details: 'not-an-object', contact_url: '/sibling' },
      });
      expect(spec!.cta).toBeUndefined();
    });
  });

  // cloud#959 — the dialog's copy comes from the Console's own locale bundle
  // rather than the (possibly older, possibly English-only) control plane.
  it('renders localized copy when a translator is supplied, ignoring server prose', () => {
    const zh = (key: string) =>
      ({
        'environment.entitlement.productionLimitTitle': '你已经有生产环境了',
        'environment.entitlement.productionLimitBody': '每个组织只包含一个生产环境。',
        'environment.entitlement.contactSalesCta': '联系销售',
      })[key] ?? key;
    const spec = entitlementDialogFromError(
      {
        error: {
          code: 'PRODUCTION_ENV_LIMIT',
          message: 'You already have your production environment.',
          details: { contact_url: SERVER_CONTACT_URL },
        },
      },
      zh,
    );
    expect(spec!.title).toBe('你已经有生产环境了');
    expect(spec!.message).toBe('每个组织只包含一个生产环境。');
    expect(spec!.cta!.label).toBe('联系销售');
  });

  // objectui#10437 — the destination is the control plane's to name. With no
  // `contact_url` the dialog still explains the gate, but offers no link.
  describe('no server contact_url ⇒ no CTA (objectui#10437)', () => {
    it('PRODUCTION_ENV_LIMIT without contact_url keeps its copy and drops the CTA', () => {
      const spec = entitlementDialogFromError({ error: { code: 'PRODUCTION_ENV_LIMIT', details: { current: 1, limit: 1 } } });
      expect(spec!.title).toBe('You already have your production environment');
      expect(spec!.cta).toBeUndefined();
    });

    it('an empty-string contact_url is no URL', () => {
      const spec = entitlementDialogFromError({ error: { code: 'PRODUCTION_ENV_LIMIT', details: { contact_url: '' } } });
      expect(spec!.cta).toBeUndefined();
    });

    it('control: a server-supplied contact_url becomes the CTA verbatim', () => {
      const spec = entitlementDialogFromError({
        error: { code: 'PRODUCTION_ENV_LIMIT', details: { contact_url: SERVER_CONTACT_URL } },
      });
      expect(spec!.cta).toEqual({ label: 'Contact sales', url: SERVER_CONTACT_URL });
    });
  });
});

describe('decideEnvironmentCta', () => {
  it('no production env → set up production (the never-error path)', () => {
    expect(decideEnvironmentCta(base({ hasProductionEnv: false }))).toBe('setup_production');
  });
  it('has production env → nothing left to create, from the summary or from rows', () => {
    expect(decideEnvironmentCta(base({}))).toBe('production_exists');
    expect(decideEnvironmentCta(base({ source: 'derived', upgradeUrl: undefined }))).toBe('production_exists');
  });
  it('is total over the two creation answers: production setup is the only creation path', () => {
    const kinds = new Set([
      decideEnvironmentCta(base({ hasProductionEnv: false })),
      decideEnvironmentCta(base({ hasProductionEnv: true })),
      decideEnvironmentCta(base({ hasProductionEnv: true, plan: 'team' })),
      decideEnvironmentCta(base({ hasProductionEnv: false, plan: 'team' })),
    ]);
    expect([...kinds].sort()).toEqual(['production_exists', 'setup_production']);
  });
});
