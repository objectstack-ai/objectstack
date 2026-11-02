// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The email template context's `baseUrl` is the address `serve` resolves for
 * this deployment — the parity pin the mirror in `@objectstack/plugin-email`'s
 * `capability-arg.ts` (`resolveDeploymentBaseUrl`) names.
 *
 * The source is `resolveAuthBaseUrl` here in `serve.ts`; the email package
 * cannot import it (this package depends on that one), so it carries a copy of
 * the chain. This file is where both are reachable, and it drives both over
 * the same environment: when either chain moves — a variable added, renamed,
 * reordered, or an empty value read another way — one of these rows goes red.
 * The email reader is reached through the call `serve` makes for every
 * capability provider (`resolveCapabilityArgument`, `@objectstack/core`), so
 * the row asserts what a served boot's mail renders with.
 *
 * Rows carry no `config.email`: the config link sits between `OS_BASE_URL` and
 * the local default in the email chain only (the auth chain has no config
 * carrier), and is pinned in the email package's own test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCapabilityArgument } from '@objectstack/core';
import * as pluginEmail from '@objectstack/plugin-email';
import { resolveAuthBaseUrl } from './serve.js';

const TOUCHED = ['OS_AUTH_URL', 'BETTER_AUTH_URL', 'OS_BASE_URL', 'OS_PORT', 'PORT'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The `baseUrl` a served boot's email capability is constructed with. */
function emailBaseUrl(): unknown {
  const arg = resolveCapabilityArgument('email', {
    stack: {},
    packageRoot: '/app',
    providerModule: pluginEmail,
    env: process.env,
  }).argument as { defaultTemplateContext: Record<string, unknown> };
  return arg.defaultTemplateContext.baseUrl;
}

/** What `serve` resolves for the same environment, on the port it would listen on. */
function serveBaseUrl(): string {
  const port = process.env.OS_PORT ?? process.env.PORT ?? '3000';
  return resolveAuthBaseUrl(port).value.replace(/\/+$/, '');
}

const ROWS: Array<[string, Partial<Record<(typeof TOUCHED)[number], string>>, string]> = [
  ['nothing set: the local default', {}, 'http://localhost:3000'],
  ['OS_PORT names the local default port', { OS_PORT: '4100' }, 'http://localhost:4100'],
  ['legacy PORT names it when OS_PORT is unset', { PORT: '4200' }, 'http://localhost:4200'],
  ['OS_PORT over PORT', { OS_PORT: '4100', PORT: '4200' }, 'http://localhost:4100'],
  ['OS_BASE_URL over the default', { OS_BASE_URL: 'https://base.example.com/', OS_PORT: '4100' }, 'https://base.example.com'],
  ['legacy BETTER_AUTH_URL over OS_BASE_URL',
    { BETTER_AUTH_URL: 'https://legacy.example.com', OS_BASE_URL: 'https://base.example.com' }, 'https://legacy.example.com'],
  ['OS_AUTH_URL over everything',
    { OS_AUTH_URL: 'https://auth.example.com/', BETTER_AUTH_URL: 'https://legacy.example.com', OS_BASE_URL: 'https://base.example.com' },
    'https://auth.example.com'],
  ['a set-but-empty OS_AUTH_URL is a value in both', { OS_AUTH_URL: '', OS_BASE_URL: 'https://base.example.com' }, ''],
];

describe('email baseUrl ↔ serve resolveAuthBaseUrl — one deployment address', () => {
  it.each(ROWS)('%s', (_name, env, expected) => {
    Object.assign(process.env, env);
    expect(serveBaseUrl()).toBe(expected);
    expect(emailBaseUrl()).toBe(expected);
  });
});
