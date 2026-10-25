/**
 * objectui#12956 — inside the running system, the console does not call
 * itself 「此环境 / 本环境」.
 *
 * Ruling A on objectstack-ai/cloud#3002 keeps 「环境」 as the cloud's noun for
 * a deployment and keeps it out of the way of a user who is already inside
 * one. The strings in the families below are shown by every ObjectStack
 * deployment to that user, so they say 「本系统」, or drop the noun where the
 * sentence reads without it.
 *
 * The pin enumerates every string under each named family in the `zh` pack,
 * so a value added to one of these families later is held too. It asserts the
 * enumeration is non-empty per family first: a family path that stopped
 * resolving would otherwise pass with nothing checked.
 *
 * Out of scope on purpose (the card's exclusions): `console.settingsView`,
 * where 「环境变量」 means environment variables, and `cloudOnboarding.*`,
 * which explained the cloud noun once (that family has since retired with its
 * widget, objectui#12954).
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const FAMILIES = [
  'console.settingsHub',
  'console.workspaceTimezonePrompt',
  'console.readRate',
  'auth',
  'profile.password',
  'home',
  'connectAgent',
  'aiModelStatus',
] as const;

/** "This / the said environment", the phrasing the ruling retires here. */
const SELF_AS_ENVIRONMENT = /[此本该]环境/u;

function resolve(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
    root,
  );
}

function strings(node: unknown, path: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) strings(child, `${path}.${key}`, out);
  }
  return out;
}

describe('console copy names the system the user is in, not the cloud noun (objectui#12956)', () => {
  const zh = builtInLocales.zh as unknown;

  it.each(FAMILIES)('zh %s carries no 此环境 / 本环境 / 该环境', (family) => {
    const entries = strings(resolve(zh, family), family);
    expect(entries.length).toBeGreaterThan(0);
    const offenders = entries.filter(([, value]) => SELF_AS_ENVIRONMENT.test(value));
    expect(offenders).toEqual([]);
  });

  it('the matcher catches each retired spelling and leaves environment variables alone', () => {
    expect(SELF_AS_ENVIRONMENT.test('本环境读取量异常')).toBe(true);
    expect(SELF_AS_ENVIRONMENT.test('您正在登录此环境')).toBe(true);
    expect(SELF_AS_ENVIRONMENT.test('该环境可能未运行 AI 服务')).toBe(true);
    expect(SELF_AS_ENVIRONMENT.test('已被环境变量锁定')).toBe(false);
  });
});
