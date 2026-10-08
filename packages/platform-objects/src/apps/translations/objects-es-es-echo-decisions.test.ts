// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20493 — the DECISION LEDGER for the es-ES `objects` bundle's en-echoes.
//
// An en-echo is not automatically a defect: a leaf that reads its English
// source may be an unauthored extractor fill, or it may be the right rendering
// for that locale. The two are byte-identical, so the distinction cannot be
// recovered from the catalog later — it has to be RECORDED when someone looks.
// `objects-zh-cn-echo-decisions.test.ts` keeps that record for zh-CN; this file
// is the same record, in the same shape, for es-ES: `Verdict` per row, a reason
// for every row, and a per-locale `departure` for every `echo`. Each locale
// decides its own set — the zh-CN set was where reading started, not a list
// copied over.
//
// ## What was decided, and where it was measured
//
// Walk of `en.objects.generated.ts` against `es-ES.objects.generated.ts` at
// base 397572ed5, counting every string leaf byte-equal to its `en` leaf
// (1529 leaves in each bundle):
//
//   before   392 copies — `label` 217 · `options.*` 22 · `pluralLabel` 12 ·
//            `help` 121 · `description` 12 · `placeholder` 4 ·
//            `emptyState.*` 4
//   after     54 copies — every one of them a row below with verdict `echo`
//
// The other 338 were extractor fills and are translated. The extractor files a
// field's `help` / `description` / `placeholder` under the same `source` kind
// as its `label` (`ExpectedEntry.source` in `packages/cli/src/utils/
// i18n-extract.ts`), so they were decided as the same class.
//
// Where es-ES departs from zh-CN, and why:
//   - the result dialog's `Client ID` / `Client Secret` and the SAML
//     `IdP SSO URL` were never copies here: this bundle authored them;
//   - the register dialog's `Web` option stays `Web`, because this bundle
//     already renders the sibling `fields.type.options.web` as Web;
//   - fourteen leaves are Spanish as written. Eight are words Spanish spells
//     exactly as English (Error, Actor, Global, Variables); five are the
//     loanwords this bundle already uses for the concept (Token, Checksum,
//     Slug); and `Cc` is the Spanish copy abbreviation beside its authored
//     blind-copy sibling `Cco`.
//
// Per-leaf witness: the package's provenance table
// (`es-ES.source-hashes.generated.ts`) holds an entry exactly while a leaf is
// still a byte copy of its source revision. `pnpm i18n:extract` dropped the 338
// rows for the translated leaves and kept 54 rows, one per echo below (measured
// equal at the time). What is asserted is one direction per verdict: every
// declared echo still has its row, and no pinned translation has one. That the
// table holds nothing BEYOND the echoes is not asserted, for the reason the
// next section gives.
//
// Since that walk, the seven `sys_account._actions.link_social` provider-brand
// rows (Google through Discord) left this ledger together with the action,
// retired under ADR-0049 enforce-or-remove (#21849): the bundle no longer
// carries those leaves, so the ledger held 47 echoes. Then the `global` option
// of `sys_setting.scope` left with the settings cascade's global rung
// (ADR-0131 D7): the ledger below holds 46.
//
// ## What this file deliberately does NOT assert
//
// That no OTHER es-ES objects leaf reads its `en` source. A new field's label
// arrives in every translated locale as a `--fill=default` copy, so that
// assertion would red every future PR that adds a platform-object field without
// an es-ES word. It is the coverage-ratchet half, which the triage kept out of
// this card: widening a gate is a separate decision.
//
// ⛔ Do not add a row here to make a red go away. A row is a decision someone
// took about one leaf; the `echo` verdict needs its own reason precisely so that
// recording "the English is right here" costs a sentence.

import { describe, it, expect } from 'vitest';

import { enObjects } from './en.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';
import { esESGeneratedSourceHashes } from './es-ES.source-hashes.generated.js';
import { hashSource } from './source-hash.js';

