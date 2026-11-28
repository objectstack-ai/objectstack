// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Turso group of the Knowledge settings page, contributed by the store
 * that reads it.
 *
 * `turso_url` and `turso_auth_token` have one reader: this plugin, under
 * `urlFromSettings` (`readStoreSettings` in `plugin.ts`), which the runtime's
 * `knowledge` capability mount sets where the platform database is not
 * PostgreSQL. `@objectstack/service-settings`' `knowledge` manifest therefore
 * no longer declares them (ADR-0049 enforce-or-remove: a setting nothing reads
 * is not offered). The plugin adds this group to that page in `init()`, only
 * when it reads the two keys, so a deployment that mounts
 * `@objectstack/knowledge-pgvector` instead shows no Turso fields, and one that
 * mounts this store shows them where they are read.
 *
 * The mechanism is the one `@objectstack/service-knowledge` uses for the `ai`
 * page's embedder section (`withAiEmbedderSection`): re-register the
 * namespace's manifest with the section added (`SettingsService.registerManifest`
 * replaces a manifest and keeps the namespace's action handlers). The
 * knowledge service registers the page in its own `init()`, which runs first:
 * this plugin declares it in `optionalDependencies`.
 *
 * Stored values are never touched: the settings service never deletes a
 * stored row. Where this group is not contributed, a saved `turso_url` stays
 * stored, is not served, and a write naming the key is refused
 * `400 UNKNOWN_KEY`, the answer every undeclared key gets; mounted again, the
 * store reads it as before.
 *
 * The group's "Test connection" action and its handler
 * ({@link knowledgeTestActionHandler}) come with it: the check reads the two
 * fields and nothing else, so a page without them has no button, and
 * `POST /api/settings/knowledge/test` there answers as every undeclared
 * action does (`400 SETTINGS_ACTION_FAILED`, no handler registered).
 *
 * The group's copy moved here with it, in every locale the settings bundle
 * ships ({@link knowledgeTursoSettingsTranslations}), and is loaded into the
 * i18n service at `kernel:ready`, when the settings service loads its own.
 */

import type { PluginContext } from '@objectstack/core';
import type { SettingsManifest } from '@objectstack/spec/system';

/** The settings namespace this group joins: the Knowledge page. */
export const KNOWLEDGE_SETTINGS_NAMESPACE = 'knowledge';

/** The id of the group's "Test connection" action (`POST /api/settings/knowledge/test`). */
export const KNOWLEDGE_TURSO_TEST_ACTION = 'test';

/**
 * The Turso group, its two fields and the "Test connection" action that
 * checks them, ahead of the page's other groups.
 */
export const knowledgeTursoSettingsSpecifiers: SettingsManifest['specifiers'] = [
  // ── Turso / libSQL ────────────────────────────────────────────
  // No `visible` predicate: the group is on the page only where this store
  // reads it, so nothing on the page has to gate it.
  { type: 'group', id: 'turso', label: 'Turso / libSQL', required: false,
    description:
      'Used only when the platform database is not PostgreSQL: the knowledge store is then a Turso database, ' +
      'by default a file of its own. Works against managed Turso (libsql://…), local file (file:./knowledge.db), ' +
      'or in-memory (:memory:). Leave blank to use knowledge.db in the data directory.' },
  { type: 'text', key: 'turso_url', label: 'Connection URL', required: false,
    description: 'Examples: libsql://your-tenant.turso.io · file:./.objectstack/data/knowledge.db · :memory:' },
  { type: 'password', key: 'turso_auth_token', label: 'Auth token',
    required: false, encrypted: true,
    description: 'Only required for managed Turso URLs. Leave blank for local file / :memory:.' },
  // The check of the two fields above, beside them: a page without them has
  // no button, and its action door answers as for any undeclared action.
  { type: 'action_button', id: KNOWLEDGE_TURSO_TEST_ACTION, label: 'Test connection',
    required: false, icon: 'Plug',
    handler: { kind: 'http', method: 'POST', url: `/api/settings/${KNOWLEDGE_SETTINGS_NAMESPACE}/${KNOWLEDGE_TURSO_TEST_ACTION}` } },
];

/**
 * `manifest` with the Turso group in front of its specifiers, or `manifest`
 * itself when it already declares any of them (a host's own page keeps what it
 * wrote).
 */
