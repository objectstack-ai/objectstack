// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver catalog's words in the languages the New datasource dialog is
 * written in, keyed by locale tag.
 *
 * `GET /api/v1/datasources/drivers` serves every word the dialog shows about a
 * driver: the entry's `label` and `description`, and each connection field's
 * JSON-Schema `title` and `description`. The console has no key of its own for
 * any of them, so before this table a Chinese console read `Filename`,
 * `Auto-migrate schema`, `Host` and `Port` in English beside Chinese text
 * everywhere else in the dialog.
 *
 * ## What is translated, and what stays English
 *
 * English is the source and is never restated here: the entry words come from
 * `CURATED` in `driver-catalog.ts`, the field words from the spec's per-driver
 * zod schemas, projected to JSON Schema. A locale below overrides a word only
 * where the English side has one, and any word it leaves out is served in
 * English (`driverCatalogFor`), never as a key.
 *
 * The fields are the top-level properties of each driver's `configSchema`, the
 * ones the dialog draws as inputs. Nested shapes (the memory driver's
 * persistence variants) are not drawn, so they are not translated.
 *
 * `zh-CN` is the one locale today because the dialog's own strings are written
 * in English and Chinese only (the console's `studio` namespace); a Japanese or
 * Spanish dialog is English around these fields, so translating the fields
 * alone would make it read in two languages the other way round. A locale is
 * added here when the dialog gains it.
 *
 * `__tests__/driver-catalog.test.ts` holds every locale to the served
 * shape: each driver and field named here exists, and every field word the
 * English side carries is translated.
 */

import type { BuiltinDriverId } from '@objectstack/spec/data';

/** One connection field's words: the JSON-Schema `title` and `description`. */
export interface DriverFieldText {
  title?: string;
  description?: string;
}

/** One driver's words in one locale. */
export interface DriverCatalogText {
  label?: string;
  description?: string;
  /** Keyed by the field's property name in the driver's `configSchema`. */
  fields?: Readonly<Record<string, DriverFieldText>>;
}

/** Every curated driver's words in one locale. */
export type DriverCatalogLocaleText = Readonly<Partial<Record<BuiltinDriverId, DriverCatalogText>>>;

// Fields several drivers share, in the same words.
const ZH_HOST: DriverFieldText = { title: '主机', description: '主机地址' };
const ZH_PORT: DriverFieldText = { title: '端口', description: '端口号' };
const ZH_DATABASE: DriverFieldText = { title: '数据库', description: '数据库名称' };
const ZH_USERNAME: DriverFieldText = { title: '用户', description: '认证用户' };
const ZH_PASSWORD: DriverFieldText = {
  title: '密码',
  description:
    '通过连接表单的密钥字段或 `external.credentialsRef` 设置，加密存入 `sys_secret`，从不存放在 `config` 中。'
    + '在代码中定义的数据源（`defineDatasource`）不在声明中写凭据：连接时从按数据源名称派生的运行时环境变量读取'
    + '（名为 `warehouse` 的数据源读取 `OS_DATASOURCE_WAREHOUSE_PASSWORD`），'
    + '`os serve` / `os start` 默认启用此方式（`OS_DATASOURCE_ENV_CREDENTIALS=on`）。',
};
const ZH_SSL: DriverFieldText = {
  title: '使用 SSL/TLS',
  description: '启用 TLS。证书填写在数据源级别的 `ssl` 配置块中。',
};
const ZH_AUTO_MIGRATE: DriverFieldText = {
  title: '自动迁移表结构',
  description: '仅限开发环境：以非破坏性方式自动修复表结构',
};
const ZH_URL_NO_PASSWORD = '连接 URI（优先于各单项字段；不得内嵌密码，请改为绑定密钥）';

/** 简体中文 (zh-CN). */
const zhCN: DriverCatalogLocaleText = {
  memory: {
    label: '内存',
    description: '用于开发、测试和原型验证的临时内存驱动，无需连接设置。',
    fields: {
      initialData: { description: '按对象名称组织的预置数据' },
      strictMode: { description: '记录不存在时抛出错误，而不是返回 null' },
      persistence: { description: '持久化配置（可选；默认纯内存）' },
    },
  },
  sqlite: {
    description: '基于文件（或内存）的 SQL 数据库，适合本地开发和小型部署。',
    fields: {
      filename: { title: '文件名', description: '数据库文件路径，或填 ":memory:" 使用临时内存数据库' },
      autoMigrate: ZH_AUTO_MIGRATE,
    },
  },
  postgres: {
    description: 'PostgreSQL 连接。填写主机、端口和数据库，或提供连接 URL。',
    fields: {
      url: {
        title: '连接 URL',
        description: '连接 URI（优先于各单项字段；必须是 `pg` 能解析的 URL；不得内嵌密码，请改为绑定密钥）',
      },
      host: ZH_HOST,
      port: ZH_PORT,
      database: ZH_DATABASE,
      username: ZH_USERNAME,
      password: ZH_PASSWORD,
      ssl: ZH_SSL,
      schema: { title: '模式', description: '默认模式（knex searchPath）' },
      applicationName: { title: '应用名称', description: 'Postgres 的 application_name' },
      statementTimeout: { title: '语句超时（毫秒）', description: '中止运行时间超过此值的语句（毫秒）' },
      autoMigrate: ZH_AUTO_MIGRATE,
    },
  },
  mysql: {
    description: 'MySQL 或 MariaDB 连接。',
    fields: {
      url: { title: '连接 URL', description: ZH_URL_NO_PASSWORD },
      host: ZH_HOST,
      port: ZH_PORT,
      database: ZH_DATABASE,
      username: ZH_USERNAME,
      password: ZH_PASSWORD,
      ssl: ZH_SSL,
      autoMigrate: ZH_AUTO_MIGRATE,
    },
  },
  mongodb: {
    description: '通过连接 URI 连接 MongoDB。',
    fields: {
      url: { title: '连接 URI', description: ZH_URL_NO_PASSWORD },
      database: ZH_DATABASE,
      host: ZH_HOST,
      port: ZH_PORT,
      username: ZH_USERNAME,
      password: ZH_PASSWORD,
      authSource: { title: '认证库', description: '认证数据库' },
      options: {
        description:
          '额外的 MongoClient 选项（replicaSet、tls、超时等）。以凭据命名的键（`password`、`authToken` 及其旧别名）'
          + '在任何层级都会被直接拒绝，请通过连接表单或 external.credentialsRef 绑定密钥。'
          + '`proxyPassword`、`tlsCertificateKeyFilePassword`、`key` 和 `passphrase` 会被接受，并以明文静态存储；'
          + '它们只在读回数据源时被遮蔽，写入时不会被拒绝。',
      },
    },
  },
};

/**
 * The catalog's translations, by locale tag. A requested locale is matched
 * against these keys by the platform's one negotiation ladder
 * (`resolveLocaleAmong`), so `zh`, `zh-cn` and `zh-SG` reach `zh-CN`.
 */
export const DRIVER_CATALOG_TRANSLATIONS: Readonly<Record<string, DriverCatalogLocaleText>> = {
  'zh-CN': zhCN,
};
