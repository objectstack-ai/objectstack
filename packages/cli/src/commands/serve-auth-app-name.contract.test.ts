// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `objectstack serve` hands the deployment's product name to AuthPlugin, from
// the SAME resolver the email capability's template context uses.
//
// The name reaches two auth surfaces through `AuthManager.getAppName()`: the
// `{{appName}}` of every auth email, and the issuer and label prefix of the
// otpauth URI a TOTP enrollment hands to an authenticator app. AuthPlugin used
// to be constructed with no `appName`, so under `serve` `getAppName()` answered
// 'ObjectStack' whatever `OS_APP_NAME` said. Auth emails hid it: their own
// `appName` outranks the email service's template context, which DID carry
// `OS_APP_NAME`, so an operator who set it saw the env var honoured in every
// other mail and the framework's name in the auth ones.
//
// Two halves, both needed. The resolver half proves the chain is the email
// chain, rung for rung, so the two consumers cannot disagree about the name.
// The construction half scans `serve.ts` (comments masked, as its siblings
// `serve-email-config-parity.contract.test.ts` and
// `serve-verify-security-parity.contract.test.ts` do), because nothing else
// sees the AuthPlugin literal: the plugin is imported through a variable
// specifier, so the type checker cannot, and only a booted CLI could.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeploymentAppName, resolveEmailCapabilityArg } from './serve.js';
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const SERVE_SOURCE = maskComments(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'serve.ts'), 'utf8'),
);

/** The text between the parenthesis or brace opening at `open` and its match. */
function balanced(source: string, open: number): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  const close = pairs[source[open]];
  if (!close) throw new Error(`no bracket at offset ${open}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === source[open]) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced bracket opened at offset ${open}`);
}

/** Every `<callee>(` call's argument text, declarations excluded. */
function callArguments(source: string, callee: string): string[] {
  const out: string[] = [];
  const needle = `${callee}(`;
  for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + 1)) {
    if (/function\s+$/.test(source.slice(Math.max(0, i - 20), i))) continue;
    out.push(balanced(source, i + callee.length));
  }
  return out;
}

/** Argument text compared as code: whitespace and a trailing comma dropped. */
const normalise = (args: string) => args.replace(/\s+/g, '').replace(/,$/, '');

const emailAppName = (cfgEmail: Record<string, any>, env: NodeJS.ProcessEnv, configAppName?: string) =>
  (resolveEmailCapabilityArg(cfgEmail, env, configAppName).options
    .defaultTemplateContext as Record<string, unknown>).appName;

describe('resolveDeploymentAppName is the email chain, rung for rung', () => {
  const RUNGS: Array<[string, Record<string, any>, NodeJS.ProcessEnv, string | undefined, string]> = [
    ['OS_APP_NAME', { appName: 'Key', defaultTemplateContext: { appName: 'Context' } }, { OS_APP_NAME: 'Env' }, 'Top', 'Env'],
    ['config.email.appName', { appName: 'Key', defaultTemplateContext: { appName: 'Context' } }, {}, 'Top', 'Key'],
    ['defaultTemplateContext.appName', { defaultTemplateContext: { appName: 'Context' } }, {}, 'Top', 'Context'],
    ['top-level config.appName', {}, {}, 'Top', 'Top'],
    ["'ObjectStack'", {}, {}, undefined, 'ObjectStack'],
  ];

  for (const [rung, cfgEmail, env, top, expected] of RUNGS) {
    it(`${rung} decides both consumers`, () => {
      expect(resolveDeploymentAppName(cfgEmail, env, top)).toBe(expected);
      expect(emailAppName(cfgEmail, env, top)).toBe(expected);
    });
  }
});

describe('serve constructs AuthPlugin with the deployment app name', () => {
  it('passes appName from resolveDeploymentAppName, with the arguments the email capability gets', () => {
    const constructions = callArguments(SERVE_SOURCE, 'new AuthPlugin');
    // Absence must be loud: a scan that finds no construction proves nothing.
    expect(constructions.length, 'serve.ts must construct AuthPlugin exactly once').toBe(1);

    const literal = constructions[0];
    const passed = callArguments(literal, 'resolveDeploymentAppName');
    expect(passed.length, 'AuthPlugin must receive appName from resolveDeploymentAppName').toBe(1);
    expect(literal).toMatch(/\bappName:\s*resolveDeploymentAppName\(/);

    const emailCalls = callArguments(SERVE_SOURCE, 'resolveEmailCapabilityArg');
    expect(emailCalls.length, 'serve.ts must resolve the email capability exactly once').toBe(1);
    expect(normalise(passed[0])).toBe(normalise(emailCalls[0]));
  });
});
