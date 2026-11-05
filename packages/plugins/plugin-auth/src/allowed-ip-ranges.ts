// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D5 — the `auth.allowed_ip_ranges` setting outside the gate itself
 * (#30203).
 *
 *  - {@link parseAllowedIpRanges} is THE reading of the setting's textarea, for
 *    the settings binding (`bindAuthSettings`) and for the save predicate below,
 *    so the list a save is judged by is the list the gate then enforces.
 *  - {@link allowedIpRangesWritePredicate} refuses a save, through the settings
 *    console, of a list that leaves out the address the saving request itself
 *    comes from. Saved, such a list refuses the administrator's own next
 *    sign-in, and nothing at the save said so.
 *
 * The address judged at the save is the one the gate judges at sign-in: the
 * auth manager's {@link AuthManager.resolveClientAddress}, from the same two
 * facts (the transport's peer address and the request headers) under the same
 * `server.trustProxy` declaration, and matched by the same
 * {@link ipMatchesRange}. A request whose address the server cannot establish
 * is refused at the gate whenever a list is set, so a non-empty list is refused
 * at the save for it too.
 *
 * Only a write that arrives over HTTP is judged. An in-process write (boot,
 * seed, a migration) carries no request, so there is no caller connection to
 * lock out, and it is let through.
 *
 * The way back when locked out anyway — a list saved from another address, or
 * an address that changed — is the settings env override every auth key has,
 * in four steps, and the refusal names them: start the server with
 * `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value (the override wins over
 * the stored list, so the gate is open), sign in, clear the stored list (a
 * settings write of `null` to the key, which the override lets through,
 * #30385), then remove the variable. Removing it without the clear brings the
 * stored list back at the next restart.
 */

import { resolveLocale } from '@objectstack/core';
import { ipMatchesRange, type AuthManager } from './auth-manager.js';

/** The settings env override that pins `auth.allowed_ip_ranges` (`OS_` + namespace + key). */
export const ALLOWED_IP_RANGES_ENV = 'OS_AUTH_ALLOWED_IP_RANGES';

/**
 * The setting's textarea as a list: entries separated by newlines or commas,
 * trimmed, blanks dropped. Anything that is not a string reads as no list.
 */
export function parseAllowedIpRanges(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * The HTTP request a settings write arrived on, as the settings routes hand it
 * to a write predicate (`SettingsWriteOptions.transport` in `service-settings`).
 */
interface WriteTransport {
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
}

/**
 * What this predicate reads of a settings write predicate's input. Structural,
 * for the reason `SettingsReadSurface` is: plugin-auth does not depend on
 * service-settings.
 */
export interface AllowedIpRangesWriteInput {
  next: unknown;
  transport?: WriteTransport;
  locale?: string;
}

/** A refusal, in the settings write predicate's shape. */
export interface AllowedIpRangesWriteRefusal {
  message: string;
  constraint: { clientAddress: string | null };
}

interface RefusalCopy {
  outside(address: string): string;
  undetermined: string;
  recovery: string;
}

/** One entry per locale the settings bundle ships. */
const COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', RefusalCopy> = {
  en: {
    outside: (address) =>
      `No entry in this list matches ${address}, the address you are connected from, so saving it would refuse your `
      + 'own next sign-in. Add your address or its range to the list, or save the list from an address it matches.',
    undetermined:
      'The server cannot establish the address you are connected from, and while any list is set it refuses every '
      + 'such request, your own next sign-in included. Save the list from a connection whose address the server can '
      + 'establish.',
    recovery:
      ` If you are locked out, start the server with ${ALLOWED_IP_RANGES_ENV} set to an empty value, sign in, `
      + 'clear the stored list with a settings request that sets allowed_ip_ranges to null '
      + '(PUT /api/settings/auth), then remove the variable.',
  },
  'zh-CN': {
    outside: (address) =>
      `这份列表中没有任何一项与你当前连接所用的地址 ${address} 匹配，保存后你自己下一次登录就会被拒绝。`
      + '请把你的地址或所在网段加进列表，或在列表能匹配的地址上保存。',
    undetermined:
      '服务器无法确定你当前连接所用的地址；只要设置了列表，这样的请求都会被拒绝，你自己下一次登录也不例外。'
      + '请在服务器能确定地址的连接上保存。',
    recovery:
      `如果已被锁在外面：将环境变量 ${ALLOWED_IP_RANGES_ENV} 设为空值后重启服务器并登录，`
      + '用一次把 allowed_ip_ranges 设为 null 的设置请求（PUT /api/settings/auth）清除已保存的列表，再去掉该环境变量。',
  },
  'ja-JP': {
    outside: (address) =>
      `このリストには、現在接続しているアドレス ${address} に一致する項目がないため、保存するとご自身の次回のサインインが拒否されます。`
      + 'ご自身のアドレスまたはその範囲をリストに追加するか、リストに一致するアドレスから保存してください。',
    undetermined:
      'サーバーは現在の接続のアドレスを確定できません。リストが設定されている間はそのようなリクエストはすべて拒否され、'
      + 'ご自身の次回のサインインも同様です。サーバーがアドレスを確定できる接続から保存してください。',
    recovery:
      `締め出された場合は、環境変数 ${ALLOWED_IP_RANGES_ENV} を空の値にしてサーバーを再起動してサインインし、`
      + 'allowed_ip_ranges を null にする設定リクエスト（PUT /api/settings/auth）で保存済みのリストを消去してから、'
      + '環境変数を削除してください。',
  },
  'es-ES': {
    outside: (address) =>
      `Ninguna entrada de esta lista coincide con ${address}, la dirección desde la que está conectado, así que al `
      + 'guardarla se rechazaría su propio próximo inicio de sesión. Añada su dirección o su rango a la lista, o guarde '
      + 'la lista desde una dirección con la que coincida.',
    undetermined:
      'El servidor no puede determinar la dirección desde la que está conectado y, mientras haya una lista, rechaza '
      + 'todas esas solicitudes, incluido su propio próximo inicio de sesión. Guarde la lista desde una conexión cuya '
      + 'dirección el servidor pueda determinar.',
    recovery:
      ` Si queda bloqueado, inicie el servidor con ${ALLOWED_IP_RANGES_ENV} con un valor vacío, inicie sesión, `
      + 'borre la lista guardada con una solicitud de ajustes que ponga allowed_ip_ranges a null '
      + '(PUT /api/settings/auth) y después quite la variable.',
  },
};

const COPY_LOCALES = Object.keys(COPY);

function copyFor(locale: string | undefined): RefusalCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return COPY[(picked ?? 'en') as keyof typeof COPY];
}

/**
 * `auth.allowed_ip_ranges`'s settings write predicate. `manager` is read per
 * write, so the address rule is the one in force when the save happens.
 */
export function allowedIpRangesWritePredicate(
  manager: () => Pick<AuthManager, 'resolveClientAddress'> | null | undefined,
): (input: unknown) => AllowedIpRangesWriteRefusal | undefined {
  return (input) => {
    // The settings write predicate's input (`SettingsWritePredicateInput`), read structurally.
    const { next, transport, locale } = (input ?? {}) as AllowedIpRangesWriteInput;
    if (!transport) return undefined;
    const ranges = parseAllowedIpRanges(next);
    if (ranges.length === 0) return undefined;
    const mgr = manager();
    if (!mgr) return undefined;
    const address = mgr.resolveClientAddress({
      ...(transport.headers ? { headers: transport.headers } : {}),
      ...(transport.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
    });
    if (address && ranges.some((range) => ipMatchesRange(address, range))) return undefined;
    const copy = copyFor(locale);
    return {
      message: (address ? copy.outside(address) : copy.undetermined) + copy.recovery,
      constraint: { clientAddress: address ?? null },
    };
  };
}
