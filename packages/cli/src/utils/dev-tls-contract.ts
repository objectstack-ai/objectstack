// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE dev-TLS contract this CLI has: the `--cert` / `--key` pair, the
 * protocol a listener carrying them speaks, and the prose every door refuses in
 * (#16804).
 *
 * ## What this is for, and the ONE thing it deliberately is NOT
 *
 * An interactive MCP client refuses to open an OAuth sign-in against a non-TLS
 * URL, so the self-serve identity path the product advertises could not be
 * exercised against a local dev server at all — every demo, recording and
 * investigation hand-built a page of reverse-proxy setup off-camera. These two
 * flags let the developer hand `objectstack dev` a certificate they already
 * have and let the dev process terminate TLS itself.
 *
 * ⛔ **Nothing here generates a certificate or a CA, and nothing here tells a
 * developer how to install one into a system trust store.** The maintainer's
 * ruling (2026-09-10, option N) refused the generating shape on a
 * security-statement ground: a product that generates a CA and then instructs
 * developers to trust it owns that instruction, and an error in it is invisible
 * to the person following it. The trust store is the developer's own business.
 * The developer brings the certificate; this module's whole job is to USE it.
 *
 * ## Why the pair is refused HERE rather than at the flag layer
 *
 * `--cert` without `--key` (or the reverse) is not a TLS configuration — it is
 * half of one, and the honest answer is a refusal that names the missing flag.
 * oclif's `dependsOn` would express that, but the refusal it prints names the
 * flag pair without saying what the operator was trying to do, and
 * {@link formatIncompleteDevTlsPairNotice} is read by a pin test rather than
 * only by a human. Same judgement, and the same reason, as
 * `port-contract.ts`'s explicit pre-spawn call: the doors call this module.
 *
 * ## Why the protocol is DERIVED and never configured
 *
 * `resolveAuthBaseUrl`'s fallback tail used to be a hardcoded
 * `http://localhost:<port>`, which is the address of the socket — and once TLS
 * terminates in-process that address is unreachable. A listener that speaks TLS
 * and a canonical origin that says `http://` is strictly worse than today's
 * plain-http server, because the boot output is then self-consistently WRONG
 * rather than merely plain: the two `/.well-known/*` documents, the CSRF
 * allow-list, the ready banner's `API:` row and the `🤖 MCP server` block would
 * all agree on an origin no client can reach. So the protocol is a function of
 * the material the listener was handed ({@link listenerProtocol}) and of
 * nothing else — there is no flag, and no env var, that can set it
 * independently of the certificate that makes it true.
 *
 * `OS_AUTH_URL` (and the rest of that chain) keeps winning over the derived
 * value: it names where a deployment is REACHED, which is a different question
 * from what this process bound. Only the tail of the chain — the built-in
 * default nobody configured — follows the listener.
 */
import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

/**
 * The scheme a bound listener actually speaks. Two values, because that is how
 * many a Node HTTP listener has; the point of naming the type is that callers
 * pass a *measured* protocol rather than a boolean whose polarity is guessable
 * at the call site.
 */
export type ListenerProtocol = 'http' | 'https';

/** The flag names, declared once so prose, forwarding and tests cannot drift. */
export const DEV_TLS_CERT_FLAG = 'cert';
export const DEV_TLS_KEY_FLAG = 'key';

/** Both flags as an operator typed them — the shape every door parses from. */
export interface DevTlsFlagInput {
  [DEV_TLS_CERT_FLAG]?: string;
  [DEV_TLS_KEY_FLAG]?: string;
}

/** A requested TLS listener: the two paths, not yet read. */
export interface DevTlsRequest {
  certPath: string;
  keyPath: string;
}

/** PEM bytes for a requested listener, plus the paths they were read from. */
export interface DevTlsMaterial extends DevTlsRequest {
  cert: Buffer;
  key: Buffer;
}

/**
 * What the flag pair says, as one of three answers — ⛔ never a boolean plus a
 * separate validity bit, which is the shape that lets a door act on "TLS was
 * asked for" while ignoring "…and it was asked for wrong".
 *
 * `none` is the overwhelmingly common case and the one that must stay
 * byte-for-byte identical to a tree with no TLS support at all.
 */
export type DevTlsIntent =
  | { kind: 'none' }
  | { kind: 'incomplete'; notice: string }
  | ({ kind: 'requested' } & DevTlsRequest);

/**
 * Read the `--cert` / `--key` pair. PURE — it touches no filesystem, so the
 * `os dev` parent can learn the protocol its child will speak without reading
 * the certificate it merely forwards.
 *
 * Whitespace-only is treated as absent: `--cert ''` is a value an operator can
 * produce from a shell variable that did not expand, and reading it as a path
 * would refuse with `ENOENT ''` instead of naming the flag.
 */
export function resolveDevTlsIntent(flags: DevTlsFlagInput): DevTlsIntent {
  const certPath = flags[DEV_TLS_CERT_FLAG]?.trim() ?? '';
  const keyPath = flags[DEV_TLS_KEY_FLAG]?.trim() ?? '';

  if (!certPath && !keyPath) return { kind: 'none' };
  if (!certPath) return { kind: 'incomplete', notice: formatIncompleteDevTlsPairNotice(DEV_TLS_KEY_FLAG) };
  if (!keyPath) return { kind: 'incomplete', notice: formatIncompleteDevTlsPairNotice(DEV_TLS_CERT_FLAG) };
  return { kind: 'requested', certPath, keyPath };
}

/**
 * The protocol a listener handed `request` speaks.
 *
 * Takes the resolved intent rather than the raw flags so an `incomplete` pair
 * can never resolve to `https`: a door that refuses the pair and a door that
 * derives the origin read the same answer.
 */
export function listenerProtocol(intent: DevTlsIntent): ListenerProtocol {
  return intent.kind === 'requested' ? 'https' : 'http';
}

/**
 * The refusal for half a TLS pair, naming the flag that WAS given and the one
 * that is missing.
 *
 * Returns text rather than printing it, so the decision to warn or to exit
 * stays at the call site and a test can read the sentence without capturing a
 * stream — the same division as `formatInvalidPortNotice`.
 */
export function formatIncompleteDevTlsPairNotice(given: typeof DEV_TLS_CERT_FLAG | typeof DEV_TLS_KEY_FLAG): string {
  const missing = given === DEV_TLS_CERT_FLAG ? DEV_TLS_KEY_FLAG : DEV_TLS_CERT_FLAG;
  return `--${given} was given without --${missing}.\n`
    + `    TLS needs both halves: --${DEV_TLS_CERT_FLAG} <path to the certificate> `
    + `--${DEV_TLS_KEY_FLAG} <path to its private key>.\n`
    + '    Drop both to serve plain http on this port.';
}

/**
 * The refusal for a certificate or key that cannot be read, naming the flag,
 * the path it resolved to and what the filesystem said.
 *
 * ⛔ There is deliberately no path from here back to plain http. A developer who
 * typed `--cert` asked for TLS; starting an http listener instead would answer
 * a request for one protocol with a server speaking the other, and the first
 * symptom would be a client-side handshake error naming neither the flag nor
 * the file. Prefer failing to falling back.
 */
export function formatUnreadableDevTlsFileNotice(
  flag: typeof DEV_TLS_CERT_FLAG | typeof DEV_TLS_KEY_FLAG,
  path: string,
  cause: unknown,
): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return `--${flag} could not be read: ${JSON.stringify(path)}\n`
    + `    ${reason}\n`
    + '    The path is resolved relative to the current working directory.';
}

