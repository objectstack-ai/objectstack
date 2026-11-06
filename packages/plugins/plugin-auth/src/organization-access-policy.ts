// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0069 TL;DR 6, D3, D4, D5] The access policy, per organization: the
 * allowed IP ranges, the idle, absolute and concurrent session limits, and the
 * multi-factor requirement, each set by an organization in the
 * `access_policy` settings namespace (scope `tenant`: one row per
 * organization, ADR-0131) on top of the deployment's own value in the `auth`
 * namespace (scope `global`).
 *
 * Rulings of record (objectstack-ai/cloud#3668): 「支持按组织（推荐）」, so the
 * policy is set per organization; and 「可以，按三档做（推荐）」, so the
 * multi-factor requirement has three levels, `off`, `administrators` and
 * `everyone`, where "administrators" are ADR-0090 D12's three kinds.
 *
 * ## The deployment value is the default AND the floor
 *
 * An organization may tighten its policy and never loosen it. Each key's zero
 * value — an empty list, `0`, `off` — means "nothing beyond the deployment's":
 * an organization that sets nothing is held to the deployment's value, which is
 * the default. Every other value is judged twice:
 *
 *  - at the save, by {@link accessPolicyFloorRefusal}: a value weaker than the
 *    deployment's is refused, because honoured it would loosen the floor and
 *    ignored it would read as saved while doing nothing;
 *  - at enforcement, by the combining rules below, which hold the floor
 *    whatever is stored — a deployment that tightens later is in force at once
 *    for every organization, with no stored row to rewrite.
 *
 * The rule, per key:
 *
 *  | key | organization may save | enforced |
 *  |---|---|---|
 *  | `allowed_ip_ranges` | an empty list; or ranges each inside a deployment range (any range when the deployment sets none), one of which admits the saving request's own address | an address must pass the deployment's list AND the organization's |
 *  | `session_idle_timeout_minutes`, `session_absolute_max_hours`, `max_concurrent_sessions_per_user` | `0`; or a positive value no larger than the deployment's (any positive value when the deployment's is `0`) | the smaller positive value of the two; `0` on both is no limit |
 *  | `mfa_required` | `off`; or a level at least as strong as the deployment's | the stronger level of the two (`off` < `administrators` < `everyone`) |
 *
 * ## Which organization's policy applies
 *
 * The organization the session is scoped to (`session.activeOrganizationId`).
 * Sign-in happens before a session has one, so the sign-in request itself is
 * judged by the deployment's policy alone (the floor, which binds every
 * organization). The session the sign-in mints is scoped by `session.create`
 * (ADR-0093 D9, owner-preferred, else the oldest membership), and from there
 * the scoped organization's policy decides: the scoping itself is refused from
 * an address the organization's list does not admit
 * ({@link judgeSessionScopingAddress}), and every later request on the session
 * is held to that organization's limits and multi-factor level. Switching the
 * active organization re-scopes the session and is judged the same way.
 *
 * ## Break-glass
 *
 * An organization's network list never holds a tenant-level administrator
 * (ADR-0090 D12 kind 1, the platform administrator): the deployment's list
 * still does. An organization that locks out all of its own administrators can
 * therefore be reopened from inside the product, by the deployment's
 * administrator clearing the list — the per-organization reading of the
 * last-administrator guard (cloud ADR-0024 D5.2). The save check
 * ({@link accessPolicyFloorRefusal}) refuses a list that leaves out the saving
 * request's own address, so the administrator who saves is never the one it
 * locks out.
 */

import { resolveLocale } from '@objectstack/core';
import type { SettingsCopyLocale } from './settings-copy-locale.js';
import { ipMatchesRange } from './auth-manager.js';
import { parseAllowedIpRanges, type RequestTransport } from './allowed-ip-ranges.js';

/** The settings namespace an organization's access policy lives in (scope `tenant`). */
export const ACCESS_POLICY_NAMESPACE = 'access_policy';

/** The keys of {@link ACCESS_POLICY_NAMESPACE}, each the same key as its deployment twin in `auth`. */
export const ACCESS_POLICY_KEYS = {
  allowedIpRanges: 'allowed_ip_ranges',
  sessionIdleTimeoutMinutes: 'session_idle_timeout_minutes',
  sessionAbsoluteMaxHours: 'session_absolute_max_hours',
  maxConcurrentSessions: 'max_concurrent_sessions_per_user',
  mfaRequired: 'mfa_required',
} as const;