export function withKnowledgeTursoSection(manifest: SettingsManifest): SettingsManifest {
  const declared = new Set(manifest.specifiers.map((s) => s.key ?? s.id));
  if (knowledgeTursoSettingsSpecifiers.some((s) => declared.has(s.key ?? s.id))) return manifest;
  return { ...manifest, specifiers: [...knowledgeTursoSettingsSpecifiers, ...manifest.specifiers] };
}

/** One locale's copy of the group, at the paths the console resolves (`settings.knowledge.…`). */
interface TursoGroupCopy {
  settings: {
    knowledge: {
      groups: { turso: { title: string; description: string } };
      keys: {
        turso_url: { label: string; help: string };
        turso_auth_token: { label: string; help: string };
      };
      actions: { test: { label: string } };
    };
  };
}

function copy(
  group: { title: string; description: string },
  url: { label: string; help: string },
  token: { label: string; help: string },
  test: { label: string },
): TursoGroupCopy {
  return {
    settings: {
      knowledge: {
        groups: { turso: group },
        keys: { turso_url: url, turso_auth_token: token },
        actions: { test },
      },
    },
  };
}

const URL_EXAMPLES = 'libsql://your-tenant.turso.io · file:./.objectstack/data/knowledge.db · :memory:';

/**
 * The group's copy in each locale `@objectstack/service-settings` ships, moved
 * from that package's bundles with the fields. Keyed as its
 * `settingsBuiltinTranslations` is.
 */
export const knowledgeTursoSettingsTranslations: Readonly<Record<string, TursoGroupCopy>> = {
  en: copy(
    { title: 'Turso / libSQL',
      description: 'Used only when the platform database is not PostgreSQL. Works against managed Turso, local file, or in-memory. Leave blank to use knowledge.db in the data directory.' },
    { label: 'Connection URL', help: `Examples: ${URL_EXAMPLES}` },
    { label: 'Auth token', help: 'Only required for managed Turso URLs.' },
    { label: 'Test connection' },
  ),
  'zh-CN': copy(
    { title: 'Turso / libSQL',
      description: '仅在平台数据库不是 PostgreSQL 时使用。支持托管 Turso、本地文件、内存三种模式。留空则使用数据目录中的 knowledge.db。' },
    { label: '连接 URL', help: `示例:${URL_EXAMPLES}` },
    { label: 'Auth Token', help: '仅托管 Turso URL 需要。' },
    { label: '测试连接' },
  ),
  'ja-JP': copy(
    { title: 'Turso / libSQL',
      description: 'プラットフォームのデータベースが PostgreSQL でない場合にのみ使用されます。マネージド Turso、ローカルファイル、インメモリのいずれでも動作します。空欄の場合は、データディレクトリ内の knowledge.db を使用します。' },
    { label: '接続 URL', help: `例: ${URL_EXAMPLES}` },
    { label: '認証トークン', help: 'マネージド Turso URL の場合のみ必要です。' },
    { label: '接続テスト' },
  ),
  'es-ES': copy(
    { title: 'Turso / libSQL',
      description: 'Solo se usa cuando la base de datos de la plataforma no es PostgreSQL. Funciona con Turso gestionado, archivo local o en memoria. Déjelo en blanco para usar knowledge.db en el directorio de datos.' },
    { label: 'URL de conexión', help: `Ejemplos: ${URL_EXAMPLES}` },
    { label: 'Token de autenticación', help: 'Solo se requiere para URLs de Turso gestionado.' },
    { label: 'Probar conexión' },
  ),
  'zh-Hant': copy(
    { title: 'Turso / libSQL',
      description: '僅在平台資料庫不是 PostgreSQL 時使用。可搭配託管 Turso、本機檔案或記憶體使用。留空則使用資料目錄中的 knowledge.db。' },
    { label: '連線 URL', help: `範例：${URL_EXAMPLES}` },
    { label: '驗證權杖', help: '僅託管 Turso URL 需要。' },
    { label: '測試連線' },
  ),
  ar: copy(
    { title: 'Turso / libSQL',
      description: 'يُستخدم فقط عندما لا تكون قاعدة بيانات المنصة PostgreSQL. يعمل مع Turso المُدار أو ملف محلي أو في الذاكرة. اتركه فارغًا لاستخدام knowledge.db في دليل البيانات.' },
    { label: 'عنوان URL للاتصال', help: `أمثلة: ${URL_EXAMPLES}` },
    { label: 'رمز المصادقة', help: 'مطلوب فقط لعناوين Turso المُدارة.' },
    { label: 'اختبار الاتصال' },
  ),
  fr: copy(
    { title: 'Turso / libSQL',
      description: 'Utilisé uniquement lorsque la base de données de la plateforme n’est pas PostgreSQL. Fonctionne avec Turso géré, un fichier local ou en mémoire. Laissez vide pour utiliser knowledge.db dans le répertoire de données.' },
    { label: 'URL de connexion', help: `Exemples : ${URL_EXAMPLES}` },
    { label: 'Jeton d’authentification', help: 'Nécessaire uniquement pour les URL Turso gérées.' },
    { label: 'Tester la connexion' },
  ),
  'pt-BR': copy(
    { title: 'Turso / libSQL',
      description: 'Usado apenas quando o banco de dados da plataforma não é PostgreSQL. Funciona com Turso gerenciado, arquivo local ou em memória. Deixe em branco para usar knowledge.db no diretório de dados.' },
    { label: 'URL de conexão', help: `Exemplos: ${URL_EXAMPLES}` },
    { label: 'Token de autenticação', help: 'Necessário apenas para URLs do Turso gerenciado.' },
    { label: 'Testar conexão' },
  ),
  ru: copy(
    { title: 'Turso / libSQL',
      description: 'Используется, только если база данных платформы — не PostgreSQL. Работает с управляемым Turso, локальным файлом или в памяти. Оставьте пустым, чтобы использовать knowledge.db в каталоге данных.' },
    { label: 'URL подключения', help: `Примеры: ${URL_EXAMPLES}` },
    { label: 'Токен авторизации', help: 'Нужен только для URL управляемого Turso.' },
    { label: 'Проверить подключение' },
  ),
  de: copy(
    { title: 'Turso / libSQL',
      description: 'Wird nur verwendet, wenn die Plattformdatenbank nicht PostgreSQL ist. Funktioniert mit verwaltetem Turso, lokaler Datei oder im Arbeitsspeicher. Leer lassen, um knowledge.db im Datenverzeichnis zu verwenden.' },
    { label: 'Verbindungs-URL', help: `Beispiele: ${URL_EXAMPLES}` },
    { label: 'Auth-Token', help: 'Nur für verwaltete Turso-URLs erforderlich.' },
    { label: 'Verbindung testen' },
  ),
  ko: copy(
    { title: 'Turso / libSQL',
      description: '플랫폼 데이터베이스가 PostgreSQL이 아닐 때만 사용됩니다. 관리형 Turso, 로컬 파일, 인메모리 모두에서 동작합니다. 비워 두면 데이터 디렉터리의 knowledge.db를 사용합니다.' },
    { label: '연결 URL', help: `예: ${URL_EXAMPLES}` },
    { label: '인증 토큰', help: '관리형 Turso URL에만 필요합니다.' },
    { label: '연결 테스트' },
  ),
};

