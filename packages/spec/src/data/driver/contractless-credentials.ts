// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Credential material in the `config` of a datasource whose driver the
 * platform ships NO config contract for (a plugin-contributed driver).
 *
 * For such a driver no schema types a position, so the inline-credential
 * refusal at write (`data/datasource.zod.ts`) and the read-path redaction
 * (`data/datasource-credential-redaction.ts`) both judge by NAME and by value
 * SHAPE — and both read the ONE walk in this module
 * ({@link findContractlessCredentials}), so the two doors cannot drift: every
 * position the write door refuses is a position the read door withholds.
 *
 * ⛔ Never consulted for a driver WITH a contract: there the contract's own
 * `z.never()` slots and the measured passthrough tables decide, and a
 * name-shape guess layered over a measured list would refuse configuration a
 * measured client reads.
 */

import { CREDENTIAL_KEY_SPELLINGS } from './common.zod';

// ---------------------------------------------------------------------------
// The key-name judgment
// ---------------------------------------------------------------------------

/**
 * A key split into lower-case words at separators and camel-case boundaries:
 * `secretAccessKey` → `secret access key`, `X-API-Key` → `x api key`,
 * `client_secret` → `client secret`. Judging WORDS rather than substrings is
 * what keeps `bypass`, `passive`, `primaryKey` and `partitionKey` out while
 * `pass`, `key` and `apiKey` are in. A run of non-ASCII characters is a word
 * of its own (`客户名称` is one word, `Größe` is `gr`, `öß`, `e`); every ASCII
 * character other than a letter or a digit is a separator.
 */
function wordsOf(key: string): string[] {
  // Every pattern here is linear: each matches a fixed number of characters
  // per attempt. The split before the last capital of a run (`APIKey` →
  // `API Key`) looks ahead instead of capturing the run, so a long run of
  // capitals is not re-scanned at every position.
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1 ')
    .replace(/([^\x00-\x7f]+)/g, ' $1 ')
    .toLowerCase()
    .split(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/)
    .filter(Boolean);
}

/**
 * Longer than this (after NFKC normalisation), a key — an object key, a
 * connection-string segment key, a query or form parameter name, a header
 * name — is not split into words at all: it is judged credential-shaped
 * unread, so an over-long name can neither cost the judgment time nor hide a
 * credential from it.
 */
const MAX_JUDGED_KEY_LENGTH = 256;

/**
 * A key as the word judgment reads it: NFKC-normalised (so a full-width
 * `ｐａｓｓｗｏｒｄ` reads as `password`), or `undefined` when it is longer than
 * {@link MAX_JUDGED_KEY_LENGTH} — such a key is judged credential-shaped.
 */
function judgedKey(key: string): string | undefined {
  if (key.length > MAX_JUDGED_KEY_LENGTH * 4) return undefined;
  const normalized = key.normalize('NFKC');
  return normalized.length > MAX_JUDGED_KEY_LENGTH ? undefined : normalized;
}

/** The words of a key as the judgment reads them; `undefined` past the length cap. */
function judgedWords(key: string): string[] | undefined {
  const judged = judgedKey(key);
  return judged === undefined ? undefined : wordsOf(judged);
}

const NON_ASCII_RE = /[^\x00-\x7f]/;
const isNonAscii = (c: string): boolean => c.charCodeAt(0) > 0x7f;

/**
 * Invisible format characters (soft hyphen, zero-width space / joiners,
 * word joiner, BOM, Mongolian vowel separator): NFKC keeps them, and inside a
 * word they hide it from a word judgment.
 */
const FORMAT_CHAR_RE = /[\u00ad\u180e\u200b-\u200f\u2060-\u2064\ufeff]/g;

/**
 * Cyrillic and Greek letters that render as a Latin letter (`а` U+0430 → `a`):
 * a key spelled with them reads to a person as the Latin word.
 */
const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w',
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u',
  'χ': 'x', 'ω': 'w',
};

/** The key with invisible format characters removed and confusable letters read as Latin ones. */
function confusableReading(key: string): string {
  return key.replace(FORMAT_CHAR_RE, '').replace(/[^\x00-\x7f]/g, (c) => {
    const lower = c.toLowerCase();
    const latin = CONFUSABLE_LETTERS[lower];
    if (latin === undefined) return c;
    return lower === c ? latin : latin.toUpperCase();
  });
}

/**
 * Credential words in other scripts, matched as a SUBSTRING of a key's
 * lower-cased non-ASCII text (`数据库密码`): CJK text has no word separators.
 */
const NON_LATIN_CREDENTIAL_WORDS: readonly string[] = [
  '密码', '密碼', '口令', '密钥', '密鑰', '秘钥', '令牌', '凭证', '憑證',
  'パスワード', '暗証番号', '秘密鍵', 'トークン',
  '비밀번호', '토큰',
  'пароль', 'токен',
  'contraseña',
];
/** {@link CREDENTIAL_KEY_SPELLINGS} folded to one lower-case word each (`auth_token` → `authtoken`). */
const FOLDED_CREDENTIAL_KEY_SPELLINGS: ReadonlySet<string> = new Set(
  CREDENTIAL_KEY_SPELLINGS.map((key) => wordsOf(key).join('')),
);

/** Words that make a key credential-shaped in ANY position (`dbPassword`, `secretAccessKey`, `serviceCredential`). */
const CREDENTIAL_WORDS_ANYWHERE: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'passphrase',
  'secret',
  'credential',
]);

/**
 * Words that make a key credential-shaped as its LAST word (`accessToken`,
 * `dbPass`, `githubPat`, `basicAuth`, `sasToken`): each is also an ordinary
 * leading word (`tokenUrl`, `passThrough`, `cookieDomain`, `authMethod`), so
 * only the head noun of the key counts.
 */
const CREDENTIAL_WORDS_LAST: ReadonlySet<string> = new Set([
  'token',
  'pass',
  'pw',
  'pwd',
  'jwt',
  'pat',
  'cookie',
  'sas',
  'auth',
  'authorization',
  'bearer',
  'apikey',
  'privkey',
  'pfx',
  'pkcs12',
  'p12',
]);

/**
 * `key` as the last word is key material only beside one of these
 * (`apiKey`, `privateKey`, `accountKey`, `sharedAccessKey`,
 * `serviceAccountKey`) or alone (`key`). `primaryKey`, `partitionKey`,
 * `sortKey` and `cacheKey` are ordinary configuration, and `accessKey` alone is
 * the IDENTITY half of an access-key pair (`accessKeyId` / `secretAccessKey`).
 */
const KEY_MATERIAL_QUALIFIERS: ReadonlySet<string> = new Set([
  'api',
  'private',
  'secret',
  'signing',
  'master',
  'encryption',
  'decryption',
  'account',
  'shared',
  'client',
  'session',
  'auth',
  'hmac',
  'license',
  'subscription',
  'ssh',
  'aes',
  'storage',
  'ssl',
  'tls',
]);

/** `signature` as the last word is credential material beside one of these (`sharedAccessSignature`). */
const SIGNATURE_QUALIFIERS: ReadonlySet<string> = new Set(['shared', 'access', 'sas', 'hmac', 'amz']);

/**
 * Trailing words that qualify a credential stem without changing what it is
 * (`apiKeyValue`, `tokenValue`, `privateKeyPem`, `keyJson`, `privateKeyData`,
 * `tokenString`, `authData`, `encryptionKeyHex`, `pwdHash`).
 */
const CREDENTIAL_TRAILING_QUALIFIERS: ReadonlySet<string> = new Set([
  'value',
  'values',
  'pem',
  'json',
  'b64',
  'base64',
  'data',
  'content',
  'hex',
  'string',
  'str',
  'raw',
  'hash',
]);

/**
 * LAST words that name WHERE or WHAT a credential is rather than the credential
 * itself: a reference into a secret store (`credentialsRef`, `secretArn`,
 * `secretName`), a locator (`passwordFile`, `privateKeyPath`, `tokenUrl`,
 * `tokenEndpoint`, `passwordEnv`, `secretsManagerRegion`), an identifier
 * (`clientSecretId`, `accessKeyId`) or a descriptor (`tokenType`,
 * `apiKeyHeader`, `tokenPrefix`, `credentialProvider`, `credentialSource`,
 * `credentialChain`, `passwordPolicy`, `authMethod`, `passwordEnabled`,
 * `passwordAuthentication`). A last word ending in `less` (`passwordless`) is
 * a descriptor too.
 */
const CREDENTIAL_DESCRIPTOR_ENDINGS: ReadonlySet<string> = new Set([
  'ref',
  'refs',
  'reference',
  'arn',
  'id',
  'ids',
  'name',
  'names',
  'path',
  'paths',
  'file',
  'files',
  'filename',
  'url',
  'urls',
  'uri',
  'endpoint',
  'env',
  'type',
  'header',
  'headers',
  'field',
  'prefix',
  'mode',
  'region',
  'provider',
  'source',
  'chain',
  'policy',
  'method',
  'enabled',
  'authentication',
  'format',
  'version',
  'expiry',
  'expires',
  'length',
  'count',
]);

