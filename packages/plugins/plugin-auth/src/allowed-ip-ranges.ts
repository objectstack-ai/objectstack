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
 * Only a write that arrives over HTTP is judged. An in-process write (boot,
 * seed, a migration) carries no request, so there is no caller connection to
 * lock out, and it is let through.
 *
 * The way back when locked out anyway — a list saved from another address, or
 * an address that changed — is the settings env override every auth key has:
 * `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value, then a restart. The
 * refusal names it.
 */

import { resolveLocale } from '@objectstack/core';
import type { SettingsCopyLocale } from './settings-copy-locale.js';
import { ipMatchesRange, type AuthManager } from './auth-manager.js';
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

/** A refusal, in the settings write predicate's shape. */
export interface AllowedIpRangesWriteRefusal {
  message: string;
  constraint: { clientAddress: string | null };
}

export interface AllowedIpRangesRefusalCopy {
  outside(address: string): string;
  undetermined: string;
  recovery: string;
}

/**
 * One entry per language on the platform locale table, the four served first
 * under their older codes; `resolveLocale` reads a caller's code through that
 * table (`zh-TW` → `zh-Hant`).
 */
export const ALLOWED_IP_RANGES_REFUSAL_COPY: Record<SettingsCopyLocale, AllowedIpRangesRefusalCopy> = {
  en: {
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
    outside: (address) =>
      `这份列表中没有任何一项与你当前连接所用的地址 ${address} 匹配，保存后你自己下一次登录就会被拒绝。`
      + '请把你的地址或所在网段加进列表，或在列表能匹配的地址上保存。',
    undetermined:
      '服务器无法确定你当前连接所用的地址；只要设置了列表，这样的请求都会被拒绝，你自己下一次登录也不例外。'
      + '请在服务器能确定地址的连接上保存。',
    recovery: `如果已被锁在外面，可将环境变量 ${ALLOWED_IP_RANGES_ENV} 设为空值后重启服务器。`,
  },
  'ja-JP': {
    outside: (address) =>
      `このリストには、現在接続しているアドレス ${address} に一致する項目がないため、保存するとご自身の次回のサインインが拒否されます。`
      + 'ご自身のアドレスまたはその範囲をリストに追加するか、リストに一致するアドレスから保存してください。',
    undetermined:
      'サーバーは現在の接続のアドレスを確定できません。リストが設定されている間はそのようなリクエストはすべて拒否され、'
      + 'ご自身の次回のサインインも同様です。サーバーがアドレスを確定できる接続から保存してください。',
    recovery: `締め出された場合は、環境変数 ${ALLOWED_IP_RANGES_ENV} を空の値にしてサーバーを再起動してください。`,
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
    recovery: ` Si queda bloqueado, inicie el servidor con ${ALLOWED_IP_RANGES_ENV} con un valor vacío.`,
  },
  'zh-Hant': {
    outside: (address) =>
      `這份清單中沒有任何一項與你目前連線所用的位址 ${address} 相符，儲存後你自己下一次登入就會被拒絕。`
      + '請把你的位址或所在網段加進清單，或在清單能相符的位址上儲存。',
    undetermined:
      '伺服器無法確定你目前連線所用的位址；只要設定了清單，這樣的請求都會被拒絕，你自己下一次登入也不例外。'
      + '請在伺服器能確定位址的連線上儲存。',
    recovery: `如果已被鎖在外面，可將環境變數 ${ALLOWED_IP_RANGES_ENV} 設為空值後重新啟動伺服器。`,
  },
  ar: {
    outside: (address) =>
      `لا يطابق أي إدخال في هذه القائمة العنوان ${address} الذي تتصل منه، لذا فإن حفظها سيرفض تسجيل دخولك التالي `
      + 'أنت نفسك. أضف عنوانك أو نطاقه إلى القائمة، أو احفظ القائمة من عنوان تطابقه.',
    undetermined:
      'لا يستطيع الخادم تحديد العنوان الذي تتصل منه، وما دامت هناك قائمة مضبوطة فإنه يرفض كل طلب من هذا النوع، '
      + 'بما في ذلك تسجيل دخولك التالي. احفظ القائمة من اتصال يستطيع الخادم تحديد عنوانه.',
    recovery: ` إذا مُنعت من الدخول، فشغّل الخادم مع ضبط ${ALLOWED_IP_RANGES_ENV} على قيمة فارغة.`,
  },
  fr: {
    outside: (address) =>
      `Aucune entrée de cette liste ne correspond à ${address}, l’adresse depuis laquelle vous êtes connecté : `
      + 'l’enregistrer refuserait votre propre prochaine connexion. Ajoutez votre adresse ou sa plage à la liste, ou '
      + 'enregistrez la liste depuis une adresse qu’elle autorise.',
    undetermined:
      'Le serveur ne parvient pas à établir l’adresse depuis laquelle vous êtes connecté et, tant qu’une liste est '
      + 'définie, il refuse toutes ces requêtes, y compris votre propre prochaine connexion. Enregistrez la liste '
      + 'depuis une connexion dont le serveur peut établir l’adresse.',
    recovery: ` Si vous êtes bloqué, démarrez le serveur avec ${ALLOWED_IP_RANGES_ENV} défini sur une valeur vide.`,
  },
  'pt-BR': {
    outside: (address) =>
      `Nenhuma entrada desta lista corresponde a ${address}, o endereço do qual você está conectado, então salvá-la `
      + 'recusaria o seu próprio próximo login. Adicione o seu endereço ou a faixa dele à lista, ou salve a lista a '
      + 'partir de um endereço que ela aceite.',
    undetermined:
      'O servidor não consegue determinar o endereço do qual você está conectado e, enquanto houver uma lista '
      + 'definida, recusa todas essas solicitações, inclusive o seu próprio próximo login. Salve a lista a partir de '
      + 'uma conexão cujo endereço o servidor consiga determinar.',
    recovery: ` Se você ficar bloqueado, inicie o servidor com ${ALLOWED_IP_RANGES_ENV} definido como um valor vazio.`,
  },
  ru: {
    outside: (address) =>
      `Ни одна запись этого списка не соответствует адресу ${address}, с которого вы подключены, поэтому после `
      + 'сохранения ваш собственный следующий вход будет отклонён. Добавьте в список свой адрес или его диапазон '
      + 'либо сохраните список с адреса, который ему соответствует.',
    undetermined:
      'Сервер не может определить адрес, с которого вы подключены, и, пока задан любой список, отклоняет все такие '
      + 'запросы, включая ваш собственный следующий вход. Сохраните список через подключение, адрес которого сервер '
      + 'может определить.',
    recovery: ` Если доступ уже потерян, запустите сервер с пустым значением ${ALLOWED_IP_RANGES_ENV}.`,
  },
  de: {
    outside: (address) =>
      `Kein Eintrag dieser Liste passt zu ${address}, der Adresse, von der aus Sie verbunden sind. Nach dem Speichern `
      + 'würde daher Ihre eigene nächste Anmeldung abgewiesen. Fügen Sie Ihre Adresse oder deren Bereich der Liste '
      + 'hinzu oder speichern Sie die Liste von einer Adresse aus, die sie zulässt.',
    undetermined:
      'Der Server kann die Adresse, von der aus Sie verbunden sind, nicht ermitteln, und solange eine Liste gesetzt '
      + 'ist, weist er alle solchen Anfragen ab, auch Ihre eigene nächste Anmeldung. Speichern Sie die Liste über eine '
      + 'Verbindung, deren Adresse der Server ermitteln kann.',
    recovery: ` Wenn Sie ausgesperrt sind, starten Sie den Server mit ${ALLOWED_IP_RANGES_ENV} auf einem leeren Wert.`,
  },
  ko: {
    outside: (address) =>
      `이 목록에는 현재 접속한 주소 ${address}와 일치하는 항목이 없어, 저장하면 본인의 다음 로그인이 거부됩니다. `
      + '본인의 주소나 그 대역을 목록에 추가하거나, 목록과 일치하는 주소에서 저장하세요.',
    undetermined:
      '서버가 현재 접속한 주소를 확인할 수 없으며, 목록이 설정되어 있는 동안에는 이러한 요청을 모두 거부합니다. '
      + '본인의 다음 로그인도 마찬가지입니다. 서버가 주소를 확인할 수 있는 연결에서 목록을 저장하세요.',
    recovery: ` 접속이 차단되었다면 ${ALLOWED_IP_RANGES_ENV}를 빈 값으로 설정한 채 서버를 시작하세요.`,
  },
};

const COPY_LOCALES = Object.keys(ALLOWED_IP_RANGES_REFUSAL_COPY);

/** The refusal copy for a caller's locale: through the platform locale table, else English. */
export function allowedIpRangesRefusalCopy(locale: string | undefined): AllowedIpRangesRefusalCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return ALLOWED_IP_RANGES_REFUSAL_COPY[(picked ?? 'en') as SettingsCopyLocale];
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
    const address = judgedClientAddress(mgr, transport);
    if (address && ranges.some((range) => ipMatchesRange(address, range))) return undefined;
    const copy = allowedIpRangesRefusalCopy(locale);
    return {
      message: (address ? copy.outside(address) : copy.undetermined) + copy.recovery,
      constraint: { clientAddress: address ?? null },
    };
  };
}
