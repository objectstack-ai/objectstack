// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20493 — the DECISION LEDGER for the ja-JP `objects` bundle's en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// `objects-zh-cn-echo-decisions.test.ts` keeps that record for zh-CN; this file
// is the same record, in the same shape, for ja-JP: `Verdict` per row, a reason
// for every row, and a per-locale `departure` for every `echo`. Each locale
// decides its own set — the zh-CN set was where reading started, not a list
// copied over.
//
// ## What was decided, and where it was measured
//
// Walk of `en.objects.generated.ts` against `ja-JP.objects.generated.ts` at
// base 397572ed5, counting every string leaf byte-equal to its `en` leaf
// (1529 leaves in each bundle):
//
//   before   383 copies — `label` 210 · `options.*` 20 · `pluralLabel` 12 ·
//            `help` 121 · `description` 12 · `placeholder` 4 ·
//            `emptyState.*` 4
//   after     43 copies — every one of them a row below with verdict `echo`
//
// The other 340 were extractor fills and are translated. The extractor files a
// field's `help` / `description` / `placeholder` under the same `source` kind
// as its `label` (`ExpectedEntry.source` in `packages/cli/src/utils/
// i18n-extract.ts`), so they were decided as the same class.
//
// Where ja-JP departs from zh-CN, and why:
//   - the result dialog's `Client ID` / `Client Secret` were never copies here:
//     this bundle authored them (クライアント ID, クライアントシークレット);
//   - the register dialog's `Web` option stays `Web`, because this bundle
//     already renders the sibling `fields.type.options.web` as Web;
//   - `Cc` / `Bcc` stay as written, the header abbreviations Japanese mail
//     clients print in Latin letters, while `Reply-To` is translated (返信先).
//
// Per-leaf witness: the package's provenance table
// (`ja-JP.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of its source revision. `pnpm i18n:extract` dropped the 340
// rows for the translated leaves and kept 43 rows, one per echo below (measured
// equal at the time). What is asserted is one direction per verdict: every
// declared echo still has its row, and no pinned translation has one. That the
// table holds nothing BEYOND the echoes is not asserted, for the reason the
// next section gives.
//
// Since that walk, the seven `sys_account._actions.link_social` provider-brand
// rows (Google through Discord) left this ledger together with the action,
// retired under ADR-0049 enforce-or-remove (#21849): the bundle no longer
// carries those leaves, so the ledger held 36 echoes. Then `sys_view_definition`
// retired as inert (ADR-0131 D13) and took its bare `ID` leaf with it: 35.
//
// ## What this file deliberately does NOT assert
//
// That no OTHER ja-JP objects leaf reads its `en` source. A new field's label
// arrives in every translated locale as a `--fill=default` copy, so that
// assertion would red every future PR that adds a platform-object field without
// a ja-JP word. It is the coverage-ratchet half, which the triage kept out of
// this card: widening a gate is a separate decision.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own reason precisely so that
// recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { enObjects } from './en.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { jaJPGeneratedSourceHashes } from './ja-JP.source-hashes.generated.js';
import { hashSource } from './source-hash.js';

const LOCALE = 'ja-JP';

/** Kana or kanji: what a Japanese rendering carries and an en copy never does. */
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** `translate` — the echo was an unauthored fill. `echo` — the English IS the rendering. */
type Verdict = 'translate' | 'echo';

interface Decision {
  /** Dotted leaf path under `objects`. */
  path: string;
  /**
   * The `en` source the verdict was taken against. Held equal to the live
   * bundle, so a reworded source reds this file instead of leaving a decision
   * standing over text nobody judged.
   */
  en: string;
  /** The verdict for ja-JP. */
  verdict: Verdict;
  /** Why — recorded for `translate` as much as for `echo`. */
  reason: string;
  /** Required for every `echo` verdict: why the English is right in ja-JP. */
  departure?: string;
}

