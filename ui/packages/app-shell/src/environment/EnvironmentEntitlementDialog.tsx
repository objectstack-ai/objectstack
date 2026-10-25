/**
 * EnvironmentEntitlementDialog — a friendly upgrade / limit dialog shown instead
 * of a raw red error toast when an environment-create is gated by plan or
 * capacity (DEV_ENV_PLAN_LOCKED / DEV_ENV_LIMIT / PRODUCTION_ENV_LIMIT).
 *
 * Driven by a single {@link EntitlementDialogSpec}, opened from one place: the
 * action runtime's apiHandler, when the create POST comes back with an
 * entitlement 403. The env-list toolbar opens no dialog: its plan-locked state
 * draws a locked mark that links to the upgrade page instead (objectui#12190).
 *
 * The CTA renders as an anchor (not an SPA navigation) so a control-plane URL
 * lands on the control plane's own page regardless of the console's router.
 * Relative URLs resolve against the control-plane origin (`apiBase`); absolute
 * / mailto URLs are used as-is. A spec without a `cta` renders no CTA at all:
 * the URL is the server's to send, and none sent means no link (objectui#10437).
 */

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  Button,
} from '@object-ui/components';
import { classifyNavigationTarget } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import type { EntitlementCta, EntitlementDialogSpec } from './entitlements.js';

export interface EntitlementDialogState {
  open: boolean;
  spec?: EntitlementDialogSpec;
}

/**
 * Resolve a CTA URL to a concrete href + whether it should open in a new tab.
 *
 * Which targets are absolute is `@object-ui/core`'s answer, shared with the
 * action runner (objectui#12191): an http(s) URL opens in a new tab, and a
 * `mailto:` URL navigates in place. This function keeps no scheme list of its own.
 */
export function resolveCtaHref(url: string, apiBase: string): { href: string; external: boolean } {
  const kind = classifyNavigationTarget(url);
  if (kind === 'web' || kind === 'mail') {
    return { href: url, external: kind === 'web' };
  }
  const base = (apiBase || '').replace(/\/+$/, '');
  // A control-plane-relative path: prefix the API origin when we have one (dev:
  // split SPA + backend). Empty base → same-origin relative (prod).
  return { href: `${base}${url}`, external: Boolean(base) };
}

function CtaButton({
  cta,
  apiBase,
  primary,
  onNavigate,
}: {
  cta: EntitlementCta;
  apiBase: string;
  primary: boolean;
  onNavigate: () => void;
}) {
  const { href, external } = resolveCtaHref(cta.url, apiBase);
  return (
    <Button asChild variant={primary ? 'default' : 'outline'} size="sm">
      <a
        href={href}
        onClick={onNavigate}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        data-testid={`entitlement-cta-${primary ? 'primary' : 'secondary'}`}
      >
        {cta.label}
      </a>
    </Button>
  );
}

interface Props {
  state: EntitlementDialogState;
  /** Control-plane origin used to resolve relative CTA URLs. */
  apiBase: string;
  onOpenChange: (open: boolean) => void;
}

export function EnvironmentEntitlementDialog({ state, apiBase, onOpenChange }: Props) {
  const spec = state.spec;
  // Title / body / CTA labels arrive already localized on the spec; the dismiss
  // button is the dialog's own chrome, so it resolves its label here.
  const { t } = useObjectTranslation();
  return (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) onOpenChange(false); }}>
      <AlertDialogContent data-testid="environment-entitlement-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{spec?.title}</AlertDialogTitle>
          <AlertDialogDescription>{spec?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.close', { defaultValue: 'Close' })}</AlertDialogCancel>
          {spec?.secondaryCta && (
            <CtaButton cta={spec.secondaryCta} apiBase={apiBase} primary={false} onNavigate={() => onOpenChange(false)} />
          )}
          {spec?.cta && (
            <CtaButton cta={spec.cta} apiBase={apiBase} primary onNavigate={() => onOpenChange(false)} />
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
