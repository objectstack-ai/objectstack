/**
 * Environment entitlement logic — the React-free decision layer behind the
 * state-aware "create environment" affordance and the entitlement-error dialog.
 *
 * The Console environment list (`sys_environment`) renders a single
 * `create_environment` toolbar action. Whether that should read "Set up your
 * production environment", "Add development environment", or give way to a
 * locked plan-tier mark depends on org state the action metadata can't express
 * (does the org already own its one production env? is its plan allowed
 * development envs?).
 * This module turns the org-scoped capacity summary
 * (GET /cloud/environment-entitlements) — with a row-derived fallback — into
 * that decision, and maps the cloud env-create 403 bodies to a friendly dialog
 * so a confused user never sees a raw red error toast.
 *
 * Kept dependency-free so it is trivially unit-testable.
 */

export type EntitlementErrorCode = 'DEV_ENV_PLAN_LOCKED' | 'DEV_ENV_LIMIT' | 'PRODUCTION_ENV_LIMIT';

const ENTITLEMENT_ERROR_CODES = new Set<string>([
  'DEV_ENV_PLAN_LOCKED',
  'DEV_ENV_LIMIT',
  'PRODUCTION_ENV_LIMIT',
]);

export function isEntitlementErrorCode(code: unknown): code is EntitlementErrorCode {
  return typeof code === 'string' && ENTITLEMENT_ERROR_CODES.has(code);
}

/** A CTA link rendered in the entitlement dialog. */
export interface EntitlementCta {
  label: string;
  /**
   * Absolute (http/mailto) or a control-plane-relative path — always the value
   * the control plane sent, never one composed or defaulted here.
   */
  url: string;
}

/** Declarative spec the {@link EnvironmentEntitlementDialog} renders. */
export interface EntitlementDialogSpec {
  code: string;
  title: string;
  message: string;
  /** Primary CTA (e.g. Upgrade plan). */
  cta?: EntitlementCta;
  /** Secondary CTA (e.g. Contact sales). */
  secondaryCta?: EntitlementCta;
}

/**
 * Minimal translator — structurally `useObjectTranslation()`'s `t`, passed IN
 * rather than imported so this module stays dependency-free and the specs stay
 * unit-testable without an i18n provider. Omit it and the English defaults are
 * used (with `{{token}}` interpolation applied locally).
 */
export type EntitlementTranslate = (key: string, options?: Record<string, any>) => string;

/** English default + `{{token}}` interpolation, for callers with no `t`. */
function fallbackTranslate(key: string, options?: Record<string, any>): string {
  const raw = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? ''));
}

/**
 * The plan phrase interpolated into the plan-locked copy — "free plan" /
 * "team plan" in English, 「免费版」/「team 版」in Chinese.
 */
function planPhrase(t: EntitlementTranslate, plan: unknown): string {
  return typeof plan === 'string' && plan && plan !== 'free'
    ? t('environment.entitlement.namedPlan', { plan, defaultValue: '{{plan}} plan' })
    : t('environment.entitlement.freePlan', { defaultValue: 'free plan' });
}

/**
 * Map a cloud env-create 403 body to a dialog spec. Returns `null` for any
 * non-entitlement error so the caller falls back to its normal error handling
 * (a red toast). This is the safety net: it fires regardless of whether the
 * up-front state-aware presentation was right.
 *
 * ## Exactly ONE accepted wire shape (cloud#1046)
 *
 * ```jsonc
 * { "success": false,
 *   "error": { "code": "DEV_ENV_LIMIT", "message": "…", "httpStatus": 403,
 *              "details": { "current": 3, "limit": 3, "upgrade_url": "…" } } }
 * ```
 *
 * `code` and `message` are DECLARED `ApiErrorSchema` fields and stay on
 * `error`. The business context (`upgrade_url`, `contact_url`, `plan`,
 * `current`, `limit`) is read from `error.details` and NOWHERE ELSE — that is
 * the slot ADR-0112 declares for it (framework#4224; cloud#930's
 * `AiErrorExtra`). These keys used to ride as undeclared siblings of `code`,
 * where they only ever "parsed clean" because `ApiErrorSchema` is a plain
 * `z.object` that STRIPS unknown keys: conformant by evaporating rather than
 * by declaration.
 *
 * There is deliberately no fallback to the older locations — neither the
 * pre-`details` siblings nor the flat pre-cloud#948 body. Producer and
 * consumer ship atomically in the hosted product (the cloud image pins
 * objectui by `.objectui-sha`; cloud#1046 lands the producer change together
 * with the pin bump), so a tolerant reader would buy nothing and would
 * fossilize the retired dialects into a second de-facto contract — exactly
 * the multi-dialect drift cloud#944 is retiring. One strict contract beats N.
 *
 * The copy is the CONSOLE's, not the server's: a control plane may be older
 * than the Console (or newer), and its prose is only localized from cloud#959
 * on. Rendering our own localized strings — from the same code + counts the
 * server reports — keeps this dialog in the user's language either way.
 */