const BARE_ID =
  'The bare initialism ID. This bundle keeps ID verbatim inside every label that carries it (ユーザー ID, 組織 ID, クライアント ID); a bare en ID has no noun to render, and adding one would invent content.';
const JWKS =
  'A protocol name (the RFC 7517 JWK Set) that this bundle keeps verbatim: sys_jwks is authored as 署名キー (JWKS), and every URI stays URI (リダイレクト URI).';
const WEB_CLIENT_TYPE =
  'The web client type as this bundle already renders it: the sibling option sys_oauth_application.fields.type.options.web is authored as Web, so the register dialog and the record field read one word.';
const IDP_SSO_URL =
  'Nothing but protocol initialisms (IdP, SSO, URL), each of which this bundle keeps verbatim; the sibling SAML params are authored as IdP エンティティ ID and IdP 署名証明書.';
const TYPED_CLAIM =
  'A placeholder shows the literal value the admin types: OIDC scope and claim names the IdP matches byte for byte. The authored help on the same param keeps them verbatim (既定値は「email」).';
const TYPED_URN =
  'A placeholder shows the literal value the admin types, here the SAML NameID format URN: an identifier matched byte for byte, not prose.';
const MESSAGE_ID =
  'The RFC 5322 header name. The authored help on the same field keeps it verbatim (トランスポートが割り当てる RFC-5322 Message-ID).';
const COPY_HEADER =
  'A copy-recipient header abbreviation that Japanese mail clients print in Latin letters, with no kana or kanji form in use. The prose labels beside it on the same record are authored (送信元, 宛先, 返信先).';
const CHANNEL_INITIALISM =
  'An initialism this bundle keeps verbatim wherever it appears (API キー, UI には表示されません; sys_metadata.fields.source.options.api is authored as API); the option names the channel a setting change came through.';

function echo(path: string, en: string, departure: string): Decision {
  return {
    path,
    en,
    verdict: 'echo',
    reason: 'Kept in English by design, in the small brand / protocol / typed-value class the triage names.',
    departure,
  };
}

const DECISIONS: readonly Decision[] = [
  // ── The card's named strings (three leaves), pinned translated ───────────
  {
    path: 'sys_member.fields.role.options.delegated_admin',
    en: 'Delegated Admin',
    verdict: 'translate',
    reason:
      'Read from the bundle, not re-driven in a browser: the membership role list rendered 所有者 / 管理者 / Delegated Admin / メンバー. Rendered with the word the console already uses for this role value.',
  },
  {
    path: 'sys_invitation.fields.role.options.delegated_admin',
    en: 'Delegated Admin',
    verdict: 'translate',
    reason:
      'The option list the Invite user dialog reads. The same word as the sys_member row, asserted below, so one role is not translated two ways.',
  },
  {
    path: 'sys_team.fields.member_count.label',
    en: 'Member Count',
    verdict: 'translate',
    reason: 'The team record page field zh-CN reproduced as MEMBER COUNT: an ordinary field label an admin reads, an unauthored fill.',
  },

  // ── Kept in English by design (36) ───────────────────────────────────────
  echo('sys_oauth_application.fields.jwks.label', 'JWKS', JWKS),
  echo('sys_oauth_application.fields.jwks_uri.label', 'JWKS URI', JWKS),
  echo('sys_oauth_application._actions.create_oauth_application.params.type.options.web', 'Web', WEB_CLIENT_TYPE),

  echo('sys_sso_provider._actions.register_saml_provider.params.entryPoint.label', 'IdP SSO URL', IDP_SSO_URL),
  echo('sys_sso_provider._actions.register_sso_provider.params.scopes.placeholder', 'openid email profile', TYPED_CLAIM),
  echo('sys_sso_provider._actions.register_sso_provider.params.mapEmail.placeholder', 'email', TYPED_CLAIM),
  echo('sys_sso_provider._actions.register_sso_provider.params.mapName.placeholder', 'name', TYPED_CLAIM),
  echo(
    'sys_sso_provider._actions.register_saml_provider.params.identifierFormat.placeholder',
    'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    TYPED_URN,
  ),

  echo('sys_email.fields.message_id.label', 'Message-ID', MESSAGE_ID),
  echo('sys_email.fields.cc_addresses.label', 'Cc', COPY_HEADER),
  echo('sys_email.fields.bcc_addresses.label', 'Bcc', COPY_HEADER),
  echo('sys_setting_audit.fields.source.options.ui', 'UI', CHANNEL_INITIALISM),
  echo('sys_setting_audit.fields.source.options.api', 'API', CHANNEL_INITIALISM),

  ...[
    'sys_oauth_application',
    'sys_oauth_access_token',
    'sys_oauth_refresh_token',
    'sys_oauth_consent',
    'sys_oauth_resource',
    'sys_oauth_client_resource',
    'sys_oauth_client_assertion',
    'sys_sso_provider',
    'sys_scim_connection_binding',
    'sys_scim_connection_credential',
    'sys_scim_group',
    'sys_scim_group_member',
    'sys_scim_identity_tombstone',
    'sys_scim_projection_grant',
    'sys_scim_subject',
    'sys_scim_user',
    'sys_email_template',
    'sys_metadata',
    'sys_metadata_history',
    'sys_metadata_audit',
    'sys_secret',
    'sys_setting_audit',
  ].map((object) => echo(`${object}.fields.id.label`, 'ID', BARE_ID)),
];

