// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A read-only IMAP4rev1 session (RFC 3501): connect, authenticate, open one
 * folder READ-ONLY, list its messages by UID, fetch them, log out.
 *
 * Read-only is a guarantee, not a habit. The folder is opened with `EXAMINE`,
 * never `SELECT`, and bodies are fetched with `BODY.PEEK[]`, never `BODY[]`, so
 * nothing this session does sets `\Seen` or changes the mailbox in any other
 * way: the platform mirrors a mailbox, it does not process it (write-back is a
 * separate, later capability).
 *
 * Commands run one at a time; the server's untagged responses are collected
 * for the command they arrive under, and anything a command did not ask for
 * (a flag change another client made, a new message's EXISTS) is ignored.
 */

import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { MailAccount, MailCredential, MailCredentialProvider } from './account.js';
import { ImapError, type ImapErrorKind } from './imap-error.js';
import {
  ImapResponseReader,
  encodeMailboxName,
  imapAstring,
  parseImapValues,
  parseInternalDate,
  type ImapArgument,
  type ImapResponseParts,
  type ImapValue,
} from './imap-wire.js';

/** How long the server may stay silent before the session is abandoned (ms). */
export const DEFAULT_IMAP_TIMEOUT_MS = 60_000;
/** The largest literal (one message body, in practice) a session accepts, in bytes. */
export const DEFAULT_IMAP_MAX_LITERAL_BYTES = 64 * 1024 * 1024;
/** The longest response line a session accepts, in bytes. */
export const IMAP_MAX_LINE_BYTES = 4 * 1024 * 1024;
/**
 * The most a session keeps of the untagged responses to ONE command, in
 * bytes: their lines and literals, plus {@link IMAP_RESPONSE_OVERHEAD_BYTES}
 * per response for what holding it costs. Listing a 100,000-message folder
 * keeps about 30 MB; the bound refuses a server that streams untagged
 * responses before its tagged answer forever, however slowly.
 */
export const DEFAULT_IMAP_MAX_COMMAND_BYTES = 128 * 1024 * 1024;
/** What one kept response is charged beyond its own bytes. */
export const IMAP_RESPONSE_OVERHEAD_BYTES = 256;

/** How to open a session. */
export interface ImapSessionOptions {
  account: MailAccount;
  credentials: MailCredentialProvider;
  /** Server silence bound, in ms. Default {@link DEFAULT_IMAP_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Largest literal accepted, in bytes. Default {@link DEFAULT_IMAP_MAX_LITERAL_BYTES}. */
  maxLiteralBytes?: number;
  /** Most kept of one command's responses, in bytes. Default {@link DEFAULT_IMAP_MAX_COMMAND_BYTES}. */
  maxCommandBytes?: number;
}

/** A folder as `EXAMINE` reports it. */
export interface ImapFolderStatus {
  folder: string;
  /** UIDVALIDITY (RFC 3501 §2.3.1.1): while it holds, a UID names the same message. */
  uidValidity: number;
  /** The UID the next message will get, when the server says (it may not). */
  uidNext: number | null;
  /** How many messages the folder holds. */
  exists: number;
}

/** One message's UID and size, without its body. */
export interface ImapMessageSize {
  uid: number;
  /** RFC822.SIZE, in bytes; `null` when the server did not say. */
  size: number | null;
}

/** One fetched message. */
export interface ImapMessage {
  uid: number;
  /** INTERNALDATE: when the server received it; `null` when unreadable. */
  internalDate: Date | null;
  /** The message as stored (RFC 5322), byte for byte. */
  raw: Uint8Array;
}

/** An open, authenticated session. */
export interface ImapSession {
  /** What the server said it supports (upper case). */
  readonly capabilities: ReadonlySet<string>;
  /** Open `folder` read-only (`EXAMINE`). */
  examine(folder: string): Promise<ImapFolderStatus>;
  /** The UIDs (and sizes) of the examined folder's messages from `fromUid` up, ascending. */
  listMessages(fromUid: number): Promise<ImapMessageSize[]>;
  /** Fetch these messages of the examined folder, ascending by UID; a UID no longer there is absent. */
  fetchMessages(uids: ReadonlyArray<number>): Promise<ImapMessage[]>;
  /** End the session politely (`LOGOUT`) and close the connection. */
  logout(): Promise<void>;
  /** Close the connection now. */
  close(): void;
}

type Status = 'OK' | 'NO' | 'BAD' | 'BYE' | 'PREAUTH';

interface ParsedResponse {
  kind: 'tagged' | 'untagged' | 'continuation';
  tag: string;
  status: Status | null;
  /** The response code inside `[...]`, without the brackets. */
  code: string | null;
  /** The human-readable text (status responses), or the continuation's text. */
  text: string;
  /** `* <n> EXISTS` / `* <n> FETCH`: the number. */
  number: number | null;
  /** `EXISTS`, `FETCH`, `CAPABILITY`, … upper case. */
  keyword: string | null;
  parts: ImapResponseParts;
  /** Where the data after the keyword starts in the first part. */
  dataOffset: number;
}

interface CommandResult {
  code: string | null;
  untagged: ParsedResponse[];
}

interface InFlight {
  tag: string;
  untagged: ParsedResponse[];
  /** What {@link untagged} is charged against the command bound. */
  keptBytes: number;
  literals: Uint8Array[];
  texts: string[];
  sentLiterals: number;
  failureKind: ImapErrorKind;
  onContinue?: (text: string) => string;
  resolve(result: CommandResult): void;
  reject(err: Error): void;
}

const IMAPS_PORT = 993;
const IMAP_PORT = 143;

function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare === '::1') return true;
  return isIP(bare) === 4 && bare.startsWith('127.');
}

