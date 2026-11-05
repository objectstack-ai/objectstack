/**
 * What an e-mail address's domain says about its owner: the domain itself,
 * whether it is a public mailbox provider's, and its registrable label (the
 * name a company registered, `mail.acme.co.uk` → `acme`).
 *
 * Product-neutral by construction: it reads an address and a closed list, and
 * decides nothing about what a caller shows. A caller that names something
 * after the label owns that choice.
 *
 * @module
 */

/**
 * Public mailbox domains: a CLOSED list, kept in code on purpose. A subdomain
 * of a listed domain is public too (`vip.qq.com`, `vip.163.com`). Add a
 * provider here when one is seen; an unlisted provider reads as a private
 * (work) domain, which a caller must treat as a guess, never as a fact.
 */
export const PUBLIC_MAILBOX_DOMAINS: ReadonlySet<string> = new Set([
  // Google, Microsoft, Yahoo, Apple, AOL
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  // Privacy / independent providers
  'proton.me',
  'protonmail.com',
  'pm.me',
  'tutanota.com',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  // China
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'aliyun.com',
  '139.com',
  '189.cn',
  // Korea, Japan
  'naver.com',
  'daum.net',
  'hanmail.net',
  'yahoo.co.jp',
]);

/**
 * Second-level labels that are registry-run under a two-letter country TLD
 * (`acme.co.uk`, `acme.com.cn`, `acme.co.jp`, `acme.com.au`). Under such a
 * pair the registrable label is the one BEFORE it. This is the smallest rule
 * that finds the registrable label for the common multi-part suffixes without
 * shipping the whole Public Suffix List; a suffix it misses yields the label
 * left of the TLD (`foo.bar.example` → `bar`), not a failure.
 */
const COUNTRY_SECOND_LEVEL_LABELS: ReadonlySet<string> = new Set([
  'co',
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'ac',
  'or',
  'ne',
  'go',
  'gob',
  'ltd',
  'plc',
]);

/**
 * The domain of an e-mail address, lower-cased and without a trailing dot
 * (`Jane@ACME.com.` → `acme.com`); `undefined` when the value is not an
 * address with both a local part and a domain.
 */
export function emailDomain(email: string | null | undefined): string | undefined {
  const value = (email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return undefined;
  const domain = value.slice(at + 1).replace(/\.$/, '');
  return domain || undefined;
}

/** Whether a (lower-case) domain belongs to a public mailbox provider, subdomains included. */
export function isPublicMailboxDomain(domain: string): boolean {
  if (PUBLIC_MAILBOX_DOMAINS.has(domain)) return true;
  for (const listed of PUBLIC_MAILBOX_DOMAINS) {
    if (domain.endsWith(`.${listed}`)) return true;
  }
  return false;
}

/**
 * The registrable label of a domain: the label just left of its public suffix
 * (`mail.acme.com` → `acme`, `acme.co.uk` → `acme`). `undefined` for a domain
 * with fewer than two labels.
 */
export function registrableLabel(domain: string): string | undefined {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return undefined;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  if (labels.length >= 3 && tld.length === 2 && COUNTRY_SECOND_LEVEL_LABELS.has(second)) {
    return labels[labels.length - 3];
  }
  return second;
}
