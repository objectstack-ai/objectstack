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
  'console.firstRunChecklist',
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
  const zh = builtInLocales['zh-Hans'] as unknown;

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

/**
 * The Settings hub subtitle does not promise feature flags.
 *
 * The platform has no feature-flag settings page any more: the `feature_flags`
 * settings namespace and its Setup entry were removed because none of its
 * toggles was read by anything. A subtitle that still listed feature flags
 * sent an administrator looking for a page that is gone.
 *
 * Every shipped pack is enumerated, so a pack added later is held too, and
 * each pack's subtitle is checked against every language's term, so a pack
 * that copied another pack's phrasing is caught as well.
 */
describe('console.settingsHub.subtitle promises no feature flags in any pack', () => {
  /** "Feature flag(s)" in each shipped language, as the packs spelled it. */
  const FEATURE_FLAG_TERMS = [
    /feature[\s-]?flags?/iu, // en, de ("Feature-Flags")
    /indicadores? de funcion/iu, // es
    /功能开关/u, // zh
    /機能フラグ/u, // ja
    /기능\s*플래그/u, // ko
    /флаг\S* функци/iu, // ru
    /indicateurs? de fonctionnalit/iu, // fr
    /أعلام الميزات/u, // ar
    /sinalizador\S* de recurso/iu, // pt
  ];

  const packs = Object.entries(builtInLocales as Record<string, unknown>);

  it('enumerates every shipped pack', () => {
    expect(packs.length).toBeGreaterThanOrEqual(10);
  });

  it.each(packs.map(([code]) => code))('%s subtitle names no feature flags', (code) => {
    const pack = (builtInLocales as Record<string, unknown>)[code];
    const subtitle = resolve(pack, 'console.settingsHub.subtitle');
    expect(typeof subtitle).toBe('string');
    const hits = FEATURE_FLAG_TERMS.filter((term) => term.test(subtitle as string));
    expect(hits).toEqual([]);
  });

  it('each term catches the subtitle wording it retired', () => {
    const retired = [
      'Configure your system, integrations, and feature flags.',
      'Konfigurieren Sie Ihr System, Integrationen und Feature-Flags.',
      'Configure su sistema, las integraciones y los indicadores de funciones.',
      '配置系统、集成与功能开关。',
      'システム、連携、機能フラグを設定します。',
      '시스템, 연동, 기능 플래그를 구성합니다.',
      'Настройте систему, интеграции и флаги функций.',
      'Configurez votre système, vos intégrations et vos indicateurs de fonctionnalité.',
      'اضبط النظام والتكاملات وأعلام الميزات.',
      'Configure seu sistema, integrações e sinalizadores de recursos.',
    ];
    for (const text of retired) {
      expect(FEATURE_FLAG_TERMS.some((term) => term.test(text)), text).toBe(true);
    }
  });
});
