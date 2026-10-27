/**
 * AuthFooter — the row under the auth card on `/login` and `/register`: the
 * locale switch at the left; at the right the privacy and terms links, each
 * only when the server's auth config serves its URL.
 *
 * Lifted out of `LoginPage` unchanged (objectui#12600) so the sign-up page,
 * where a visitor accepts the terms, draws the same links from the same reader
 * instead of a copy (#25885).
 *
 * No version or environment pill: the runtime config the preview badge reads
 * (`GET /api/v1/runtime/config`) carries the platform stage and no product
 * version or environment label, so there is nothing to print (objectui#12600).
 */

import type { AuthPublicConfig } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { LocaleSwitcher } from '@object-ui/app-shell';

/**
 * Accept a legal-link URL from the server only as an absolute http(s) URL or a
 * same-origin path. Anything else (a `javascript:` URL, a protocol-relative
 * `//host`, a non-string) renders no link.
 */
function legalHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const href = value.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return undefined;
}

/**
 * The legal links the server's public auth config serves: `features.termsUrl`
 * and `features.privacyUrl`, which the spec lists among its non-flag keys
 * (`PUBLIC_AUTH_CONFIG_NON_FLAG_KEYS`) and the runtime defaults to its own
 * public pages, or omits when an operator blanks them. `AuthPublicConfig` does
 * not declare the two keys, so they are read here by name; nothing is
 * rendered for a key the server did not send.
 */
export function readLegalLinks(cfg: AuthPublicConfig | null): { privacyUrl?: string; termsUrl?: string } {
  const features = cfg?.features as { privacyUrl?: unknown; termsUrl?: unknown } | undefined;
  return { privacyUrl: legalHref(features?.privacyUrl), termsUrl: legalHref(features?.termsUrl) };
}

export function AuthFooter({ privacyUrl, termsUrl }: { privacyUrl?: string; termsUrl?: string }) {
  const { t } = useObjectTranslation();
  const linkClass =
    'underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:underline';
  return (
    <div
      data-testid="auth-footer"
      className="flex min-h-8 items-center justify-between gap-3 px-1 text-xs text-muted-foreground"
    >
      <div className="flex items-center">
        <LocaleSwitcher />
      </div>
      {privacyUrl || termsUrl ? (
        <span className="inline-flex items-center gap-2.5">
          {privacyUrl ? (
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t('auth.login.footer.privacy', { defaultValue: 'Privacy' })}
            </a>
          ) : null}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {t('auth.login.footer.terms', { defaultValue: 'Terms' })}
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