/** The three multi-factor requirement levels, weakest first (ruling 「可以，按三档做（推荐）」). */
export const MFA_REQUIREMENT_LEVELS = ['off', 'administrators', 'everyone'] as const;
export type MfaRequirementLevel = (typeof MFA_REQUIREMENT_LEVELS)[number];

/** `off` < `administrators` < `everyone`. */
export function mfaLevelRank(level: MfaRequirementLevel): number {
  return MFA_REQUIREMENT_LEVELS.indexOf(level);
}

/** The stronger of two levels. */
export function strongerMfaLevel(a: MfaRequirementLevel, b: MfaRequirementLevel): MfaRequirementLevel {
  return mfaLevelRank(a) >= mfaLevelRank(b) ? a : b;
}

/** Is `value` one of the three level names? */
export function isMfaRequirementLevel(value: unknown): value is MfaRequirementLevel {
  return typeof value === 'string' && (MFA_REQUIREMENT_LEVELS as readonly string[]).includes(value);
}

/**
 * The deployment's `auth.mfa_required` as a level.
 *
 * The three level names are the contract. The setting was a toggle before it
 * had levels, and its env override `OS_AUTH_MFA_REQUIRED` may still carry a
 * toggle's spelling on a deployment upgraded without editing its environment;
 * a stored toggle is rewritten to a level once, at boot
 * (`migrateLegacyMfaRequiredSetting`). So a toggle spelling read here can only
 * come from that variable, and it keeps its meaning — on is `everyone`, off is
 * `off` — with `legacy: true`, so the caller says once that the variable needs
 * a level name. Anything else is not a level: `undefined`, and the caller keeps
 * the value in force.
 */
export function readMfaRequirementLevel(
  raw: unknown,
): { level: MfaRequirementLevel; legacy: boolean } | undefined {
  if (isMfaRequirementLevel(raw)) return { level: raw, legacy: false };
  if (raw === true || raw === 1) return { level: 'everyone', legacy: true };
  if (raw === false || raw === 0) return { level: 'off', legacy: true };
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (isMfaRequirementLevel(text)) return { level: text, legacy: false };
    if (text === 'true' || text === '1') return { level: 'everyone', legacy: true };
    if (text === 'false' || text === '0') return { level: 'off', legacy: true };
  }
  return undefined;
}

/** The smaller positive limit of two, `0` meaning no limit on either side. */
export function tighterLimit(deployment: number, organization: number): number {
  const d = Math.max(0, Math.floor(Number(deployment) || 0));
  const o = Math.max(0, Math.floor(Number(organization) || 0));
  if (d <= 0) return o;
  if (o <= 0) return d;
  return Math.min(d, o);
}

/** The base address and prefix length of a range entry, `bits` undefined for an exact address. */
function splitRange(range: string): { base: string; bits: number | undefined; v6: boolean } {
  const [rawBase, rawBits] = range.trim().split('/');
  const base = (rawBase ?? '').trim();
  const v6 = base.includes(':');
  if (rawBits === undefined) return { base, bits: undefined, v6 };
  const bits = /^\d{1,3}$/.test(rawBits.trim()) ? Number(rawBits.trim()) : Number.NaN;
  return { base, bits, v6 };
}

/**
 * Does every address `inner` names lie inside `outer`? Both are entries of an
 * allow-list, as {@link ipMatchesRange} reads them: an exact address, or a
 * CIDR range of the same family. An inner range is inside when its prefix is
 * at least as long as the outer one's and its base address matches the outer
 * range; an exact address, when the outer range matches it.
 */
export function rangeWithin(inner: string, outer: string): boolean {
  const i = splitRange(inner);
  const o = splitRange(outer);
  if (!i.base || !o.base || i.v6 !== o.v6) return false;
  const width = i.v6 ? 128 : 32;
  const innerBits = i.bits === undefined ? width : i.bits;
  const outerBits = o.bits === undefined ? width : o.bits;
  if (!Number.isFinite(innerBits) || innerBits < 0 || innerBits > width) return false;
  if (!Number.isFinite(outerBits) || outerBits < 0 || outerBits > width) return false;
  if (innerBits < outerBits) return false;
  return ipMatchesRange(i.base, outer);
}