function parseResponse(parts: ImapResponseParts): ParsedResponse {
  const line = parts[0] as string;
  const base = { code: null, number: null, keyword: null, parts, dataOffset: line.length };
  if (line.startsWith('+')) {
    return { ...base, kind: 'continuation', tag: '+', status: null, text: line.slice(1).trim() };
  }
  const space = line.indexOf(' ');
  const tag = space < 0 ? line : line.slice(0, space);
  const rest = space < 0 ? '' : line.slice(space + 1);
  const status = /^(OK|NO|BAD|BYE|PREAUTH)(?: (.*))?$/i.exec(rest);
  if (status) {
    let text = status[2] ?? '';
    let code: string | null = null;
    if (text.startsWith('[')) {
      const close = text.indexOf(']');
      if (close > 0) {
        code = text.slice(1, close);
        text = text.slice(close + 1).trim();
      }
    }
    return {
      ...base,
      kind: tag === '*' ? 'untagged' : 'tagged',
      tag,
      status: status[1]!.toUpperCase() as Status,
      code,
      text,
    };
  }
  if (tag !== '*') throw new ImapError('protocol', 'The server sent a tagged response that is not a status.', line);
  const numbered = /^(\d+) ([A-Za-z]+)/.exec(rest);
  if (numbered) {
    return {
      ...base,
      kind: 'untagged',
      tag,
      status: null,
      text: '',
      number: Number(numbered[1]),
      keyword: numbered[2]!.toUpperCase(),
      dataOffset: space + 1 + numbered[0].length,
    };
  }
  const keyword = /^([A-Za-z]+)/.exec(rest);
  return {
    ...base,
    kind: 'untagged',
    tag,
    status: null,
    text: '',
    keyword: keyword ? keyword[1]!.toUpperCase() : null,
    dataOffset: space + 1 + (keyword ? keyword[0].length : 0),
  };
}

function capabilitiesOf(words: string): Set<string> {
  return new Set(words.split(' ').filter((w) => w.length > 0).map((w) => w.toUpperCase()));
}