const LOCALE = 'es-ES';

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
  /** The verdict for es-ES. */
  verdict: Verdict;
  /** Why — recorded for `translate` as much as for `echo`. */
  reason: string;
  /** Required for every `echo` verdict: why the English is right in es-ES. */
  departure?: string;
}

const BARE_ID =
  'The bare initialism ID. This bundle keeps ID verbatim inside every label that carries it (ID de usuario, ID de organización, ID de cliente); a bare en ID has no noun to render, and adding one would invent content.';
const JWKS =
  'A protocol name (the RFC 7517 JWK Set) that this bundle keeps verbatim: sys_jwks is authored as Clave de firma (JWKS), and every URI stays URI (URI de redirección).';
const WEB_CLIENT_TYPE =
  'The web client type as this bundle already renders it: the sibling option sys_oauth_application.fields.type.options.web is authored as Web, so the register dialog and the record field read one word.';
const TYPED_CLAIM =
  'A placeholder shows the literal value the admin types: OIDC scope and claim names the IdP matches byte for byte. The authored help on the same param keeps them verbatim (Valor predeterminado: «email»).';
const TYPED_URN =
  'A placeholder shows the literal value the admin types, here the SAML NameID format URN: an identifier matched byte for byte, not prose.';
const MESSAGE_ID =
  'The RFC 5322 header name. The authored help on the same field keeps it verbatim (Message-ID RFC-5322 asignado por el transporte).';
const COPY_HEADER =
  'The Spanish copy-recipient abbreviation (con copia) is spelled Cc as well; the blind-copy sibling on the same record is authored as its Spanish form, Cco.';
const CHANNEL_INITIALISM =
  'An initialism this bundle keeps verbatim wherever it appears (nunca se muestra en la UI; sys_metadata.fields.source.options.api is authored as API); the option names the channel a setting change came through.';
const SAME_WORD_ERROR =
  'Spanish spells the word exactly as English (el error); this bundle already writes it so in the authored label Último error on sys_job_queue.';
const SAME_WORD_ACTOR =
  'Spanish spells the word exactly as English (el actor); this bundle already writes it so in authored help (Último actor que escribió esta fila), and the messaging bundle authors its actor label as Actor.';
const SAME_WORD_GLOBAL =
  'Spanish spells the word exactly as English (global); the security bundle already writes it so in authored help (nulo = global (entre inquilinos)), beside the authored sibling scope options Inquilino and Usuario.';
const SAME_WORD_VARIABLES =
  'Spanish spells the word exactly as English (las variables); the authored description of this same object already says (asunto + contenido + variables).';
const BUNDLE_LOANWORD =
  'The loanword this bundle already uses for the concept, so one term is not rendered two ways: Token de sesión and Token de acceso (token), Checksum anterior (checksum), Cambiar slug (slug).';

