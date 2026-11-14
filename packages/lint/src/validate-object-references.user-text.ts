// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `validate-object-references.ts`'s advisory, in
 * every platform locale (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`).
 * The finding mechanism and the locale ladder are `finding-user-text.ts`'s;
 * this file is the rule's own half of it, kept beside the rule so its wording
 * and its translations change together.
 *
 * Who reads it: the person who saved a dataset in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from it. So the sentence says what the dataset will show and the one change
 * that fixes it, in the console's words (dataset, object, package); the
 * developer-facing detail stays in the finding's `message`, `hint` and
 * `os explain` entry.
 *
 * Only the site the publish door can actually return has a sentence. The rule
 * is a reference-integrity member on `flow` and `dataset` writes, and of its
 * sites only a dataset's base object (`datasets[].object`) is on the written
 * item: a flow snapshot carries no object field, view, action, dashboard filter
 * or app navigation entry of its own, and those sites' names arrive as context
 * on both sides of the door's differential, so they cancel. Those sites carry
 * no params and stay on the English `message`; `object-reference-unknown` is an
 * error.
 *
 * The entry reads the `userTextParams` its finding carries, set at the dataset
 * site in `validate-object-references.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `object-reference-unregistered-platform` | `dataset`, `object` (the platform-shaped base object name) |
 *
 * Names are the API names the rule saw, not labels, for the reason
 * `validate-security-posture.user-text.ts` gives.
 *
 * `finding-user-text.data-model.test.ts` renders the entry from the rule's
 * real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import { OBJECT_REFERENCE_UNREGISTERED_PLATFORM } from './validate-object-references.js';

export const OBJECT_REFERENCES_USER_TEXT: UserTextCatalog = Object.freeze({
  [OBJECT_REFERENCE_UNREGISTERED_PLATFORM]: {
    en: (p) =>
      `Dataset "${p.dataset}" is based on object "${p.object}", which is named like a platform object, but no ` +
      `installed package provides it, so the dataset will likely show no data. Check the object's name, or ignore ` +
      `this if another package provides it.`,
    'zh-Hans': (p) =>
      `数据集“${p.dataset}”基于对象“${p.object}”，该名称看起来像平台对象，但没有任何已安装的包提供它，因此该数据集` +
      `很可能不显示任何数据。请检查对象名称；如果它由其他包提供，可忽略此提示。`,
    'zh-Hant': (p) =>
      `資料集「${p.dataset}」以物件「${p.object}」為基礎，該名稱看起來像平台物件，但沒有任何已安裝的套件提供它，` +
      `因此該資料集很可能不顯示任何資料。請檢查物件名稱；如果它由其他套件提供，可忽略此提示。`,
    es: (p) =>
      `El conjunto de datos "${p.dataset}" se basa en el objeto "${p.object}", cuyo nombre parece de un objeto de ` +
      `la plataforma, pero ningún paquete instalado lo proporciona, así que probablemente el conjunto de datos no ` +
      `muestre datos. Revise el nombre del objeto, o ignore este aviso si otro paquete lo proporciona.`,
    ar: (p) =>
      `تستند مجموعة البيانات "${p.dataset}" إلى الكائن "${p.object}"، واسمه يشبه اسم كائن من المنصة، لكن لا توفره ` +
      `أي حزمة مثبّتة، لذا من المرجح ألا تعرض مجموعة البيانات أي بيانات. تحقّق من اسم الكائن، أو تجاهل هذا التنبيه ` +
      `إذا كانت حزمة أخرى توفره.`,
    fr: (p) =>
      `Le jeu de données « ${p.dataset} » repose sur l’objet « ${p.object} », dont le nom ressemble à celui d’un ` +
      `objet de la plateforme, mais aucun package installé ne le fournit : le jeu de données n’affichera ` +
      `probablement aucune donnée. Vérifiez le nom de l’objet, ou ignorez ce message si un autre package le fournit.`,
    'pt-BR': (p) =>
      `O conjunto de dados "${p.dataset}" se baseia no objeto "${p.object}", cujo nome parece o de um objeto da ` +
      `plataforma, mas nenhum pacote instalado o fornece, então o conjunto de dados provavelmente não mostrará ` +
      `dados. Verifique o nome do objeto, ou ignore este aviso se outro pacote o fornecer.`,
    ru: (p) =>
      `Набор данных «${p.dataset}» основан на объекте «${p.object}», имя которого похоже на объект платформы, но ни ` +
      `один установленный пакет его не предоставляет, поэтому набор данных, скорее всего, не покажет данных. ` +
      `Проверьте имя объекта или не обращайте внимания на это сообщение, если объект предоставляет другой пакет.`,
    de: (p) =>
      `Der Datensatz „${p.dataset}“ basiert auf dem Objekt „${p.object}“, dessen Name wie der eines ` +
      `Plattformobjekts aussieht, aber kein installiertes Paket stellt es bereit. Der Datensatz zeigt daher ` +
      `wahrscheinlich keine Daten. Prüfen Sie den Namen des Objekts, oder ignorieren Sie diesen Hinweis, wenn ein ` +
      `anderes Paket es bereitstellt.`,
    ja: (p) =>
      `データセット「${p.dataset}」はオブジェクト「${p.object}」に基づいていますが、この名前はプラットフォームの` +
      `オブジェクトのように見えるものの、インストール済みのどのパッケージも提供していないため、データセットには` +
      `データが表示されない可能性があります。オブジェクト名を確認してください。別のパッケージが提供している場合は、` +
      `この通知を無視してかまいません。`,
    ko: (p) =>
      `데이터 세트 "${p.dataset}"은(는) 개체 "${p.object}"을(를) 기반으로 하는데, 이 이름은 플랫폼 개체처럼 ` +
      `보이지만 설치된 어떤 패키지도 이 개체를 제공하지 않으므로 데이터 세트에 데이터가 표시되지 않을 수 ` +
      `있습니다. 개체 이름을 확인하고, 다른 패키지가 제공하는 경우에는 이 알림을 무시하세요.`,
  },
});