/** Every string leaf of a bundle, keyed by its dotted path. */
function flatten(node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof node === 'string') {
    out.set(prefix, node);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const EN = flatten(enObjects);
const JA = flatten(jaJPObjects);

/**
 * Every `echo` verdict that carries no departure reason. A predicate rather
 * than an inlined loop so the suite can prove it FIRES.
 */
function undeclaredEchoes(rows: readonly Decision[]): string[] {
  return rows.filter((d) => d.verdict === 'echo' && (d.departure ?? '').length <= 40).map((d) => d.path);
}

describe('#20493 ja-JP — the ledger itself (controls before verdicts)', () => {
  it('is the size it claims: 3 pinned translations and 35 declared echoes, no path twice', () => {
    expect(DECISIONS.length).toBe(38);
    expect(DECISIONS.filter((d) => d.verdict === 'translate').length).toBe(3);
    expect(DECISIONS.filter((d) => d.verdict === 'echo').length).toBe(35);
    expect(new Set(DECISIONS.map((d) => d.path)).size).toBe(DECISIONS.length);
  });

  it('every row is pinned to the live `en` source it was decided against', () => {
    for (const d of DECISIONS) {
      expect(EN.get(d.path), `en ${d.path} moved — re-judge the decision, do not refresh this row`).toBe(d.en);
    }
  });

  it('the echo predicate can say "echo" — fed the `en` catalog, it flags every row', () => {
    // Dark. `value === en` is the whole verdict test below; run it against the
    // source catalog itself and it must hold for every row, or a green verdict
    // run means nothing.
    const flagged = DECISIONS.filter((d) => EN.get(d.path) === d.en);
    expect(flagged.length).toBe(DECISIONS.length);
  });

  it('every decision records a reason, and every `echo` its departure', () => {
    for (const d of DECISIONS) {
      expect(d.reason.length, `${d.path} records no reason`).toBeGreaterThan(40);
    }
    expect(undeclaredEchoes(DECISIONS), 'a declared echo here carries no departure reason').toEqual([]);
  });

  it('refuses an `echo` verdict that carries no departure — proved on a synthetic row', () => {
    const synthetic: Decision = {
      path: 'sys_team.fields.member_count.label',
      en: 'Member Count',
      verdict: 'echo',
      reason: 'A synthetic row that exists only to prove this file can refuse an undeclared echo.',
    };
    expect(undeclaredEchoes([synthetic])).toEqual(['sys_team.fields.member_count.label']);
    expect(
      undeclaredEchoes([
        { ...synthetic, departure: 'A departure reason long enough to satisfy the rule, standing in for a real one.' },
      ]),
    ).toEqual([]);
  });

  it('the Japanese-script predicate can say "no" — an en copy fails it', () => {
    // Dark. The verdict below asks a translated leaf to carry kana or kanji;
    // the en source of every pinned row must fail that same test.
    for (const d of DECISIONS.filter((r) => r.verdict === 'translate')) expect(d.en).not.toMatch(JAPANESE);
  });
});

describe('#20493 ja-JP — the catalog holds what the ledger decided', () => {
  it('every decided leaf matches its verdict', () => {
    for (const d of DECISIONS) {
      const id = `${LOCALE} ${d.path}`;
      const value = JA.get(d.path);
      expect(typeof value, `${id} is missing from the catalog`).toBe('string');
      expect((value as string).length, `${id} is empty`).toBeGreaterThan(0);
      if (d.verdict === 'translate') {
        expect(value, `${id} reads its en source again — the decision was that this echo is a fill`).not.toBe(d.en);
        expect(value, `${id} carries no Japanese`).toMatch(JAPANESE);
      } else {
        expect(value, `${id} is a declared echo and must stay the en source`).toBe(d.en);
      }
    }
  });

  it('⭐ the role options read one word per role, on both objects the console lists them from', () => {
    // The members list and the Invite user dialog render the same role values
    // from two objects, which declare them from one spec constant
    // (`BUILTIN_MEMBERSHIP_ROLE_OPTIONS`). One word per role on both.
    const roles = (object: string): Record<string, string> =>
      (jaJPObjects as Record<string, any>)[object].fields.role.options;
    expect(Object.keys(roles('sys_member'))).toContain('delegated_admin');
    expect(roles('sys_invitation')).toEqual(roles('sys_member'));
    // DISTINCT words: a copy of one role's word onto another would pass the
    // equality above.
    const words = Object.values(roles('sys_member'));
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) expect(word).toMatch(JAPANESE);
    // The console's own word for this role value — objectui
    // `packages/i18n/src/locales/ja.ts`, `organization.roles.delegatedAdmin` —
    // so the Invite dialog and the console name the role the same way.
    expect(roles('sys_member').delegated_admin).toBe('委任管理者');
  });
});