/**
 * FIRST words that make a multi-word key a flag or a measure, never a value:
 * `useDefaultCredentials`, `requirePassword`, `maxTokens`.
 */
const NON_CREDENTIAL_LEADING_WORDS: ReadonlySet<string> = new Set([
  'use',
  'enable',
  'enabled',
  'disable',
  'require',
  'required',
  'allow',
  'has',
  'is',
  'no',
  'skip',
  'max',
  'min',
  'num',
  'count',
  'total',
]);

/**
 * Folded compound endings that make a ONE-word key credential-shaped — the
 * spelling an all-lower-case or all-upper-case key (`APIKEY`, `accesstoken`,
 * `secretaccesskey`) collapses to, where no word boundary survives.
 */
const FOLDED_CREDENTIAL_ENDINGS: readonly string[] = [
  'token',
  'pwd',
  'apikey',
  'privatekey',
  'secretkey',
  'signingkey',
  'masterkey',
  'encryptionkey',
  'accountkey',
  'sharedkey',
  'sharedaccesskey',
  'clientkey',
  'sessionkey',
  'authkey',
  'hmackey',
  'licensekey',
  'subscriptionkey',
  'serviceaccountkey',
  'serviceaccountjson',
  'accesssignature',
  'privkey',
  'pfx',
  'sslkey',
  'tlskey',
  'basicauth',
  'bearerauth',
  'digestauth',
];

/** Every stem a trailing `s` may pluralize (`apiKeys`, `tokens`, `credentials`). */
const PLURALIZABLE_STEMS: ReadonlySet<string> = new Set([
  ...CREDENTIAL_WORDS_ANYWHERE,
  ...CREDENTIAL_WORDS_LAST,
  'key',
  'signature',
]);

/** A trailing `s` is a plural only after a stem that does not itself end in `s` (`sass` is not `sas`s). */
const pluralOf = (word: string): boolean => word.endsWith('s') && !word.endsWith('ss');

function singular(word: string): string {
  return pluralOf(word) && PLURALIZABLE_STEMS.has(word.slice(0, -1)) ? word.slice(0, -1) : word;
}

/**
 * What may FOLLOW a {@link CREDENTIAL_WORDS_ANYWHERE} word inside a one-word
 * key (`dbpassword`, `secretkey`, `secretaccesskey`, `passwordhash`) — so the
 * word counts only as a whole word of the folded key, never as a substring of
 * a longer one (`secretary`, `credentialing`).
 */
const FOLDED_ANYWHERE_FOLLOWERS: readonly string[] = ['', 'key', 'accesskey', 'hash', 'string'];

const holdsAnywhereWord = (folded: string): boolean =>
  [...CREDENTIAL_WORDS_ANYWHERE].some((word) => {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      if (FOLDED_ANYWHERE_FOLLOWERS.includes(folded.slice(at + word.length))) return true;
    }
    return false;
  });

/** The ONE-word judgment, on a key with no surviving word boundary. */
function isCredentialShapedWord(word: string): boolean {
  if (FOLDED_CREDENTIAL_KEY_SPELLINGS.has(word)) return true;
  if (word.endsWith('less')) return false;
  if (/^(max|min|num|total|count)/.test(word)) return false;
  for (const ending of CREDENTIAL_DESCRIPTOR_ENDINGS) {
    if (word.length > ending.length && word.endsWith(ending)) return false;
  }
  let stem = word;
  for (let changed = true; changed;) {
    changed = false;
    for (const qualifier of CREDENTIAL_TRAILING_QUALIFIERS) {
      if (stem.length > qualifier.length && stem.endsWith(qualifier)) {
        stem = stem.slice(0, -qualifier.length);
        changed = true;
      }
    }
  }
  const candidates = pluralOf(stem) ? [stem, stem.slice(0, -1)] : [stem];
  return candidates.some((candidate) =>
    PLURALIZABLE_STEMS.has(candidate)
    || holdsAnywhereWord(candidate)
    || FOLDED_CREDENTIAL_ENDINGS.some((ending) => candidate.endsWith(ending)),
  ) || word.endsWith('serviceaccountjson') || word.endsWith('serviceaccountpem');
}

/**
 * Does a key's non-ASCII text hide a credential word — sit inside one or next
 * to one? (`judged` is NFKC-normalised and holds a non-ASCII character.)
 *
 *  - it holds a credential word of another script
 *    ({@link NON_LATIN_CREDENTIAL_WORDS}: `数据库密码`, `пароль`);
 *  - read with its invisible format characters removed and its confusable
 *    Cyrillic and Greek letters as the Latin letters they render as
 *    ({@link confusableReading}: `pаssword` with a Cyrillic `а`, `kеy`), the key
 *    is credential-shaped;
 *  - in a run of characters with no ASCII separator in it that mixes ASCII
 *    letters or digits with non-ASCII characters, the ASCII word that TOUCHES
 *    a non-ASCII character is credential-shaped on its own (`password密码`,
 *    `token値`); or
 *  - in such a run, a credential word of four or more letters is spelled with
 *    non-ASCII characters standing in for, or inserted between, some of its
 *    letters — at most one per four letters (`pas§word`, `tok€n`) — invisible
 *    format characters inserted free (`pass` U+200B `word`).
 *
 * Anything else non-ASCII is an ordinary word of its own ({@link wordsOf}):
 * `客户名称`, `Größe` and `café` are not credential-shaped.
 */
function nonAsciiHidesCredential(judged: string): boolean {
  const lower = judged.toLowerCase();
  if (NON_LATIN_CREDENTIAL_WORDS.some((word) => lower.includes(word))) return true;
  const reading = confusableReading(judged);
  if (reading !== judged && judgeWords(wordsOf(reading))) return true;
  for (const run of judged.split(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/)) {
    if (!NON_ASCII_RE.test(run) || !/[A-Za-z0-9]/.test(run)) continue;
    if (touchingWordIsCredential(run)) return true;
    const chars = [...run.toLowerCase()];
    if (FUZZY_CREDENTIAL_WORDS.some((word) => spelledAround(chars, word))) return true;
  }
  return false;
}

