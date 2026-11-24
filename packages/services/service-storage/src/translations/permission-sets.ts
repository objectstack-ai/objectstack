// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `permissions.<name>` translations of the one permission set this service
 * declares, `storage_attachment_member` (`../attachment-member-grant.ts`),
 * overlaid on the served set by `translatePermissionSet`. HAND-AUTHORED (the
 * extract runs objects-only): when the set's label or description changes,
 * re-translate every locale here in the same change; nothing marks one stale.
 */

import type { TranslationData } from '@objectstack/spec/system';

type PermissionSetTranslations = NonNullable<TranslationData['permissions']>;

const entry = (label: string, description: string): PermissionSetTranslations => ({
  storage_attachment_member: { label, description },
});

export const storagePermissionSets: Readonly<Record<string, PermissionSetTranslations>> = {
  'zh-CN': entry(
    '附件：读取与添加（所有成员）',
    '每位成员对附件（sys_attachment）的读取与新建权限，由存储服务随附件的行级访问检查一并提供。成员可为自己能编辑的记录添加文件，并查看自己能读取的记录的文件。',
  ),
  'ja-JP': entry(
    '添付ファイル：参照と添付（全メンバー）',
    'すべてのメンバーに添付ファイル（sys_attachment）の参照と作成を許可し、ストレージサービスが添付ファイルの行チェックと合わせて付与します。メンバーは編集できるレコードにファイルを添付し、参照できるレコードのファイルを見られます。',
  ),
  'es-ES': entry(
    'Adjuntos: leer y adjuntar (todos los miembros)',
    'Lectura y creación en sys_attachment para todo miembro, aportadas por el servicio de almacenamiento junto a los controles por fila de los adjuntos. Un miembro adjunta archivos a los registros que puede editar y ve los de los registros que puede leer.',
  ),
  'zh-Hant': entry(
    '附件：讀取與新增（所有成員）',
    '每位成員對附件（sys_attachment）的讀取與建立權限，由儲存服務隨附件的逐筆存取檢查一併提供。成員可為自己能編輯的記錄新增檔案，並檢視自己能讀取的記錄的檔案。',
  ),
  'ar': entry(
    'المرفقات: قراءة وإرفاق (كل الأعضاء)',
    'قراءة وإنشاء على sys_attachment لكل عضو، توفّرهما خدمة التخزين إلى جانب فحوص صفوف المرفقات. يرفق العضو ملفًا بسجل يمكنه تعديله ويرى ملفات السجل الذي يمكنه قراءته.',
  ),
  'fr': entry(
    'Pièces jointes : lire et joindre (tous les membres)',
    'Lecture et création sur sys_attachment pour tout membre, apportées par le service de stockage avec les contrôles par ligne des pièces jointes. Un membre joint un fichier à un enregistrement qu’il peut modifier et voit ceux d’un enregistrement qu’il peut lire.',
  ),
  'pt-BR': entry(
    'Anexos: ler e anexar (todos os membros)',
    'Leitura e criação em sys_attachment para todo membro, fornecidas pelo serviço de armazenamento junto às verificações por linha dos anexos. Um membro anexa arquivos aos registros que pode editar e vê os dos registros que pode ler.',
  ),
  'ru': entry(
    'Вложения: чтение и прикрепление (все участники)',
    'Чтение и создание в sys_attachment для каждого участника, предоставляемые службой хранения вместе с построчными проверками вложений. Участник прикрепляет файл к записи, которую может изменять, и видит файлы записей, которые может читать.',
  ),
  'de': entry(
    'Anhänge: lesen und anhängen (alle Mitglieder)',
    'Lesen und Anlegen in sys_attachment für jedes Mitglied, bereitgestellt vom Speicherdienst zusammen mit den zeilenweisen Prüfungen der Anhänge. Ein Mitglied hängt Dateien an Datensätze an, die es bearbeiten darf, und sieht die Dateien der Datensätze, die es lesen darf.',
  ),
  'ko': entry(
    '첨부 파일: 읽기 및 첨부(모든 멤버)',
    '모든 멤버에게 sys_attachment의 읽기와 생성을 허용하며, 스토리지 서비스가 첨부 파일 행 검사와 함께 제공합니다. 멤버는 편집할 수 있는 레코드에 파일을 첨부하고 읽을 수 있는 레코드의 파일을 볼 수 있습니다.',
  ),
};
