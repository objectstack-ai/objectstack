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
 * The group's copy moved here with it, in every locale the settings bundle
 * ships ({@link knowledgeTursoSettingsTranslations}), and is loaded into the
 * i18n service at `kernel:ready`, when the settings service loads its own.
 */

import type { PluginContext } from '@objectstack/core';
import type { SettingsManifest } from '@objectstack/spec/system';

/** The settings namespace this group joins: the Knowledge page. */
export const KNOWLEDGE_SETTINGS_NAMESPACE = 'knowledge';

/**
 * The Turso group and its two fields, in the order the page showed them, ahead
 * of the page's other groups.
 */
export const knowledgeTursoSettingsSpecifiers: SettingsManifest['specifiers'] = [
  // ── Turso / libSQL ────────────────────────────────────────────
  // No `visible` predicate: the group is on the page only where this store
  // reads it, so nothing on the page has to gate it.
  { type: 'group', id: 'turso', label: 'Turso / libSQL', required: false,
    description:
      'Used only when the platform database is not PostgreSQL: the knowledge store is then a Turso database, ' +
      'by default a file of its own. On PostgreSQL the store lives in the platform database and these fields are not read. ' +
      'Works against managed Turso (libsql://…), local file (file:./knowledge.db), ' +
      'or in-memory (:memory:). In a cloud deployment with a database per organization, leave blank to ' +
      'reuse that organization\'s own database connection.' },
  { type: 'text', key: 'turso_url', label: 'Connection URL', required: false,
    description: 'Examples: libsql://your-tenant.turso.io · file:./.objectstack/data/knowledge.db · :memory:' },
  { type: 'password', key: 'turso_auth_token', label: 'Auth token',
    required: false, encrypted: true,
    description: 'Only required for managed Turso URLs. Leave blank for local file / :memory:.' },
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
    };
  };
}