export function entitlementDialogFromError(body: any, t: EntitlementTranslate = fallbackTranslate): EntitlementDialogSpec | null {
  const error = body?.error;
  if (!error || typeof error !== 'object') return null;
  const code = error.code;
  if (!isEntitlementErrorCode(code)) return null;
  const details = error.details && typeof error.details === 'object' ? error.details : undefined;
  // No `upgrade_url` from the server ⇒ no upgrade CTA (objectui#10437). The
  // destination is the control plane's to name; a path guessed here pointed at
  // one no router serves. Same rule as `contact_url` just below.
  const upgradeUrl = typeof details?.upgrade_url === 'string' && details.upgrade_url ? details.upgrade_url : '';
  const contactUrl = typeof details?.contact_url === 'string' && details.contact_url ? details.contact_url : '';

  if (code === 'PRODUCTION_ENV_LIMIT') {
    return {
      code,
      title: t('environment.entitlement.productionLimitTitle', {
        defaultValue: 'You already have your production environment',
      }),
      message: t('environment.entitlement.productionLimitBody', {
        defaultValue:
          'Each organization includes exactly one production environment. Create a separate organization for another, or contact us about an Enterprise arrangement.',
      }),
      cta: contactUrl
        ? { label: t('environment.entitlement.contactSalesCta', { defaultValue: 'Contact sales' }), url: contactUrl }
        : undefined,
    };
  }

  const upgradeCta = upgradeUrl
    ? { label: t('environment.entitlement.upgradeCta', { defaultValue: 'Upgrade plan' }), url: upgradeUrl }
    : undefined;

  if (code === 'DEV_ENV_PLAN_LOCKED') {
    return {
      code,
      title: t('environment.entitlement.planLockedTitle', {
        defaultValue: 'Development environments are a paid feature',
      }),
      message: t('environment.entitlement.planLockedBody', {
        plan: planPhrase(t, details?.plan),
        defaultValue:
          'Your {{plan}} includes one production environment. Upgrade to add development environments — build in dev, then publish to production.',
      }),
      cta: upgradeCta,
    };
  }

  // DEV_ENV_LIMIT — a paid org that exhausted its seat-scaled pool. Quote the
  // usage when the server reported it; the counts carry the same information
  // the server's own prose did.
  const used = Number(details?.current);
  const limit = Number(details?.limit);
  const hasCounts = Number.isFinite(used) && Number.isFinite(limit);
  return {
    code,
    title: t('environment.entitlement.limitTitle', { defaultValue: 'Development environment limit reached' }),
    message: hasCounts
      ? t('environment.entitlement.limitBodyWithCount', {
          used,
          limit,
          defaultValue:
            'You are using {{used}} of {{limit}} development environments. Capacity scales with AI seats — add an AI seat, or archive an unused development environment to free one up.',
        })
      : t('environment.entitlement.limitBody', {
          defaultValue:
            'Capacity scales with AI seats. Add an AI seat, or archive an unused development environment to free one up.',
        }),
    cta: upgradeCta,
  };
}

/** Server summary shape (GET /cloud/environment-entitlements → `data`). */
export interface EnvironmentEntitlementsSummary {
  plan?: string;
  hasProductionEnv?: boolean;
  production?: { used: number; limit: number; canCreate: boolean };
  development?: { used: number; limit: number; canCreate: boolean };
  seatCount?: number;
  upgradeUrl?: string;
  contactSalesUrl?: string;
  /**
   * The IANA timezone the workspace was seeded with at creation, from the
   * creator's browser (objectstack-ai/cloud#2676). Additive: absent when no
   * seed was recorded, which includes every workspace created before the seed
   * existed and every control plane that does not send it yet.
   */
  workspaceTimezoneSeed?: string;
}

/** Combined client state (authoritative summary, or a row-derived fallback). */
export interface EnvironmentEntitlementsState {
  /** True once a usable signal exists (summary OR derived rows). */
  ready: boolean;
  hasProductionEnv: boolean;
  /** Authoritative dev-create capability; `undefined` when unknown (no summary). */
  canCreateDevelopmentEnv?: boolean;
  plan?: string;
  /**
   * The summary's `upgradeUrl`, verbatim. Absent when the control plane sent
   * none — including the row-derived and unknown states, which never had one —
   * and then no upgrade CTA renders (objectui#10437).
   */
  upgradeUrl?: string;
  contactSalesUrl?: string;
  /**
   * The summary's `workspaceTimezoneSeed`, verbatim. Absent when the control
   * plane sent none — including the row-derived and unknown states, which
   * never had one — and then the `cloud:workspace-timezone-notice` widget
   * renders nothing (objectui#11930).
   */
  workspaceTimezoneSeed?: string;
  /** Where the signal came from — telemetry + degradation note + tests. */
  source: 'summary' | 'derived' | 'unknown';
}

export type EnvironmentCtaKind = 'setup_production' | 'add_development' | 'upgrade_for_development';

/**
 * Decide which toolbar affordance to present:
 *   • no production env          → set up production (the create POST makes one;
 *                                  the critical historical-data path — never errors)
 *   • has prod + dev allowed     → add development (POST makes a dev env)
 *   • has prod + dev NOT allowed → locked plan-tier mark (no POST, no dialog)
 *   • has prod + dev unknown     → add development (let the POST + dialog decide)
 */
export function decideEnvironmentCta(state: EnvironmentEntitlementsState): EnvironmentCtaKind {
  if (!state.hasProductionEnv) return 'setup_production';
  if (state.canCreateDevelopmentEnv === false) return 'upgrade_for_development';
  return 'add_development';
}