function echo(path: string, en: string, departure: string): Decision {
  return {
    path,
    en,
    verdict: 'echo',
    reason: 'Kept as written by design: a brand, protocol or typed value, or a word es-ES already spells this way.',
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
      'Read from the bundle, not re-driven in a browser: the membership role list rendered Propietario / Administrador / Delegated Admin / Miembro. Rendered with the word the console already uses for this role value.',
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

  // ── Kept as written by design (47) ───────────────────────────────────────
  echo('sys_oauth_application.fields.jwks.label', 'JWKS', JWKS),
  echo('sys_oauth_application.fields.jwks_uri.label', 'JWKS URI', JWKS),
  echo('sys_oauth_application._actions.create_oauth_application.params.type.options.web', 'Web', WEB_CLIENT_TYPE),

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
  echo('sys_setting_audit.fields.source.options.ui', 'UI', CHANNEL_INITIALISM),
  echo('sys_setting_audit.fields.source.options.api', 'API', CHANNEL_INITIALISM),

  echo('sys_email.fields.error.label', 'Error', SAME_WORD_ERROR),
  echo('sys_job_run.fields.error.label', 'Error', SAME_WORD_ERROR),
  echo('sys_notification.fields.actor_id.label', 'Actor', SAME_WORD_ACTOR),
  echo('sys_metadata_audit.fields.actor.label', 'Actor', SAME_WORD_ACTOR),
  echo('sys_setting_audit.fields.actor_id.label', 'Actor', SAME_WORD_ACTOR),
  echo('sys_setting_audit.fields.scope.options.global', 'Global', SAME_WORD_GLOBAL),
  echo('sys_email_template.fields.variables_json.label', 'Variables (JSON)', SAME_WORD_VARIABLES),

  echo('sys_oauth_access_token.fields.token.label', 'Token', BUNDLE_LOANWORD),
  echo('sys_oauth_refresh_token.fields.token.label', 'Token', BUNDLE_LOANWORD),
  echo('sys_metadata.fields.checksum.label', 'Checksum', BUNDLE_LOANWORD),
  echo('sys_metadata_history.fields.checksum.label', 'Checksum', BUNDLE_LOANWORD),
  echo('sys_organization.fields.slug.label', 'Slug', BUNDLE_LOANWORD),

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
    'sys_view_definition',
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
const ES = flatten(esESObjects);

/**
 * Every `echo` verdict that carries no departure reason. A predicate rather
 * than an inlined loop so the suite can prove it FIRES.
 */
function undeclaredEchoes(rows: readonly Decision[]): string[] {
  return rows.filter((d) => d.verdict === 'echo' && (d.departure ?? '').length <= 40).map((d) => d.path);
}

describe('#20493 es-ES — the ledger itself (controls before verdicts)', () => {
  // [ADR-0131 D7] 47 → 46 echoes: `sys_setting.scope` no longer declares the
  // `global` option (the rung moved to `sys_platform_setting`), so its leaf left
  // the catalog with it. `sys_setting_audit.scope`'s `global` option stays.
  it('is the size it claims: 3 pinned translations and 46 declared echoes, no path twice', () => {
    expect(DECISIONS.length).toBe(49);
    expect(DECISIONS.filter((d) => d.verdict === 'translate').length).toBe(3);
    expect(DECISIONS.filter((d) => d.verdict === 'echo').length).toBe(46);
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
});

describe('#20493 es-ES — the catalog holds what the ledger decided', () => {
  it('every decided leaf matches its verdict', () => {
    for (const d of DECISIONS) {
      const id = `${LOCALE} ${d.path}`;
      const value = ES.get(d.path);
      expect(typeof value, `${id} is missing from the catalog`).toBe('string');
      expect((value as string).length, `${id} is empty`).toBeGreaterThan(0);
      if (d.verdict === 'translate') {
        expect(value, `${id} reads its en source again — the decision was that this echo is a fill`).not.toBe(d.en);
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
      (esESObjects as Record<string, any>)[object].fields.role.options;
    const enRoles = (enObjects as Record<string, any>).sys_member.fields.role.options as Record<string, string>;
    expect(Object.keys(roles('sys_member'))).toContain('delegated_admin');
    expect(roles('sys_invitation')).toEqual(roles('sys_member'));
    // DISTINCT words: a copy of one role's word onto another would pass the
    // equality above.
    const words = Object.values(roles('sys_member'));
    expect(new Set(words).size).toBe(words.length);
    // No role reads its English source: es-ES has no script to test, so the
    // en catalog is the negative.
    for (const [role, word] of Object.entries(roles('sys_member'))) {
      expect(word, `es-ES role ${role} reads its en source`).not.toBe(enRoles[role]);
    }
    // The console's own word for this role value — objectui
    // `packages/i18n/src/locales/es.ts`, `organization.roles.delegatedAdmin` —
    // so the Invite dialog and the console name the role the same way.
    expect(roles('sys_member').delegated_admin).toBe('Administrador delegado');
  });
});

describe('#20493 es-ES — the provenance table agrees', () => {
  const table = esESGeneratedSourceHashes;

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
    expect(ES.get('sys_user.fields.email.label')).not.toBe(EN.get('sys_user.fields.email.label'));
    expect(table['objects.sys_user.fields.email.label']).toBeUndefined();
  });
});
