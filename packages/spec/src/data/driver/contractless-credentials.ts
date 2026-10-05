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

import { CREDENTIAL_KEY_SPELLINGS, urlUserinfoPassword } from './common.zod';

// ---------------------------------------------------------------------------
// The key-name judgment
// ---------------------------------------------------------------------------

/**
 * A key split into lower-case words at separators and camel-case boundaries:
 * `secretAccessKey` → `secret access key`, `X-API-Key` → `x api key`,
 * `client_secret` → `client secret`. Judging WORDS rather than substrings is
 * what keeps `bypass`, `passive`, `primaryKey` and `partitionKey` out while
 * `pass`, `key` and `apiKey` are in.
 */
function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

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
]);

/** `signature` as the last word is credential material beside one of these (`sharedAccessSignature`). */
const SIGNATURE_QUALIFIERS: ReadonlySet<string> = new Set(['shared', 'access', 'sas', 'hmac']);

/**
 * Trailing words that qualify a credential stem without changing what it is
 * (`apiKeyValue`, `tokenValue`, `privateKeyPem`, `keyJson`).
 */
const CREDENTIAL_TRAILING_QUALIFIERS: ReadonlySet<string> = new Set(['value', 'values', 'pem', 'json', 'b64', 'base64']);

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
];

/** Every stem a trailing `s` may pluralize (`apiKeys`, `tokens`, `credentials`). */
const PLURALIZABLE_STEMS: ReadonlySet<string> = new Set([
  ...CREDENTIAL_WORDS_ANYWHERE,
  ...CREDENTIAL_WORDS_LAST,
  'key',
  'signature',
]);

function singular(word: string): string {
  return word.endsWith('s') && PLURALIZABLE_STEMS.has(word.slice(0, -1)) ? word.slice(0, -1) : word;
}

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
  const candidates = stem.endsWith('s') ? [stem, stem.slice(0, -1)] : [stem];
  return candidates.some((candidate) =>
    PLURALIZABLE_STEMS.has(candidate)
    || [...CREDENTIAL_WORDS_ANYWHERE].some((fragment) => candidate.includes(fragment))
    || FOLDED_CREDENTIAL_ENDINGS.some((ending) => candidate.endsWith(ending)),
  ) || word.endsWith('serviceaccountjson') || word.endsWith('serviceaccountpem');
}

/**
 * Is `key` spelled like a credential — judged on its WHOLE name, case- and
 * separator-insensitively?
 *
 * The key is split into words ({@link wordsOf}). It is NOT credential-shaped
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
 * A key with one word only (`APIKEY`, `accesstoken`) is judged on its folded
 * spelling against the same stems and {@link FOLDED_CREDENTIAL_ENDINGS}.
 */
export function isCredentialShapedConfigKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  const words = wordsOf(key);
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

  const judged = stem.map(singular);
  if (judged.some((word) => CREDENTIAL_WORDS_ANYWHERE.has(word))) return true;
  const head = judged[judged.length - 1] as string;
  const before = judged.slice(0, -1);
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
  const words = wordsOf(key);
  const last = words[words.length - 1];
  if (last === undefined) return false;
  return CREDENTIAL_DESCRIPTOR_ENDINGS.has(last) || IDENTITY_LEAF_WORDS.has(last) || last.endsWith('less');
}

// ---------------------------------------------------------------------------
// Credential material embedded in a string value
// ---------------------------------------------------------------------------

/** `scheme://…`. */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;

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

const isCredentialSegment = (segment: ConnectionStringSegment): boolean =>
  segment.key !== undefined && segment.value !== '' && isCredentialShapedConfigKey(segment.key.trim());

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

/**
 * Parse a libpq keyword/value connection string (`host=h port=5432
 * password='a b'`): whitespace-separated pairs, a value single-quoted with
 * `\'` / `\\` escapes or a run of non-space characters. `undefined` when the
 * string is not entirely made of such pairs.
 */