function copy(
  group: { title: string; description: string },
  url: { label: string; help: string },
  token: { label: string; help: string },
): TursoGroupCopy {
  return { settings: { knowledge: { groups: { turso: group }, keys: { turso_url: url, turso_auth_token: token } } } };
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
      description: 'Used only when the platform database is not PostgreSQL; on PostgreSQL the knowledge store lives in the platform database and these fields are not read. Works against managed Turso, local file, or in-memory.' },
    { label: 'Connection URL', help: `Examples: ${URL_EXAMPLES}` },
    { label: 'Auth token', help: 'Only required for managed Turso URLs.' },
  ),
  'zh-CN': copy(
    { title: 'Turso / libSQL',
      description: '仅在平台数据库不是 PostgreSQL 时使用；平台数据库为 PostgreSQL 时，知识存储位于平台数据库中，不读取这些字段。支持托管 Turso、本地文件、内存三种模式。' },
    { label: '连接 URL', help: `示例:${URL_EXAMPLES}` },
    { label: 'Auth Token', help: '仅托管 Turso URL 需要。' },
  ),
  'ja-JP': copy(
    { title: 'Turso / libSQL',
      description: 'プラットフォームのデータベースが PostgreSQL でない場合にのみ使用されます。PostgreSQL の場合、ナレッジストアはプラットフォームのデータベース内にあり、これらの項目は読み取られません。マネージド Turso、ローカルファイル、インメモリのいずれでも動作します。' },
    { label: '接続 URL', help: `例: ${URL_EXAMPLES}` },
    { label: '認証トークン', help: 'マネージド Turso URL の場合のみ必要です。' },
  ),
  'es-ES': copy(
    { title: 'Turso / libSQL',
      description: 'Solo se usa cuando la base de datos de la plataforma no es PostgreSQL; con PostgreSQL, el almacén de conocimiento está en la base de datos de la plataforma y estos campos no se leen. Funciona con Turso gestionado, archivo local o en memoria.' },
    { label: 'URL de conexión', help: `Ejemplos: ${URL_EXAMPLES}` },
    { label: 'Token de autenticación', help: 'Solo se requiere para URLs de Turso gestionado.' },
  ),
  'zh-Hant': copy(
    { title: 'Turso / libSQL',
      description: '僅在平台資料庫不是 PostgreSQL 時使用；平台資料庫為 PostgreSQL 時，知識儲存位於平台資料庫中，不會讀取這些欄位。可搭配託管 Turso、本機檔案或記憶體使用。' },
    { label: '連線 URL', help: `範例：${URL_EXAMPLES}` },
    { label: '驗證權杖', help: '僅託管 Turso URL 需要。' },
  ),
  ar: copy(
    { title: 'Turso / libSQL',
      description: 'يُستخدم فقط عندما لا تكون قاعدة بيانات المنصة PostgreSQL؛ مع PostgreSQL يكون مخزن المعرفة داخل قاعدة بيانات المنصة ولا تُقرأ هذه الحقول. يعمل مع Turso المُدار أو ملف محلي أو في الذاكرة.' },
    { label: 'عنوان URL للاتصال', help: `أمثلة: ${URL_EXAMPLES}` },
    { label: 'رمز المصادقة', help: 'مطلوب فقط لعناوين Turso المُدارة.' },
  ),
  fr: copy(
    { title: 'Turso / libSQL',
      description: 'Utilisé uniquement lorsque la base de données de la plateforme n’est pas PostgreSQL ; sous PostgreSQL, le magasin de connaissances se trouve dans la base de données de la plateforme et ces champs ne sont pas lus. Fonctionne avec Turso géré, un fichier local ou en mémoire.' },
    { label: 'URL de connexion', help: `Exemples : ${URL_EXAMPLES}` },
    { label: 'Jeton d’authentification', help: 'Nécessaire uniquement pour les URL Turso gérées.' },
  ),
  'pt-BR': copy(
    { title: 'Turso / libSQL',
      description: 'Usado apenas quando o banco de dados da plataforma não é PostgreSQL; no PostgreSQL, o repositório de conhecimento fica no banco de dados da plataforma e estes campos não são lidos. Funciona com Turso gerenciado, arquivo local ou em memória.' },
    { label: 'URL de conexão', help: `Exemplos: ${URL_EXAMPLES}` },
    { label: 'Token de autenticação', help: 'Necessário apenas para URLs do Turso gerenciado.' },
  ),
  ru: copy(
    { title: 'Turso / libSQL',
      description: 'Используется, только если база данных платформы — не PostgreSQL; на PostgreSQL хранилище знаний находится в базе данных платформы, и эти поля не читаются. Работает с управляемым Turso, локальным файлом или в памяти.' },
    { label: 'URL подключения', help: `Примеры: ${URL_EXAMPLES}` },
    { label: 'Токен авторизации', help: 'Нужен только для URL управляемого Turso.' },
  ),
  de: copy(
    { title: 'Turso / libSQL',
      description: 'Wird nur verwendet, wenn die Plattformdatenbank nicht PostgreSQL ist; unter PostgreSQL liegt der Wissensspeicher in der Plattformdatenbank, und diese Felder werden nicht gelesen. Funktioniert mit verwaltetem Turso, lokaler Datei oder im Arbeitsspeicher.' },
    { label: 'Verbindungs-URL', help: `Beispiele: ${URL_EXAMPLES}` },
    { label: 'Auth-Token', help: 'Nur für verwaltete Turso-URLs erforderlich.' },
  ),
  ko: copy(
    { title: 'Turso / libSQL',
      description: '플랫폼 데이터베이스가 PostgreSQL이 아닐 때만 사용됩니다. PostgreSQL에서는 지식 저장소가 플랫폼 데이터베이스 안에 있으며 이 필드는 읽히지 않습니다. 관리형 Turso, 로컬 파일, 인메모리 모두에서 동작합니다.' },
    { label: '연결 URL', help: `예: ${URL_EXAMPLES}` },
    { label: '인증 토큰', help: '관리형 Turso URL에만 필요합니다.' },
  ),
};

/** The settings service as this contribution uses it. */
interface SettingsRegistry {
  getManifest(namespace: string): SettingsManifest;
  registerManifest(manifest: SettingsManifest): void;
}

/** The i18n service as this contribution uses it. */
interface TranslationSink {
  loadTranslations(locale: string, data: Record<string, unknown>): void;
}

/**
 * Add the Turso group to the composition's Knowledge page, and its copy to the
 * i18n service at `kernel:ready`. Called from `KnowledgeTursoPlugin.init()`
 * when the plugin reads its URL from settings.
 *
 * Answers whether the page carries the group after the call. No settings
 * service, or no `knowledge` page (the knowledge service is not mounted, and
 * the plugin's start() says so), contributes nothing; a page that already
 * declares the keys is left as it is.
 */
export function contributeKnowledgeTursoSettings(ctx: PluginContext): boolean {
  let settings: Partial<SettingsRegistry> | undefined;
  try {
    settings = ctx.getService<Partial<SettingsRegistry> | undefined>('settings') ?? undefined;
  } catch {
    return false;
  }
  if (typeof settings?.getManifest !== 'function' || typeof settings.registerManifest !== 'function') return false;
  let page: SettingsManifest;
  try {
    page = settings.getManifest(KNOWLEDGE_SETTINGS_NAMESPACE);
  } catch {
    return false;
  }
  const composed = withKnowledgeTursoSection(page);
  if (composed !== page) settings.registerManifest(composed);

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