/** One organization's own access-policy values — each key's zero value is "nothing beyond the deployment's". */
export interface OrganizationAccessPolicy {
  allowedIpRanges: string[];
  sessionIdleTimeoutMinutes: number;
  sessionAbsoluteMaxHours: number;
  maxConcurrentSessions: number;
  mfaRequired: MfaRequirementLevel;
}

/** The policy of an organization that sets nothing, and of a session scoped to none. */
export const NO_ORGANIZATION_POLICY: Readonly<OrganizationAccessPolicy> = Object.freeze({
  allowedIpRanges: Object.freeze([]) as unknown as string[],
  sessionIdleTimeoutMinutes: 0,
  sessionAbsoluteMaxHours: 0,
  maxConcurrentSessions: 0,
  mfaRequired: 'off',
});

function nonNegativeInt(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * An organization's resolved `access_policy` values (`key → value`, as the
 * settings service resolves them for that organization) as a policy. A value
 * that is not of its key's type reads as the key's zero value: the save door
 * refuses such a value, so only a row written around it can carry one, and the
 * deployment's value still holds then.
 */
export function readOrganizationAccessPolicy(values: Record<string, unknown> | undefined): OrganizationAccessPolicy {
  if (!values) return { ...NO_ORGANIZATION_POLICY, allowedIpRanges: [] };
  return {
    allowedIpRanges: parseAllowedIpRanges(values[ACCESS_POLICY_KEYS.allowedIpRanges]),
    sessionIdleTimeoutMinutes: nonNegativeInt(values[ACCESS_POLICY_KEYS.sessionIdleTimeoutMinutes]),
    sessionAbsoluteMaxHours: nonNegativeInt(values[ACCESS_POLICY_KEYS.sessionAbsoluteMaxHours]),
    maxConcurrentSessions: nonNegativeInt(values[ACCESS_POLICY_KEYS.maxConcurrentSessions]),
    mfaRequired: isMfaRequirementLevel(values[ACCESS_POLICY_KEYS.mfaRequired])
      ? (values[ACCESS_POLICY_KEYS.mfaRequired] as MfaRequirementLevel)
      : 'off',
  };
}

/** The deployment's values for the same keys — the `auth` settings as the settings pass applied them. */
export interface DeploymentAccessFloor {
  allowedIpRanges?: string[];
  sessionIdleTimeoutMinutes?: number;
  sessionAbsoluteMaxHours?: number;
  maxConcurrentSessions?: number;
  mfaRequirement?: MfaRequirementLevel;
}

/** The session limits in force for a session scoped to an organization with `organization`'s policy. */
export function effectiveSessionLimits(
  floor: DeploymentAccessFloor,
  organization: OrganizationAccessPolicy,
): { idleMinutes: number; absoluteHours: number; concurrent: number } {
  return {
    idleMinutes: tighterLimit(floor.sessionIdleTimeoutMinutes ?? 0, organization.sessionIdleTimeoutMinutes),
    absoluteHours: tighterLimit(floor.sessionAbsoluteMaxHours ?? 0, organization.sessionAbsoluteMaxHours),
    concurrent: tighterLimit(floor.maxConcurrentSessions ?? 0, organization.maxConcurrentSessions),
  };
}

/** The multi-factor level in force for a session scoped to an organization with `organization`'s policy. */
export function effectiveMfaLevel(
  floor: DeploymentAccessFloor,
  organization: OrganizationAccessPolicy,
): MfaRequirementLevel {
  return strongerMfaLevel(floor.mfaRequirement ?? 'off', organization.mfaRequired);
}

/**
 * Does the organization's own list admit `address`? An empty list admits every
 * address (the deployment's list, judged at the auth door, still applies); a
 * set list admits only an address inside one of its ranges, and never an
 * undetermined one — the deployment gate's reading (`isClientIpAllowed`).
 */
export function organizationListAdmits(address: string | undefined, organization: OrganizationAccessPolicy): boolean {
  if (organization.allowedIpRanges.length === 0) return true;
  if (!address) return false;
  return organization.allowedIpRanges.some((range) => ipMatchesRange(address, range));
}

/**
 * The refusal of a session scoped to an organization from an address its list
 * does not admit — `403 IP_NOT_ALLOWED`, the deployment gate's code and
 * message, so a client tells the two apart by nothing it could act on
 * differently.
 */
