// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver catalog's words in every language on the platform locale table
 * (`PLATFORM_LOCALES`, `@objectstack/spec/system`), keyed by the table's tags.
 *
 * `GET /api/v1/datasources/drivers` serves every word the New datasource
 * dialog shows about a driver: the entry's `label` and `description`, and each
 * connection field's JSON-Schema `title` and `description`. The console has no
 * key of its own for any of them, so before this table a Chinese console read
 * `Filename`, `Auto-migrate schema`, `Host` and `Port` in English beside
 * Chinese text everywhere else in the dialog.
 *
 * ## What is translated, and what stays English
 *
 * English is the source and is never restated here: the entry words come from
 * `CURATED` in `driver-catalog.ts`, the field words from the spec's per-driver
 * zod schemas, projected to JSON Schema. A language below overrides a word
 * only where the English side has one, and any word it leaves out is served in
 * English (`driverCatalogFor`), never as a key. Product names (SQLite,
 * PostgreSQL, MySQL / MariaDB, MongoDB) and technical terms (URL, URI, SSL/TLS,
 * `knex searchPath`, `application_name`) are not translated.
 *
 * The fields are the top-level properties of each driver's `configSchema`, the
 * ones the dialog draws as inputs. Nested shapes (the memory driver's
 * persistence variants) are not drawn, so they are not translated.
 *
 * Every language on the table is complete: the platform has one list of
 * languages and no tiers. `__tests__/driver-catalog.test.ts` walks
 * `PLATFORM_LOCALES` (not this table's keys), so a language missing here, or a
 * field the spec adds without its words, goes red there.
 *
 * Each language is written once as {@link CatalogWords}, the distinct words
 * the five drivers use; {@link catalogText} lays them out per driver, so a
 * field the drivers share (host, port, password, …) cannot read two ways.
 */

import type { BuiltinDriverId } from '@objectstack/spec/data';
import type { PlatformLocaleTag } from '@objectstack/spec/system';

/** One connection field's words: the JSON-Schema `title` and `description`. */
export interface DriverFieldText {
  title?: string;
  description?: string;
}

/** One driver's words in one language. */
export interface DriverCatalogText {
  label?: string;
  description?: string;
  /** Keyed by the field's property name in the driver's `configSchema`. */
  fields?: Readonly<Record<string, DriverFieldText>>;
}

/** Every curated driver's words in one language. */
export type DriverCatalogLocaleText = Readonly<Partial<Record<BuiltinDriverId, DriverCatalogText>>>;

/** The platform table's languages other than English, the source. */
export type DriverCatalogLocale = Exclude<PlatformLocaleTag, 'en'>;

/** The distinct words of the catalog in one language. */
interface CatalogWords {
  memoryLabel: string;
  memoryDescription: string;
  sqliteDescription: string;
  postgresDescription: string;
  mysqlDescription: string;
  mongodbDescription: string;
  initialDataDescription: string;
  strictModeDescription: string;
  persistenceDescription: string;
  filename: Required<DriverFieldText>;
  autoMigrate: Required<DriverFieldText>;
  connectionUrlTitle: string;
  connectionUriTitle: string;
  postgresUrlDescription: string;
  urlDescription: string;
  host: Required<DriverFieldText>;
  port: Required<DriverFieldText>;
  database: Required<DriverFieldText>;
  username: Required<DriverFieldText>;
  password: Required<DriverFieldText>;
  ssl: Required<DriverFieldText>;
  schema: Required<DriverFieldText>;
  applicationName: Required<DriverFieldText>;
  statementTimeout: Required<DriverFieldText>;
  authSource: Required<DriverFieldText>;
  mongoOptionsDescription: string;
}

/** One language's words laid out per driver and field. */
function catalogText(w: CatalogWords): DriverCatalogLocaleText {
  return {
    memory: {
      label: w.memoryLabel,
      description: w.memoryDescription,
      fields: {
        initialData: { description: w.initialDataDescription },
        strictMode: { description: w.strictModeDescription },
        persistence: { description: w.persistenceDescription },
      },
    },
    sqlite: {
      description: w.sqliteDescription,
      fields: { filename: w.filename, autoMigrate: w.autoMigrate },
    },
    postgres: {
      description: w.postgresDescription,
      fields: {
        url: { title: w.connectionUrlTitle, description: w.postgresUrlDescription },
        host: w.host,
        port: w.port,
        database: w.database,
        username: w.username,
        password: w.password,
        ssl: w.ssl,
        schema: w.schema,
        applicationName: w.applicationName,
        statementTimeout: w.statementTimeout,
        autoMigrate: w.autoMigrate,
      },
    },
    mysql: {
      description: w.mysqlDescription,
      fields: {
        url: { title: w.connectionUrlTitle, description: w.urlDescription },
        host: w.host,
        port: w.port,
        database: w.database,
        username: w.username,
        password: w.password,
        ssl: w.ssl,
        autoMigrate: w.autoMigrate,
      },
    },
    mongodb: {
      description: w.mongodbDescription,
      fields: {
        url: { title: w.connectionUriTitle, description: w.urlDescription },
        database: w.database,
        host: w.host,
        port: w.port,
        username: w.username,
        password: w.password,
        authSource: w.authSource,
        options: { description: w.mongoOptionsDescription },
      },
    },
  };
}

/** 简体中文. */
const zhHans: CatalogWords = {
  memoryLabel: '内存',
  memoryDescription: '用于开发、测试和原型验证的临时内存驱动，无需连接设置。',
  sqliteDescription: '基于文件（或内存）的 SQL 数据库，适合本地开发和小型部署。',
  postgresDescription: 'PostgreSQL 连接。填写主机、端口和数据库，或提供连接 URL。',
  mysqlDescription: 'MySQL 或 MariaDB 连接。',
  mongodbDescription: '通过连接 URI 连接 MongoDB。',
  initialDataDescription: '按对象名称组织的预置数据',
  strictModeDescription: '记录不存在时抛出错误，而不是返回 null',
  persistenceDescription: '持久化配置（可选；默认纯内存）',
  filename: { title: '文件名', description: '数据库文件路径，或填 ":memory:" 使用临时内存数据库' },
  autoMigrate: { title: '自动迁移表结构', description: '仅限开发环境：以非破坏性方式自动修复表结构' },
  connectionUrlTitle: '连接 URL',
  connectionUriTitle: '连接 URI',
  postgresUrlDescription: '连接 URI（优先于各单项字段；必须是 `pg` 能解析的 URL；不得内嵌密码，请改为绑定密钥）',
  urlDescription: '连接 URI（优先于各单项字段；不得内嵌密码，请改为绑定密钥）',
  host: { title: '主机', description: '主机地址' },
  port: { title: '端口', description: '端口号' },
  database: { title: '数据库', description: '数据库名称' },
  username: { title: '用户', description: '认证用户' },
  password: {
    title: '密码',
    description:
      '通过连接表单的密钥字段或 `external.credentialsRef` 设置，加密存入 `sys_secret`，从不存放在 `config` 中。'
      + '在代码中定义的数据源（`defineDatasource`）不在声明中写凭据：连接时从按数据源名称派生的运行时环境变量读取'
      + '（名为 `warehouse` 的数据源读取 `OS_DATASOURCE_WAREHOUSE_PASSWORD`），'
      + '`os serve` / `os start` 默认启用此方式（`OS_DATASOURCE_ENV_CREDENTIALS=on`）。',
  },
  ssl: { title: '使用 SSL/TLS', description: '启用 TLS。证书填写在数据源级别的 `ssl` 配置块中。' },
  schema: { title: '模式', description: '默认模式（knex searchPath）' },
  applicationName: { title: '应用名称', description: 'Postgres 的 application_name' },
  statementTimeout: { title: '语句超时（毫秒）', description: '中止运行时间超过此值的语句（毫秒）' },
  authSource: { title: '认证库', description: '认证数据库' },
  mongoOptionsDescription:
    '额外的 MongoClient 选项（replicaSet、tls、超时等）。以凭据命名的键（`password`、`authToken` 及其旧别名）'
    + '在任何层级都会被直接拒绝，请通过连接表单或 external.credentialsRef 绑定密钥。'
    + '`proxyPassword`、`tlsCertificateKeyFilePassword`、`key` 和 `passphrase` 会被接受，并以明文静态存储；'
    + '它们只在读回数据源时被遮蔽，写入时不会被拒绝。',
};

/** 繁體中文. */
const zhHant: CatalogWords = {
  memoryLabel: '記憶體',
  memoryDescription: '用於開發、測試和原型驗證的暫時性記憶體驅動程式，無需連線設定。',
  sqliteDescription: '以檔案（或記憶體）為基礎的 SQL 資料庫，適合本機開發和小型部署。',
  postgresDescription: 'PostgreSQL 連線。填寫主機、連接埠和資料庫，或提供連線 URL。',
  mysqlDescription: 'MySQL 或 MariaDB 連線。',
  mongodbDescription: '透過連線 URI 連線 MongoDB。',
  initialDataDescription: '依物件名稱組織的預載資料',
  strictModeDescription: '記錄不存在時擲回錯誤，而不是傳回 null',
  persistenceDescription: '持久化設定（選用；預設為純記憶體）',
  filename: { title: '檔案名稱', description: '資料庫檔案路徑，或填 ":memory:" 使用暫時性記憶體資料庫' },
  autoMigrate: { title: '自動遷移資料表結構', description: '僅限開發環境：以非破壞性方式自動修復資料表結構' },
  connectionUrlTitle: '連線 URL',
  connectionUriTitle: '連線 URI',
  postgresUrlDescription: '連線 URI（優先於各個單項欄位；必須是 `pg` 能解析的 URL；不得內嵌密碼，請改為繫結密鑰）',
  urlDescription: '連線 URI（優先於各個單項欄位；不得內嵌密碼，請改為繫結密鑰）',
  host: { title: '主機', description: '主機位址' },
  port: { title: '連接埠', description: '連接埠號碼' },
  database: { title: '資料庫', description: '資料庫名稱' },
  username: { title: '使用者', description: '驗證使用者' },
  password: {
    title: '密碼',
    description:
      '透過連線表單的密鑰欄位或 `external.credentialsRef` 設定，加密存入 `sys_secret`，絕不存放在 `config` 中。'
      + '以程式碼定義的資料來源（`defineDatasource`）不在宣告中寫入憑證：連線時從依資料來源名稱衍生的執行階段環境變數讀取'
      + '（名為 `warehouse` 的資料來源讀取 `OS_DATASOURCE_WAREHOUSE_PASSWORD`），'
      + '`os serve` / `os start` 預設啟用此方式（`OS_DATASOURCE_ENV_CREDENTIALS=on`）。',
  },
  ssl: { title: '使用 SSL/TLS', description: '啟用 TLS。憑證填寫在資料來源層級的 `ssl` 設定區塊中。' },
  schema: { title: '結構描述', description: '預設結構描述（knex searchPath）' },
  applicationName: { title: '應用程式名稱', description: 'Postgres 的 application_name' },
  statementTimeout: { title: '陳述式逾時（毫秒）', description: '中止執行時間超過此值的陳述式（毫秒）' },
  authSource: { title: '驗證來源', description: '驗證資料庫' },
  mongoOptionsDescription:
    '額外的 MongoClient 選項（replicaSet、tls、逾時等）。以憑證命名的鍵（`password`、`authToken` 及其舊別名）'
    + '在任何層級都會被直接拒絕，請透過連線表單或 external.credentialsRef 繫結密鑰。'
    + '`proxyPassword`、`tlsCertificateKeyFilePassword`、`key` 和 `passphrase` 會被接受，並以明文靜態儲存；'
    + '它們只在讀回資料來源時被遮蔽，寫入時不會被拒絕。',
};

/** Español. */
const es: CatalogWords = {
  memoryLabel: 'En memoria',
  memoryDescription: 'Driver efímero en memoria para desarrollo, pruebas y prototipos. Sin ajustes de conexión.',
  sqliteDescription:
    'Base de datos SQL basada en archivo (o en memoria). Ideal para desarrollo local y despliegues pequeños.',
  postgresDescription: 'Conexión PostgreSQL. Indica host, puerto y base de datos, o una URL de conexión.',
  mysqlDescription: 'Conexión MySQL o MariaDB.',
  mongodbDescription: 'Conexión MongoDB mediante un URI de conexión.',
  initialDataDescription: 'Datos precargados, agrupados por nombre de objeto',
  strictModeDescription: 'Lanzar un error cuando falta un registro en lugar de devolver null',
  persistenceDescription: 'Configuración de persistencia (opcional; por defecto, solo en memoria)',
  filename: {
    title: 'Nombre de archivo',
    description: 'Ruta del archivo de base de datos, o ":memory:" para una base de datos efímera',
  },
  autoMigrate: {
    title: 'Migrar el esquema automáticamente',
    description: 'Solo para desarrollo: repara el esquema automáticamente sin destruir datos',
  },
  connectionUrlTitle: 'URL de conexión',
  connectionUriTitle: 'URI de conexión',
  postgresUrlDescription:
    'URI de conexión (sustituye a los campos individuales; debe ser una URL que `pg` pueda analizar; '
    + 'no debe incluir la contraseña: vincula el secreto en su lugar)',
  urlDescription:
    'URI de conexión (sustituye a los campos individuales; no debe incluir la contraseña: vincula el secreto en su lugar)',
  host: { title: 'Host', description: 'Dirección del host' },
  port: { title: 'Puerto', description: 'Número de puerto' },
  database: { title: 'Base de datos', description: 'Nombre de la base de datos' },
  username: { title: 'Usuario', description: 'Usuario de autenticación' },
  password: {
    title: 'Contraseña',
    description:
      'Se establece mediante el campo de secreto del formulario de conexión o `external.credentialsRef`: '
      + 'se cifra en `sys_secret` y nunca se guarda en `config`. Un origen de datos definido en código '
      + '(`defineDatasource`) no incluye la credencial en su declaración: se lee al conectar desde la variable '
      + 'de entorno derivada del nombre del origen de datos (`OS_DATASOURCE_WAREHOUSE_PASSWORD` para un origen '
      + 'de datos llamado `warehouse`), que `os serve` / `os start` respetan por defecto '
      + '(`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: { title: 'Usar SSL/TLS', description: 'Activa TLS. Los certificados van en el bloque `ssl` del origen de datos.' },
  schema: { title: 'Esquema', description: 'Esquema predeterminado (knex searchPath)' },
  applicationName: { title: 'Nombre de la aplicación', description: 'application_name de Postgres' },
  statementTimeout: {
    title: 'Tiempo límite de sentencia (ms)',
    description: 'Cancela las sentencias que tarden más que este valor (ms)',
  },
  authSource: { title: 'Origen de autenticación', description: 'Base de datos de autenticación' },
  mongoOptionsDescription:
    'Opciones adicionales de MongoClient (replicaSet, tls, tiempos de espera, …). Las claves con nombre de '
    + 'credencial (`password`, `authToken` y sus alias anteriores) se rechazan a cualquier profundidad: vincula '
    + 'el secreto mediante el formulario de conexión o external.credentialsRef. `proxyPassword`, '
    + '`tlsCertificateKeyFilePassword`, `key` y `passphrase` se aceptan y se guardan sin cifrar; solo se ocultan '
    + 'al volver a leer el origen de datos, no se rechazan al escribir.',
};

/** العربية. */
const ar: CatalogWords = {
  memoryLabel: 'في الذاكرة',
  memoryDescription: 'مشغّل مؤقت في الذاكرة للتطوير والاختبار والنماذج الأولية. لا يحتاج إلى إعدادات اتصال.',
  sqliteDescription: 'قاعدة بيانات SQL قائمة على ملف (أو في الذاكرة). مناسبة للتطوير المحلي وعمليات النشر الصغيرة.',
  postgresDescription: 'اتصال PostgreSQL. أدخل المضيف والمنفذ وقاعدة البيانات، أو عنوان URL للاتصال.',
  mysqlDescription: 'اتصال MySQL أو MariaDB.',
  mongodbDescription: 'اتصال MongoDB عبر URI للاتصال.',
  initialDataDescription: 'بيانات معبأة مسبقًا ومرتبة حسب اسم الكائن',
  strictModeDescription: 'إطلاق خطأ عند عدم وجود سجل بدلًا من إرجاع null',
  persistenceDescription: 'إعدادات الحفظ الدائم (اختيارية؛ الافتراضي في الذاكرة فقط)',
  filename: { title: 'اسم الملف', description: 'مسار ملف قاعدة البيانات، أو ":memory:" لقاعدة بيانات مؤقتة' },
  autoMigrate: { title: 'ترحيل المخطط تلقائيًا', description: 'للتطوير فقط: إصلاح تلقائي غير مدمّر للمخطط' },
  connectionUrlTitle: 'عنوان URL للاتصال',
  connectionUriTitle: 'URI للاتصال',
  postgresUrlDescription:
    'URI للاتصال (يحل محل الحقول المنفصلة؛ يجب أن يكون عنوان URL يستطيع `pg` تحليله؛ '
    + 'يجب ألا يتضمن كلمة المرور: اربط السر بدلًا من ذلك)',
  urlDescription: 'URI للاتصال (يحل محل الحقول المنفصلة؛ يجب ألا يتضمن كلمة المرور: اربط السر بدلًا من ذلك)',
  host: { title: 'المضيف', description: 'عنوان المضيف' },
  port: { title: 'المنفذ', description: 'رقم المنفذ' },
  database: { title: 'قاعدة البيانات', description: 'اسم قاعدة البيانات' },
  username: { title: 'المستخدم', description: 'مستخدم المصادقة' },
  password: {
    title: 'كلمة المرور',
    description:
      'تُعيَّن من حقل السر في نموذج الاتصال أو عبر `external.credentialsRef`، وتُشفَّر في `sys_secret` '
      + 'ولا تُخزَّن أبدًا في `config`. مصدر البيانات المعرَّف في الشيفرة (`defineDatasource`) لا يتضمن بيانات '
      + 'الاعتماد في تعريفه: تُقرأ عند الاتصال من متغير بيئة التشغيل المشتق من اسم مصدر البيانات '
      + '(`OS_DATASOURCE_WAREHOUSE_PASSWORD` لمصدر بيانات اسمه `warehouse`)، ويعتمده `os serve` / `os start` '
      + 'افتراضيًا (`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: { title: 'استخدام SSL/TLS', description: 'يفعّل TLS. توضع الشهادات في كتلة `ssl` على مستوى مصدر البيانات.' },
  schema: { title: 'المخطط', description: 'المخطط الافتراضي (knex searchPath)' },
  applicationName: { title: 'اسم التطبيق', description: 'قيمة application_name في Postgres' },
  statementTimeout: {
    title: 'مهلة العبارة (مللي ثانية)',
    description: 'إيقاف العبارات التي يتجاوز تنفيذها هذه المدة (مللي ثانية)',
  },
  authSource: { title: 'مصدر المصادقة', description: 'قاعدة بيانات المصادقة' },
  mongoOptionsDescription:
    'خيارات إضافية لـ MongoClient (replicaSet وtls والمهلات، …). المفاتيح التي تحمل أسماء بيانات اعتماد '
    + '(`password` و`authToken` وأسماؤها البديلة السابقة) تُرفض في أي مستوى: اربط السر عبر نموذج الاتصال أو '
    + 'external.credentialsRef. أما `proxyPassword` و`tlsCertificateKeyFilePassword` و`key` و`passphrase` '
    + 'فتُقبل وتُخزَّن كنص صريح؛ ولا تُخفى إلا عند قراءة مصدر البيانات، ولا تُرفض عند الكتابة.',
};

/** Français. */
const fr: CatalogWords = {
  memoryLabel: 'En mémoire',
  memoryDescription:
    'Pilote éphémère en mémoire pour le développement, les tests et le prototypage. Aucun paramètre de connexion.',
  sqliteDescription:
    'Base de données SQL sur fichier (ou en mémoire). Idéale pour le développement local et les petits déploiements.',
  postgresDescription:
    'Connexion PostgreSQL. Indiquez l’hôte, le port et la base de données, ou une URL de connexion.',
  mysqlDescription: 'Connexion MySQL ou MariaDB.',
  mongodbDescription: 'Connexion MongoDB via un URI de connexion.',
  initialDataDescription: 'Données préchargées, indexées par nom d’objet',
  strictModeDescription: 'Lever une erreur pour un enregistrement absent au lieu de renvoyer null',
  persistenceDescription: 'Configuration de la persistance (facultative ; par défaut, en mémoire uniquement)',
  filename: {
    title: 'Nom de fichier',
    description: 'Chemin du fichier de base de données, ou ":memory:" pour une base de données éphémère',
  },
  autoMigrate: {
    title: 'Migration automatique du schéma',
    description: 'Développement uniquement : réparation automatique et non destructive du schéma',
  },
  connectionUrlTitle: 'URL de connexion',
  connectionUriTitle: 'URI de connexion',
  postgresUrlDescription:
    'URI de connexion (remplace les champs individuels ; doit être une URL que `pg` sait analyser ; '
    + 'ne doit pas contenir de mot de passe : liez plutôt le secret)',
  urlDescription:
    'URI de connexion (remplace les champs individuels ; ne doit pas contenir de mot de passe : liez plutôt le secret)',
  host: { title: 'Hôte', description: 'Adresse de l’hôte' },
  port: { title: 'Port', description: 'Numéro de port' },
  database: { title: 'Base de données', description: 'Nom de la base de données' },
  username: { title: 'Utilisateur', description: 'Utilisateur d’authentification' },
  password: {
    title: 'Mot de passe',
    description:
      'Se définit dans le champ secret du formulaire de connexion ou via `external.credentialsRef` : chiffré dans '
      + '`sys_secret`, jamais stocké dans `config`. Une source de données définie dans le code (`defineDatasource`) '
      + 'n’inclut pas l’identifiant dans sa déclaration : il est lu à la connexion depuis la variable d’environnement '
      + 'dérivée du nom de la source de données (`OS_DATASOURCE_WAREHOUSE_PASSWORD` pour une source nommée '
      + '`warehouse`), que `os serve` / `os start` prennent en compte par défaut (`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: {
    title: 'Utiliser SSL/TLS',
    description: 'Active TLS. Les certificats se placent dans le bloc `ssl` de la source de données.',
  },
  schema: { title: 'Schéma', description: 'Schéma par défaut (knex searchPath)' },
  applicationName: { title: 'Nom de l’application', description: 'application_name de Postgres' },
  statementTimeout: {
    title: 'Délai d’expiration des requêtes (ms)',
    description: 'Interrompt les requêtes qui durent plus longtemps que cette valeur (ms)',
  },
  authSource: { title: 'Source d’authentification', description: 'Base de données d’authentification' },
  mongoOptionsDescription:
    'Options MongoClient supplémentaires (replicaSet, tls, délais, …). Les clés portant un nom d’identifiant '
    + '(`password`, `authToken` et leurs anciens alias) sont refusées à toute profondeur : liez le secret via le '
    + 'formulaire de connexion ou external.credentialsRef. `proxyPassword`, `tlsCertificateKeyFilePassword`, `key` '
    + 'et `passphrase` sont acceptées et stockées en clair ; elles ne sont masquées qu’à la relecture de la source '
    + 'de données, sans être refusées à l’écriture.',
};

/** Português (Brasil). */
const ptBR: CatalogWords = {
  memoryLabel: 'Em memória',
  memoryDescription: 'Driver efêmero em memória para desenvolvimento, testes e protótipos. Sem configurações de conexão.',
  sqliteDescription:
    'Banco de dados SQL baseado em arquivo (ou em memória). Ótimo para desenvolvimento local e implantações pequenas.',
  postgresDescription: 'Conexão PostgreSQL. Informe host, porta e banco de dados, ou uma URL de conexão.',
  mysqlDescription: 'Conexão MySQL ou MariaDB.',
  mongodbDescription: 'Conexão MongoDB por meio de um URI de conexão.',
  initialDataDescription: 'Dados pré-carregados, organizados por nome de objeto',
  strictModeDescription: 'Lançar erro quando um registro não existe em vez de retornar null',
  persistenceDescription: 'Configuração de persistência (opcional; por padrão, apenas em memória)',
  filename: {
    title: 'Nome do arquivo',
    description: 'Caminho do arquivo do banco de dados, ou ":memory:" para um banco de dados efêmero',
  },
  autoMigrate: {
    title: 'Migrar esquema automaticamente',
    description: 'Somente em desenvolvimento: corrige o esquema automaticamente, sem destruir dados',
  },
  connectionUrlTitle: 'URL de conexão',
  connectionUriTitle: 'URI de conexão',
  postgresUrlDescription:
    'URI de conexão (substitui os campos individuais; deve ser uma URL que o `pg` consiga interpretar; '
    + 'não deve conter a senha: vincule o segredo em vez disso)',
  urlDescription:
    'URI de conexão (substitui os campos individuais; não deve conter a senha: vincule o segredo em vez disso)',
  host: { title: 'Host', description: 'Endereço do host' },
  port: { title: 'Porta', description: 'Número da porta' },
  database: { title: 'Banco de dados', description: 'Nome do banco de dados' },
  username: { title: 'Usuário', description: 'Usuário de autenticação' },
  password: {
    title: 'Senha',
    description:
      'Definida pelo campo de segredo do formulário de conexão ou por `external.credentialsRef`: criptografada em '
      + '`sys_secret`, nunca armazenada em `config`. Uma fonte de dados definida em código (`defineDatasource`) não '
      + 'inclui a credencial na declaração: ela é lida ao conectar, a partir da variável de ambiente derivada do nome '
      + 'da fonte de dados (`OS_DATASOURCE_WAREHOUSE_PASSWORD` para uma fonte de dados chamada `warehouse`), que '
      + '`os serve` / `os start` respeitam por padrão (`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: { title: 'Usar SSL/TLS', description: 'Ativa o TLS. Os certificados ficam no bloco `ssl` da fonte de dados.' },
  schema: { title: 'Esquema', description: 'Esquema padrão (knex searchPath)' },
  applicationName: { title: 'Nome da aplicação', description: 'application_name do Postgres' },
  statementTimeout: {
    title: 'Tempo limite de instrução (ms)',
    description: 'Interrompe instruções que demorarem mais que este valor (ms)',
  },
  authSource: { title: 'Origem da autenticação', description: 'Banco de dados de autenticação' },
  mongoOptionsDescription:
    'Opções adicionais do MongoClient (replicaSet, tls, tempos limite, …). Chaves com nome de credencial '
    + '(`password`, `authToken` e seus aliases antigos) são recusadas em qualquer nível: vincule o segredo pelo '
    + 'formulário de conexão ou por external.credentialsRef. `proxyPassword`, `tlsCertificateKeyFilePassword`, '
    + '`key` e `passphrase` são aceitas e armazenadas sem criptografia; elas só são mascaradas quando a fonte de '
    + 'dados é lida de volta, não recusadas na gravação.',
};

/** Русский. */
const ru: CatalogWords = {
  memoryLabel: 'В памяти',
  memoryDescription: 'Временный драйвер в памяти для разработки, тестов и прототипов. Параметры подключения не нужны.',
  sqliteDescription:
    'SQL-база данных в файле (или в памяти). Подходит для локальной разработки и небольших развертываний.',
  postgresDescription: 'Подключение к PostgreSQL. Укажите хост, порт и базу данных или URL подключения.',
  mysqlDescription: 'Подключение к MySQL или MariaDB.',
  mongodbDescription: 'Подключение к MongoDB по URI подключения.',
  initialDataDescription: 'Предзаполненные данные, сгруппированные по имени объекта',
  strictModeDescription: 'Выбрасывать ошибку при отсутствии записи вместо возврата null',
  persistenceDescription: 'Настройки сохранения (необязательно; по умолчанию только в памяти)',
  filename: {
    title: 'Имя файла',
    description: 'Путь к файлу базы данных или ":memory:" для временной базы данных',
  },
  autoMigrate: {
    title: 'Автомиграция схемы',
    description: 'Только для разработки: неразрушающее автоматическое исправление схемы',
  },
  connectionUrlTitle: 'URL подключения',
  connectionUriTitle: 'URI подключения',
  postgresUrlDescription:
    'URI подключения (заменяет отдельные поля; должен быть URL, который понимает `pg`; '
    + 'не должен содержать пароль: вместо этого привяжите секрет)',
  urlDescription: 'URI подключения (заменяет отдельные поля; не должен содержать пароль: вместо этого привяжите секрет)',
  host: { title: 'Хост', description: 'Адрес хоста' },
  port: { title: 'Порт', description: 'Номер порта' },
  database: { title: 'База данных', description: 'Имя базы данных' },
  username: { title: 'Пользователь', description: 'Пользователь для аутентификации' },
  password: {
    title: 'Пароль',
    description:
      'Задается в поле секрета формы подключения или через `external.credentialsRef`: шифруется в `sys_secret` '
      + 'и никогда не хранится в `config`. Источник данных, определенный в коде (`defineDatasource`), не содержит '
      + 'учетных данных в объявлении: при подключении они читаются из переменной окружения, образованной от имени '
      + 'источника данных (`OS_DATASOURCE_WAREHOUSE_PASSWORD` для источника данных `warehouse`); '
      + '`os serve` / `os start` учитывают ее по умолчанию (`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: {
    title: 'Использовать SSL/TLS',
    description: 'Включает TLS. Сертификаты задаются в блоке `ssl` на уровне источника данных.',
  },
  schema: { title: 'Схема', description: 'Схема по умолчанию (knex searchPath)' },
  applicationName: { title: 'Имя приложения', description: 'application_name в Postgres' },
  statementTimeout: {
    title: 'Тайм-аут запроса (мс)',
    description: 'Прерывать запросы, выполняющиеся дольше этого значения (мс)',
  },
  authSource: { title: 'Источник аутентификации', description: 'База данных аутентификации' },
  mongoOptionsDescription:
    'Дополнительные параметры MongoClient (replicaSet, tls, тайм-ауты, …). Ключи с именами учетных данных '
    + '(`password`, `authToken` и их прежние псевдонимы) отклоняются на любом уровне вложенности: привяжите секрет '
    + 'через форму подключения или external.credentialsRef. `proxyPassword`, `tlsCertificateKeyFilePassword`, '
    + '`key` и `passphrase` принимаются и хранятся в открытом виде; они скрываются только при чтении источника '
    + 'данных, а при записи не отклоняются.',
};

/** Deutsch. */
const de: CatalogWords = {
  memoryLabel: 'Im Arbeitsspeicher',
  memoryDescription:
    'Flüchtiger In-Memory-Treiber für Entwicklung, Tests und Prototypen. Keine Verbindungseinstellungen.',
  sqliteDescription:
    'Dateibasierte (oder speicherinterne) SQL-Datenbank. Gut geeignet für lokale Entwicklung und kleine Deployments.',
  postgresDescription: 'PostgreSQL-Verbindung. Host, Port und Datenbank oder eine Verbindungs-URL angeben.',
  mysqlDescription: 'MySQL- oder MariaDB-Verbindung.',
  mongodbDescription: 'MongoDB-Verbindung über einen Verbindungs-URI.',
  initialDataDescription: 'Vorab geladene Daten, nach Objektname gruppiert',
  strictModeDescription: 'Bei fehlenden Datensätzen einen Fehler auslösen, statt null zurückzugeben',
  persistenceDescription: 'Persistenzkonfiguration (optional; standardmäßig nur im Arbeitsspeicher)',
  filename: {
    title: 'Dateiname',
    description: 'Pfad der Datenbankdatei oder ":memory:" für eine flüchtige Datenbank',
  },
  autoMigrate: {
    title: 'Schema automatisch migrieren',
    description: 'Nur für Entwicklung: nicht destruktive automatische Schemareparatur',
  },
  connectionUrlTitle: 'Verbindungs-URL',
  connectionUriTitle: 'Verbindungs-URI',
  postgresUrlDescription:
    'Verbindungs-URI (ersetzt die Einzelfelder; muss eine URL sein, die `pg` parsen kann; '
    + 'darf kein Passwort enthalten: stattdessen das Secret binden)',
  urlDescription: 'Verbindungs-URI (ersetzt die Einzelfelder; darf kein Passwort enthalten: stattdessen das Secret binden)',
  host: { title: 'Host', description: 'Hostadresse' },
  port: { title: 'Port', description: 'Portnummer' },
  database: { title: 'Datenbank', description: 'Datenbankname' },
  username: { title: 'Benutzer', description: 'Authentifizierungsbenutzer' },
  password: {
    title: 'Passwort',
    description:
      'Wird über das Secret-Feld des Verbindungsformulars oder `external.credentialsRef` gesetzt: verschlüsselt in '
      + '`sys_secret` abgelegt, nie in `config` gespeichert. Eine im Code definierte Datenquelle (`defineDatasource`) '
      + 'lässt die Anmeldedaten in der Deklaration weg: Sie werden beim Verbinden aus der Umgebungsvariable gelesen, '
      + 'die sich aus dem Namen der Datenquelle ergibt (`OS_DATASOURCE_WAREHOUSE_PASSWORD` für eine Datenquelle '
      + 'namens `warehouse`); `os serve` / `os start` berücksichtigen sie standardmäßig '
      + '(`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: { title: 'SSL/TLS verwenden', description: 'Aktiviert TLS. Zertifikate gehören in den `ssl`-Block der Datenquelle.' },
  schema: { title: 'Schema', description: 'Standardschema (knex searchPath)' },
  applicationName: { title: 'Anwendungsname', description: 'application_name von Postgres' },
  statementTimeout: {
    title: 'Statement-Timeout (ms)',
    description: 'Bricht Anweisungen ab, die länger als dieser Wert laufen (ms)',
  },
  authSource: { title: 'Authentifizierungsquelle', description: 'Authentifizierungsdatenbank' },
  mongoOptionsDescription:
    'Zusätzliche MongoClient-Optionen (replicaSet, tls, Timeouts, …). Schlüssel mit Anmeldedaten-Namen '
    + '(`password`, `authToken` und ihre früheren Aliasse) werden auf jeder Ebene abgelehnt: Binden Sie das Secret '
    + 'über das Verbindungsformular oder external.credentialsRef. `proxyPassword`, `tlsCertificateKeyFilePassword`, '
    + '`key` und `passphrase` werden akzeptiert und im Klartext gespeichert; sie werden nur beim Zurücklesen der '
    + 'Datenquelle maskiert und beim Schreiben nicht abgelehnt.',
};

/** 日本語. */
const ja: CatalogWords = {
  memoryLabel: 'インメモリ',
  memoryDescription: '開発、テスト、プロトタイピング用の一時的なインメモリドライバー。接続設定は不要です。',
  sqliteDescription: 'ファイルベース（またはインメモリ）の SQL データベース。ローカル開発や小規模なデプロイに最適です。',
  postgresDescription: 'PostgreSQL 接続。ホスト、ポート、データベースを指定するか、接続 URL を指定します。',
  mysqlDescription: 'MySQL または MariaDB 接続。',
  mongodbDescription: '接続 URI による MongoDB 接続。',
  initialDataDescription: 'オブジェクト名ごとの初期データ',
  strictModeDescription: 'レコードが存在しない場合、null を返す代わりにエラーをスローする',
  persistenceDescription: '永続化の設定（任意。既定ではインメモリのみ）',
  filename: {
    title: 'ファイル名',
    description: 'データベースファイルのパス。一時的なデータベースには ":memory:" を指定',
  },
  autoMigrate: { title: 'スキーマの自動マイグレーション', description: '開発環境専用：非破壊的なスキーマ自動修復' },
  connectionUrlTitle: '接続 URL',
  connectionUriTitle: '接続 URI',
  postgresUrlDescription:
    '接続 URI（個別フィールドより優先。`pg` が解析できる URL であること。パスワードを含めず、代わりにシークレットをバインドしてください）',
  urlDescription: '接続 URI（個別フィールドより優先。パスワードを含めず、代わりにシークレットをバインドしてください）',
  host: { title: 'ホスト', description: 'ホストアドレス' },
  port: { title: 'ポート', description: 'ポート番号' },
  database: { title: 'データベース', description: 'データベース名' },
  username: { title: 'ユーザー', description: '認証ユーザー' },
  password: {
    title: 'パスワード',
    description:
      '接続フォームのシークレット欄または `external.credentialsRef` で設定し、`sys_secret` に暗号化して保存されます。'
      + '`config` には保存されません。コードで定義したデータソース（`defineDatasource`）は宣言に認証情報を書きません。'
      + '接続時に、データソース名から導出される実行時の環境変数から読み取ります'
      + '（`warehouse` という名前のデータソースなら `OS_DATASOURCE_WAREHOUSE_PASSWORD`）。'
      + '`os serve` / `os start` は既定でこれに従います（`OS_DATASOURCE_ENV_CREDENTIALS=on`）。',
  },
  ssl: { title: 'SSL/TLS を使用', description: 'TLS を有効にします。証明書はデータソースレベルの `ssl` ブロックに指定します。' },
  schema: { title: 'スキーマ', description: '既定のスキーマ（knex searchPath）' },
  applicationName: { title: 'アプリケーション名', description: 'Postgres の application_name' },
  statementTimeout: {
    title: 'ステートメントタイムアウト（ミリ秒）',
    description: 'この時間を超えて実行されるステートメントを中止します（ミリ秒）',
  },
  authSource: { title: '認証ソース', description: '認証データベース' },
  mongoOptionsDescription:
    '追加の MongoClient オプション（replicaSet、tls、タイムアウトなど）。認証情報の名前を持つキー'
    + '（`password`、`authToken` とその旧エイリアス）は、どの階層でも拒否されます。シークレットは接続フォームまたは '
    + 'external.credentialsRef でバインドしてください。`proxyPassword`、`tlsCertificateKeyFilePassword`、`key`、'
    + '`passphrase` は受け付けられ、平文のまま保存されます。データソースの読み戻し時にのみマスクされ、'
    + '書き込み時には拒否されません。',
};

/** 한국어. */
const ko: CatalogWords = {
  memoryLabel: '인메모리',
  memoryDescription: '개발, 테스트, 프로토타이핑을 위한 임시 인메모리 드라이버입니다. 연결 설정이 필요 없습니다.',
  sqliteDescription: '파일 기반(또는 인메모리) SQL 데이터베이스입니다. 로컬 개발과 소규모 배포에 적합합니다.',
  postgresDescription: 'PostgreSQL 연결입니다. 호스트, 포트, 데이터베이스를 입력하거나 연결 URL을 입력하세요.',
  mysqlDescription: 'MySQL 또는 MariaDB 연결입니다.',
  mongodbDescription: '연결 URI를 통한 MongoDB 연결입니다.',
  initialDataDescription: '개체 이름별로 미리 채워진 데이터',
  strictModeDescription: '레코드가 없으면 null을 반환하는 대신 오류를 발생시킵니다',
  persistenceDescription: '영속성 구성(선택 사항, 기본값은 메모리 전용)',
  filename: {
    title: '파일 이름',
    description: '데이터베이스 파일 경로, 또는 임시 데이터베이스의 경우 ":memory:"',
  },
  autoMigrate: { title: '스키마 자동 마이그레이션', description: '개발 전용: 비파괴적 스키마 자동 복구' },
  connectionUrlTitle: '연결 URL',
  connectionUriTitle: '연결 URI',
  postgresUrlDescription:
    '연결 URI(개별 필드보다 우선 적용, `pg`가 해석할 수 있는 URL이어야 함, '
    + '비밀번호를 포함하면 안 되며 대신 시크릿을 바인딩하세요)',
  urlDescription: '연결 URI(개별 필드보다 우선 적용, 비밀번호를 포함하면 안 되며 대신 시크릿을 바인딩하세요)',
  host: { title: '호스트', description: '호스트 주소' },
  port: { title: '포트', description: '포트 번호' },
  database: { title: '데이터베이스', description: '데이터베이스 이름' },
  username: { title: '사용자', description: '인증 사용자' },
  password: {
    title: '비밀번호',
    description:
      '연결 양식의 시크릿 필드 또는 `external.credentialsRef`로 설정하며, `sys_secret`에 암호화되어 저장되고 '
      + '`config`에는 절대 저장되지 않습니다. 코드로 정의한 데이터 소스(`defineDatasource`)는 선언에 자격 증명을 '
      + '넣지 않습니다. 연결 시 데이터 소스 이름에서 파생된 런타임 환경 변수에서 읽으며(이름이 `warehouse`인 데이터 '
      + '소스는 `OS_DATASOURCE_WAREHOUSE_PASSWORD`), `os serve` / `os start`는 기본적으로 이를 따릅니다'
      + '(`OS_DATASOURCE_ENV_CREDENTIALS=on`).',
  },
  ssl: { title: 'SSL/TLS 사용', description: 'TLS를 활성화합니다. 인증서는 데이터 소스 수준의 `ssl` 블록에 넣습니다.' },
  schema: { title: '스키마', description: '기본 스키마(knex searchPath)' },
  applicationName: { title: '애플리케이션 이름', description: 'Postgres의 application_name' },
  statementTimeout: {
    title: '문 실행 제한 시간(ms)',
    description: '이 값보다 오래 실행되는 문을 중단합니다(ms)',
  },
  authSource: { title: '인증 소스', description: '인증 데이터베이스' },
  mongoOptionsDescription:
    '추가 MongoClient 옵션(replicaSet, tls, 제한 시간 등). 자격 증명 이름을 가진 키(`password`, `authToken` 및 '
    + '이전 별칭)는 어느 깊이에서든 거부됩니다. 연결 양식 또는 external.credentialsRef로 시크릿을 바인딩하세요. '
    + '`proxyPassword`, `tlsCertificateKeyFilePassword`, `key`, `passphrase`는 허용되며 평문으로 저장됩니다. '
    + '데이터 소스를 다시 읽을 때만 가려지고, 쓸 때는 거부되지 않습니다.',
};

/**
 * The catalog's translations, by platform locale table tag. A requested code
 * reaches its entry through the table's own reader (`driverCatalogLocaleOf` in
 * `driver-catalog.ts`), so `zh-TW` reads `zh-Hant` and `zh-CN` reads
 * `zh-Hans`.
 */
export const DRIVER_CATALOG_TRANSLATIONS: Readonly<Record<DriverCatalogLocale, DriverCatalogLocaleText>> = {
  'zh-Hans': catalogText(zhHans),
  'zh-Hant': catalogText(zhHant),
  es: catalogText(es),
  ar: catalogText(ar),
  fr: catalogText(fr),
  'pt-BR': catalogText(ptBR),
  ru: catalogText(ru),
  de: catalogText(de),
  ja: catalogText(ja),
  ko: catalogText(ko),
};