/**
 * What a settings action handler is handed and answers, as this contribution
 * uses it (`SettingsActionHandler` in `@objectstack/service-settings`, which
 * this package does not depend on at runtime).
 */
export interface KnowledgeTursoActionInput {
  /** The namespace's stored values, one per key its page declares. */
  values: Record<string, unknown>;
  /** The request body: the form's unsaved values, bare or under `values`. */
  payload?: unknown;
}

/** The answer the action door serves (`200` when `ok`, else `400 SETTINGS_ACTION_FAILED`). */
export interface KnowledgeTursoActionResult {
  ok: boolean;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

/**
 * The sentence every answer carries, so a green "Test connection" is never
 * read as a connection that succeeded.
 */
const FORM_CHECK_ONLY = 'This checks the form only — no connection was attempted.';

/**
 * Handler for `knowledge/test` ("Test connection"), registered with the group
 * it checks ({@link contributeKnowledgeTursoSettings}): a page without the two
 * fields has no button, and no handler.
 *
 * It checks the libSQL fields for completeness only — a Turso auth token
 * beside a managed `libsql://` URL — and opens NO connection. It reads
 * `turso_url` and `turso_auth_token` and nothing else: the page names no
 * adapter, so a payload or a stored row still carrying `adapter` (a value
 * saved before `@objectstack/service-settings`' manifest version 4) is not
 * read, and neither is any other key the page does not declare. So every
 * answer says no connection was attempted.
 */
export async function knowledgeTestActionHandler({
  values,
  payload,
}: KnowledgeTursoActionInput): Promise<KnowledgeTursoActionResult> {
  const merged: Record<string, unknown> = { ...values, ...extractOverrides(payload) };

  const url = merged.turso_url;
  if (!url) {
    return {
      ok: true,
      severity: 'info',
      message:
        'No Turso URL configured — where the knowledge store is @objectstack/knowledge-turso (a platform ' +
        'database other than PostgreSQL), it uses its own file, knowledge.db under .objectstack/data/, never ' +
        'the platform database. ' +
        FORM_CHECK_ONLY,
    };
  }
  const u = String(url);
  if (u.startsWith('libsql://') && !merged.turso_auth_token) {
    return {
      ok: false,
      severity: 'error',
      message: 'Managed Turso URL requires an auth token.',
    };
  }
  return {
    ok: true,
    severity: 'info',
    message:
      `Turso URL configured (${u}). ${FORM_CHECK_ONLY} It is read at startup by the ` +
      '@objectstack/knowledge-turso plugin registered beside the knowledge service, which is the store a ' +
      'platform database other than PostgreSQL gets.',
  };
}

function extractOverrides(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  if (p.values && typeof p.values === 'object' && p.values !== null) {
    return p.values as Record<string, unknown>;
  }
  return p;
}

/** The settings service as this contribution uses it. */
interface SettingsRegistry {
  getManifest(namespace: string): SettingsManifest;
  registerManifest(manifest: SettingsManifest): void;
  registerAction(
    namespace: string,
    actionId: string,
    handler: (input: KnowledgeTursoActionInput) => Promise<KnowledgeTursoActionResult>,
  ): void;
}

/** The i18n service as this contribution uses it. */
interface TranslationSink {
  loadTranslations(locale: string, data: Record<string, unknown>): void;
}

/**
 * Add the Turso group, with its "Test connection" action and that action's
 * handler, to the composition's Knowledge page, and its copy to the i18n
 * service at `kernel:ready`. Called from `KnowledgeTursoPlugin.init()` when
 * the plugin reads its URL from settings.
 *
 * Answers whether the page carries both Turso keys after the call. No
 * settings service, or no `knowledge` page (the knowledge service is not
 * mounted), contributes nothing; a page that already declares any of the
 * group's ids is left as it is, handler included, and answers whether it
 * declares both keys itself.
 */
export function contributeKnowledgeTursoSettings(ctx: PluginContext): boolean {
  let settings: Partial<SettingsRegistry> | undefined;
  try {
    settings = ctx.getService<Partial<SettingsRegistry> | undefined>('settings') ?? undefined;
  } catch {
    return false;
  }
  if (
    typeof settings?.getManifest !== 'function' ||
    typeof settings.registerManifest !== 'function' ||
    typeof settings.registerAction !== 'function'
  ) {
    return false;
  }
  let page: SettingsManifest;
  try {
    page = settings.getManifest(KNOWLEDGE_SETTINGS_NAMESPACE);
  } catch {
    return false;
  }
  const composed = withKnowledgeTursoSection(page);
  if (composed !== page) {
    settings.registerManifest(composed);
    // After the manifest: `registerAction` refuses a namespace not registered,
    // and the re-registration keeps the namespace's other handlers.
    settings.registerAction(KNOWLEDGE_SETTINGS_NAMESPACE, KNOWLEDGE_TURSO_TEST_ACTION, knowledgeTestActionHandler);
  }
  const keys = new Set(composed.specifiers.map((s) => s.key));
  if (!keys.has('turso_url') || !keys.has('turso_auth_token')) return false;

  ctx.hook('kernel:ready', async () => {
    let i18n: Partial<TranslationSink> | undefined;
    try {
      i18n = ctx.getService<Partial<TranslationSink> | undefined>('i18n') ?? undefined;
    } catch {
      // No i18n service: the manifest's own labels are the page's copy.
      return;
    }
    if (typeof i18n?.loadTranslations !== 'function') return;
    for (const [locale, data] of Object.entries(knowledgeTursoSettingsTranslations)) {
      try {
        i18n.loadTranslations(locale, data as unknown as Record<string, unknown>);
      } catch (err) {
        ctx.logger?.warn?.(
          `KnowledgeTursoPlugin: the Turso settings copy for '${locale}' could not be loaded ` +
            `(${err instanceof Error ? err.message : String(err)}); that locale shows the English labels.`,
        );
      }
    }
  });
  return true;
}