/** In a run mixing ASCII and non-ASCII characters: is an ASCII word that touches a non-ASCII character credential-shaped? */
function touchingWordIsCredential(run: string): boolean {
  const pieces = run.split(/([^\x00-\x7f]+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const ascii = pieces[i] as string;
    if (ascii === '') continue;
    const words = wordsOf(ascii);
    if (words.length === 0) continue;
    if (i > 0 && isCredentialShapedWord(words[0] as string)) return true;
    if (i < pieces.length - 1 && isCredentialShapedWord(words[words.length - 1] as string)) return true;
  }
  return false;
}

/** The credential words a non-ASCII spelling is matched against (four letters or more). */
const FUZZY_CREDENTIAL_WORDS: readonly string[] = [...new Set([
  ...CREDENTIAL_WORDS_ANYWHERE,
  ...CREDENTIAL_WORDS_LAST,
  'signature',
])].filter((word) => word.length >= 4);

const isFormatChar = (c: string): boolean => /^[\u00ad\u180e\u200b-\u200f\u2060-\u2064\ufeff]$/.test(c);

/**
 * Does some stretch of `chars` spell `word` with at least one, and at most one
 * per four letters, non-ASCII character standing in for a letter or inserted
 * between two — invisible format characters inserted between letters free?
 * Bounded: a key is at most 256 characters, a word at most 13, the edit budget
 * at most 3.
 */
function spelledAround(chars: readonly string[], word: string): boolean {
  const budget = Math.floor(word.length / 4);
  const align = (i: number, j: number, left: number, used: boolean): boolean => {
    if (j === word.length) return used;
    if (i >= chars.length) return false;
    const c = chars[i] as string;
    if (c === word[j] && align(i + 1, j + 1, left, used)) return true;
    if (j > 0 && isFormatChar(c)) return align(i + 1, j, left, true);
    if (!isNonAscii(c) || left === 0) return false;
    return align(i + 1, j + 1, left - 1, true) || (j > 0 && align(i + 1, j, left - 1, true));
  };
  for (let start = 0; start < chars.length; start += 1) if (align(start, 0, budget, false)) return true;
  return false;
}

/**
 * Is `key` spelled like a credential — judged on its WHOLE name, case- and
 * separator-insensitively?
 *
 * The key is NFKC-normalised first. A key that is then longer than 256
 * characters is credential-shaped unread ({@link judgedKey}), and so is one
 * whose non-ASCII text hides a credential word ({@link nonAsciiHidesCredential}).
 * Otherwise the key is split into words ({@link wordsOf}; a run of non-ASCII
 * characters is a word of its own). It is NOT credential-shaped
 * when its last word is a descriptor ({@link CREDENTIAL_DESCRIPTOR_ENDINGS},
 * or a word ending in `less`) or its first word marks a flag or a measure
 * ({@link NON_CREDENTIAL_LEADING_WORDS}). Otherwise, after dropping trailing
 * qualifiers ({@link CREDENTIAL_TRAILING_QUALIFIERS}) and a plural `s`, it IS
 * credential-shaped when:
 *
 *  - folded, it is one of {@link CREDENTIAL_KEY_SPELLINGS} (`password`,
 *    `authToken` and the former aliases), or
 *  - any word is one of {@link CREDENTIAL_WORDS_ANYWHERE}, or
 *  - its last word is one of {@link CREDENTIAL_WORDS_LAST}, or
 *  - its last word is `key` alone or beside a {@link KEY_MATERIAL_QUALIFIERS}
 *    word, or `signature` beside a {@link SIGNATURE_QUALIFIERS} word, or
 *  - it names service-account key material (`serviceAccountKey`,
 *    `serviceAccountJson`).
 *
 * A key with one word only (`APIKEY`, `accesstoken`, `dbpassword`) has no
 * boundary left to split at, so it is judged on its folded spelling: one of
 * {@link CREDENTIAL_KEY_SPELLINGS} is credential-shaped; otherwise ending in
 * `less`, starting with `max` / `min` / `num` / `total` / `count`, or ending in
 * a descriptor longer than nothing (`tokentype`, `secretid`) is not. After
 * dropping trailing qualifiers and a plural `s` (never the `s` of a stem
 * already ending in `s`: `sass` is not `sas`), it is credential-shaped when it
 * IS one of the stems above (`pass`, `pw`, `key`, `signature`, `auth`, …),
 * when it holds a {@link CREDENTIAL_WORDS_ANYWHERE} word followed by nothing,
 * `key`, `accesskey`, `hash` or `string` (`dbpassword`, `secretaccesskey` —
 * not `secretary`), or when it ends in one of
 * {@link FOLDED_CREDENTIAL_ENDINGS} (`accesstoken`, `apikey`).
 */
export function isCredentialShapedConfigKey(key: string): boolean {
  if (typeof key !== 'string' || key === '') return false;
  const judged = judgedKey(key);
  if (judged === undefined) return true;
  if (NON_ASCII_RE.test(judged) && nonAsciiHidesCredential(judged)) return true;
  return judgeWords(wordsOf(judged));
}

/** The word judgment of {@link isCredentialShapedConfigKey}, on a key already split. */
function judgeWords(words: readonly string[]): boolean {
  if (words.length === 0) return false;
  if (words.length === 1) return isCredentialShapedWord(words[0] as string);

  const last = words[words.length - 1] as string;
  if (CREDENTIAL_DESCRIPTOR_ENDINGS.has(last) || last.endsWith('less')) return false;
  if (NON_CREDENTIAL_LEADING_WORDS.has(words[0] as string)) return false;
  if (FOLDED_CREDENTIAL_KEY_SPELLINGS.has(words.join(''))) return true;

  const stem = [...words];
  let stripped: string | undefined;
  while (stem.length > 1 && CREDENTIAL_TRAILING_QUALIFIERS.has(stem[stem.length - 1] as string)) {
    stripped = stem.pop();
  }
  if (stripped !== undefined && stem.join('').endsWith('serviceaccount')) return true;

  const singulars = stem.map(singular);
  if (singulars.some((word) => CREDENTIAL_WORDS_ANYWHERE.has(word))) return true;
  const head = singulars[singulars.length - 1] as string;
  const before = singulars.slice(0, -1);
  if (CREDENTIAL_WORDS_LAST.has(head)) return true;
  if (head === 'key') return before.length === 0 || before.some((word) => KEY_MATERIAL_QUALIFIERS.has(word));
  if (head === 'signature') return before.some((word) => SIGNATURE_QUALIFIERS.has(word));
  return FOLDED_CREDENTIAL_ENDINGS.some((ending) => head.length > ending.length && head.endsWith(ending));
}

/**
 * Inside an object reached under a credential-shaped key (`credentials: {…}`,
 * `auth: {…}`), the leaves that still carry no secret: descriptors and
 * identities (`type`, `clientId`, `user`, `email`, `scope`, `region`, …).
 * Every other leaf there is judged credential material.
 */
const IDENTITY_LEAF_WORDS: ReadonlySet<string> = new Set([
  'user',
  'username',
  'login',
  'email',
  'issuer',
  'audience',
  'scope',
  'scopes',
  'algorithm',
  'alg',
  'domain',
  'host',
  'hostname',
  'port',
  'realm',
  'project',
  'tenant',
  'subject',
  'kind',
  'label',
  'description',
]);

function isDescriptorLeafKey(key: string): boolean {
  const words = judgedWords(key);
  if (words === undefined) return false;
  const last = words[words.length - 1];
  if (last === undefined) return false;
  return CREDENTIAL_DESCRIPTOR_ENDINGS.has(last) || IDENTITY_LEAF_WORDS.has(last) || last.endsWith('less');
}

/** Is `key` the bare word `key` (or `keys`), in any case and with any separators? */
function isBareKeyName(key: string): boolean {
  const words = judgedWords(key);
  if (words === undefined) return false;
  return words.length === 1 && (words[0] === 'key' || words[0] === 'keys');
}

/** Is `key` header-ish — does one of its words name a header (`headers`, `httpHeaders`, `rawHeaders`)? */
function isHeaderishKey(key: string | undefined): boolean {
  if (key === undefined) return false;
  return judgedWords(key)?.some((word) => word === 'header' || word === 'headers') ?? false;
}

/**
 * Words of a holder that make a bare `key` below it key material: the TLS
 * options of a client (`ssl: { key, cert, ca }`, `tls: { key }`, pg / mysql2 /
 * mongodb / `tls.connect`), and any word starting with `cert`
 * (`certificate: { key }`, `clientCert: { key }`).
 */
const KEY_MATERIAL_HOLDER_WORDS: ReadonlySet<string> = new Set(['ssl', 'tls', 'mtls', 'x509', 'pfx', 'pkcs12']);

/** Is `key` a holder whose bare `key` is TLS key material? */
function isKeyMaterialHolder(key: string): boolean {
  return judgedWords(key)?.some((word) => KEY_MATERIAL_HOLDER_WORDS.has(word) || word.startsWith('cert')) ?? false;
}

/**
 * Does a string LOOK like a secret rather than a name — at least 16 characters
 * with no whitespace, and either mixing upper-case letters, lower-case letters
 * and digits (`sk_live_51Hx…`, `ghp_…`, `AIza…`), or at least 32 characters of
 * a token alphabet holding a digit (a hex or base64 key)? `email`,
 * `customer_email_2` and `orders.created_at` do not.
 */
export function looksLikeSecretValue(value: string): boolean {
  if (typeof value !== 'string' || value.length < 16) return false;
  if (/\s/.test(value)) return false;
  const lower = /[a-z]/.test(value);
  const upper = /[A-Z]/.test(value);
  const digit = /[0-9]/.test(value);
  if (lower && upper && digit) return true;
  return value.length >= 32 && digit && /^[A-Za-z0-9+/=_\-.~]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Credential material embedded in a string value
// ---------------------------------------------------------------------------

/**
 * A URL-ish prefix: `scheme://`, a stacked `jdbc:mysql://`, or a scheme-relative `//`.
 * Linear: a scheme group ends at its `:`, which its character class excludes,
 * so no input can be split into groups more than one way.
 */
const URL_PREFIX_RE = /^(?:[a-z][a-z0-9+.\-]*:)*\/\//i;

/**
 * Connection-string keywords that are NOT part of a credential: after a dropped
 * credential segment, a following segment is taken as the tail of that
 * credential (an unquoted `;` or `=` inside the password) until a segment whose
 * key is one of these — or is itself credential-shaped — starts again.
 * Folded (lower-case, letters and digits only).
 */
const CONNECTION_STRING_KEYWORDS: ReadonlySet<string> = new Set([
  'server', 'datasource', 'address', 'addr', 'networkaddress', 'host', 'hostname', 'hostaddr', 'port',
  'database', 'initialcatalog', 'db', 'dbname', 'user', 'userid', 'uid', 'username', 'login', 'role',
  'integratedsecurity', 'trustedconnection', 'encrypt', 'trustservercertificate', 'hostnameincertificate',
  'connectiontimeout', 'connecttimeout', 'timeout', 'commandtimeout', 'pooling', 'maxpoolsize', 'minpoolsize',
  'applicationname', 'app', 'applicationintent', 'multipleactiveresultsets', 'multisubnetfailover', 'driver',
  'dsn', 'provider', 'schema', 'sslmode', 'ssl', 'sslcert', 'sslrootcert', 'charset', 'characterset',
  'defaultendpointsprotocol', 'accountname', 'endpointsuffix', 'endpoint', 'blobendpoint', 'queueendpoint',
  'sharedaccesskeyname', 'entitypath', 'warehouse', 'account', 'region', 'authentication', 'mode',
  'persistsecurityinfo', 'failoverpartner', 'workstationid', 'wsid', 'packetsize', 'language', 'attachdbfilename',
  'tenant', 'tenantid', 'clientid', 'options', 'targetsessionattrs', 'currentlanguage', 'readonly',
  'databasename', 'servername', 'portnumber', 'instancename', 'logintimeout', 'sockettimeout', 'querytimeout',
  'authenticationscheme', 'domain', 'sendstringparametersasunicode', 'selectmethod', 'responsebuffering',
]);

const foldKeyword = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** One `key=value` segment of a semicolon-delimited connection string, with its byte range. */
interface ConnectionStringSegment {
  /** The segment's key, verbatim; `undefined` for a segment with no `=`. */
  key: string | undefined;
  /** The segment's value, trimmed and unquoted; `''` for a keyless segment. */
  value: string;
  start: number;
  end: number;
}

/**
 * Split a semicolon-delimited `key=value` connection string (the ADO.NET /
 * ODBC / JDBC-property shape: `Server=h;User Id=u;Password=p`) into segments.
 * A value may be quoted — `"…"` or `'…'` with the quote doubled to escape it,
 * or `{…}` with `}}` escaping the brace — and a `;` inside a quoted value does
 * not end the segment. Anything else runs to the next `;`.
 */
function semicolonSegments(value: string): ConnectionStringSegment[] {
  const out: ConnectionStringSegment[] = [];
  let i = 0;
  while (i <= value.length) {
    const start = i;
    while (i < value.length && value[i] !== '=' && value[i] !== ';') i += 1;
    if (i >= value.length || value[i] === ';') {
      out.push({ key: undefined, value: '', start, end: i });
      i += 1;
      continue;
    }
    const key = value.slice(start, i);
    i += 1;
    while (i < value.length && (value[i] === ' ' || value[i] === '\t')) i += 1;
    const open = value[i];
    const close = open === '"' || open === "'" ? open : open === '{' ? '}' : undefined;
    let raw: string;
    if (close) {
      let j = i + 1;
      let inner = '';
      while (j < value.length) {
        if (value[j] === close) {
          if (value[j + 1] === close) {
            inner += close;
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        inner += value[j];
        j += 1;
      }
      while (j < value.length && value[j] !== ';') j += 1;
      raw = inner;
      i = j;
    } else {
      const valueStart = i;
      while (i < value.length && value[i] !== ';') i += 1;
      raw = value.slice(valueStart, i).trim();
    }
    out.push({ key, value: raw, start, end: i });
    i += 1;
  }
  return out;
}

/**
 * A value that STARTS with a SQL bind placeholder (`$1`, `?`, `:name`)
 * ending at whitespace, `)`, `,`, `;` or the end — `WHERE token = $1` is a
 * query, not a credential.
 */
const SQL_PLACEHOLDER_RE = /^(?:\$[0-9]+|\?|:[A-Za-z_][A-Za-z0-9_]*)(?=[\s),;]|$)/;

const isCredentialSegment = (segment: ConnectionStringSegment): boolean =>
  segment.key !== undefined
  && segment.value !== ''
  && !SQL_PLACEHOLDER_RE.test(segment.value)
  && isCredentialShapedConfigKey(segment.key.trim());

/** Strip the credential segments of a semicolon-delimited string — and the tail each one drags (see {@link CONNECTION_STRING_KEYWORDS}). */
function redactSemicolonSegments(value: string): string {
  const segments = semicolonSegments(value);
  if (!segments.some(isCredentialSegment)) return value;
  const kept: string[] = [];
  let dropping = false;
  for (const segment of segments) {
    if (isCredentialSegment(segment)) {
      dropping = true;
      continue;
    }
    if (dropping) {
      const keyword = segment.key !== undefined && CONNECTION_STRING_KEYWORDS.has(foldKeyword(segment.key));
      if (!keyword) continue;
      dropping = false;
    }
    kept.push(value.slice(segment.start, segment.end));
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join(';');
}

/** One `keyword = value` pair of a libpq keyword/value string, with its byte range. */
interface LibpqPair {
  key: string;
  value: string;
  start: number;
  end: number;
}

const isLibpqSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isLibpqKeyStart = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_');
const isLibpqKeyChar = (c: string | undefined): boolean => isLibpqKeyStart(c) || (c !== undefined && c >= '0' && c <= '9');

/**
 * Every libpq-style `keyword = value` pair in a string (`host=h port=5432
 * password='a b'`), found LENIENTLY: a pair is a keyword at the start of the
 * string or after whitespace, optional whitespace, `=`, and a value —
 * single-quoted with `\'` / `\\` escapes (an unclosed quote runs to the end of
 * the string), or a run of non-space characters. Any other token is skipped,
 * so one stray word does not hide the pairs around it. One pass, linear.
 */
function libpqPairs(value: string): LibpqPair[] {
  const out: LibpqPair[] = [];
  let i = 0;
  while (i < value.length) {
    while (isLibpqSpace(value[i])) i += 1;
    if (i >= value.length) break;
    const start = i;
    let j = i;
    if (isLibpqKeyStart(value[j])) {
      j += 1;
      while (isLibpqKeyChar(value[j])) j += 1;
    }
    let k = j;
    while (isLibpqSpace(value[k])) k += 1;
    if (j === i || value[k] !== '=') {
      // Not a pair: skip the rest of this token.
      i = j > i ? j : i + 1;
      while (i < value.length && !isLibpqSpace(value[i])) i += 1;
      continue;
    }
    const key = value.slice(start, j);
    i = k + 1;
    while (isLibpqSpace(value[i])) i += 1;
    let raw = '';
    if (value[i] === "'") {
      i += 1;
      while (i < value.length) {
        if (value[i] === '\\' && i + 1 < value.length) {
          raw += value[i + 1];
          i += 2;
          continue;
        }
        if (value[i] === "'") {
          i += 1;
          break;
        }
        raw += value[i];
        i += 1;
      }
    } else {
      while (i < value.length && !isLibpqSpace(value[i])) {
        if (value[i] === '\\' && i + 1 < value.length) {
          raw += value[i + 1];
          i += 2;
          continue;
        }
        raw += value[i];
        i += 1;
      }
    }
    out.push({ key, value: raw, start, end: i });
  }
  return out;
}

const isCredentialLibpqPair = (pair: LibpqPair): boolean =>
  pair.value !== '' && !SQL_PLACEHOLDER_RE.test(pair.value) && isCredentialShapedConfigKey(pair.key);

/** The string without its credential libpq pairs, each cut with the whitespace that separated it. */
function redactLibpqPairs(value: string): string {
  const pairs = libpqPairs(value);
  if (!pairs.some(isCredentialLibpqPair)) return value;
  let out = '';
  let from = 0;
  for (const pair of pairs) {
    if (!isCredentialLibpqPair(pair)) continue;
    let cutStart = pair.start;
    let cutEnd = pair.end;
    // Take the whitespace after the pair; for the last pair, the whitespace before it.
    while (isLibpqSpace(value[cutEnd])) cutEnd += 1;
    if (cutEnd >= value.length) while (cutStart > from && isLibpqSpace(value[cutStart - 1])) cutStart -= 1;
    out += value.slice(from, cutStart);
    from = cutEnd;
  }
  return out + value.slice(from);
}

/**
 * `user:password@host…` with no scheme — the userinfo half of a URL written
 * without one. The password group allows `@` and is greedy, so the match ends
 * at the LAST `@` before the host (a malformed literal `@` must not decide how
 * much leaks), and it excludes `/`, so a `scheme://` URL never matches.
 * Linear: the anchored groups backtrack over one run each, and the lookahead
 * after each candidate `@` stops at the next `@`.
 */
const SCHEMELESS_USERINFO_RE = /^([^\s/?#@:;=]+):([^\s/?#]+)@(?=[^\s/?#@]*[A-Za-z0-9])/;

/**
 * Opaque URI schemes whose `scheme:` prefix is not a userinfo username
 * (`mailto:alice@example.com`): the judgment reads what follows the prefix
 * instead, so `sip:alice:secret@host` is still found.
 */
const OPAQUE_SCHEME_RE = /^(?:mailto|sips?|tel|urn|xmpp|news|im|pres):/i;

/** A time of day (`12:30@`, `9:05:59.250@`) — not a `user:password@` pair. */
const TIME_USERINFO_RE = /^[0-9]{1,2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?@/;

/**
 * Where a scheme-less `user:password@host` userinfo starts in `value` — after
 * an opaque scheme prefix, else `0` — or `-1` when the string holds none
 * (a time of day before the `@` is none).
 */
function schemelessUserinfoAt(value: string): number {
  const opaque = OPAQUE_SCHEME_RE.exec(value);
  const from = opaque ? opaque[0].length : 0;
  const rest = value.slice(from);
  if (TIME_USERINFO_RE.test(rest) || !SCHEMELESS_USERINFO_RE.test(rest)) return -1;
  return from;
}

/**
 * `jdbc:oracle:thin:user/password@…` — the Oracle thin-driver form, whose
 * userinfo splits user from password with `/` and carries no `//`. Anchored;
 * each group backtracks over one run, so linear.
 */
const ORACLE_THIN_USERINFO_RE = /^(jdbc:oracle:[a-z]+:)([^\s/@:]*)\/([^\s@]+)@/i;

/**
 * The byte layout of a URL-ish string (see {@link URL_PREFIX_RE}), or
 * `undefined` when it has none. Boundaries are RFC 3986's, as in
 * `urlUserinfo` (`driver/common.zod.ts`): the authority runs from after `//`
 * to the first `/`, `?` or `#`, and userinfo ends at its LAST `@`.
 */
interface UrlLayout {
  /** Index of the authority's first byte (just past `//`). */
  authorityStart: number;
  /** Index of the userinfo's `@`, or `-1`. */
  at: number;
  /** The userinfo password (after the userinfo's first `:`), or `undefined` when there is none or it is empty. */
  password: string | undefined;
  /** A userinfo with NO password whose username looks like a token (`https://ghp_…@host`). */
  tokenUsername: boolean;
  /** Index of the `;` that starts a `;key=value` property tail, or `-1`. */
  tail: number;
  /** Index of the `?` or `#` that ends the part a property tail can occupy (the string's length when none). */
  queryStart: number;
  /** Index of the `#` that starts the fragment, or `-1`. */
  hash: number;
}

function urlLayout(value: string): UrlLayout | undefined {
  const prefix = URL_PREFIX_RE.exec(value);
  if (!prefix) return undefined;
  const authorityStart = prefix[0].length;
  const authorityRel = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = authorityRel === -1 ? value.length : authorityStart + authorityRel;
  const atIdx = value.lastIndexOf('@', authorityEnd - 1);
  const at = atIdx >= authorityStart ? atIdx : -1;
  let password: string | undefined;
  let tokenUsername = false;
  if (at !== -1) {
    const userinfo = value.slice(authorityStart, at);
    const colon = userinfo.indexOf(':');
    // A `;` before the `:` makes it no userinfo at all but a property tail
    // whose value holds a `:` and an `@` (`sqlserver://h;password=a:b@c`).
    if (colon !== -1 && colon < userinfo.length - 1 && !userinfo.slice(0, colon).includes(';')) {
      password = userinfo.slice(colon + 1);
    } else if (!userinfo.slice(0, colon === -1 ? userinfo.length : colon).includes(';')) {
      // No password (or an empty one): the username alone may be the token.
      let username = colon === -1 ? userinfo : userinfo.slice(0, colon);
      try {
        username = decodeURIComponent(username);
      } catch {
        /* judge the raw username */
      }
      tokenUsername = looksLikeSecretValue(username);
    }
  }
  // A property tail starts at the first `;` after the userinfo when a
  // password ended it (`sqlserver://u:a;b@h;db=d` — that `;` is the
  // password's), and otherwise at the first `;` after `//` — so a credential
  // property whose value carries an `@` (`sqlserver://h;password=a@b`) is
  // still read as a property, not as userinfo.
  const tailFrom = password !== undefined || tokenUsername ? at + 1 : authorityStart;
  const queryRel = value.slice(tailFrom).search(/[?#]/);
  const queryStart = queryRel === -1 ? value.length : tailFrom + queryRel;
  const semi = value.indexOf(';', tailFrom);
  const hash = value.indexOf('#', queryStart);
  return {
    authorityStart,
    at,
    password,
    tokenUsername,
    tail: semi !== -1 && semi < queryStart ? semi : -1,
    queryStart,
    hash,
  };
}

/** Query and fragment parameter names that are credential material although not credential-shaped as config keys (`sig`, the SAS signature). */
const CREDENTIAL_PARAMETER_NAMES: ReadonlySet<string> = new Set(['sig']);

/** Is one `&`-separated query, fragment or form pair credential material — a credential-shaped name, or a `;key=value` run carrying one? */
function isCredentialQueryPair(pair: string): boolean {
  const eq = pair.indexOf('=');
  if (eq <= 0 || eq === pair.length - 1) return false;
  let key = pair.slice(0, eq);
  try {
    key = decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    /* keep the raw key */
  }
  if (CREDENTIAL_PARAMETER_NAMES.has(key.trim().toLowerCase())) return true;
  // `token=a;b` is ONE pair (the `;` is the value's); `mode=ro;password=p`
  // carries a credential in its `;` run — both are credential material.
  return isCredentialShapedConfigKey(key) || semicolonSegments(pair).some(isCredentialSegment);
}

/** The query (`?…`, up to `#`) of a URL, split into its `&` pairs; `[]` when there is none. */
function queryPairs(value: string, url: UrlLayout): string[] {
  if (value[url.queryStart] !== '?') return [];
  return value.slice(url.queryStart + 1, url.hash === -1 ? value.length : url.hash).split('&');
}

/** The fragment (`#…`) of a URL, split into its `&` pairs (`#access_token=…&state=…`); `[]` when there is none. */
function fragmentPairs(value: string, url: UrlLayout): string[] {
  return url.hash === -1 ? [] : value.slice(url.hash + 1).split('&');
}

/**
 * A form-encoded string (`a=b&pass=c`): no whitespace, an `&`, and an `=`;
 * a leading `?` is allowed. `undefined` when the string is not one.
 */
function formPairs(value: string): string[] | undefined {
  if (!value.includes('&') || !value.includes('=') || /\s/.test(value)) return undefined;
  return (value.startsWith('?') ? value.slice(1) : value).split('&');
}

/** A header-name token (RFC 9110 `token`). */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** The name of a `Name: value` header line whose name is credential-shaped and whose value is non-empty, or `undefined`. */
function credentialHeaderLineName(line: string): string | undefined {
  const colon = line.indexOf(':');
  if (colon <= 0) return undefined;
  const name = line.slice(0, colon).trim();
  if (!HEADER_NAME_RE.test(name)) return undefined;
  if (line.slice(colon + 1).trim() === '') return undefined;
  return isCredentialShapedConfigKey(name) ? name : undefined;
}

/** The lines of a string, each without its line terminator. */
const linesOf = (value: string): string[] => value.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

/** Does a key/value connection string (libpq, `;`-delimited, or form-encoded) carry a credential, and in which form? */
function keyValueCredentialOf(value: string): string | undefined {
  if (!value.includes('=')) return undefined;
  // Every reading is judged: a libpq value may hold an unquoted `;`
  // (`host=h password=a;b`), and a `;` string reads as one libpq pair whose
  // value runs to the next space. Any finding is a finding.
  if (libpqPairs(value).some(isCredentialLibpqPair)) {
    return 'a credential keyword inside a keyword/value connection string';
  }
  if (semicolonSegments(value).some(isCredentialSegment)) return 'a credential segment inside a connection string';
  if (formPairs(value)?.some(isCredentialQueryPair)) return 'a credential parameter inside a form-encoded string';
  return undefined;
}

/** The form-encoded reading's inverse: the credential pairs removed. */
function redactFormPairs(value: string): string {
  const form = formPairs(value);
  if (!form?.some(isCredentialQueryPair)) return value;
  return `${value.startsWith('?') ? '?' : ''}${form.filter((pair) => !isCredentialQueryPair(pair)).join('&')}`;
}

/**
 * {@link keyValueCredentialOf}'s inverse: every reading's credentials removed.
 * The reading that delimits the string is applied first, so a credential's
 * own delimiter-shaped bytes go with it: the form reading for a string with
 * no `;`, then the libpq reading when the string holds more than one
 * whitespace-separated pair (`password=a;b host=h`), and the semicolon
 * reading first otherwise (`Password=a b;Server=h`).
 */
function redactKeyValueCredentials(value: string): string {
  let out = value.includes(';') ? value : redactFormPairs(value);
  out = libpqPairs(out).length > 1
    ? redactSemicolonSegments(redactLibpqPairs(out))
    : redactLibpqPairs(redactSemicolonSegments(out));
  return redactFormPairs(out);
}

/** A string that may be JSON-encoded: its first non-space character opens an object or an array. */
const looksLikeJson = (value: string): boolean => /^\s*[[{]/.test(value);

/** `value` parsed, when it is a JSON-encoded object or array; `undefined` otherwise. */
function parsedJson(value: string): object | undefined {
  if (!looksLikeJson(value)) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Longer than this, a string (or the UTF-8 text of bytes) is not read at all:
 * it is judged credential material unread — refused at write, withheld whole
 * on read — so an over-long value can neither cost the judgment time nor hide
 * a credential from it.
 */
export const MAX_JUDGED_STRING_LENGTH = 64 * 1024;

/**
 * PEM private-key armour — `-----BEGIN PRIVATE KEY-----`, `RSA`, `EC`, `DSA`,
 * `ENCRYPTED`, `OPENSSH` and `PGP … BLOCK` forms included. Linear: each
 * candidate starts at a literal `-----BEGIN `, and its letter run ends at the
 * next `-`.
 */
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/i;

/** A PEM private-key block, from its BEGIN line to its END line — or to the end of the string when it has none. */
const PEM_PRIVATE_KEY_BLOCK_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----|$)/gi;

/**
 * Is a string read for `Name: value` header lines? A multi-line string is; a
 * single-line one only under a header-ish key (`headers: ['Authorization: …']`)
 * — a one-line `description: 'Password: provided via the secret store'` is prose.
 */
const readsHeaderLines = (value: string, headerish: boolean): boolean => headerish || value.includes('\n');

/** {@link embeddedCredentialOf} at a walk depth — a JSON-encoded string is walked one level deeper. */
function embeddedCredentialAt(value: string, depth: number, headerish = false): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (value.length > MAX_JUDGED_STRING_LENGTH) return `a value longer than ${MAX_JUDGED_STRING_LENGTH} characters, too long to judge`;
  const json = parsedJson(value);
  if (json !== undefined) {
    if (depth > CONTRACTLESS_CREDENTIAL_WALK_DEPTH) return 'a JSON-encoded value nested too deeply to judge';
    return collectFindings(json, depth + 1).length > 0 ? 'credential material inside a JSON-encoded string' : undefined;
  }
  if (PEM_PRIVATE_KEY_RE.test(value)) return 'a PEM private key';
  const url = urlLayout(value);
  if (url) {
    if (url.password !== undefined) return 'a userinfo password inside a URL';
    if (url.tokenUsername) return 'a token-shaped userinfo username inside a URL';
    if (queryPairs(value, url).some(isCredentialQueryPair)) return 'a credential query parameter inside a URL';
    if (fragmentPairs(value, url).some(isCredentialQueryPair)) return 'a credential parameter in a URL fragment';
    if (url.tail !== -1 && semicolonSegments(value.slice(url.tail + 1, url.queryStart)).some(isCredentialSegment)) {
      return "a credential property in a URL's `;key=value` tail";
    }
    return undefined;
  }
  if (ORACLE_THIN_USERINFO_RE.test(value)) return 'a userinfo password (`user/password@host`)';
  if (schemelessUserinfoAt(value) !== -1) return 'a userinfo password (`user:password@host`)';
  if (readsHeaderLines(value, headerish) && linesOf(value).some((line) => credentialHeaderLineName(line) !== undefined)) {
    return 'a credential header line (`Name: value`)';
  }
  return keyValueCredentialOf(value);
}

/**
 * The credential a string value carries EMBEDDED, named for the author, or
 * `undefined` when it carries none. Judged shapes:
 *
 *  - a JSON-encoded object or array (the string starts with `{` or `[`): it is
 *    parsed and walked exactly as a config is ({@link findContractlessCredentials});
 *  - a URL userinfo password (`scheme://user:pass@host`, `//user:pass@host`,
 *    `jdbc:mysql://user:pass@host`), a userinfo username with no password that
 *    looks like a token ({@link looksLikeSecretValue}: `https://ghp_…@host`), a
 *    URL query or fragment pair whose name is credential-shaped (`?password=`,
 *    `?api_key=`, `#access_token=`) or is `sig`, or whose `;key=value` run
 *    carries one;
 *  - a `;key=value` property tail after a URL's authority
 *    (`sqlserver://h;user=u;password=p`);
 *  - the Oracle thin-driver userinfo (`jdbc:oracle:thin:user/pass@host`);
 *  - a scheme-less userinfo password (`user:pass@host/db`);
 *  - a `Name: value` header line (one per line) whose name is
 *    credential-shaped (`Authorization: Bearer …`) — see below for when a
 *    string is read for header lines;
 *  - a libpq keyword/value pair (`host=h password=p`), found leniently;
 *  - a semicolon-delimited connection-string segment (`Server=h;Password=p`);
 *  - a form-encoded pair (`a=b&pass=c`).
 *
 *  - PEM private-key armour (`-----BEGIN … PRIVATE KEY-----`), anywhere in it.
 *
 * A string longer than {@link MAX_JUDGED_STRING_LENGTH} is not read: it is
 * judged credential material. A header line is read in a multi-line string,
 * or in a single-line one only with {@link EmbeddedCredentialOptions.headerish}.
 * A libpq or segment value starting with a SQL bind placeholder (`$1`, `?`,
 * `:name`) is none; an opaque URI scheme prefix (`mailto:`, `sip:`, …) is not
 * a userinfo username, and a time of day (`12:30@`) is no userinfo.
 * Every key inside a string is judged by {@link isCredentialShapedConfigKey},
 * and only a NON-EMPTY credential counts.
 */
export function embeddedCredentialOf(value: string, options?: EmbeddedCredentialOptions): string | undefined {
  return embeddedCredentialAt(value, 0, options?.headerish === true);
}

/** How {@link embeddedCredentialOf} and {@link redactEmbeddedCredentials} read a string. */
export interface EmbeddedCredentialOptions {
  /**
   * The string sits under a header-ish key (one of whose words is `header` or
   * `headers`), so a single-line string is read as a `Name: value` header line
   * too — a multi-line string always is. A finding's
   * {@link ContractlessCredentialFinding.headerish} carries this.
   */
  headerish?: boolean;
}

/**
 * The credential-shaped segment keys of a connection string — semicolon,
 * libpq, or a URL's `;key=value` tail — with a non-empty value, in order and
 * without repeats (`Server=h;Password=p` → `['Password']`).
 */
export function connectionStringCredentialKeys(value: string): string[] {
  if (typeof value !== 'string' || !value.includes('=')) return [];
  const url = urlLayout(value);
  const keys: string[] = [];
  const add = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };
  const fromSegments = (text: string) => {
    for (const segment of semicolonSegments(text)) if (isCredentialSegment(segment)) add((segment.key as string).trim());
  };
  if (url) {
    if (url.tail !== -1) fromSegments(value.slice(url.tail + 1, url.queryStart));
    return keys;
  }
  for (const pair of libpqPairs(value)) if (isCredentialLibpqPair(pair)) add(pair.key);
  fromSegments(value);
  return keys;
}

/** One rewrite pass of {@link redactEmbeddedCredentials}. */
function redactEmbeddedOnce(input: string, depth: number, headerish: boolean): string {
  if (input.length > MAX_JUDGED_STRING_LENGTH) return '';
  const json = parsedJson(input);
  if (json !== undefined) {
    if (depth > CONTRACTLESS_CREDENTIAL_WALK_DEPTH) return '';
    return JSON.stringify(withholdFindings(json, collectFindings(json, depth + 1), depth + 1));
  }
  // A PEM private key goes whole, armour included; the rest of the string is
  // judged as it would be without it.
  const value = PEM_PRIVATE_KEY_RE.test(input) ? input.replace(PEM_PRIVATE_KEY_BLOCK_RE, '') : input;
  const url = urlLayout(value);
  if (url) {
    const headEnd = url.tail === -1 ? url.queryStart : url.tail;
    let out: string;
    if (url.password !== undefined) {
      out = `${value.slice(0, url.authorityStart + value.slice(url.authorityStart, url.at).indexOf(':'))}@${value.slice(url.at + 1, headEnd)}`;
    } else if (url.tokenUsername) {
      out = `${value.slice(0, url.authorityStart)}${value.slice(url.at + 1, headEnd)}`;
    } else {
      out = value.slice(0, headEnd);
    }
    if (url.tail !== -1) {
      const rest = redactSemicolonSegments(value.slice(url.tail + 1, url.queryStart));
      if (rest !== '') out += `;${rest}`;
    }
    if (value[url.queryStart] === '?') {
      const kept = queryPairs(value, url).filter((pair) => !isCredentialQueryPair(pair));
      if (kept.length > 0) out += `?${kept.join('&')}`;
    } else if (url.hash === -1) {
      out += value.slice(url.queryStart);
    }
    if (url.hash !== -1) {
      const fragment = fragmentPairs(value, url);
      if (!fragment.some(isCredentialQueryPair)) out += value.slice(url.hash);
      else {
        const kept = fragment.filter((pair) => !isCredentialQueryPair(pair));
        if (kept.length > 0) out += `#${kept.join('&')}`;
      }
    }
    return out;
  }
  if (ORACLE_THIN_USERINFO_RE.test(value)) return value.replace(ORACLE_THIN_USERINFO_RE, '$1$2@');
  const userinfoAt = schemelessUserinfoAt(value);
  if (userinfoAt !== -1) return value.slice(0, userinfoAt) + value.slice(userinfoAt).replace(SCHEMELESS_USERINFO_RE, '$1@');
  let out = value;
  if (readsHeaderLines(out, headerish) && linesOf(out).some((line) => credentialHeaderLineName(line) !== undefined)) {
    out = out
      .split('\n')
      .map((line) => {
        const cr = line.endsWith('\r') ? '\r' : '';
        const name = credentialHeaderLineName(cr ? line.slice(0, -1) : line);
        return name === undefined ? line : `${name}:${cr}`;
      })
      .join('\n');
  }
  return redactKeyValueCredentials(out);
}

/** {@link redactEmbeddedCredentials} at a walk depth (see {@link embeddedCredentialAt}). */
function redactEmbeddedAt(value: string, depth: number, headerish = false): string {
  if (embeddedCredentialAt(value, depth, headerish) === undefined) return value;
  const out = redactEmbeddedOnce(value, depth, headerish);
  // The invariant the read door rests on: what it serves carries no
  // credential. A string the rewrite cannot clear is withheld whole.
  return embeddedCredentialAt(out, depth, headerish) === undefined ? out : '';
}

/**
 * {@link embeddedCredentialOf}'s inverse for the read path: the string with
 * every embedded credential removed and everything else kept — the URL's
 * username and host (`user@host`), the non-credential segments, pairs, query
 * and fragment parameters, a header line's name, a JSON-encoded value's
 * non-credential members. Dropped, not masked: a mask would round-trip back
 * as a literal new credential. Returns the input unchanged when it carries
 * none; what it returns never carries one ({@link embeddedCredentialOf}
 * answers `undefined` for it) — a string the rewrite cannot clear comes back
 * empty.
 */
export function redactEmbeddedCredentials(value: string, options?: EmbeddedCredentialOptions): string {
  return redactEmbeddedAt(value, 0, options?.headerish === true);
}

// ---------------------------------------------------------------------------
// The one walk both doors read
// ---------------------------------------------------------------------------

/** A position in a contractless driver's `config` that holds credential material. */
export interface ContractlessCredentialFinding {
  /** Segments from the config root; an array element's index is its decimal string. */
  path: readonly string[];
  /**
   * `named` — the value sits under a credential position (a credential-shaped
   * key, a leaf inside a credential-shaped object, a header pair's or tuple's
   * value, binary data there or carrying an embedded credential) and is
   * withheld whole; `embedded` — a string carrying a credential
   * ({@link embeddedCredentialOf}), rewritten without it; `depth` — a subtree
   * too deep to judge, and `opaque` — a `Map` or `Set`, whose entries the walk
   * does not read: both doors treat these as credential material rather than
   * skip them.
   */
  kind: 'named' | 'embedded' | 'depth' | 'opaque';
  /** The value found there, as stored. */
  value: unknown;
  /** For `embedded`, what was found, for the author. */
  what?: string;
  /**
   * For `embedded`: `true` when the string sits under a header-ish key and was
   * read as a single-line `Name: value` header line too — hand it to
   * {@link embeddedCredentialOf} as {@link EmbeddedCredentialOptions.headerish}
   * to judge the string the same way.
   */
  headerish?: true;
}

/** Deeper than this, a subtree is a {@link ContractlessCredentialFinding} of kind `depth`. */
export const CONTRACTLESS_CREDENTIAL_WALK_DEPTH = 16;

/** The keys that label a `{ name, value }` pair; EVERY one present is judged (`{ key: 'Authorization', value }`). */
const PAIR_LABEL_KEYS = ['name', 'key', 'header', 'headerName'] as const;

/** Is a value under a credential position credential material? Booleans, `null` and empties are not. */
function holdsCredentialValue(value: unknown): boolean {
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  if (isBinary(value)) return binaryLength(value) > 0;
  if (Array.isArray(value)) {
    return value.some((element) => (element && typeof element === 'object' && !isBinary(element) ? false : holdsCredentialValue(element)));
  }
  return false;
}

/** A `Buffer`, a typed array, a `DataView` or an `ArrayBuffer` — bytes, judged as ONE value. */
const isBinary = (value: unknown): value is ArrayBufferView | ArrayBuffer =>
  !!value && typeof value === 'object' && (ArrayBuffer.isView(value) || value instanceof ArrayBuffer);

const binaryLength = (value: ArrayBufferView | ArrayBuffer): number => value.byteLength;

/** The bytes as UTF-8 text, for the embedded-credential judgment. */
function binaryText(value: ArrayBufferView | ArrayBuffer): string {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Does a string under a bare `key` look like key material rather than a name?
 * {@link looksLikeSecretValue}, or — wider, for a bare `key` only — at least
 * 16 characters of hexadecimal holding a letter (`deadbeefcafebabe`), or
 * digit-free text whose case flips like random text rather than camel case or
 * a path — 30% to 70% of its letters upper-case and at least four
 * lower-to-upper steps — that is either base64 (at least 16 characters of
 * `A`–`Z`, `a`–`z`, `+`, `/`, up to two `=` of padding, a length divisible by
 * four, and a `+`, a `/` or padding) or at least 24 letters (`-` and `_`
 * allowed).
 * `email`, `customerEmailAddress` and `XMLHttpRequestURLBuilder` do not.
 */
function looksLikeBareKeyMaterial(value: string): boolean {
  if (looksLikeSecretValue(value)) return true;
  if (value.length < 16) return false;
  if (/^[0-9a-f]+$/i.test(value) && /[a-f]/i.test(value)) return true;
  // Random text flips case like coin tosses; camel case and paths do not.
  let upper = 0;
  let letters = 0;
  let lowerToUpper = 0;
  let prev = '';
  for (const c of value) {
    const isUpper = c >= 'A' && c <= 'Z';
    if (isUpper || (c >= 'a' && c <= 'z')) letters += 1;
    if (isUpper) {
      upper += 1;
      if (prev >= 'a' && prev <= 'z') lowerToUpper += 1;
    }
    prev = c;
  }
  const ratio = letters === 0 ? 0 : upper / letters;
  if (ratio < 0.3 || ratio > 0.7 || lowerToUpper < 4) return false;
  if (/^[A-Za-z+/]+={0,2}$/.test(value) && value.length % 4 === 0 && /[+/=]/.test(value)) return true;
  return value.length >= 24 && /^[A-Za-z_-]+$/.test(value);
}

/** Does a value under a bare `key` look like key material rather than a name (`{ key: 'email' }`)? */
function bareKeyHoldsSecret(value: unknown): boolean {
  if (typeof value === 'string') return looksLikeBareKeyMaterial(value);
  if (isBinary(value)) return binaryLength(value) > 0;
  if (Array.isArray(value)) return value.some((element) => typeof element === 'string' && looksLikeBareKeyMaterial(element));
  return false;
}

/** Where a node sits, for the judgment of its own key and leaves. */
interface WalkContext {
  /** Inside an object reached under a credential-shaped key — never reset by a descriptor key on the way down. */
  enclosing: boolean;
  /** The key leaf values are judged by: an array element's is its array's key. */
  leafKey: string | undefined;
  /** The key of the object (or of the array holding the object) the node sits in. */
  holderKey: string | undefined;
  /** The node's object is an ELEMENT of a list (`headers: [{ key, value }]`), not a map (`headers: { key }`). */
  element: boolean;
}

/**
 * The positions of a list that hold a header's VALUE:
 *  - a `[name, value, …]` tuple whose name is credential-shaped, inside a list
 *    (two or more elements) or directly under a header-ish key (an odd number
 *    of elements, or two) — every element after the name;
 *  - a flat `[name, value, name, value]` list directly under a header-ish key
 *    (the raw-headers form) — the element after each credential-shaped name at
 *    an even position.
 */
function headerValuePositions(key: string | undefined, list: readonly unknown[]): Set<number> {
  const marked = new Set<number>();
  const headerish = key !== undefined && isHeaderishKey(key);
  if (key !== undefined && !headerish) return marked;
  const first = list[0];
  // Directly under a header-ish key, an even-length list reads as pairs
  // (`rawHeaders`), an odd-length one as a tuple.
  const tuple = headerish ? list.length % 2 === 1 : list.length >= 2;
  if (tuple && typeof first === 'string' && isCredentialShapedConfigKey(first)) {
    for (let i = 1; i < list.length; i += 1) marked.add(i);
  }
  if (headerish) {
    for (let i = 0; i + 1 < list.length; i += 2) {
      const name = list[i];
      if (typeof name === 'string' && isCredentialShapedConfigKey(name)) marked.add(i + 1);
    }
  }
  return marked;
}

/** Every finding in a value, the root being an object or an array, starting at `depth`. */
function collectFindings(root: unknown, depth: number): ContractlessCredentialFinding[] {
  const out: ContractlessCredentialFinding[] = [];

  const visit = (key: string | undefined, value: unknown, path: string[], ctx: WalkContext, at: number): void => {
    const leafKey = key ?? ctx.leafKey;
    let named = key !== undefined && isCredentialShapedConfigKey(key);
    // A bare `key` is credential-shaped only where it can mean key material:
    // inside a credential-shaped or TLS holder, in a header MAP (`headers:
    // { key: … }`, the header named `key` — not a list element, which is a
    // pair's label: `headers: [{ key: 'Authorization' }]`), or holding a value
    // that looks like key material — never `{ key: 'email' }`.
    if (named && isBareKeyName(key as string) && !ctx.enclosing) {
      const holder = ctx.holderKey;
      named = (holder !== undefined
        && (isCredentialShapedConfigKey(holder) || (isHeaderishKey(holder) && !ctx.element) || isKeyMaterialHolder(holder)))
        || bareKeyHoldsSecret(value);
    }
    // The descriptor exemption applies to LEAF values only (a string, a
    // number, bytes, a list of them); an object below a descriptor key keeps
    // the enclosing credential context.
    const leafCredential = named || (ctx.enclosing && !(leafKey !== undefined && isDescriptorLeafKey(leafKey)));
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (leafCredential) {
        if (value !== '') out.push({ path, kind: 'named', value });
        return;
      }
      const headerish = isHeaderishKey(leafKey) || isHeaderishKey(ctx.holderKey);
      const what = embeddedCredentialAt(value, at, headerish);
      if (what) out.push({ path, kind: 'embedded', value, what, ...(headerish ? { headerish: true as const } : {}) });
      return;
    }
    if (typeof value !== 'object') {
      if (leafCredential && holdsCredentialValue(value)) out.push({ path, kind: 'named', value });
      return;
    }
    if (isBinary(value)) {
      const judged = leafCredential
        || binaryLength(value) > MAX_JUDGED_STRING_LENGTH
        || embeddedCredentialAt(binaryText(value), at, isHeaderishKey(leafKey) || isHeaderishKey(ctx.holderKey)) !== undefined;
      if (leafCredential ? binaryLength(value) > 0 : judged) {
        out.push({ path, kind: 'named', value });
      }
      return;
    }
    if (at > CONTRACTLESS_CREDENTIAL_WALK_DEPTH) {
      out.push({ path, kind: 'depth', value });
      return;
    }
    if (value instanceof Map || value instanceof Set) {
      out.push({ path, kind: 'opaque', value });
      return;
    }
    const enclosing = ctx.enclosing || named;
    const holderKey = key ?? ctx.holderKey;
    if (Array.isArray(value)) {
      if (leafCredential && holdsCredentialValue(value)) {
        out.push({ path, kind: 'named', value });
        return;
      }
      const marked = headerValuePositions(key, value);
      value.forEach((element, index) => {
        const elementPath = [...path, String(index)];
        if (marked.has(index)) {
          if (holdsCredentialValue([element]) || (element && typeof element === 'object')) {
            out.push({ path: elementPath, kind: 'named', value: element });
          }
          return;
        }
        visit(undefined, element, elementPath, { enclosing, leafKey, holderKey, element: false }, at + 1);
      });
      return;
    }
    walkObject(value as Record<string, unknown>, path, { enclosing, leafKey: undefined, holderKey, element: key === undefined }, at + 1);
  };

  const walkObject = (node: Record<string, unknown>, path: string[], ctx: WalkContext, at: number): void => {
    const labels = PAIR_LABEL_KEYS.filter((k) => typeof node[k] === 'string');
    const isPair = labels.length > 0 && 'value' in node;
    const pairCredential = isPair && labels.some((k) => isCredentialShapedConfigKey(node[k] as string));
    for (const [key, value] of Object.entries(node)) {
      const childPath = [...path, key];
      if (isPair && (labels as readonly string[]).includes(key)) {
        // A label names the pair; it is judged only for an embedded credential.
        const headerish = isHeaderishKey(ctx.holderKey);
        const what = embeddedCredentialAt(value as string, at, headerish);
        if (what) out.push({ path: childPath, kind: 'embedded', value, what, ...(headerish ? { headerish: true as const } : {}) });
        continue;
      }
      if (isPair && key === 'value' && pairCredential) {
        if (holdsCredentialValue(value) || (value && typeof value === 'object')) out.push({ path: childPath, kind: 'named', value });
        continue;
      }
      visit(key, value, childPath, ctx, at);
    }
  };

  const top: WalkContext = { enclosing: false, leafKey: undefined, holderKey: undefined, element: false };
  if (Array.isArray(root)) visit(undefined, root, [], top, depth);
  else if (root && typeof root === 'object' && !isBinary(root) && !(root instanceof Map) && !(root instanceof Set)) {
    walkObject(root as Record<string, unknown>, [], top, depth);
  }
  return out;
}

/**
 * Every position in a contractless driver's `config` that holds credential
 * material — the ONE judgment the write door refuses and the read door
 * withholds:
 *
 *  - a value under a credential-shaped key ({@link isCredentialShapedConfigKey}):
 *    a non-empty string, a number, non-empty bytes (a `Buffer` or typed array,
 *    judged as ONE value), or an array holding a non-empty primitive
 *    (`apiKeys: ['k1', 'k2']`). A boolean is a flag, never a secret. A bare
 *    `key` counts only inside a credential-shaped, header-ish or TLS holder
 *    ({@link isKeyMaterialHolder}), or holding a value that looks like key
 *    material ({@link looksLikeBareKeyMaterial});
 *  - inside an object reached under a credential-shaped key (`credentials`,
 *    `auth`), every leaf except a descriptor or identity (`type`, `clientId`,
 *    `user`, …) — an OBJECT below a descriptor key stays inside that context;
 *  - the `value` of a `{ name, value }` pair whose label — ANY of `name`,
 *    `key`, `header`, `headerName` — is credential-shaped: a headers list
 *    carrying `Authorization`, `X-API-Key` or `Cookie`;
 *  - every element after the name of a `[name, value, …]` tuple whose name is
 *    credential-shaped, inside a list or directly under a header-ish key, and
 *    the element after each credential-shaped name at an even position of a
 *    flat list directly under a header-ish key (`rawHeaders`);
 *  - a string carrying an embedded credential ({@link embeddedCredentialOf}),
 *    wherever it sits — array elements and pair labels included — and bytes
 *    whose UTF-8 text carries one;
 *  - a subtree past {@link CONTRACTLESS_CREDENTIAL_WALK_DEPTH}, and a `Map` or
 *    `Set` anywhere, judged whole.
 *
 * The walk enters the object elements of arrays (`servers: [{ host, password }]`)
 * and judges them by key; plain row data with no credential-shaped key is not
 * a finding.
 */
export function findContractlessCredentials(config: unknown): ContractlessCredentialFinding[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  return collectFindings(config, 0);
}

/**
 * Withhold `findings` from `root` IN PLACE (the caller owns `root`): a string
 * finding of kind `embedded` is rewritten without its credential, every other
 * finding is dropped — a key deleted, an array element spliced only from the
 * END of its array (so no sibling shifts and a write-path inverse restores each
 * withheld element at its own index), nulled when siblings follow it. Returns
 * `root`.
 */
function withholdFindings<T>(root: T, findings: readonly ContractlessCredentialFinding[], depth: number): T {
  const parentOf = (path: readonly string[]): unknown => {
    let node: unknown = root;
    for (const segment of path.slice(0, -1)) {
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  };
  for (const finding of findings) {
    if (finding.kind !== 'embedded') continue;
    const parent = parentOf(finding.path) as Record<string, unknown> | undefined;
    const leaf = finding.path[finding.path.length - 1] as string;
    if (parent && typeof parent[leaf] === 'string') {
      parent[leaf] = redactEmbeddedAt(parent[leaf] as string, depth + Math.max(0, finding.path.length - 1), finding.headerish === true);
    }
  }
  // Drops deepest-first and, inside one array, highest index first — so a
  // drop never shifts a position still to be visited.
  const drops = findings
    .filter((finding) => finding.kind !== 'embedded')
    .sort((a, b) => {
      if (a.path.length !== b.path.length) return b.path.length - a.path.length;
      return Number(b.path[b.path.length - 1]) - Number(a.path[a.path.length - 1]) || 0;
    });
  for (const finding of drops) {
    const parent = parentOf(finding.path);
    const leaf = finding.path[finding.path.length - 1] as string;
    if (Array.isArray(parent)) {
      if (Number(leaf) === parent.length - 1) parent.splice(Number(leaf), 1);
      else parent[Number(leaf)] = null;
    } else if (parent && typeof parent === 'object' && !isBinary(parent)) {
      delete (parent as Record<string, unknown>)[leaf];
    }
  }
  return root;
}

/**
 * The read half of the contractless-driver judgment: `config` with every
 * position {@link findContractlessCredentials} reports withheld — the SAME
 * walk the write door refuses by — and those positions, sorted. A value under
 * a credential position, a subtree too deep to judge, and a `Map` or `Set` are
 * dropped (an array element is spliced from the end of its array, or nulled
 * when siblings follow it); a string with an embedded credential is rewritten
 * without it ({@link redactEmbeddedCredentials}). Every position is reported,
 * array indices included, so a write-path inverse can restore exactly what was
 * withheld. The projection is judged again until it holds no finding — what
 * is served is what an untouched Save hands the write door — and one that has
 * not settled after {@link MAX_WITHHOLD_PASSES} passes is withheld whole.
 * Pure: the input is never mutated, and returned by reference when nothing is
 * withheld.
 */
export function withholdContractlessCredentials(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  paths: (readonly string[])[];
} {
  let findings = findContractlessCredentials(config);
  if (findings.length === 0) return { config, paths: [] };
  let out = structuredClone(config);
  const seen = new Map<string, readonly string[]>();
  // What is served must itself hold no finding — it is what an untouched Save
  // hands the write door. A withheld position can leave a sibling that reads
  // as credential material on its own (a pair's `key` label without its
  // `value`, directly under a header-ish key), so the projection is judged
  // again until it is clean; each pass only removes, and a projection that
  // will not settle is withheld whole.
  for (let pass = 0; findings.length > 0; pass += 1) {
    for (const finding of findings) seen.set(JSON.stringify(finding.path), finding.path);
    if (pass === MAX_WITHHOLD_PASSES) {
      for (const key of Object.keys(out)) seen.set(JSON.stringify([key]), [key]);
      out = {};
      break;
    }
    out = withholdFindings(out, findings, 0);
    findings = findContractlessCredentials(out);
  }
  const paths = [...seen.values()].sort((a, b) => (a.join('.') < b.join('.') ? -1 : a.join('.') > b.join('.') ? 1 : 0));
  return { config: out, paths };
}

/** Past this many passes, a projection that still holds a finding is withheld whole (see {@link withholdContractlessCredentials}). */
const MAX_WITHHOLD_PASSES = 8;