export const SESSION_SCOPING_REFUSAL = Object.freeze({
  code: 'IP_NOT_ALLOWED',
  message: 'Sign-in is not allowed from your network.',
});

/**
 * Is a session for `userId` allowed to be scoped to an organization whose own
 * policy is `organization`, from `address`? Allowed when the organization's
 * list admits the address ({@link organizationListAdmits}), or when the user is
 * a tenant-level administrator (break-glass; see the module header).
 * `isPlatformAdmin` is asked only when the list refuses.
 */
export async function judgeSessionScopingAddress(input: {
  address: string | undefined;
  organization: OrganizationAccessPolicy;
  isPlatformAdmin: () => Promise<boolean>;
}): Promise<'admitted' | 'refused'> {
  if (organizationListAdmits(input.address, input.organization)) return 'admitted';
  return (await input.isPlatformAdmin()) ? 'admitted' : 'refused';
}

// ---------------------------------------------------------------------------
// The save door — the floor, per key
// ---------------------------------------------------------------------------

interface FloorCopy {
  rangeOutside(range: string, deployment: string): string;
  limitAbove(limit: number, deployment: number): string;
  mfaBelow(level: string, deployment: string): string;
}

/**
 * The floor refusals, per language: one sentence each, naming the value that
 * was refused and the deployment's value it may not loosen. Level names and
 * ranges are named verbatim: they are what an administrator types.
 */
