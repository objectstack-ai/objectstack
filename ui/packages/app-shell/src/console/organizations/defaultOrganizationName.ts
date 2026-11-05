/**
 * The name a brand-new user's FIRST organization is prefilled with, so the
 * create dialog that opens right after sign-up continues with one click
 * (maintainer ruling objectstack-ai/cloud#3559 A: keep the naming step,
 * prefill a default, never create the organization automatically).
 *
 * Two shapes, decided by the e-mail domain:
 *
 *   - a WORK domain names the company: the domain's registrable label,
 *     capitalised (`jane@acme.com` → `Acme`, `jane@mail.acme.co.uk` → `Acme`);
 *   - a PUBLIC mailbox domain (the closed list below) says nothing about a
 *     company, so the default is the person's own organization. That form is a
 *     sentence in the reader's language (「张三的组织」 / "Zhang San's
 *     organization"), so this module returns the person's name and the dialog
 *     renders it through the `workspace.defaultPersonalName` translation.
 *
 * A domain not on the list is treated as a work domain: the user sees the
 * guess in an editable field before clicking.
 *
 * @module
 */

/**
 * Public mailbox domains: a CLOSED list, kept in code on purpose (the ruling
 * names it so). A subdomain of a listed domain is public too (`vip.qq.com`,
 * `vip.163.com`). Add a provider here when one is seen; an unlisted provider
 * degrades to a company-shaped guess the user can correct, never to an error.
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
 * that names the company for the common multi-part suffixes without shipping
 * the whole Public Suffix List; a suffix it misses yields a visible, editable
 * guess (`foo.bar.example` → `Bar`), not a failure.
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

/** What the first organization is prefilled with, before translation. */
export type DefaultOrganizationName =
  /** A work domain: the company name itself, ready to show. */
  | { kind: 'company'; name: string }
  /** A public mailbox: the person, to be rendered as "PERSON's organization". */
  | { kind: 'personal'; person: string };

function isPublicMailboxDomain(domain: string): boolean {
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

function capitalise(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The default for a user's first organization, or `null` when the user gives
 * nothing to derive one from (no usable e-mail address).
 *
 * The personal form uses the user's `name`; a user with no name falls back to
 * the e-mail's local part (`zhang.san@gmail.com` → `zhang.san`). A work label
 * spelled in punycode (`xn--…`) would show as gibberish, so that case takes
 * the personal form too.
 */
export function defaultOrganizationName(user: {
  email?: string | null;
  name?: string | null;
}): DefaultOrganizationName | null {
  const email = (user.email ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1).replace(/\.$/, '');

  if (!isPublicMailboxDomain(domain)) {
    const label = registrableLabel(domain);
    if (label && !label.startsWith('xn--')) {
      return { kind: 'company', name: capitalise(label) };
    }
  }

  const name = (user.name ?? '').trim();
  // Some sign-up paths store the address itself as the name; that is no name.
  const person = name && name.toLowerCase() !== email ? name : localPart;
  return { kind: 'personal', person };
}
