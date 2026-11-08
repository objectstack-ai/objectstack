/**
 * Mirror of `@objectstack/spec/system` SettingsManifest types.
 *
 * The UI repo doesn't depend on the server-side spec package, so we
 * duplicate the minimal subset needed by the renderer. Source of
 * truth lives in `framework/packages/spec/src/system/settings-manifest.zod.ts`
 * (ADR-0007).
 *
 * ⚠️ Hand-written, not generated — so nothing tells this file when the server's
 * shape GROWS. The payload keeps carrying the new member; only the renderer
 * stops seeing it, and TypeScript reports nothing because a narrower mirror is
 * a structurally valid reading of a wider object. That is exactly how
 * `valueDomain` below went 18 days unread after the server started sending it
 * (objectui#3719). When a settings feature "doesn't render", check this mirror
 * against the zod schema first.
 */

export type SpecifierType =
  | 'group'
  | 'child_pane'
  | 'info_banner'
  | 'title_value'
  | 'text'
  | 'textarea'
  | 'password'
  | 'email'
  | 'url'
  | 'phone'
  | 'number'
  | 'toggle'
  | 'select'
  | 'radio'
  | 'multiselect'
  | 'slider'
  | 'color'
  | 'json'
  | 'map'
  | 'action_button';

export type SpecifierScope = 'global' | 'tenant' | 'user';

/**
 * Standard value domains a specifier's value may be judged against
 * (objectstack#5933, PR objectstack#6515). Mirrors `SpecifierValueDomainSchema`.
 *
 * The vocabulary is closed server-side, so it is mirrored closed here. Note the
 * renderer branches on PRESENCE, never on the particular member — a domain
 * added upstream still gets the right control before this union catches up.
 */
export type SpecifierValueDomain =
  | 'iana_time_zone'
  | 'iso_4217_currency'
  | 'iso_3166_alpha2';

export interface SpecifierOption {
  value: string | number | boolean;
  label: string | { defaultValue?: string; key?: string };
  icon?: string;
  description?: string;
}

export type SpecifierHandler =
  | { kind: 'http'; method?: string; url: string; body?: Record<string, unknown>; confirmText?: string }
  | { kind: 'action'; name: string; params?: Record<string, unknown>; confirmText?: string }
  | { kind: 'navigate'; url: string; target?: '_self' | '_blank' };

/**
 * The value kinds a `map` column declares (objectstack#30208). Mirrors
 * `SpecifierMapColumnKindSchema`, which is closed: a new kind is an ADR-0007
 * amendment.
 */
export type SpecifierMapColumnKind = 'duration' | 'positive_integer';

/** One value column of a `map` specifier. Mirrors `SpecifierMapColumnSchema`. */
export interface SpecifierMapColumn {
  /** The property the cell is stored under when the map has several value columns. */
  name: string;
  /** An `I18nLabel`: the default-language string, or an inline locale map. */
  label: string | Record<string, string>;
  description?: string;
  kind: SpecifierMapColumnKind;
}

/** The key column of a `map` specifier: its header only, never a list of keys. */
export interface SpecifierMapKeyColumn {
  /** An `I18nLabel`: the default-language string, or an inline locale map. */
  label: string | Record<string, string>;
  description?: string;
}

export interface Specifier {
  type: SpecifierType;
  id?: string;
  key?: string;
  label: string | { defaultValue?: string; key?: string };
  description?: string;
  icon?: string;
  default?: unknown;
  visible?: string;
  required?: boolean;
  encrypted?: boolean;
  scope?: SpecifierScope;
  deprecated?: boolean;
  replacedBy?: string;
  options?: SpecifierOption[];
  /**
   * When declared, the STANDARD's membership is the enforcement boundary and
   * `options` degrades to a UI suggestion list — the server accepts any member
   * of the domain (objectstack#5712, PR objectstack#6581). When ABSENT,
   * `options` is exhaustive (objectstack#5131) and the control must stay a
   * closed dropdown.
   */
  valueDomain?: SpecifierValueDomain;
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  rows?: number;
  handler?: SpecifierHandler;
  /**
   * `toggle` only: the question asked before the switch goes from on to off
   * (omit = no confirm). Mirrors `SpecifierSchema.confirmOffText`, an
   * `I18nLabel`: the default-language string, or an inline locale map
   * (`{ en, 'zh-CN' }`).
   */
  confirmOffText?: string | Record<string, string>;
  childNamespace?: string;
  bannerText?: string;
  bannerSeverity?: 'info' | 'success' | 'warning' | 'error';
  /**
   * `map` only (objectstack#30208): the key column's header. The keys a map
   * admits are served at read time as this specifier's `options`, from a
   * runtime option source; the manifest declares no list.
   */
  keyColumn?: SpecifierMapKeyColumn;
  /**
   * `map` only: the value columns, in display order. One column stores
   * `Record<key, value>`; several store `Record<key, { [column.name]: value }>`.
   */
  columns?: SpecifierMapColumn[];
}

export interface SettingsManifest {
  namespace: string;
  version: number;
  label: string | { defaultValue?: string; key?: string };
  icon?: string;
  description?: string;
  helpText?: string;
  scope?: SpecifierScope;
  readPermission?: string;
  writePermission?: string;
  category?: string;
  order?: number;
  specifiers: Specifier[];
  visible?: string;
  featureFlag?: string;
  beta?: boolean;
}

export interface ResolvedSettingValue<T = unknown> {
  value: T;
  source: 'env' | 'global' | 'tenant' | 'user' | 'default';
  locked: boolean;
  lockedReason?: string;
  cascadeChain?: Array<{
    scope: 'env' | 'global' | 'tenant' | 'user' | 'default';
    value: unknown;
    locked?: boolean;
    lockedReason?: string;
    effective?: boolean;
  }>;
}

export interface SettingsNamespacePayload {
  manifest: SettingsManifest;
  values: Record<string, ResolvedSettingValue>;
}

export interface SettingsActionResult {
  ok: boolean;
  message?: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  details?: unknown;
}

export interface SettingsListResponse {
  manifests: SettingsManifest[];
}

/** Resolve i18n label objects to plain strings. */
export function resolveLabel(label: SettingsManifest['label'] | Specifier['label']): string {
  if (typeof label === 'string') return label;
  return label?.defaultValue || label?.key || '';
}