export const ACCESS_POLICY_FLOOR_COPY: Readonly<Record<SettingsCopyLocale, FloorCopy>> = {
  en: {
    rangeOutside: (r, d) => `${r} is not inside the deployment's allowed IP ranges (${d}). An organization can only narrow them: use ranges inside them.`,
    limitAbove: (n, d) => `${n} is longer than the deployment's limit of ${d}. An organization can only shorten it: use ${d} or less, or 0 to keep the deployment's limit.`,
    mfaBelow: (l, d) => `"${l}" is weaker than the deployment's multi-factor requirement "${d}". An organization can only strengthen it: choose "${d}" or stronger, or "off" to keep the deployment's requirement.`,
  },
  'zh-CN': {
    rangeOutside: (r, d) => `${r} 不在部署允许的 IP 范围（${d}）之内。组织只能收窄范围：请使用其中的网段。`,
    limitAbove: (n, d) => `${n} 超过部署的上限 ${d}。组织只能缩短：请填写 ${d} 或更小，或填 0 沿用部署的上限。`,
    mfaBelow: (l, d) => `“${l}”弱于部署的多因素认证要求“${d}”。组织只能加强：请选择“${d}”或更强，或选“off”沿用部署的要求。`,
  },
  'zh-Hant': {
    rangeOutside: (r, d) => `${r} 不在部署允許的 IP 範圍（${d}）之內。組織只能收窄範圍：請使用其中的網段。`,
    limitAbove: (n, d) => `${n} 超過部署的上限 ${d}。組織只能縮短：請填寫 ${d} 或更小，或填 0 沿用部署的上限。`,
    mfaBelow: (l, d) => `「${l}」弱於部署的多因素驗證要求「${d}」。組織只能加強：請選擇「${d}」或更強，或選「off」沿用部署的要求。`,
  },
  'ja-JP': {
    rangeOutside: (r, d) => `${r} はデプロイで許可された IP 範囲（${d}）に含まれていません。組織は範囲を狭めることしかできません。その内側の範囲を指定してください。`,
    limitAbove: (n, d) => `${n} はデプロイの上限 ${d} より長くなっています。組織は短くすることしかできません。${d} 以下を指定するか、0 にしてデプロイの上限を使ってください。`,
    mfaBelow: (l, d) => `「${l}」はデプロイの多要素認証要件「${d}」より弱くなっています。組織は強めることしかできません。「${d}」以上を選ぶか、「off」にしてデプロイの要件を使ってください。`,
  },
  'es-ES': {
    rangeOutside: (r, d) => `${r} no está dentro de los rangos de IP permitidos de la implementación (${d}). Una organización solo puede reducirlos: usa rangos incluidos en ellos.`,
    limitAbove: (n, d) => `${n} supera el límite de la implementación, ${d}. Una organización solo puede acortarlo: usa ${d} o menos, o 0 para mantener el límite de la implementación.`,
    mfaBelow: (l, d) => `"${l}" es más débil que el requisito multifactor de la implementación, "${d}". Una organización solo puede reforzarlo: elige "${d}" o uno más fuerte, u "off" para mantener el de la implementación.`,
  },
  ar: {
    rangeOutside: (r, d) => `النطاق ${r} ليس ضمن نطاقات IP المسموح بها في النشر (${d}). لا يمكن للمؤسسة إلا تضييقها: استخدم نطاقات تقع داخلها.`,
    limitAbove: (n, d) => `القيمة ${n} أطول من حد النشر ${d}. لا يمكن للمؤسسة إلا تقصيره: استخدم ${d} أو أقل، أو 0 للإبقاء على حد النشر.`,
    mfaBelow: (l, d) => `المستوى "${l}" أضعف من متطلب المصادقة متعددة العوامل في النشر "${d}". لا يمكن للمؤسسة إلا تقويته: اختر "${d}" أو أقوى، أو "off" للإبقاء على متطلب النشر.`,
  },
  fr: {
    rangeOutside: (r, d) => `${r} n’est pas compris dans les plages d’adresses IP autorisées du déploiement (${d}). Une organisation peut seulement les restreindre : utilisez des plages incluses dedans.`,
    limitAbove: (n, d) => `${n} dépasse la limite du déploiement, ${d}. Une organisation peut seulement la raccourcir : indiquez ${d} ou moins, ou 0 pour garder la limite du déploiement.`,
    mfaBelow: (l, d) => `« ${l} » est plus faible que l’exigence multifacteur du déploiement, « ${d} ». Une organisation peut seulement la renforcer : choisissez « ${d} » ou plus strict, ou « off » pour garder celle du déploiement.`,
  },
  'pt-BR': {
    rangeOutside: (r, d) => `${r} não está dentro das faixas de IP permitidas da implantação (${d}). Uma organização só pode restringi-las: use faixas contidas nelas.`,
    limitAbove: (n, d) => `${n} é maior que o limite da implantação, ${d}. Uma organização só pode encurtá-lo: use ${d} ou menos, ou 0 para manter o limite da implantação.`,
    mfaBelow: (l, d) => `"${l}" é mais fraco que o requisito multifator da implantação, "${d}". Uma organização só pode reforçá-lo: escolha "${d}" ou mais forte, ou "off" para manter o da implantação.`,
  },
  ru: {
    rangeOutside: (r, d) => `${r} не входит в разрешённые диапазоны IP развёртывания (${d}). Организация может только сузить их: укажите диапазоны внутри них.`,
    limitAbove: (n, d) => `${n} больше лимита развёртывания ${d}. Организация может только сократить его: укажите ${d} или меньше либо 0, чтобы сохранить лимит развёртывания.`,
    mfaBelow: (l, d) => `«${l}» слабее требования многофакторной аутентификации развёртывания «${d}». Организация может только усилить его: выберите «${d}» или строже либо «off», чтобы сохранить требование развёртывания.`,
  },
  de: {
    rangeOutside: (r, d) => `${r} liegt nicht innerhalb der erlaubten IP-Bereiche der Bereitstellung (${d}). Eine Organisation kann sie nur einschränken: Verwenden Sie Bereiche innerhalb davon.`,
    limitAbove: (n, d) => `${n} ist länger als das Limit der Bereitstellung von ${d}. Eine Organisation kann es nur verkürzen: Geben Sie ${d} oder weniger an oder 0, um das Limit der Bereitstellung zu behalten.`,
    mfaBelow: (l, d) => `„${l}“ ist schwächer als die Multi-Faktor-Anforderung der Bereitstellung „${d}“. Eine Organisation kann sie nur verschärfen: Wählen Sie „${d}“ oder strenger oder „off“, um die Anforderung der Bereitstellung zu behalten.`,
  },
  ko: {
    rangeOutside: (r, d) => `${r}은(는) 배포에서 허용한 IP 범위(${d}) 안에 있지 않습니다. 조직은 범위를 좁히기만 할 수 있으니 그 안의 범위를 사용하세요.`,
    limitAbove: (n, d) => `${n}은(는) 배포의 한도 ${d}보다 깁니다. 조직은 줄이기만 할 수 있으니 ${d} 이하를 입력하거나 0으로 배포의 한도를 유지하세요.`,
    mfaBelow: (l, d) => `"${l}"은(는) 배포의 다단계 인증 요구 수준 "${d}"보다 약합니다. 조직은 강화하기만 할 수 있으니 "${d}" 이상을 선택하거나 "off"로 배포의 요구 수준을 유지하세요.`,
  },
};