function libpqPairs(value: string): LibpqPair[] | undefined {
  const out: LibpqPair[] = [];
  let i = 0;
  const ws = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  while (i < value.length) {
    while (ws(value[i])) i += 1;
    if (i >= value.length) break;
    const start = i;
    const keyMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(i));
    if (!keyMatch) return undefined;
    const key = keyMatch[0];
    i += key.length;
    while (ws(value[i])) i += 1;
    if (value[i] !== '=') return undefined;
    i += 1;
    while (ws(value[i])) i += 1;
    let raw = '';
    if (value[i] === "'") {
      i += 1;
      let closed = false;
      while (i < value.length) {
        if (value[i] === '\\' && i + 1 < value.length) {
          raw += value[i + 1];
          i += 2;
          continue;
        }
        if (value[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        raw += value[i];
        i += 1;
      }
      if (!closed) return undefined;
    } else {
      while (i < value.length && !ws(value[i])) {
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
  return out.length > 0 ? out : undefined;
}

/**
 * `user:password@host…` with no scheme — the userinfo half of a URL written
 * without one. The password group allows `@` and is greedy, so the match ends
 * at the LAST `@` before the host (a malformed literal `@` must not decide how
 * much leaks), and it excludes `/`, so a `scheme://` URL never matches.
 */
const SCHEMELESS_USERINFO_RE = /^([^\s/?#@:;=]+):([^\s/?#]+)@(?=[^\s/?#@]*[A-Za-z0-9])/;

/** The query-string credential pairs of a URL-ish string, judged by the key-name predicate. */
function credentialQueryPairs(value: string): string[] {
  const hashIdx = value.indexOf('#');
  const head = hashIdx === -1 ? value : value.slice(0, hashIdx);
  const queryIdx = head.indexOf('?');
  if (queryIdx === -1) return [];
  return head
    .slice(queryIdx + 1)
    .split('&')
    .filter((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0 || eq === pair.length - 1) return false;
      let key = pair.slice(0, eq);
      try {
        key = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        /* keep the raw key */
      }
      return isCredentialShapedConfigKey(key);
    });
}

/** Where a URL's `;key=value` tail starts (`sqlserver://h;user=u;password=p`), or `-1`. */
function urlSegmentTailIndex(value: string): number {
  if (!URL_SCHEME_RE.test(value)) return -1;
  const authorityStart = value.indexOf('://') + 3;
  return value.indexOf(';', authorityStart);
}

/**
 * The credential a string value carries EMBEDDED, named for the author, or
 * `undefined` when it carries none. Judged shapes:
 *
 *  - a URL userinfo password (`scheme://user:pass@host`), or a credential-named
 *    query parameter (`?password=`, `?api_key=`, `?access_token=`);
 *  - a `;key=value` property tail after a URL's authority
 *    (`sqlserver://h;user=u;password=p`);
 *  - a semicolon-delimited connection string (`Server=h;Password=p`);
 *  - a libpq keyword/value string (`host=h password=p`);
 *  - a scheme-less userinfo password (`user:pass@host/db`).
 *
 * Every key inside a string is judged by {@link isCredentialShapedConfigKey},
 * and only a NON-EMPTY credential counts.
 */
export function embeddedCredentialOf(value: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (URL_SCHEME_RE.test(value)) {
    if (urlUserinfoPassword(value) !== undefined) return 'a userinfo password inside a URL';
    const tail = urlSegmentTailIndex(value);
    const head = tail === -1 ? value : value.slice(0, tail);
    if (credentialQueryPairs(head).length > 0) return 'a credential query parameter inside a URL';
    if (tail !== -1 && semicolonSegments(value.slice(tail + 1)).some(isCredentialSegment)) {
      return "a credential property in a URL's `;key=value` tail";
    }
    return undefined;
  }
  if (SCHEMELESS_USERINFO_RE.test(value)) return 'a userinfo password (`user:password@host`)';
  if (!value.includes('=')) return undefined;
  if (!value.includes(';')) {
    const pairs = libpqPairs(value);
    if (pairs) {
      return pairs.some((pair) => pair.value !== '' && isCredentialShapedConfigKey(pair.key))
        ? 'a credential keyword inside a keyword/value connection string'
        : undefined;
    }
  }
  return semicolonSegments(value).some(isCredentialSegment)
    ? 'a credential segment inside a connection string'
    : undefined;
}

/**
 * The credential-shaped segment keys of a connection string — semicolon,
 * libpq, or a URL's `;key=value` tail — with a non-empty value, in order
 * (`Server=h;Password=p` → `['Password']`).
 */
export function connectionStringCredentialKeys(value: string): string[] {
  if (typeof value !== 'string' || !value.includes('=')) return [];
  if (URL_SCHEME_RE.test(value)) {
    const tail = urlSegmentTailIndex(value);
    if (tail === -1) return [];
    return semicolonSegments(value.slice(tail + 1)).filter(isCredentialSegment).map((s) => (s.key as string).trim());
  }
  if (!value.includes(';')) {
    const pairs = libpqPairs(value);
    if (pairs) return pairs.filter((p) => p.value !== '' && isCredentialShapedConfigKey(p.key)).map((p) => p.key);
  }
  return semicolonSegments(value).filter(isCredentialSegment).map((s) => (s.key as string).trim());
}

/**
 * {@link embeddedCredentialOf}'s inverse for the read path: the string with
 * every embedded credential removed and everything else kept — the URL's
 * username and host (`user@host`), the non-credential segments and pairs.
 * Dropped, not masked: a mask would round-trip back as a literal new
 * credential. Returns the input unchanged when it carries none.
 */
export function redactEmbeddedCredentials(value: string): string {
  if (embeddedCredentialOf(value) === undefined) return value;
  if (URL_SCHEME_RE.test(value)) {
    const tail = urlSegmentTailIndex(value);
    let head = tail === -1 ? value : value.slice(0, tail);
    head = head.replace(/^([a-z][a-z0-9+.\-]*:\/\/)([^/?#@:]*)(:[^/?#]*)@/i, (_m, scheme: string, user: string) => `${scheme}${user}@`);
    const hashIdx = head.indexOf('#');
    const beforeHash = hashIdx === -1 ? head : head.slice(0, hashIdx);
    const fragment = hashIdx === -1 ? '' : head.slice(hashIdx);
    const queryIdx = beforeHash.indexOf('?');
    if (queryIdx !== -1) {
      const credential = new Set(credentialQueryPairs(beforeHash));
      const kept = beforeHash.slice(queryIdx + 1).split('&').filter((pair) => !credential.has(pair));
      const base = beforeHash.slice(0, queryIdx);
      head = `${kept.length > 0 ? `${base}?${kept.join('&')}` : base}${fragment}`;
    }
    if (tail === -1) return head;
    const rest = redactSemicolonSegments(value.slice(tail + 1));
    return rest === '' ? head : `${head};${rest}`;
  }
  if (SCHEMELESS_USERINFO_RE.test(value)) return value.replace(SCHEMELESS_USERINFO_RE, '$1@');
  if (!value.includes(';')) {
    const pairs = libpqPairs(value);
    if (pairs) {
      return pairs
        .filter((p) => !(p.value !== '' && isCredentialShapedConfigKey(p.key)))
        .map((p) => value.slice(p.start, p.end))
        .join(' ');
    }
  }
  return redactSemicolonSegments(value);
}

// ---------------------------------------------------------------------------
// The one walk both doors read
// ---------------------------------------------------------------------------

/** A position in a contractless driver's `config` that holds credential material. */
export interface ContractlessCredentialFinding {
  /** Segments from the config root; an array element's index is its decimal string. */
  path: readonly string[];
  /**
   * `named` — the value sits under a credential-shaped key (or a non-descriptor
   * leaf inside a credential-shaped object, or the `value` of a `{ name, value }`
   * pair whose name is credential-shaped); `embedded` — a string carrying a
   * credential ({@link embeddedCredentialOf}); `depth` — a subtree too deep to
   * judge, which both doors treat as credential material rather than skip.
   */
  kind: 'named' | 'embedded' | 'depth';
  /** The value found there, as stored. */
  value: unknown;
  /** For `embedded`, what was found, for the author. */
  what?: string;
}

/** Deeper than this, a subtree is a {@link ContractlessCredentialFinding} of kind `depth`. */
export const CONTRACTLESS_CREDENTIAL_WALK_DEPTH = 16;

const PAIR_LABEL_KEYS = ['name', 'key', 'header', 'headerName'] as const;

/** Is a value under a credential position credential material? Booleans, `null` and empties are not. */
function holdsCredentialValue(value: unknown): boolean {
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  if (Array.isArray(value)) {
    return value.some((element) => (element && typeof element === 'object' ? false : holdsCredentialValue(element)));
  }
  return false;
}

/**
 * Every position in a contractless driver's `config` that holds credential
 * material — the ONE judgment the write door refuses and the read door
 * withholds:
 *
 *  - a value under a credential-shaped key ({@link isCredentialShapedConfigKey}):
 *    a non-empty string, a number, or an array holding a non-empty primitive
 *    (`apiKeys: ['k1', 'k2']`). A boolean is a flag, never a secret;
 *  - inside an object reached under a credential-shaped key (`credentials`,
 *    `auth`), every such leaf except a descriptor or identity
 *    (`type`, `clientId`, `user`, …);
 *  - the `value` of a `{ name, value }` pair (also `key` / `header` /
 *    `headerName`) whose name is credential-shaped — a headers list carrying
 *    `Authorization`, `X-API-Key` or `Cookie`;
 *  - a string carrying an embedded credential ({@link embeddedCredentialOf}),
 *    wherever it sits — array elements included;
 *  - a subtree past {@link CONTRACTLESS_CREDENTIAL_WALK_DEPTH}, judged whole.
 *
 * The walk enters the object elements of arrays (`servers: [{ host, password }]`)
 * and judges them by key; plain row data with no credential-shaped key is not
 * a finding.
 */
export function findContractlessCredentials(config: unknown): ContractlessCredentialFinding[] {
  const out: ContractlessCredentialFinding[] = [];
  const visit = (key: string | undefined, value: unknown, path: string[], enclosing: boolean, depth: number): void => {
    const named = key !== undefined && isCredentialShapedConfigKey(key);
    const credential = named || (enclosing && !(key !== undefined && isDescriptorLeafKey(key)));
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (credential) {
        if (value !== '') out.push({ path, kind: 'named', value });
        return;
      }
      const what = embeddedCredentialOf(value);
      if (what) out.push({ path, kind: 'embedded', value, what });
      return;
    }
    if (typeof value !== 'object') {
      if (credential && holdsCredentialValue(value)) out.push({ path, kind: 'named', value });
      return;
    }
    if (depth > CONTRACTLESS_CREDENTIAL_WALK_DEPTH) {
      out.push({ path, kind: 'depth', value });
      return;
    }
    if (Array.isArray(value)) {
      if (credential && holdsCredentialValue(value)) {
        out.push({ path, kind: 'named', value });
        return;
      }
      value.forEach((element, index) => visit(undefined, element, [...path, String(index)], credential, depth + 1));
      return;
    }
    walkObject(value as Record<string, unknown>, path, credential, depth + 1);
  };
  const walkObject = (node: Record<string, unknown>, path: string[], enclosing: boolean, depth: number): void => {
    const labelKey = PAIR_LABEL_KEYS.find((k) => typeof node[k] === 'string');
    const isPair = labelKey !== undefined && 'value' in node;
    const pairCredential = isPair && isCredentialShapedConfigKey(node[labelKey as string] as string);
    for (const [key, value] of Object.entries(node)) {
      if (isPair && key === labelKey) continue;
      if (isPair && key === 'value' && pairCredential) {
        if (holdsCredentialValue(value) || (value && typeof value === 'object')) out.push({ path: [...path, key], kind: 'named', value });
        continue;
      }
      visit(key, value, [...path, key], enclosing, depth);
    }
  };
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    walkObject(config as Record<string, unknown>, [], false, 0);
  }
  return out;
}
