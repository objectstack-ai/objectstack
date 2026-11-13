// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-retired-permission-residue.ts`'s
 * advisory finding (`permission-retired-lifecycle-residue`), in every platform
 * locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding
 * mechanism and the locale ladder are `finding-user-text.ts`'s; this file is
 * the rule's own half of it, kept beside the rule so its wording and its
 * translations change together.
 *
 * Who reads it: the person who saved a permission set in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from it. It says the line grants nothing, to delete it, and where restoring
 * and purging deleted records is granted now: the recycle bin, the console's
 * own name for it (`recycleBin.title`, `ui/packages/i18n`).
 *
 * Params, set at the push site in `validate-retired-permission-residue.ts`:
 * `permissionSet`, `object` and `key` (`allowRestore` or `allowPurge`, written
 * as the author wrote it; the residue value is always `false`).
 *
 * `finding-user-text.connector-permission-form.test.ts` renders it from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { PERMISSION_RETIRED_LIFECYCLE_RESIDUE } from './validate-retired-permission-residue.js';

export const RETIRED_PERMISSION_RESIDUE_USER_TEXT: UserTextCatalog = Object.freeze({
  [PERMISSION_RETIRED_LIFECYCLE_RESIDUE]: {
    en: (p) =>
      `Permission set "${p.permissionSet}" still sets "${p.key}: false" for object "${p.object}". That setting was ` +
      `removed and is now ignored, so this line grants nothing. Delete it: who can restore or purge deleted records ` +
      `is now granted through the recycle bin.`,
    'zh-Hans': (p) =>
      `权限集“${p.permissionSet}”仍为对象“${p.object}”设置了“${p.key}: false”。该设置已被移除，现在会被忽略，因此这一行不授予任何权限。` +
      `请删除它：谁可以恢复或彻底删除已删除的记录，现在通过回收站授予。`,
    'zh-Hant': (p) =>
      `權限集「${p.permissionSet}」仍為物件「${p.object}」設定了「${p.key}: false」。該設定已被移除，現在會被忽略，因此這一行不授予任何權限。` +
      `請刪除它：誰可以還原或永久刪除已刪除的記錄，現在透過回收站授予。`,
    es: (p) =>
      `El conjunto de permisos "${p.permissionSet}" todavía establece "${p.key}: false" para el objeto ` +
      `"${p.object}". Esa opción se eliminó y ahora se ignora, así que esta línea no concede nada. Elimínela: ` +
      `quién puede restaurar o purgar registros eliminados se concede ahora mediante la papelera.`,
    ar: (p) =>
      `لا تزال مجموعة الأذونات "${p.permissionSet}" تضبط "${p.key}: false" للكائن "${p.object}". أُزيل هذا ` +
      `الإعداد ويُتجاهل الآن، لذا لا يمنح هذا السطر أي شيء. احذفه: من يمكنه استعادة السجلات المحذوفة أو حذفها ` +
      `نهائيًا يُمنح الآن عبر سلة المحذوفات.`,
    fr: (p) =>
      `L’ensemble d’autorisations « ${p.permissionSet} » définit encore « ${p.key}: false » pour l’objet ` +
      `« ${p.object} ». Ce paramètre a été supprimé et il est désormais ignoré : cette ligne n’accorde donc rien. ` +
      `Supprimez-la : le droit de restaurer ou de purger les enregistrements supprimés s’accorde désormais via la corbeille.`,
    'pt-BR': (p) =>
      `O conjunto de permissões "${p.permissionSet}" ainda define "${p.key}: false" para o objeto "${p.object}". ` +
      `Essa configuração foi removida e agora é ignorada, então esta linha não concede nada. Exclua-a: quem pode ` +
      `restaurar ou expurgar registros excluídos agora é concedido pela lixeira.`,
    ru: (p) =>
      `Набор разрешений «${p.permissionSet}» всё ещё задаёт «${p.key}: false» для объекта «${p.object}». Эта ` +
      `настройка удалена и теперь игнорируется, поэтому строка ничего не даёт. Удалите её: право восстанавливать ` +
      `или окончательно удалять удалённые записи теперь выдаётся через корзину.`,
    de: (p) =>
      `Der Berechtigungssatz „${p.permissionSet}“ setzt für das Objekt „${p.object}“ noch „${p.key}: false“. ` +
      `Diese Einstellung wurde entfernt und wird jetzt ignoriert, daher gewährt diese Zeile nichts. Löschen Sie ` +
      `sie: Wer gelöschte Datensätze wiederherstellen oder endgültig löschen darf, wird jetzt über den Papierkorb gewährt.`,
    ja: (p) =>
      `権限セット「${p.permissionSet}」は、オブジェクト「${p.object}」に対してまだ「${p.key}: false」を設定しています。` +
      `この設定は削除され、現在は無視されるため、この行は何も付与しません。この行を削除してください。` +
      `削除済みレコードを復元または完全に削除できるユーザーは、現在はごみ箱で付与します。`,
    ko: (p) =>
      `권한 집합 "${p.permissionSet}"이(가) 개체 "${p.object}"에 대해 아직 "${p.key}: false"를 설정하고 있습니다. ` +
      `이 설정은 제거되어 이제 무시되므로, 이 줄은 아무 권한도 부여하지 않습니다. 이 줄을 삭제하세요. 삭제된 ` +
      `레코드를 복원하거나 영구 삭제할 수 있는 사람은 이제 휴지통을 통해 부여됩니다.`,
  },
});
