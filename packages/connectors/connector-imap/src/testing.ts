// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/connector-imap/testing` — an in-process IMAP server double for
 * tests of anything that reads a mailbox: a real TCP server on loopback that
 * speaks the RFC 3501 subset a read-only mirror uses, holding its folders in
 * memory.
 *
 * It is deliberately its own implementation — it shares no parser, encoder or
 * constant with the client in this package — so a misreading of the protocol
 * in one is not silently mirrored by the other. It is also strict where the
 * client must be careful: a literal is accepted only after the server's `+`
 * continuation, `UID FETCH` is refused outside a selected folder, and a body
 * fetched with `BODY[]` under `SELECT` is marked `\Seen` — the only state
 * change a fetch makes, as RFC 3501 says: `BODY.PEEK[]` never sets it, and
 * nothing changes a folder opened with `EXAMINE`. A client that keeps to
 * `EXAMINE` and `BODY.PEEK[]` is therefore proved read-only by the commands
 * it sends (`commands`), and a `\Seen` flag shows a client that broke both.
 *
 * It can also play a HOSTILE or LYING server, for tests of a client's bounds:
 * `hostile` answers every `UID FETCH` with a stream that never ends or a
 * literal that never arrives, and `sizeReport` understates or omits
 * `RFC822.SIZE`.
 *
 * Supported: `CAPABILITY`, `NOOP`, `LOGIN`, `AUTHENTICATE PLAIN` and
 * `AUTHENTICATE XOAUTH2` (with or without `SASL-IR`), `EXAMINE`, `SELECT`,
 * `UID FETCH` (`UID`, `FLAGS`, `RFC822.SIZE`, `INTERNALDATE`, `BODY[]`,
 * `BODY.PEEK[]`) and `LOGOUT`. Anything else answers `BAD`.
 */

import { createServer, type Server, type Socket } from 'node:net';

/** The size of each literal of the `withheld-literal` hostile response. */
const WITHHELD_LITERAL_BYTES = 40 * 1024;

/** One account the double accepts. */
export interface ImapDoubleUser {
  password?: string;
  /** An OAuth access token accepted by `AUTHENTICATE XOAUTH2`. */
  accessToken?: string;
}

export interface ImapServerDoubleOptions {
  /** Accounts, by user name. Default: `{ user: { password: 'secret' } }`. */
  users?: Record<string, ImapDoubleUser>;
  /** Capabilities announced beside `IMAP4rev1` (`AUTH=PLAIN`, `SASL-IR`, `AUTH=XOAUTH2`, `LOGINDISABLED`). */
  capabilities?: string[];
  /** Announce the capabilities in the greeting (default) or only on `CAPABILITY`. */
  capabilitiesInGreeting?: boolean;
  /** Leave the UIDVALIDITY code out of `EXAMINE`/`SELECT` (a broken server). */
  omitUidValidity?: boolean;
  /**
   * Answer every `UID FETCH` with a stream that never ends until the client
   * drops the connection: `endless-literals` — one response that announces
   * empty literal after empty literal (`{0}` after `{0}`); `endless-untagged`
   * — untagged FETCH responses, one after another, and never the tagged
   * answer. Or `withheld-literal` — one response whose first literal (40 KiB)
   * is sent in full and whose second, of the same size, is announced and
   * never sent: only a client that judges the announcement refuses it before
   * its silence bound.
   */
  hostile?: 'endless-literals' | 'endless-untagged' | 'withheld-literal';
  /** `RFC822.SIZE` as reported: `true` (default), `understated` (at most 100) or `omitted`. */
  sizeReport?: 'true' | 'understated' | 'omitted';
}

/** One stored message. */
export interface ImapDoubleMessage {
  uid: number;
  raw: Uint8Array;
  internalDate: Date;
  flags: Set<string>;
}

interface Folder {
  uidValidity: number;
  uidNext: number;
  messages: ImapDoubleMessage[];
}