const FLOOR_COPY_LOCALES = Object.keys(ACCESS_POLICY_FLOOR_COPY);

/** The floor copy for a caller's locale: through the platform locale table, else English. */
export function accessPolicyFloorCopy(locale: string | undefined): FloorCopy {
  const picked = locale ? resolveLocale(locale, FLOOR_COPY_LOCALES) : undefined;
  return ACCESS_POLICY_FLOOR_COPY[(picked ?? 'en') as SettingsCopyLocale];
}

/** A refusal, in the settings write predicate's shape. */
export interface AccessPolicyRefusal {
  message: string;
  constraint: Record<string, unknown>;
}

/**
 * The floor check of one `access_policy` key: the refusal of a value weaker
 * than the deployment's (`floor`), or `undefined` when the value may be saved.
 * The table in the module header is the rule. A cleared value (`null`) is the
 * key's zero value and always passes.
 */
export function accessPolicyFloorRefusal(
  key: string,
  next: unknown,
  floor: DeploymentAccessFloor,
  locale?: string,
): AccessPolicyRefusal | undefined {
  if (next === null || next === undefined) return undefined;
  const copy = accessPolicyFloorCopy(locale);
  switch (key) {
    case ACCESS_POLICY_KEYS.allowedIpRanges: {
      const deployment = floor.allowedIpRanges ?? [];
      if (deployment.length === 0) return undefined;
      const outside = parseAllowedIpRanges(next).find((range) => !deployment.some((d) => rangeWithin(range, d)));
      if (!outside) return undefined;
      return {
        message: copy.rangeOutside(outside, deployment.join(', ')),
        constraint: { range: outside, deploymentRanges: [...deployment] },
      };
    }
    case ACCESS_POLICY_KEYS.sessionIdleTimeoutMinutes:
    case ACCESS_POLICY_KEYS.sessionAbsoluteMaxHours:
    case ACCESS_POLICY_KEYS.maxConcurrentSessions: {
      const deployment = nonNegativeInt(
        key === ACCESS_POLICY_KEYS.sessionIdleTimeoutMinutes
          ? floor.sessionIdleTimeoutMinutes
          : key === ACCESS_POLICY_KEYS.sessionAbsoluteMaxHours
            ? floor.sessionAbsoluteMaxHours
            : floor.maxConcurrentSessions,
      );
      const value = nonNegativeInt(next);
      if (deployment === 0 || value === 0 || value <= deployment) return undefined;
      return { message: copy.limitAbove(value, deployment), constraint: { max: deployment } };
    }
    case ACCESS_POLICY_KEYS.mfaRequired: {
      if (!isMfaRequirementLevel(next) || next === 'off') return undefined;
      const deployment = floor.mfaRequirement ?? 'off';
      if (mfaLevelRank(next) >= mfaLevelRank(deployment)) return undefined;
      return { message: copy.mfaBelow(next, deployment), constraint: { minimum: deployment } };
    }
    default:
      return undefined;
  }
}

/** What the `access_policy` write predicates read of the settings write predicate's input. */
interface AccessPolicyWriteInput {
  key: string;
  next: unknown;
  transport?: RequestTransport;
  locale?: string;
}

/**
 * The write predicate of one `access_policy` key: the floor
 * ({@link accessPolicyFloorRefusal}) for every key, and for
 * `allowed_ip_ranges` the self-lock-out check the deployment list has
 * (`allowedIpRangesWritePredicate`, judged against the same address). `floor`
 * is read per write, so the rule is the one in force when the save happens.
 */
export function accessPolicyWritePredicate(
  floor: () => DeploymentAccessFloor | undefined,
  selfLockOut?: (input: unknown) => { message: string; constraint: { clientAddress: string | null } } | undefined,
): (input: unknown) => AccessPolicyRefusal | undefined {
  return (input) => {
    const { key, next, locale } = (input ?? {}) as AccessPolicyWriteInput;
    const current = floor();
    if (current) {
      const refusal = accessPolicyFloorRefusal(key, next, current, locale);
      if (refusal) return refusal;
    }
    if (key === ACCESS_POLICY_KEYS.allowedIpRanges && selfLockOut) return selfLockOut(input);
    return undefined;
  };
}