/** The capability list a CAPABILITY code or response carries. */
function capabilityWords(response: ParsedResponse): string | null {
  if (response.code && /^CAPABILITY /i.test(response.code)) return response.code.slice('CAPABILITY '.length);
  if (response.keyword === 'CAPABILITY') return (response.parts[0] as string).slice(response.dataOffset);
  return null;
}

/** A UID set (`1:3,7,9:12`) for ascending, distinct UIDs. */
function uidSet(uids: ReadonlyArray<number>): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const uid of sorted.slice(1)) {
    if (uid === prev + 1) {
      prev = uid;
      continue;
    }
    out.push(start === prev ? String(start) : `${start}:${prev}`);
    start = prev = uid;
  }
  out.push(start === prev ? String(start) : `${start}:${prev}`);
  return out.join(',');
}

/** The FETCH item list of an untagged FETCH response, keyed by upper-case item name. */
function fetchItems(response: ParsedResponse): Map<string, ImapValue> {
  const items = new Map<string, ImapValue>();
  const [list] = parseImapValues(response.parts, response.dataOffset);
  if (!Array.isArray(list)) return items;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = list[i];
    if (typeof key === 'string') items.set(key.toUpperCase(), list[i + 1]!);
  }
  return items;
}

function positiveInt(value: ImapValue | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

class ImapConnection implements ImapSession {
  capabilities: ReadonlySet<string> = new Set();
  private readonly reader: ImapResponseReader;
  private current: InFlight | null = null;
  private greeting: { resolve(r: ParsedResponse): void; reject(e: Error): void } | null = null;
  private failure: Error | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private selected: ImapFolderStatus | null = null;

  constructor(
    private readonly socket: Socket,
    maxLiteralBytes: number,
    timeoutMs: number,
    private readonly maxCommandBytes: number,
  ) {
    this.reader = new ImapResponseReader({ maxLineBytes: IMAP_MAX_LINE_BYTES, maxLiteralBytes });
    socket.setTimeout(timeoutMs, () => {
      this.fail(new ImapError('timeout', `The IMAP server sent nothing for ${timeoutMs} ms.`));
    });
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (err: Error) => {
      this.fail(err instanceof ImapError ? err : new ImapError('connection', `The IMAP connection failed: ${err.message}`));
    });
    socket.on('close', () => {
      this.fail(new ImapError('connection', 'The IMAP server closed the connection.'));
    });
  }

  /** Wait for the server greeting; answers it. */
  awaitGreeting(): Promise<ParsedResponse> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      this.greeting = { resolve, reject };
    });
  }

  private onData(chunk: Buffer): void {
    let responses: ImapResponseParts[];
    try {
      responses = this.reader.push(chunk);
    } catch (err) {
      this.fail(err as Error);
      return;
    }
    for (const parts of responses) {
      let response: ParsedResponse;
      try {
        response = parseResponse(parts);
      } catch (err) {
        this.fail(err as Error);
        return;
      }
      this.dispatch(response);
    }
  }

  private dispatch(response: ParsedResponse): void {
    if (this.greeting) {
      const waiter = this.greeting;
      this.greeting = null;
      waiter.resolve(response);
      return;
    }
    const command = this.current;
    if (!command) return; // unsolicited between commands
    if (response.kind === 'continuation') {
      this.continueCommand(command, response);
      return;
    }
    if (response.kind === 'untagged') {
      command.keptBytes += IMAP_RESPONSE_OVERHEAD_BYTES;
      for (const part of response.parts) command.keptBytes += part.length;
      if (command.keptBytes > this.maxCommandBytes) {
        this.fail(
          new ImapError(
            'oversized',
            `The server sent more than ${this.maxCommandBytes} bytes of responses to one command; this session keeps no more.`,
          ),
        );
        return;
      }
      command.untagged.push(response);
      return;
    }
    if (response.tag !== command.tag) return;
    this.current = null;
    if (response.status === 'OK') {
      command.resolve({ code: response.code, untagged: command.untagged });
    } else {
      command.reject(
        new ImapError(
          command.failureKind,
          `The IMAP server answered ${response.status}${response.text ? `: ${response.text}` : ''}`,
          (parts0(response) ?? '').replace(/^\S+ /, ''),
        ),
      );
    }
  }

  private continueCommand(command: InFlight, response: ParsedResponse): void {
    if (command.sentLiterals < command.literals.length) {
      const literal = command.literals[command.sentLiterals]!;
      command.sentLiterals++;
      this.socket.write(literal);
      this.socket.write(this.segment(command.texts[command.sentLiterals]!, command.literals[command.sentLiterals]));
      return;
    }
    if (command.onContinue) {
      this.socket.write(`${command.onContinue(response.text)}\r\n`);
      return;
    }
    this.fail(new ImapError('protocol', 'The IMAP server asked to continue a command that has nothing more to send.'));
  }

  private segment(text: string, literal: Uint8Array | undefined): string {
    return literal ? `${text}{${literal.length}}\r\n` : `${text}\r\n`;
  }

  /** Run one command; `pieces` are inline text or arguments that may become literals. */
  run(
    pieces: ReadonlyArray<string | ImapArgument>,
    options: { failureKind?: ImapErrorKind; onContinue?: (text: string) => string } = {},
  ): Promise<CommandResult> {
    const exec = () =>
      new Promise<CommandResult>((resolve, reject) => {
        if (this.failure) return reject(this.failure);
        const texts: string[] = [''];
        const literals: Uint8Array[] = [];
        for (const piece of pieces) {
          if (typeof piece === 'string') texts[texts.length - 1] += piece;
          else if ('text' in piece) texts[texts.length - 1] += piece.text;
          else {
            literals.push(piece.literal);
            texts.push('');
          }
        }
        const tag = `A${++this.seq}`;
        this.current = {
          tag,
          untagged: [],
          keptBytes: 0,
          literals,
          texts,
          sentLiterals: 0,
          failureKind: options.failureKind ?? 'refused',
          onContinue: options.onContinue,
          resolve,
          reject,
        };
        this.socket.write(this.segment(`${tag} ${texts[0]}`, literals[0]));
      });
    const run = this.chain.then(exec, exec);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private fail(err: Error): void {
    if (this.failure) return;
    this.failure = err;
    if (this.greeting) {
      this.greeting.reject(err);
      this.greeting = null;
    }
    if (this.current) {
      this.current.reject(err);
      this.current = null;
    }
    this.socket.destroy();
  }

  async examine(folder: string): Promise<ImapFolderStatus> {
    const result = await this.run(['EXAMINE ', imapAstring(encodeMailboxName(folder))]);
    let uidValidity: number | null = null;
    let uidNext: number | null = null;
    let exists = 0;
    for (const response of result.untagged) {
      if (response.keyword === 'EXISTS' && response.number !== null) exists = response.number;
      const code = response.code ?? '';
      const validity = /^UIDVALIDITY (\d+)$/i.exec(code);
      if (validity) uidValidity = Number(validity[1]);
      const next = /^UIDNEXT (\d+)$/i.exec(code);
      if (next) uidNext = Number(next[1]);
    }
    if (uidValidity === null) {
      throw new ImapError(
        'protocol',
        `The IMAP server opened folder '${folder}' without a UIDVALIDITY, so its UIDs cannot be trusted across sessions.`,
      );
    }
    this.selected = { folder, uidValidity, uidNext, exists };
    return { ...this.selected };
  }

  async listMessages(fromUid: number): Promise<ImapMessageSize[]> {
    const folder = this.requireSelected();
    if (folder.exists === 0) return [];
    const from = Math.max(1, Math.floor(fromUid));
    const result = await this.run([`UID FETCH ${from}:* (UID RFC822.SIZE)`]);
    const out = new Map<number, ImapMessageSize>();
    for (const response of result.untagged) {
      if (response.keyword !== 'FETCH') continue;
      const items = fetchItems(response);
      const uid = positiveInt(items.get('UID'));
      // `n:*` names the last message even when every UID is below `n`.
      if (uid === null || uid < from) continue;
      out.set(uid, { uid, size: positiveInt(items.get('RFC822.SIZE')) });
    }
    return [...out.values()].sort((a, b) => a.uid - b.uid);
  }

  async fetchMessages(uids: ReadonlyArray<number>): Promise<ImapMessage[]> {
    this.requireSelected();
    if (uids.length === 0) return [];
    const wanted = new Set(uids);
    const result = await this.run([`UID FETCH ${uidSet(uids)} (UID INTERNALDATE BODY.PEEK[])`]);
    const out = new Map<number, ImapMessage>();
    for (const response of result.untagged) {
      if (response.keyword !== 'FETCH') continue;
      const items = fetchItems(response);
      const uid = positiveInt(items.get('UID'));
      if (uid === null || !wanted.has(uid)) continue;
      const body = items.get('BODY[]');
      const raw = body instanceof Uint8Array ? body : typeof body === 'string' ? new Uint8Array(Buffer.from(body, 'utf8')) : null;
      if (raw === null) continue; // an unsolicited FETCH (a flag change) carries no body
      const date = items.get('INTERNALDATE');
      out.set(uid, { uid, internalDate: typeof date === 'string' ? parseInternalDate(date) : null, raw });
    }
    return [...out.values()].sort((a, b) => a.uid - b.uid);
  }

  async logout(): Promise<void> {
    try {
      if (!this.failure) await this.run(['LOGOUT']);
    } catch {
      /* the connection is closed below either way */
    } finally {
      this.close();
    }
  }

  close(): void {
    if (!this.failure) this.failure = new ImapError('connection', 'The IMAP session is closed.');
    this.socket.destroy();
  }

  private requireSelected(): ImapFolderStatus {
    if (!this.selected) throw new ImapError('configuration', 'No folder is open: call examine() first.');
    return this.selected;
  }

  /** Learn the capabilities: from the greeting when it carried them, otherwise by asking. */
  async loadCapabilities(greeting: ParsedResponse): Promise<void> {
    const words = capabilityWords(greeting);
    if (words !== null) {
      this.capabilities = capabilitiesOf(words);
      return;
    }
    const result = await this.run(['CAPABILITY']);
    for (const response of result.untagged) {
      const found = capabilityWords(response);
      if (found !== null) this.capabilities = capabilitiesOf(found);
    }
  }

  async authenticate(account: MailAccount, credential: MailCredential): Promise<void> {
    const caps = this.capabilities;
    const saslIr = caps.has('SASL-IR');
    let result: CommandResult;
    if (credential.type === 'password') {
      if (caps.has('AUTH=PLAIN')) {
        const payload = base64(`\u0000${account.username}\u0000${credential.password}`);
        result = saslIr
          ? await this.run([`AUTHENTICATE PLAIN ${payload}`], { failureKind: 'authentication', onContinue: () => '*' })
          : await this.run(['AUTHENTICATE PLAIN'], { failureKind: 'authentication', onContinue: once(payload, '*') });
      } else if (caps.has('LOGINDISABLED')) {
        throw new ImapError(
          'configuration',
          `The IMAP server for account '${account.id}' refuses LOGIN and offers no AUTHENTICATE PLAIN, so a password cannot be used.`,
        );
      } else {
        result = await this.run(['LOGIN ', imapAstring(account.username), ' ', imapAstring(credential.password)], {
          failureKind: 'authentication',
        });
      }
    } else if (credential.type === 'oauth2') {
      if (!caps.has('AUTH=XOAUTH2')) {
        throw new ImapError(
          'configuration',
          `The IMAP server for account '${account.id}' does not offer AUTHENTICATE XOAUTH2, so an OAuth access token cannot be used.`,
        );
      }
      const payload = base64(`user=${account.username}\u0001auth=Bearer ${credential.accessToken}\u0001\u0001`);
      // On a refused token the server sends its error as a continuation and
      // waits for an empty response before the tagged NO (the XOAUTH2 flow).
      result = saslIr
        ? await this.run([`AUTHENTICATE XOAUTH2 ${payload}`], { failureKind: 'authentication', onContinue: () => '' })
        : await this.run(['AUTHENTICATE XOAUTH2'], { failureKind: 'authentication', onContinue: once(payload, '') });
    } else {
      throw new ImapError(
        'configuration',
        `The credential for account '${account.id}' has type '${String((credential as { type?: unknown }).type)}'; ` +
          "an IMAP credential is { type: 'password' } or { type: 'oauth2' }.",
      );
    }
    const words = result.code && /^CAPABILITY /i.test(result.code) ? result.code.slice('CAPABILITY '.length) : null;
    if (words !== null) this.capabilities = capabilitiesOf(words);
  }
}

