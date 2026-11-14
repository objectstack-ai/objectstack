// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LOCK THE BASE, CLONE TO CUSTOMIZE — the server half of the maintainer
 * ruling of 2026-08-24, recorded verbatim and untranslated:
 *
 *   > 同意 第一步(创业阶段,Salesforce 式)
 *
 * Step 1 of the mainstream-platform comparison: a package-declared permission
 * set is a LOCKED BASE. A Studio/API save that targets one is refused loudly,
 * with a message that names the sanctioned path — clone it and edit the clone.
 * The clone is an ordinary org-owned set with no upgrade linkage, so upgrades
 * keep flowing to the base untouched. No silent overlay row is ever minted
 * again.
 *
 * ⛔ Explicitly NOT chartered by that ruling, and deliberately absent here: the
 * ServiceNow-style explicit overlay layer (badge / customization list /
 * diff-vs-base / revert / upgrade skip-report). Recorded as the mature
 * direction if customer pull for in-place customization ever appears.
 *
 * ⛔ Also not chartered: any reap, merge or migration of overlays that already
 * exist. {@link detectPackagedPermissionSetOverlays} is a READING — count plus
 * names — and it writes nothing. Disposition of existing forks is a follow-up
 * reading for the maintainer.
 *
 * ## The question this module answers, and the read it refuses to use
 *
 * "Is this permission set package-declared?" is the ONE question the lock
 * turns on, so getting the read wrong inverts the whole feature: a read that
 * answers "not package-declared" when it merely failed to find out would
 * ACCEPT exactly the save this lock exists to refuse — a silent fork produced
 * by the code written to stop silent forks.
 *
 * ⛔ So the answer is NOT taken from a name-keyed page over
 * `sys_permission_set`. The batched existence oracle the catalog seeders read
 * (`buildExistingByName`, retired with them in C3 stage 7a) capped its UNSCOPED page at
 * `limit: names.length`, which truncated the moment one name could carry more
 * than one row — and a truncated page read as `absent`. Commit e1d773eb7
 * repaired that: the page budget was measured (one row more than it would hold
 * was requested, so overflow was DETECTED) and an overflowing page degraded to
 * the per-item read instead of answering. ⚠️ That never made such an oracle
 * safe to ask HERE, and the reason is worth stating rather than re-deriving:
 * unscoped, it answered with the FIRST row by id for a name, so on a name
 * several organizations held it could answer with somebody else's row — a
 * different wrong answer to the same question. This lock's read must have no
 * page in it at all.
 *
 * ⭐ The answer comes from the engine's SchemaRegistry instead — the same
 * source {@link readDeclared} (the retired `bootstrapDeclaredPermissions`' read) uses,
 * so this plugin keeps ONE spelling of "package-declared" rather than two (Prime
 * Directive #8). That read is an in-memory array: no page, no cap, no `$in`,
 * no driver. Truncation is not a failure mode it HAS, which is a structural
 * property rather than a promise — `packaged-permission-set-lock.test.ts`
 * pins it by failing every name-keyed page read and showing the verdict
 * unchanged.
 *
 * ## Why not `managed_by`
 *
 * The ruling's parenthetical calls the target "a row carrying package
 * provenance", and the `managed_by` column is the obvious reading of that. It
 * is also measurably the WRONG fact, in both directions:
 *
 *  - too NARROW — the `provenance_skip` mechanism `permission-set-drift.ts`
 *    documents is precisely a genuinely package-declared set whose row's
 *    `managed_by` was never `'package'`. Gating on the column would leave the
 *    field-reported shape unlocked;
 *  - too BROAD — a `managed_by:'package'` row whose definition lives only in
 *    `sys_metadata` (authored and published through the METADATA door,
 *    ADR-0070, materialized by the ADR-0086 P2 publish path) has no artifact
 *    behind it. Editing it is a direct edit of the one stored definition; it
 *    forks nothing, and ADR-0094 D5-R names it the surviving
 *    `allowRuntimeCreate` neighbour. Locking it would retire a tier the ADR
 *    keeps on purpose, and would be the over-broad refusal the ruling did not
 *    ask for.
 *
 * So provenance is decided from the ARTIFACT.
 *
 * ## Fail-closed on ambiguity
 *
 * {@link classifyPackagedPermissionSet} has THREE verdicts, not two, for the
 * same reason `ExistingLookupResult` does: a read that could not ANSWER is not
 * the answer "no". Both sources are consulted; if every source that exists
 * fails — or none exists at all — the verdict is `unknown`, and the write door
 * refuses. Accepting on `unknown` would be a guess on a write door, in the one
 * direction that cannot be undone (an overlay, once minted, wins forever).
 */

import { isTenantAuthored } from '@objectstack/metadata-core';
import { resolveBundleLocale } from '@objectstack/spec/system';

/**
 * ⛔ This module imports NOTHING from the rest of the plugin, and that is
 * structural rather than stylistic: the write doors import THIS module (the
 * metadata door's gate, `packaged-permission-set-lock-gate.ts`, and the
 * catalog echo, `security-catalog-echo.ts`), so any import back the other way
 * could close a cycle around a write door.
 *
 * ⚠️ In particular it does not reuse {@link readDeclared}, and that is a
 * deliberate strictness difference rather than a second spelling: `readDeclared`
 * normalizes a failed registry read to `[]`, which is right for its callers
 * (boot seeders that can safely do nothing) and exactly wrong for a write door,
 * where `[]` would read as "no package declares this name" and ACCEPT. Same
 * source, same member, same `'permission'` type key — the tri-state is what
 * differs, and the module header says why.
 */

/**
 * The marker the catalog echo (`security-catalog-echo.ts`) stamps on bodies it
 * syncs into the metadata manager's in-memory registry, so its own copy of an
 * overlay body can never masquerade as a shipped artifact.
 *
 * It lives HERE, and the echo imports it from here, so the
 * constant has exactly one home — a lock that decides "packaged" partly by the
 * absence of this marker must not be reading a second, drifting spelling of it.
 */
export const ENV_PROJECTION_MARKER = '_envProjection';

/**
 * The `_packageId` value the metadata layer stamps on a RUNTIME SHADOW — an
 * item hydrated into the registry from a `sys_metadata` overlay row rather
 * than shipped as an artifact. The retired projection module's
 * `readDeclaredBody` excluded it for the same reason this does: a shadow is the overlay, not the
 * declaration it shadows, and reading it as "declared" would lock a set that
 * no package ships.
 */
const RUNTIME_SHADOW_PACKAGE_ID = 'sys_metadata';

/** Provenance verdict for one permission-set name. THREE outcomes, not two. */
export type PackagedSetVerdict =
  /**
   * An installed package declares this name — the base is locked.
   * [ADR-0150 D2, #31698] `packageIds`: every package that declares it, in
   * the order found (`packageId` is the first); a name two packages hold is
   * one name per package.
   */
  | { status: 'packaged'; packageId: string; packageIds: readonly string[] }
  /** No package declares it: an ordinary org-owned set, freely editable. */
  | { status: 'org' }
  /** Nothing could answer. The write door refuses; see the module header. */
  | { status: 'unknown'; reason: string };

/**
 * A layered read the caller already holds for the same name, so the classifier
 * can use it as a second artifact source without paying its own round trip.
 *
 * `failed` is deliberately representable: a caller that TRIED to read and was
 * refused must be able to say so, because that is the difference between "no
 * artifact" and "no answer".
 */
export type LayeredProbe =
  | { status: 'read'; envelope: unknown }
  /** [ADR-0150 D3, #31698] One envelope per holder: the read naming no package was refused, naming each. */
  | { status: 'read'; envelopes: readonly unknown[] }
  | { status: 'failed'; reason: string };

/**
 * Is this registry/layer item a real shipped artifact for `name`?
 *
 * [#21789] A package id on the item does not answer that by itself. The
 * registry holds stored rows as well as artifacts: the metadata layer hydrates
 * env-wide `sys_metadata` rows into it, and the list read (`getMetaItems`)
 * stamps the row's `package_id` column onto the body as `_packageId` on the
 * way. A set saved into a writable runtime package therefore carries a package
 * id just as a code-shipped one does, and reading "has a package id" as
 * "shipped by code" locked it after the first list read. What tells the two apart is the
 * provenance the hydrator writes on every stored row (ADR-0010
 * `_provenance: 'org'`), read through `isTenantAuthored`: the exclusion
 * `isCodeArtifactBody` and `SchemaRegistry.getArtifactItem` already apply, so
 * this is the platform's one answer, not a second one. A stored row of a name a
 * code package ships is hydrated wearing the artifact's envelope
 * (`_provenance: 'package'`), and the artifact itself is in the same list, so a
 * code-shipped set stays locked.
 */
function declaredPackageIdOf(item: any, name: string): string | null {
  if (!item || typeof item !== 'object') return null;
  if (item.name !== name) return null;
  // A projection echo is this plugin's own registry copy of an OVERLAY body —
  // never an artifact. Without this skip, minting an overlay would make the
  // set look packaged on the next pass, which is a lock that latches on the
  // wrong evidence.
  if (item[ENV_PROJECTION_MARKER]) return null;
  // A stored (tenant-authored) row is never a shipped artifact, whatever
  // package it is bound to. See the doc comment.
  if (isTenantAuthored(item)) return null;
  const packageId = item._packageId; // [ADR-0086 D3] the binding only: never the body's `packageId`
  if (typeof packageId !== 'string' || packageId === '') return null;
  if (packageId === RUNTIME_SHADOW_PACKAGE_ID) return null;
  return packageId;
}

/**
 * Decide whether `name` is declared by an installed package.
 *
 * Sources are consulted in order of authority; the FIRST positive answer wins,
 * and `unknown` is reported when every source that exists failed to answer.
 *
 *  1. the engine SchemaRegistry (`ql.registry.listItems('permission')`) — the
 *     one source this repo already calls "package-declared". In-memory, so it
 *     cannot truncate;
 *  2. the layered read's `code` layer, for kernels that expose no readable
 *     SchemaRegistry (minimal embeddings). One name, one envelope — no
 *     page and no cap here either.
 */
export function classifyPackagedPermissionSet(
  name: string,
  ql: any,
  layered?: LayeredProbe,
): PackagedSetVerdict {
  if (typeof name !== 'string' || name === '') {
    return { status: 'unknown', reason: 'no permission-set name to resolve provenance for' };
  }

  let anySourceAnswered = false;
  const failures: string[] = [];
  // [ADR-0150 D2, #31698] Every declaring package, never the first found alone.
  const declarers: string[] = [];
  const packaged = (): PackagedSetVerdict => ({ status: 'packaged', packageId: declarers[0]!, packageIds: [...declarers] });
  const declare = (packageId: string | null): void => {
    if (packageId && !declarers.includes(packageId)) declarers.push(packageId);
  };

  // ── source 1: the engine SchemaRegistry ──────────────────────────────────
  if (typeof ql?.registry?.listItems === 'function') {
    let items: unknown;
    let threw = false;
    try {
      items = ql.registry.listItems('permission');
    } catch (e) {
      threw = true;
      failures.push(`schema registry read failed (${(e as Error)?.message ?? e})`);
    }
    if (!threw) {
      if (Array.isArray(items)) {
        anySourceAnswered = true;
        for (const item of items) declare(declaredPackageIdOf(item, name));
        if (declarers.length > 0) return packaged();
      } else {
        // ⛔ NOT "nothing is declared". `readDeclared` normalizes a missing
        // list to `[]` because its callers are seeders that can safely do
        // nothing; a WRITE DOOR cannot, so the non-list is kept as a failure.
        failures.push('schema registry returned no list of declared permission sets');
      }
    }
  }

  // ── source 2: the layered read's `code` layer ────────────────────────────
  if (layered) {
    if (layered.status === 'failed') {
      failures.push(`layered metadata read failed (${layered.reason})`);
    } else {
      const envelopes: readonly any[] = 'envelopes' in layered ? layered.envelopes : [layered.envelope];
      const isEnvelope = (envelope: any) => envelope && typeof envelope === 'object'
        && ('effective' in envelope || 'overlay' in envelope || 'code' in envelope);
      if (envelopes.length > 0 && envelopes.every(isEnvelope)) {
        anySourceAnswered = true;
        for (const envelope of envelopes) declare(declaredPackageIdOf(envelope.code, name));
        if (declarers.length > 0) return packaged();
      } else {
        failures.push('layered metadata read returned no layer envelope');
      }
    }
  }

  if (anySourceAnswered) return { status: 'org' };
  return {
    status: 'unknown',
    reason: failures.length > 0
      ? failures.join('; ')
      : 'no artifact source available to decide package provenance',
  };
}

/**
 * The refusals' guidance, addressed to the END USER — the `userMessage` each
 * refusal below declares.
 *
 * A thrown `userMessage` is the producer-side opt-in every HTTP door reads
 * through `declaredUserMessage` (`@objectstack/types`; see
 * `ThrownHttpError.userMessage` there): it rides the wire envelope beside
 * `code`, and the console renders it verbatim in place of the generic sentence
 * it substitutes for every unmarked 403 ("You don't have permission to save
 * this record."). Unmarked, the clone guidance in `message` never reached the
 * admin who hit the lock in Setup.
 *
 * The two channels have two audiences, so they carry different text:
 *
 *  - `message` is the DIAGNOSTIC, for logs and developers. It names the set,
 *    the package and the API path, and it is unchanged.
 *  - `userMessage` is the GUIDANCE, for the admin. It names no machine name,
 *    id, package id or API path (the console's friendly-copy rule), so it
 *    carries no host state either: a sandboxed body that catches this error
 *    receives static text.
 *
 * [#32656] In the caller's language (ruling C on #32440): the producer
 * composes the sentence in the request locale, else the workspace default,
 * else `en` ({@link packagedSetUserMessage}). The write door states the two
 * locales (`MetadataAuthoringGateContext.userTextLocales`); a caller that
 * states none gets `en`, the text this refusal always carried.
 */
type PackagedSetUserText = Readonly<Record<string, string>>;

const LOCKED_USER_TEXT: PackagedSetUserText = {
  en: `This permission set is provided by an installed package and can't be edited here. Clone it instead `
    + `with the Clone action, then edit the clone. The clone is your organization's own permission set, `
    + `and package upgrades keep reaching the original.`,
  'zh-Hans': '此权限集由已安装的软件包提供，不能在这里编辑。请使用“克隆”操作克隆它，然后编辑克隆出的权限集。'
    + '克隆出的权限集归贵组织所有，软件包升级仍会照常更新原权限集。',
  'zh-Hant': '此權限集由已安裝的套件提供，無法在這裡編輯。請使用「複製」動作複製它，然後編輯複製出的權限集。'
    + '複製出的權限集歸貴組織所有，套件升級仍會照常更新原權限集。',
  ja: 'この権限セットはインストール済みのパッケージが提供しているため、ここでは編集できません。'
    + '「複製」アクションで複製し、複製したほうを編集してください。複製した権限セットは組織独自のものになり、'
    + 'パッケージのアップグレードは引き続き元の権限セットに適用されます。',
  ko: '이 권한 집합은 설치된 패키지가 제공하므로 여기에서 편집할 수 없습니다. 복제 작업으로 복제한 다음 복제본을 '
    + '편집하세요. 복제본은 조직 고유의 권한 집합이 되며, 패키지 업그레이드는 계속 원본에 적용됩니다.',
  es: 'Este conjunto de permisos lo proporciona un paquete instalado y no se puede editar aquí. Clónelo con la '
    + 'acción Clonar y edite el clon. El clon es un conjunto de permisos propio de su organización, y las '
    + 'actualizaciones del paquete siguen llegando al original.',
  fr: 'Cet ensemble d’autorisations est fourni par un package installé et ne peut pas être modifié ici. '
    + 'Clonez-le avec l’action Cloner, puis modifiez le clone. Le clone appartient à votre organisation, et les '
    + 'mises à jour du package continuent de s’appliquer à l’original.',
  de: 'Dieser Berechtigungssatz wird von einem installierten Paket bereitgestellt und kann hier nicht bearbeitet '
    + 'werden. Klonen Sie ihn mit der Aktion „Klonen“ und bearbeiten Sie den Klon. Der Klon gehört Ihrer '
    + 'Organisation, und Paket-Upgrades erreichen weiterhin das Original.',
  'pt-BR': 'Este conjunto de permissões é fornecido por um pacote instalado e não pode ser editado aqui. Clone-o '
    + 'com a ação Clonar e edite o clone. O clone é um conjunto de permissões da sua organização, e as '
    + 'atualizações do pacote continuam chegando ao original.',
  ru: 'Этот набор разрешений предоставлен установленным пакетом, и его нельзя изменить здесь. Клонируйте его '
    + 'действием «Клонировать» и измените клон. Клон принадлежит вашей организации, а обновления пакета '
    + 'по-прежнему применяются к оригиналу.',
  ar: 'مجموعة الأذونات هذه يوفرها حزمة مثبتة ولا يمكن تعديلها هنا. انسخها باستخدام إجراء النسخ، ثم عدّل النسخة. '
    + 'النسخة مجموعة أذونات خاصة بمؤسستك، وتستمر ترقيات الحزمة في الوصول إلى المجموعة الأصلية.',
};

const PROVENANCE_UNKNOWN_USER_TEXT: PackagedSetUserText = {
  en: `This permission set can't be saved right now, because the system couldn't confirm whether an installed `
    + `package provides it. Try again in a moment. To customize a permission set that a package provides, `
    + `clone it with the Clone action and edit the clone.`,
  'zh-Hans': '此权限集暂时无法保存，因为系统无法确认它是否由已安装的软件包提供。请稍后重试。'
    + '如需自定义由软件包提供的权限集，请使用“克隆”操作克隆它，然后编辑克隆出的权限集。',
  'zh-Hant': '此權限集暫時無法儲存，因為系統無法確認它是否由已安裝的套件提供。請稍後再試。'
    + '如需自訂由套件提供的權限集，請使用「複製」動作複製它，然後編輯複製出的權限集。',
  ja: 'この権限セットは現在保存できません。インストール済みのパッケージが提供しているかどうかを確認できなかったためです。'
    + 'しばらくしてからもう一度お試しください。パッケージが提供する権限セットをカスタマイズするには、'
    + '「複製」アクションで複製し、複製したほうを編集してください。',
  ko: '설치된 패키지가 이 권한 집합을 제공하는지 확인할 수 없어 지금은 저장할 수 없습니다. 잠시 후 다시 시도하세요. '
    + '패키지가 제공하는 권한 집합을 사용자 지정하려면 복제 작업으로 복제한 다음 복제본을 편집하세요.',
  es: 'Este conjunto de permisos no se puede guardar ahora, porque el sistema no pudo confirmar si lo proporciona '
    + 'un paquete instalado. Vuelva a intentarlo en un momento. Para personalizar un conjunto de permisos que '
    + 'proporciona un paquete, clónelo con la acción Clonar y edite el clon.',
  fr: 'Cet ensemble d’autorisations ne peut pas être enregistré pour le moment, car le système n’a pas pu '
    + 'confirmer s’il est fourni par un package installé. Réessayez dans un instant. Pour personnaliser un '
    + 'ensemble d’autorisations fourni par un package, clonez-le avec l’action Cloner et modifiez le clone.',
  de: 'Dieser Berechtigungssatz kann gerade nicht gespeichert werden, weil das System nicht bestätigen konnte, '
    + 'ob ein installiertes Paket ihn bereitstellt. Versuchen Sie es gleich noch einmal. Um einen '
    + 'Berechtigungssatz anzupassen, den ein Paket bereitstellt, klonen Sie ihn mit der Aktion „Klonen“ und '
    + 'bearbeiten Sie den Klon.',
  'pt-BR': 'Este conjunto de permissões não pode ser salvo agora, porque o sistema não conseguiu confirmar se um '
    + 'pacote instalado o fornece. Tente novamente em instantes. Para personalizar um conjunto de permissões '
    + 'fornecido por um pacote, clone-o com a ação Clonar e edite o clone.',
  ru: 'Этот набор разрешений сейчас нельзя сохранить: системе не удалось проверить, предоставлен ли он '
    + 'установленным пакетом. Повторите попытку чуть позже. Чтобы настроить набор разрешений из пакета, '
    + 'клонируйте его действием «Клонировать» и измените клон.',
  ar: 'لا يمكن حفظ مجموعة الأذونات هذه الآن، لأن النظام لم يتمكن من التأكد مما إذا كانت حزمة مثبتة توفرها. '
    + 'حاول مرة أخرى بعد قليل. لتخصيص مجموعة أذونات توفرها حزمة، انسخها باستخدام إجراء النسخ ثم عدّل النسخة.',
};

/**
 * The sentence of `text` in the first locale of `locales` it has, each code
 * matched by the platform's one locale ladder ({@link resolveBundleLocale}:
 * exact, case-insensitive, the platform table language, one subtag shorter);
 * `en` when none matches or none is stated.
 */
function packagedSetUserMessage(
  text: PackagedSetUserText,
  locales: readonly (string | null | undefined)[] | undefined,
): string {
  for (const locale of locales ?? []) {
    if (typeof locale !== 'string' || locale.length === 0) continue;
    const matched = resolveBundleLocale(text, locale);
    if (matched !== undefined) return text[matched]!;
  }
  return text.en!;
}

/**
 * The refusal a write door throws for a package-declared set.
 *
 * `NOT_OVERRIDABLE` / 403 is deliberately the SAME envelope the metadata
 * protocol's ADR-0005 tier gate already answers with for this exact condition
 * — one condition, one vocabulary. The code is NOT a `StandardErrorCode`
 * member: it is an ADR-0112 registered extension code, and because this
 * package stamps it, `ERROR_CODE_LEDGER['@objectstack/plugin-security']`
 * lists it beside metadata-protocol's row (provenance, not identity — a code
 * shipped in `dist` is registered under every package that stamps it). What changes is the
 * MESSAGE: the producer's says the type has not opted into overlay writes,
 * which tells an admin nothing they can act on. The ruling's whole point is
 * that the refusal teaches the sanctioned path.
 *
 * ⚠️ The message deliberately does NOT open with `[Security] Access denied`.
 * That prefix is a MATCHER (`isPermissionDeniedError`, `mapDataError`,
 * `rest-server`'s sanitiser all read it as "this is a 403 PERMISSION_DENIED"),
 * and opening with it would re-flatten this refusal's code on the wire —
 * see the note in `errors.ts`.
 *
 * `status` AND `statusCode`: the two transports read different property names
 * (`mapDataError` passes a domain error through on `.status`; the runtime
 * dispatcher's `errorFromThrown` reads `.status` then falls back to
 * `.statusCode`), and a door's refusal can reach either.
 *
 * `userMessage` carries the same guidance for the end user — see the note on
 * the texts above.
 *
 * One remedy, the clone: the one door that throws it (the metadata door's
 * authoring gate) judges an override of the shipped base. The "choose a
 * different name" variant the retired data door's create raised is gone with
 * that door (C3 stage 8). `operation` stays in the published signature and
 * no longer selects the text.
 */
export class PackagedPermissionSetLockedError extends Error {
  readonly code = 'NOT_OVERRIDABLE';
  readonly status = 403;
  readonly statusCode = 403;
  /** The guidance addressed to the end user; `message` stays the diagnostic. */
  readonly userMessage: string;
  /**
   * [ADR-0150 D2, #31698] `packageId`: the package that declares the set, or
   * every one that does, each named — never the first found alone.
   */
  constructor(
    name: string,
    packageId: string | readonly string[],
    _operation: 'insert' | 'update',
    /** [#32656] The caller's language ladder: request locale, then workspace default. */
    userTextLocales?: readonly (string | null | undefined)[],
  ) {
    const declarers = (typeof packageId === 'string' ? [packageId] : packageId).map((id) => `'${id}'`);
    const by = declarers.length > 1 ? `packages ${declarers.slice(0, -1).join(', ')} and ${declarers[declarers.length - 1]}` : `package ${declarers[0]}`;
    super(
      `[Security] Permission set '${name}' is declared by ${by} and is locked — `
      + `editing it here would silently fork it from the package, and the fork would win over `
      + `every future upgrade with no signal. `
      + `Clone it instead (the "Clone" action on the permission set, or POST `
      + `/api/v1/security/permission-sets/${name}/clone with a new name) and edit the clone — the clone is your organization's own set, and upgrades keep `
      + `flowing to '${name}' untouched.`,
    );
    this.name = 'PackagedPermissionSetLockedError';
    this.userMessage = packagedSetUserMessage(LOCKED_USER_TEXT, userTextLocales);
  }
}

/**
 * Thrown when provenance could not be determined at all — fail-closed.
 *
 * Its `userMessage` says to retry or clone and leaves the unreadable source's
 * `reason` in `message`, where the diagnostic belongs.
 */
export class PackagedPermissionSetProvenanceUnknownError extends Error {
  readonly code = 'NOT_OVERRIDABLE';
  readonly status = 403;
  readonly statusCode = 403;
  /** The guidance addressed to the end user; `message` stays the diagnostic. */
  readonly userMessage: string;
  constructor(name: string, reason: string, userTextLocales?: readonly (string | null | undefined)[]) {
    super(
      `[Security] Permission set '${name}' cannot be saved right now: this system could not determine `
      + `whether the set is declared by an installed package (${reason}). The save is refused rather than `
      + `accepted, because accepting it would silently fork a packaged set if it turns out to be one. Retry `
      + `once the metadata layer is readable; if you meant to customize a packaged set, clone it instead.`,
    );
    this.name = 'PackagedPermissionSetProvenanceUnknownError';
    this.userMessage = packagedSetUserMessage(PROVENANCE_UNKNOWN_USER_TEXT, userTextLocales);
  }
}

/**
 * The write-door assertion: refuse a save that targets a package-declared set,
 * and refuse a save whose provenance cannot be determined.
 *
 * Returns the verdict on the accept path so a caller can log or branch on it.
 */
export function assertPermissionSetNotPackageDeclared(
  name: string,
  ql: any,
  operation: 'insert' | 'update',
  layered?: LayeredProbe,
  userTextLocales?: readonly (string | null | undefined)[],
): PackagedSetVerdict {
  const verdict = classifyPackagedPermissionSet(name, ql, layered);
  if (verdict.status === 'packaged') {
    throw new PackagedPermissionSetLockedError(name, verdict.packageIds, operation, userTextLocales);
  }
  if (verdict.status === 'unknown') {
    throw new PackagedPermissionSetProvenanceUnknownError(name, verdict.reason, userTextLocales);
  }
  return verdict;
}