interface Conn {
  socket: Socket;
  buffer: Buffer;
  /** The command being assembled: its text and literals, while a literal is awaited. */
  pendingLine: string;
  literals: Buffer[];
  literalNeed: number | null;
  /** A SASL exchange waiting for the client's next line. */
  sasl: ((line: string) => void) | null;
  user: string | null;
  selected: { name: string; readOnly: boolean } | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function internalDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getUTCDate())}-${MONTHS[at.getUTCMonth()]}-${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`;
}

/** Split a command line into arguments: atoms, quoted strings, parenthesized groups kept whole, literals by index. */
function argumentsOf(line: string, literals: Buffer[]): Array<string | Buffer> {
  const out: Array<string | Buffer> = [];
  let i = 0;
  let literal = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ') {
      i++;
    } else if (c === '"') {
      let value = '';
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        value += line[i++] ?? '';
      }
      i++;
      out.push(value);
    } else if (c === '{') {
      const close = line.indexOf('}', i);
      out.push(literals[literal++] ?? Buffer.alloc(0));
      i = close + 1;
    } else if (c === '(') {
      let depth = 0;
      const start = i;
      do {
        if (line[i] === '(') depth++;
        else if (line[i] === ')') depth--;
        i++;
      } while (i < line.length && depth > 0);
      out.push(line.slice(start, i));
    } else {
      const start = i;
      let depth = 0;
      while (i < line.length && (depth > 0 || line[i] !== ' ')) {
        if (line[i] === '[') depth++;
        else if (line[i] === ']') depth--;
        i++;
      }
      out.push(line.slice(start, i));
    }
  }
  return out;
}

/** The UIDs a UID set names, among `present` (RFC 3501 §9 sequence-set; `*` is the largest UID). */
function uidsOf(set: string, present: number[]): Set<number> | null {
  const largest = present.length ? Math.max(...present) : 0;
  const wanted = new Set<number>();
  for (const range of set.split(',')) {
    const [a, b] = range.split(':');
    const value = (s: string | undefined) => (s === '*' ? largest : /^\d+$/.test(s ?? '') ? Number(s) : NaN);
    const lo = value(a);
    const hi = b === undefined ? lo : value(b);
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo === 0 || hi === 0) return null;
    const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
    for (const uid of present) if (uid >= from && uid <= to) wanted.add(uid);
  }
  return wanted;
}

/** An in-process IMAP server on loopback. */
export class ImapServerDouble {
  /** Every command line received, credentials redacted, in order. */
  readonly commands: string[] = [];
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly folders = new Map<string, Folder>();
  private readonly users: Record<string, ImapDoubleUser>;
  private nextValidity = 1;
  private port = 0;

  constructor(private readonly options: ImapServerDoubleOptions = {}) {
    this.users = options.users ?? { user: { password: 'secret' } };
    this.server = createServer((socket) => this.accept(socket));
    this.folder('INBOX');
  }

  /** Start listening on 127.0.0.1 (an ephemeral port); answers where. */
  async listen(): Promise<{ host: string; port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    return { host: '127.0.0.1', port: this.port };
  }

  /** Stop listening and drop every connection. */
  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** How many connections are open now. */
  get openConnections(): number {
    return this.sockets.size;
  }

  /** Deliver a message into `folder` (created on first use); answers its UID. */
  append(folder: string, raw: string | Uint8Array, options: { internalDate?: Date } = {}): number {
    const target = this.folder(folder);
    const uid = target.uidNext++;
    target.messages.push({
      uid,
      raw: typeof raw === 'string' ? new Uint8Array(Buffer.from(raw, 'utf8')) : raw,
      internalDate: options.internalDate ?? new Date('2026-10-13T08:00:00Z'),
      flags: new Set(),
    });
    return uid;
  }

  /** Remove a message (as another client's EXPUNGE would). */
  expunge(folder: string, uid: number): void {
    const target = this.folder(folder);
    target.messages = target.messages.filter((m) => m.uid !== uid);
  }

  /**
   * Rebuild a folder as a server does after losing its UID state: a new
   * UIDVALIDITY, and every message renumbered from 1.
   */
  rebuild(folder: string): void {
    const target = this.folder(folder);
    target.uidValidity = this.nextValidity++ * 1000;
    target.messages.forEach((m, i) => (m.uid = i + 1));
    target.uidNext = target.messages.length + 1;
  }

  /** The messages of `folder`, as stored. */
  messages(folder: string): ReadonlyArray<ImapDoubleMessage> {
    return this.folder(folder).messages;
  }

  /** The UIDVALIDITY of `folder`. */
  uidValidity(folder: string): number {
    return this.folder(folder).uidValidity;
  }

  private folder(name: string): Folder {
    const key = name.toUpperCase() === 'INBOX' ? 'INBOX' : name;
    let folder = this.folders.get(key);
    if (!folder) {
      folder = { uidValidity: this.nextValidity++ * 1000, uidNext: 1, messages: [] };
      this.folders.set(key, folder);
    }
    return folder;
  }

  private capabilityLine(): string {
    return ['IMAP4rev1', ...(this.options.capabilities ?? [])].join(' ');
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const conn: Conn = {
      socket,
      buffer: Buffer.alloc(0),
      pendingLine: '',
      literals: [],
      literalNeed: null,
      sasl: null,
      user: null,
      selected: null,
    };
    const greeting = this.options.capabilitiesInGreeting === false ? '' : `[CAPABILITY ${this.capabilityLine()}] `;
    socket.write(`* OK ${greeting}ImapServerDouble ready\r\n`);
    socket.on('data', (chunk: Buffer) => this.onData(conn, chunk));
  }

  private onData(conn: Conn, chunk: Buffer): void {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    for (;;) {
      if (conn.literalNeed !== null) {
        if (conn.buffer.length < conn.literalNeed) return;
        conn.literals.push(conn.buffer.subarray(0, conn.literalNeed));
        conn.buffer = conn.buffer.subarray(conn.literalNeed);
        conn.literalNeed = null;
        continue;
      }
      const lf = conn.buffer.indexOf(0x0a);
      if (lf < 0) return;
      if (lf === 0 || conn.buffer[lf - 1] !== 0x0d) {
        conn.socket.write('* BAD Command lines end with CRLF\r\n');
        conn.socket.destroy();
        return;
      }
      const line = conn.buffer.toString('utf8', 0, lf - 1);
      conn.buffer = conn.buffer.subarray(lf + 1);
      if (conn.sasl) {
        const next = conn.sasl;
        conn.sasl = null;
        next(line);
        continue;
      }
      const marker = /\{(\d+)\}$/.exec(line);
      if (marker) {
        conn.pendingLine += line;
        conn.literalNeed = Number(marker[1]);
        conn.socket.write('+ Ready for literal data\r\n');
        continue;
      }
      const full = conn.pendingLine + line;
      const literals = conn.literals;
      conn.pendingLine = '';
      conn.literals = [];
      this.command(conn, full, literals);
    }
  }

  private command(conn: Conn, line: string, literals: Buffer[]): void {
    const write = (text: string | Buffer): void => {
      conn.socket.write(text);
    };
    const [tag, rawName, ...rest] = argumentsOf(line, literals);
    const name = typeof rawName === 'string' ? rawName.toUpperCase() : '';
    const sub = typeof rest[0] === 'string' ? rest[0].toUpperCase() : '';
    this.commands.push(
      name === 'LOGIN' ? `${String(tag)} LOGIN [redacted]` : name === 'AUTHENTICATE' ? `${String(tag)} AUTHENTICATE ${sub} [redacted]` : line,
    );
    if (typeof tag !== 'string' || !name) {
      write('* BAD Missing tag or command\r\n');
      return;
    }
    const ok = (text: string) => write(`${tag} OK ${text}\r\n`);
    const no = (text: string) => write(`${tag} NO ${text}\r\n`);
    const bad = (text: string) => write(`${tag} BAD ${text}\r\n`);
    const str = (v: string | Buffer | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v.toString('utf8'));

    switch (name) {
      case 'CAPABILITY':
        write(`* CAPABILITY ${this.capabilityLine()}\r\n`);
        return ok('CAPABILITY completed');
      case 'NOOP':
        return ok('NOOP completed');
      case 'LOGOUT':
        write('* BYE ImapServerDouble logging out\r\n');
        ok('LOGOUT completed');
        conn.socket.end();
        return;
      case 'LOGIN': {
        if (conn.user) return bad('Already authenticated');
        if ((this.options.capabilities ?? []).includes('LOGINDISABLED')) return no('LOGIN is disabled');
        const user = str(rest[0]);
        const account = user === undefined ? undefined : this.users[user];
        if (!account || account.password === undefined || account.password !== str(rest[1])) {
          return no('[AUTHENTICATIONFAILED] Invalid credentials');
        }
        conn.user = user!;
        return ok('LOGIN completed');
      }
      case 'AUTHENTICATE':
        return this.authenticate(conn, tag, sub, str(rest[1]));
      case 'EXAMINE':
      case 'SELECT': {
        if (!conn.user) return bad('Authenticate first');
        const folderName = str(rest[0]);
        if (folderName === undefined) return bad('Missing folder');
        const key = folderName.toUpperCase() === 'INBOX' ? 'INBOX' : folderName;
        const folder = this.folders.get(key);
        if (!folder) return no('[NONEXISTENT] No such folder');
        conn.selected = { name: key, readOnly: name === 'EXAMINE' };
        write('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n');
        write(`* ${folder.messages.length} EXISTS\r\n`);
        write('* 0 RECENT\r\n');
        if (!this.options.omitUidValidity) write(`* OK [UIDVALIDITY ${folder.uidValidity}] UIDs valid\r\n`);
        write(`* OK [UIDNEXT ${folder.uidNext}] Predicted next UID\r\n`);
        return ok(`[${name === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] ${name} completed`);
      }
      case 'UID': {
        if (sub !== 'FETCH') return bad('Only UID FETCH is supported');
        if (!conn.user || !conn.selected) return bad('Select a folder first');
        const folder = this.folders.get(conn.selected.name)!;
        const set = str(rest[1]);
        const wanted = set === undefined ? null : uidsOf(set, folder.messages.map((m) => m.uid));
        if (wanted === null) return bad('Invalid UID set');
        if (this.options.hostile === 'withheld-literal') {
          write(`* 1 FETCH (UID 1 BODY[] {${WITHHELD_LITERAL_BYTES}}\r\n`);
          write(Buffer.alloc(WITHHELD_LITERAL_BYTES, 0x78));
          write(` BODY[HEADER] {${WITHHELD_LITERAL_BYTES}}\r\n`);
          return;
        }
        if (this.options.hostile) return this.endless(conn, this.options.hostile);
        const items = (str(rest[2]) ?? '').replace(/^\(|\)$/g, '').toUpperCase().split(' ').filter(Boolean);
        folder.messages.forEach((message, index) => {
          if (!wanted.has(message.uid)) return;
          const parts: Array<string | Buffer> = [`UID ${message.uid}`];
          for (const item of items) {
            if (item === 'UID') continue;
            if (item === 'FLAGS') parts.push(`FLAGS (${[...message.flags].join(' ')})`);
            else if (item === 'RFC822.SIZE') {
              const report = this.options.sizeReport ?? 'true';
              if (report === 'true') parts.push(`RFC822.SIZE ${message.raw.length}`);
              else if (report === 'understated') parts.push(`RFC822.SIZE ${Math.min(message.raw.length, 100)}`);
            }
            else if (item === 'INTERNALDATE') parts.push(`INTERNALDATE "${internalDate(message.internalDate)}"`);
            else if (item === 'BODY[]' || item === 'BODY.PEEK[]') {
              if (item === 'BODY[]' && !conn.selected!.readOnly) message.flags.add('\\Seen');
              parts.push(Buffer.from(message.raw));
            }
          }
          let out = `* ${index + 1} FETCH (`;
          const chunks: Array<string | Buffer> = [];
          parts.forEach((part, i) => {
            const sep = i === 0 ? '' : ' ';
            if (typeof part === 'string') out += sep + part;
            else {
              out += `${sep}BODY[] {${part.length}}\r\n`;
              chunks.push(out, part);
              out = '';
            }
          });
          chunks.push(`${out})\r\n`);
          for (const c of chunks) write(c);
        });
        return ok('UID FETCH completed');
      }
      default:
        return bad(`Unknown command ${name}`);
    }
  }

  /** A stream that never ends, one write per turn of the event loop, until the client drops the connection. */
  private endless(conn: Conn, mode: 'endless-literals' | 'endless-untagged'): void {
    let sent = 0;
    const pump = () => {
      if (conn.socket.destroyed || !conn.socket.writable || sent >= 1_000_000) return;
      sent++;
      if (mode === 'endless-literals') conn.socket.write(sent === 1 ? '* 1 FETCH (UID 1 BODY[] {0}\r\n' : ' X {0}\r\n');
      else conn.socket.write(`* ${sent} FETCH (UID ${sent} FLAGS ())\r\n`);
      setImmediate(pump);
    };
    pump();
  }

  private authenticate(conn: Conn, tag: string, mechanism: string, initial: string | undefined): void {
    const write = (text: string): void => {
      conn.socket.write(text);
    };
    const caps = this.options.capabilities ?? [];
    if (conn.user) return void write(`${tag} BAD Already authenticated\r\n`);
    if (!caps.includes(`AUTH=${mechanism}`)) return void write(`${tag} NO Unsupported mechanism\r\n`);
    if (initial !== undefined && !caps.includes('SASL-IR')) return void write(`${tag} BAD SASL-IR is not enabled\r\n`);
    const finish = (response: string) => {
      if (response === '*') return void write(`${tag} BAD Authentication cancelled\r\n`);
      const decoded = Buffer.from(response, 'base64').toString('utf8');
      let user: string | undefined;
      let good = false;
      if (mechanism === 'PLAIN') {
        const [, authcid, password] = decoded.split('\u0000');
        user = authcid;
        good = user !== undefined && this.users[user]?.password !== undefined && this.users[user]?.password === password;
      } else {
        const fields = Object.fromEntries(
          decoded.split('\u0001').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
        );
        user = fields.user;
        good = user !== undefined && this.users[user]?.accessToken !== undefined && fields.auth === `Bearer ${this.users[user]?.accessToken}`;
        if (!good) {
          // The XOAUTH2 failure flow: the error as a continuation, then the
          // tagged NO once the client answers with an empty line.
          write(`+ ${Buffer.from('{"status":"401","schemes":"bearer"}').toString('base64')}\r\n`);
          conn.sasl = () => write(`${tag} NO [AUTHENTICATIONFAILED] Invalid token\r\n`);
          return;
        }
      }
      if (!good) return void write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
      conn.user = user!;
      write(`${tag} OK ${mechanism} authentication completed\r\n`);
    };
    if (initial !== undefined) return finish(initial);
    write('+ \r\n');
    conn.sasl = finish;
  }
}