describe('#20493 ja-JP — the provenance table agrees', () => {
  const table = jaJPGeneratedSourceHashes;

  it('every declared echo is still recorded as a byte copy of its CURRENT source', () => {
    // Lit — the table really loaded.
    expect(Object.keys(table).length, `${LOCALE} provenance table is empty`).toBeGreaterThan(0);
    for (const d of DECISIONS.filter((r) => r.verdict === 'echo')) {
      expect(table[`objects.${d.path}`], `${d.path} is a declared echo with no provenance row`).toBe(
        hashSource(d.en),
      );
    }
  });

  it('no translated row is still recorded as an extractor fill', () => {
    const stillFilled = DECISIONS.filter((d) => d.verdict === 'translate' && table[`objects.${d.path}`] !== undefined);
    expect(stillFilled.map((d) => d.path)).toEqual([]);
  });

  it('the provenance lookup can say "still a fill" and "authored" — both directions, on this bundle', () => {
    // Dark. The verdict above is a run of `undefined`s, which is also what a
    // misspelt key shape returns. The echo rows prove the composed key finds a
    // real row; a leaf a translator wrote long before this card proves it does
    // not find one where there is none.
    const echoRow = DECISIONS.find((d) => d.verdict === 'echo')!;
    expect(table[`objects.${echoRow.path}`]).toBeTypeOf('string');
    expect(JA.get('sys_user.fields.email.label')).not.toBe(EN.get('sys_user.fields.email.label'));
    expect(table['objects.sys_user.fields.email.label']).toBeUndefined();
  });
});
