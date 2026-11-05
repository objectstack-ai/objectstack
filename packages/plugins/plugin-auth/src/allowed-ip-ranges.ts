// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D5 — the `auth.allowed_ip_ranges` setting outside the gate itself
 * (#30203).
 *
 *  - {@link parseAllowedIpRanges} is THE reading of the setting's textarea, for
 *    the settings binding (`bindAuthSettings`) and for the save predicate below,
 *    so the list a save is judged by is the list the gate then enforces.
 *  - {@link allowedIpRangesWritePredicate} refuses a save of a list holding an
 *    entry that names no range (`parseIpRange` in `auth-manager.ts`, the
 *    gate's own reading: such an entry matches no address there). It also
 *    refuses a save, through the settings console, of a list that leaves out
 *    the address the saving request itself comes from. Saved, such a list
 *    refuses the administrator's own next sign-in, and nothing at the save
 *    said so.
 *  - {@link judgedClientAddress} is THE reading of a request's address for this
 *    setting, called by that save check and by the read that shows an
 *    administrator the address before they save (`GET /admin/client-address`,
 *    `client-address-read.ts`, #30398), so the address shown is the address
 *    judged.
 *
 * The address judged at the save is the one the gate judges at sign-in: the
 * auth manager's {@link AuthManager.resolveClientAddress}, from the same two
 * facts (the transport's peer address and the request headers) under the same
 * `server.trustProxy` declaration, and matched by the same
 * {@link ipMatchesRange}. A request whose address the server cannot establish
 * is refused at the gate whenever a list is set, so a non-empty list is refused
 * at the save for it too.
 *
 * The entries are judged on every write, an in-process one (boot, seed, a
 * migration) included: an entry the gate cannot read admits nobody it was
 * written for, whoever writes it. The address is judged only on a write that
 * arrives over HTTP. An in-process write carries no request, so there is no
 * caller connection to lock out, and its address is not judged.
 *
 * The way back when locked out anyway — a list saved from another address, or
 * an address that changed — is the settings env override every auth key has:
 * `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value, then a restart. The
 * refusal names it.
 */

import { resolveLocale } from '@objectstack/core';
import { ipMatchesRange, unreadableIpRangeEntries, type AuthManager } from './auth-manager.js';
import { FORWARDED_CLIENT_ADDRESS_HEADERS } from './client-address-forwarding.js';

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
 * The two facts a door holds about the HTTP request it serves: its headers and
 * the transport's own peer address. The settings routes hand a write predicate
 * this shape (`SettingsWriteOptions.transport` in `service-settings`).
 */
export interface RequestTransport {
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
}

/**
 * [#30398] The address `auth.allowed_ip_ranges` judges for a request, or
 * `undefined` when the server cannot establish one: the auth manager's
 * {@link AuthManager.resolveClientAddress} (`server.trustProxy` read there),
 * handed the request's peer address and only the forwarded-address headers that
 * rule reads ({@link FORWARDED_CLIENT_ADDRESS_HEADERS}), the narrowing the
 * settings service applies to the save check's input before it arrives here.
 *
 * Both doors that speak about this address call it: the save check below, and
 * the read that serves the address to an administrator before a save
 * (`client-address-read.ts`). One call, so what the read shows and what the
 * save judges cannot drift apart.
 */
export function judgedClientAddress(
  manager: Pick<AuthManager, 'resolveClientAddress'>,
  transport: RequestTransport,
): string | undefined {
  let headers: Record<string, string | string[] | undefined> | undefined;
  if (transport.headers) {
    headers = {};
    for (const [name, value] of Object.entries(transport.headers)) {
      if (FORWARDED_CLIENT_ADDRESS_HEADERS.includes(name.toLowerCase())) headers[name] = value;
    }
  }
  return manager.resolveClientAddress({
    ...(headers ? { headers } : {}),
    ...(transport.remoteAddress ? { remoteAddress: transport.remoteAddress } : {}),
  });
}

/**
 * What this predicate reads of a settings write predicate's input. Structural,
 * for the reason `SettingsReadSurface` is: plugin-auth does not depend on
 * service-settings.
 */
export interface AllowedIpRangesWriteInput {
  next: unknown;
  transport?: RequestTransport;
  locale?: string;
}

/**
 * A refusal, in the settings write predicate's shape: the entries that name no
 * range (`invalidEntries`, as written), or the judged address the list leaves
 * out (`clientAddress`, `null` when the server cannot establish one).
 */
export interface AllowedIpRangesWriteRefusal {
  message: string;
  constraint: { invalidEntries: string[] } | { clientAddress: string | null };
}

interface RefusalCopy {
  unreadable(entries: string): string;
  outside(address: string): string;
  undetermined: string;
  recovery: string;
}

/** One entry per locale the settings bundle ships. */
const COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', RefusalCopy> = {
  en: {
    unreadable: (entries) =>
      `Not an IP address or a CIDR range: ${entries}. Each entry is an address (192.0.2.7, 2001:db8::1), or an `
      + 'address, "/" and a prefix length in decimal digits: 0 to 32 for IPv4, 0 to 128 for IPv6 (203.0.113.0/24, '
      + '2001:db8::/32). An entry the server cannot read matches no address, so the list is not saved.',
    outside: (address) =>
      `No entry in this list matches ${address}, the address you are connected from, so saving it would refuse your `
      + 'own next sign-in. Add your address or its range to the list, or save the list from an address it matches.',
    undetermined:
      'The server cannot establish the address you are connected from, and while any list is set it refuses every '
      + 'such request, your own next sign-in included. Save the list from a connection whose address the server can '
      + 'establish.',
    recovery: ` If you are locked out, start the server with ${ALLOWED_IP_RANGES_ENV} set to an empty value.`,
  },
  'zh-CN': {
    unreadable: (entries) =>
      `以下条目不是 IP 地址或 CIDR 网段：${entries}。每一项应为一个地址（如 192.0.2.7、2001:db8::1），`
      + '或地址加 "/" 再加用十进制数字写的前缀长度：IPv4 为 0 到 32，IPv6 为 0 到 128（如 203.0.113.0/24、2001:db8::/32）。'
      + '服务器无法识别的条目不会匹配任何地址，因此列表未保存。',
    outside: (address) =>
      `这份列表中没有任何一项与你当前连接所用的地址 ${address} 匹配，保存后你自己下一次登录就会被拒绝。`
      + '请把你的地址或所在网段加进列表，或在列表能匹配的地址上保存。',
    undetermined:
      '服务器无法确定你当前连接所用的地址；只要设置了列表，这样的请求都会被拒绝，你自己下一次登录也不例外。'
      + '请在服务器能确定地址的连接上保存。',
    recovery: `如果已被锁在外面，可将环境变量 ${ALLOWED_IP_RANGES_ENV} 设为空值后重启服务器。`,
  },
  'ja-JP': {
    unreadable: (entries) =>
      `次の項目は IP アドレスでも CIDR 範囲でもありません：${entries}。各項目はアドレス（例：192.0.2.7、2001:db8::1）、`
      + 'またはアドレスに "/" と 10 進数字のプレフィックス長を続けたもの（IPv4 は 0〜32、IPv6 は 0〜128。例：203.0.113.0/24、'
      + '2001:db8::/32）にしてください。サーバーが読み取れない項目はどのアドレスにも一致しないため、リストは保存されません。',
    outside: (address) =>
      `このリストには、現在接続しているアドレス ${address} に一致する項目がないため、保存するとご自身の次回のサインインが拒否されます。`
      + 'ご自身のアドレスまたはその範囲をリストに追加するか、リストに一致するアドレスから保存してください。',
    undetermined:
      'サーバーは現在の接続のアドレスを確定できません。リストが設定されている間はそのようなリクエストはすべて拒否され、'
      + 'ご自身の次回のサインインも同様です。サーバーがアドレスを確定できる接続から保存してください。',
    recovery: `締め出された場合は、環境変数 ${ALLOWED_IP_RANGES_ENV} を空の値にしてサーバーを再起動してください。`,
  },
  'es-ES': {
    unreadable: (entries) =>
      `No es una dirección IP ni un rango CIDR: ${entries}. Cada entrada es una dirección (192.0.2.7, 2001:db8::1) o `
      + 'una dirección seguida de "/" y una longitud de prefijo en dígitos decimales: de 0 a 32 para IPv4 y de 0 a 128 '
      + 'para IPv6 (203.0.113.0/24, 2001:db8::/32). Una entrada que el servidor no puede leer no coincide con ninguna '
      + 'dirección, así que la lista no se guarda.',
    outside: (address) =>
      `Ninguna entrada de esta lista coincide con ${address}, la dirección desde la que está conectado, así que al `
      + 'guardarla se rechazaría su propio próximo inicio de sesión. Añada su dirección o su rango a la lista, o guarde '
      + 'la lista desde una dirección con la que coincida.',
    undetermined:
      'El servidor no puede determinar la dirección desde la que está conectado y, mientras haya una lista, rechaza '
      + 'todas esas solicitudes, incluido su propio próximo inicio de sesión. Guarde la lista desde una conexión cuya '
      + 'dirección el servidor pueda determinar.',
    recovery: ` Si queda bloqueado, inicie el servidor con ${ALLOWED_IP_RANGES_ENV} con un valor vacío.`,
  },
};

const COPY_LOCALES = Object.keys(COPY);

function copyFor(locale: string | undefined): RefusalCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return COPY[(picked ?? 'en') as keyof typeof COPY];
}

/**
 * `auth.allowed_ip_ranges`'s settings write predicate. A list holding an entry
 * that names no range is refused first, on every write, naming the entries;
 * then a list that leaves out the judged address of an HTTP write. `manager` is
 * read per write, so the address rule is the one in force when the save happens.
 */
export function allowedIpRangesWritePredicate(
  manager: () => Pick<AuthManager, 'resolveClientAddress'> | null | undefined,
): (input: unknown) => AllowedIpRangesWriteRefusal | undefined {
  return (input) => {
    // The settings write predicate's input (`SettingsWritePredicateInput`), read structurally.
    const { next, transport, locale } = (input ?? {}) as AllowedIpRangesWriteInput;
    const ranges = parseAllowedIpRanges(next);
    if (ranges.length === 0) return undefined;
    const unreadable = unreadableIpRangeEntries(ranges);
    if (unreadable.length > 0) {
      return {
        message: copyFor(locale).unreadable(unreadable.map((entry) => JSON.stringify(entry)).join(', ')),
        constraint: { invalidEntries: unreadable },
      };
    }
    if (!transport) return undefined;
    const mgr = manager();
    if (!mgr) return undefined;
    const address = judgedClientAddress(mgr, transport);
    if (address && ranges.some((range) => ipMatchesRange(address, range))) return undefined;
    const copy = copyFor(locale);
    return {
      message: (address ? copy.outside(address) : copy.undetermined) + copy.recovery,
      constraint: { clientAddress: address ?? null },
    };
  };
}