/**
 * Read the PEM bytes for a requested listener.
 *
 * Throws with {@link formatUnreadableDevTlsFileNotice} as the message, because
 * the only correct answer to an unreadable certificate is to not start — see
 * that function for why there is no http fallback here.
 */
export function readDevTlsMaterial(request: DevTlsRequest): DevTlsMaterial {
  const read = (flag: typeof DEV_TLS_CERT_FLAG | typeof DEV_TLS_KEY_FLAG, path: string): Buffer => {
    try {
      return readFileSync(path);
    } catch (e) {
      throw new Error(formatUnreadableDevTlsFileNotice(flag, path, e));
    }
  };
  return {
    ...request,
    cert: read(DEV_TLS_CERT_FLAG, request.certPath),
    key: read(DEV_TLS_KEY_FLAG, request.keyPath),
  };
}

/**
 * The argv `os dev` forwards to the `serve` child for a resolved intent.
 *
 * The child re-reads the files itself rather than receiving bytes over IPC: it
 * is the process that binds the socket, so it must be the process that fails
 * when the certificate is unusable. Forwarding the PATHS keeps one reader of
 * the file and one owner of that refusal.
 *
 * An `incomplete` pair forwards nothing — the parent has already refused it, and
 * forwarding half a pair would have the child refuse it a second time under the
 * name of a channel the operator did not use.
 */
export function devTlsChildArgs(intent: DevTlsIntent): string[] {
  if (intent.kind !== 'requested') return [];
  return [`--${DEV_TLS_CERT_FLAG}`, intent.certPath, `--${DEV_TLS_KEY_FLAG}`, intent.keyPath];
}

/**
 * Declare `--cert` on a command.
 *
 * The description says what the flag does and what the developer still owns —
 * ⛔ and it does not tell anyone how to make a certificate trusted. See this
 * module's header: that sentence is refused by ruling, and `--help` is one of
 * the surfaces it is refused on.
 */
export function devTlsCertFlag() {
  return Flags.string({
    description: 'Path to a TLS certificate (PEM). With --key, terminate TLS in this process and serve '
      + 'https://localhost:<port> — the canonical origin, both /.well-known/* documents and the MCP '
      + 'connect hint follow. Bring your own certificate; none is generated.',
  });
}

/** Declare `--key` on a command. Same division of labour as {@link devTlsCertFlag}. */
export function devTlsKeyFlag() {
  return Flags.string({
    description: 'Path to the private key (PEM) for --cert. Required with --cert, and ignored without it.',
  });
}

/** The incomplete-pair refusal, coloured for a terminal. */
export function colorizeDevTlsNotice(notice: string): string {
  return chalk.red(`  ✗ ${notice}`);
}