function parts0(response: ParsedResponse): string | null {
  const first = response.parts[0];
  return typeof first === 'string' ? first : null;
}

/** A continuation responder: `first` to the first request, `then` to every later one. */
function once(first: string, then: string): (text: string) => string {
  let used = false;
  return () => {
    if (used) return then;
    used = true;
    return first;
  };
}

/**
 * Open a session on an account: connect, read the greeting, learn the
 * capabilities, resolve the credential and authenticate. The caller owns the
 * session and ends it with {@link ImapSession.logout} or {@link ImapSession.close}.
 */
export async function openImapSession(options: ImapSessionOptions): Promise<ImapSession> {
  const { account } = options;
  const endpoint = account?.imap;
  if (!endpoint || typeof endpoint.host !== 'string' || endpoint.host === '') {
    throw new ImapError('configuration', `Mail account '${account?.id}' names no IMAP host.`);
  }
  const security = endpoint.security ?? 'tls';
  if (security !== 'tls' && security !== 'none') {
    throw new ImapError('configuration', `Mail account '${account.id}' asks for IMAP security '${String(security)}'; use 'tls' or 'none'.`);
  }
  if (security === 'none' && !isLoopback(endpoint.host)) {
    throw new ImapError(
      'configuration',
      `Mail account '${account.id}' asks for a plaintext IMAP connection to '${endpoint.host}'. A plaintext ` +
        "connection is accepted only to a loopback host, because the credential would cross the network unencrypted; use security 'tls'.",
    );
  }
  const port = endpoint.port ?? (security === 'tls' ? IMAPS_PORT : IMAP_PORT);
  const socket =
    security === 'tls'
      ? tlsConnect({ host: endpoint.host, port, servername: isIP(endpoint.host) ? undefined : endpoint.host })
      : netConnect({ host: endpoint.host, port });
  const session = new ImapConnection(
    socket,
    options.maxLiteralBytes ?? DEFAULT_IMAP_MAX_LITERAL_BYTES,
    options.timeoutMs ?? DEFAULT_IMAP_TIMEOUT_MS,
    options.maxCommandBytes ?? DEFAULT_IMAP_MAX_COMMAND_BYTES,
  );
  try {
    const greeting = await session.awaitGreeting();
    if (greeting.kind !== 'untagged' || (greeting.status !== 'OK' && greeting.status !== 'PREAUTH')) {
      throw new ImapError('connection', `The IMAP server refused the connection: ${greeting.text || greeting.status}`, parts0(greeting) ?? undefined);
    }
    await session.loadCapabilities(greeting);
    if (!session.capabilities.has('IMAP4REV1') && !session.capabilities.has('IMAP4REV2')) {
      throw new ImapError('protocol', 'The server does not announce IMAP4rev1 or IMAP4rev2.');
    }
    if (greeting.status !== 'PREAUTH') {
      const credential = await options.credentials.credentialFor(account);
      await session.authenticate(account, credential);
    }
    return session;
  } catch (err) {
    session.close();
    throw err;
  }
}
