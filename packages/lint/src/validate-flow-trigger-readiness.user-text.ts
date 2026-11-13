// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentences of `validate-flow-trigger-readiness.ts`'s advisory
 * findings, in every platform locale (`PLATFORM_LOCALE_TAGS`,
 * `@objectstack/spec/system`). The finding mechanism and the locale ladder are
 * `finding-user-text.ts`'s; this file is the rule's own half of it, kept beside
 * the rule so its wording and its translations change together.
 *
 * Who reads these: the person who saved a flow in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from them. So each sentence says what the trigger or input setting does to
 * the flow's runs and the one change that fixes it; the developer-facing detail
 * stays in the finding's `message`, `hint` and `os explain` entry.
 *
 * Each entry reads the `userTextParams` its finding carries, set at the push
 * site in `validate-flow-trigger-readiness.ts`:
 *
 * | rule id | params |
 * |---|---|
 * | `flow-trigger-unknown-object` | `flow`, `object`, `trigger` (`record` · `schedule`: the record trigger's object, or the time-relative sweep's) |
 * | `flow-input-unknown-object` | `flow`, `input`, `object` |
 * | `flow-input-object-less` | `flow`, `input` |
 * | `flow-input-record-read-as-list` | `flow`, `input`, `object` (the declared one), `node`, `listObject` (the one the node reads) |
 * | `flow-draft-status-ambiguous` | `flow` |
 *
 * The two unknown-object ids are advisories only while no package closure is
 * stated; under one the same position is refused, and that push site carries
 * no params, so a refusal never renders these sentences. Status values are the
 * API values (`active`, `obsolete`), as the flow's settings store them.
 *
 * `validate-flow-trigger-readiness.user-text.test.ts` renders every entry from
 * the rule's real findings in every platform locale.
 */

import type { UserTextCatalog } from './finding-user-text.js';
import {
  FLOW_DRAFT_STATUS_AMBIGUOUS,
  FLOW_INPUT_OBJECT_LESS,
  FLOW_INPUT_RECORD_READ_AS_LIST,
  FLOW_INPUT_UNKNOWN_OBJECT,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
} from './validate-flow-trigger-readiness.js';

export const FLOW_TRIGGER_READINESS_USER_TEXT: UserTextCatalog = Object.freeze({
  [FLOW_TRIGGER_UNKNOWN_OBJECT]: {
    en: (p) =>
      (p.trigger === 'schedule'
        ? `Flow "${p.flow}" runs on a schedule over records of object "${p.object}", which this app does not ` +
          `define, so if the name is wrong it never finds a record to run on. `
        : `Flow "${p.flow}" is triggered by changes to object "${p.object}", which this app does not define, so ` +
          `if the name is wrong the flow never runs. `) +
      `Use the object's exact API name, or ignore this if another installed package provides it.`,
    'zh-Hans': (p) =>
      (p.trigger === 'schedule'
        ? `流程“${p.flow}”按计划扫描对象“${p.object}”的记录，但本应用没有定义该对象，因此如果名称写错，它将永远找不到可处理的记录。`
        : `流程“${p.flow}”由对象“${p.object}”的变更触发，但本应用没有定义该对象，因此如果名称写错，该流程将永远不会运行。`) +
      `请使用对象准确的 API 名称；如果该对象由另一个已安装的包提供，可以忽略此提示。`,
    'zh-Hant': (p) =>
      (p.trigger === 'schedule'
        ? `流程「${p.flow}」依排程掃描物件「${p.object}」的記錄，但本應用程式沒有定義該物件，因此如果名稱寫錯，它將永遠找不到可處理的記錄。`
        : `流程「${p.flow}」由物件「${p.object}」的變更觸發，但本應用程式沒有定義該物件，因此如果名稱寫錯，該流程將永遠不會執行。`) +
      `請使用物件準確的 API 名稱；如果該物件由另一個已安裝的套件提供，可以忽略此提示。`,
    es: (p) =>
      (p.trigger === 'schedule'
        ? `El flujo "${p.flow}" se ejecuta según una programación sobre registros del objeto "${p.object}", que ` +
          `esta aplicación no define, así que si el nombre es incorrecto nunca encontrará registros. `
        : `El flujo "${p.flow}" se activa con los cambios del objeto "${p.object}", que esta aplicación no define, ` +
          `así que si el nombre es incorrecto el flujo nunca se ejecutará. `) +
      `Use el nombre de API exacto del objeto, o ignore este aviso si otro paquete instalado lo proporciona.`,
    ar: (p) =>
      (p.trigger === 'schedule'
        ? `يعمل التدفق "${p.flow}" وفق جدول على سجلات الكائن "${p.object}"، الذي لا يعرّفه هذا التطبيق، لذلك إذا ` +
          `كان الاسم خاطئًا فلن يجد أي سجل يعمل عليه. `
        : `يُشغَّل التدفق "${p.flow}" عند تغيّر الكائن "${p.object}"، الذي لا يعرّفه هذا التطبيق، لذلك إذا كان ` +
          `الاسم خاطئًا فلن يعمل التدفق أبدًا. `) +
      `استخدم اسم API الدقيق للكائن، أو تجاهل هذا إذا كانت حزمة مثبتة أخرى توفره.`,
    fr: (p) =>
      (p.trigger === 'schedule'
        ? `Le flux « ${p.flow} » s’exécute selon une planification sur les enregistrements de l’objet ` +
          `« ${p.object} », que cette application ne définit pas : si le nom est erroné, il ne trouvera jamais ` +
          `d’enregistrement. `
        : `Le flux « ${p.flow} » est déclenché par les modifications de l’objet « ${p.object} », que cette ` +
          `application ne définit pas : si le nom est erroné, le flux ne s’exécutera jamais. `) +
      `Utilisez le nom d’API exact de l’objet, ou ignorez ce message si un autre package installé le fournit.`,
    'pt-BR': (p) =>
      (p.trigger === 'schedule'
        ? `O fluxo "${p.flow}" é executado por agendamento sobre registros do objeto "${p.object}", que este ` +
          `aplicativo não define, então se o nome estiver errado ele nunca encontrará um registro. `
        : `O fluxo "${p.flow}" é acionado por alterações no objeto "${p.object}", que este aplicativo não define, ` +
          `então se o nome estiver errado o fluxo nunca será executado. `) +
      `Use o nome de API exato do objeto, ou ignore este aviso se outro pacote instalado o fornecer.`,
    ru: (p) =>
      (p.trigger === 'schedule'
        ? `Поток «${p.flow}» запускается по расписанию для записей объекта «${p.object}», который это приложение ` +
          `не определяет, поэтому если имя указано неверно, он никогда не найдёт ни одной записи. `
        : `Поток «${p.flow}» запускается при изменениях объекта «${p.object}», который это приложение не ` +
          `определяет, поэтому если имя указано неверно, поток никогда не запустится. `) +
      `Укажите точное API-имя объекта или не обращайте внимания, если его предоставляет другой установленный пакет.`,
    de: (p) =>
      (p.trigger === 'schedule'
        ? `Der Flow „${p.flow}“ läuft nach Zeitplan über Datensätze des Objekts „${p.object}“, das diese App nicht ` +
          `definiert. Ist der Name falsch, findet er nie einen Datensatz. `
        : `Der Flow „${p.flow}“ wird durch Änderungen am Objekt „${p.object}“ ausgelöst, das diese App nicht ` +
          `definiert. Ist der Name falsch, läuft der Flow nie. `) +
      `Verwenden Sie den genauen API-Namen des Objekts, oder ignorieren Sie dies, wenn ein anderes installiertes ` +
      `Paket es bereitstellt.`,
    ja: (p) =>
      (p.trigger === 'schedule'
        ? `フロー「${p.flow}」はオブジェクト「${p.object}」のレコードをスケジュールで処理しますが、このアプリではこのオブジェクトが` +
          `定義されていないため、名前が誤っている場合は処理するレコードが見つかりません。`
        : `フロー「${p.flow}」はオブジェクト「${p.object}」の変更で起動しますが、このアプリではこのオブジェクトが定義されていないため、` +
          `名前が誤っている場合はフローが実行されません。`) +
      `オブジェクトの正確な API 名を使用してください。別のインストール済みパッケージが提供している場合は無視してかまいません。`,
    ko: (p) =>
      (p.trigger === 'schedule'
        ? `플로우 "${p.flow}"는 일정에 따라 개체 "${p.object}"의 레코드를 처리하지만, 이 앱은 해당 개체를 정의하지 ` +
          `않으므로 이름이 잘못되었다면 처리할 레코드를 찾지 못합니다. `
        : `플로우 "${p.flow}"는 개체 "${p.object}"의 변경으로 실행되지만, 이 앱은 해당 개체를 정의하지 않으므로 ` +
          `이름이 잘못되었다면 플로우가 실행되지 않습니다. `) +
      `개체의 정확한 API 이름을 사용하세요. 설치된 다른 패키지가 제공하는 개체라면 무시해도 됩니다.`,
  },
  [FLOW_INPUT_UNKNOWN_OBJECT]: {
    en: (p) =>
      `Flow "${p.flow}" declares input "${p.input}" as a record of object "${p.object}", which this app does not ` +
      `define, so if the name is wrong, every start that passes this input is refused. Use the object's exact ` +
      `API name, or ignore this if another installed package provides it.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”将输入“${p.input}”声明为对象“${p.object}”的记录，但本应用没有定义该对象，因此如果名称写错，` +
      `每次传入该输入的启动都会被拒绝。请使用对象准确的 API 名称；如果该对象由另一个已安装的包提供，可以忽略此提示。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」將輸入「${p.input}」宣告為物件「${p.object}」的記錄，但本應用程式沒有定義該物件，因此如果名稱寫錯，` +
      `每次傳入該輸入的啟動都會被拒絕。請使用物件準確的 API 名稱；如果該物件由另一個已安裝的套件提供，可以忽略此提示。`,
    es: (p) =>
      `El flujo "${p.flow}" declara la entrada "${p.input}" como un registro del objeto "${p.object}", que esta ` +
      `aplicación no define, así que si el nombre es incorrecto se rechazará cada inicio que pase esta entrada. ` +
      `Use el nombre de API exacto del objeto, o ignore este aviso si otro paquete instalado lo proporciona.`,
    ar: (p) =>
      `يعرّف التدفق "${p.flow}" المُدخل "${p.input}" على أنه سجل من الكائن "${p.object}"، الذي لا يعرّفه هذا ` +
      `التطبيق، لذلك إذا كان الاسم خاطئًا فسيُرفض كل تشغيل يمرّر هذا المُدخل. استخدم اسم API الدقيق للكائن، أو ` +
      `تجاهل هذا إذا كانت حزمة مثبتة أخرى توفره.`,
    fr: (p) =>
      `Le flux « ${p.flow} » déclare l’entrée « ${p.input} » comme un enregistrement de l’objet « ${p.object} », ` +
      `que cette application ne définit pas : si le nom est erroné, chaque démarrage qui transmet cette entrée ` +
      `sera refusé. Utilisez le nom d’API exact de l’objet, ou ignorez ce message si un autre package installé le ` +
      `fournit.`,
    'pt-BR': (p) =>
      `O fluxo "${p.flow}" declara a entrada "${p.input}" como um registro do objeto "${p.object}", que este ` +
      `aplicativo não define, então se o nome estiver errado toda inicialização que passar essa entrada será ` +
      `recusada. Use o nome de API exato do objeto, ou ignore este aviso se outro pacote instalado o fornecer.`,
    ru: (p) =>
      `Поток «${p.flow}» объявляет входной параметр «${p.input}» записью объекта «${p.object}», который это ` +
      `приложение не определяет, поэтому если имя указано неверно, каждый запуск с этим параметром будет ` +
      `отклонён. Укажите точное API-имя объекта или не обращайте внимания, если его предоставляет другой ` +
      `установленный пакет.`,
    de: (p) =>
      `Der Flow „${p.flow}“ deklariert die Eingabe „${p.input}“ als Datensatz des Objekts „${p.object}“, das ` +
      `diese App nicht definiert. Ist der Name falsch, wird jeder Start abgelehnt, der diese Eingabe übergibt. ` +
      `Verwenden Sie den genauen API-Namen des Objekts, oder ignorieren Sie dies, wenn ein anderes installiertes ` +
      `Paket es bereitstellt.`,
    ja: (p) =>
      `フロー「${p.flow}」は入力「${p.input}」をオブジェクト「${p.object}」のレコードとして宣言していますが、このアプリでは` +
      `このオブジェクトが定義されていないため、名前が誤っている場合はこの入力を渡す起動がすべて拒否されます。` +
      `オブジェクトの正確な API 名を使用してください。別のインストール済みパッケージが提供している場合は無視してかまいません。`,
    ko: (p) =>
      `플로우 "${p.flow}"는 입력 "${p.input}"을(를) 개체 "${p.object}"의 레코드로 선언하지만, 이 앱은 해당 개체를 ` +
      `정의하지 않으므로 이름이 잘못되었다면 이 입력을 전달하는 모든 시작이 거부됩니다. 개체의 정확한 API 이름을 ` +
      `사용하세요. 설치된 다른 패키지가 제공하는 개체라면 무시해도 됩니다.`,
  },
  [FLOW_INPUT_OBJECT_LESS]: {
    en: (p) =>
      `Flow "${p.flow}" declares input "${p.input}" as a record without naming a real object, so no start loads ` +
      `the record and the input's value is used unchecked. Set the object whose record ID the input carries, or ` +
      `remove the object if the input is not a record ID.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”将输入“${p.input}”声明为记录，却没有指定真实的对象，因此任何启动都不会加载该记录，输入值会未经检查就被使用。` +
      `请设置该输入所携带记录 ID 对应的对象；如果该输入不是记录 ID，请删除对象设置。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」將輸入「${p.input}」宣告為記錄，卻沒有指定真實的物件，因此任何啟動都不會載入該記錄，輸入值會未經檢查就被使用。` +
      `請設定該輸入所攜帶記錄 ID 對應的物件；如果該輸入不是記錄 ID，請刪除物件設定。`,
    es: (p) =>
      `El flujo "${p.flow}" declara la entrada "${p.input}" como un registro sin indicar un objeto real, así que ` +
      `ningún inicio carga el registro y el valor de la entrada se usa sin comprobar. Indique el objeto cuyo ID de ` +
      `registro lleva la entrada, o quite el objeto si la entrada no es un ID de registro.`,
    ar: (p) =>
      `يعرّف التدفق "${p.flow}" المُدخل "${p.input}" على أنه سجل دون تحديد كائن حقيقي، لذلك لا يحمّل أي تشغيل ` +
      `السجل وتُستخدم قيمة المُدخل دون تحقق. حدّد الكائن الذي يحمل المُدخل معرّف سجله، أو أزل الكائن إذا لم يكن ` +
      `المُدخل معرّف سجل.`,
    fr: (p) =>
      `Le flux « ${p.flow} » déclare l’entrée « ${p.input} » comme un enregistrement sans nommer d’objet réel : ` +
      `aucun démarrage ne charge donc l’enregistrement et la valeur de l’entrée est utilisée sans contrôle. ` +
      `Indiquez l’objet dont l’entrée porte l’ID d’enregistrement, ou supprimez l’objet si l’entrée n’est pas un ` +
      `ID d’enregistrement.`,
    'pt-BR': (p) =>
      `O fluxo "${p.flow}" declara a entrada "${p.input}" como um registro sem indicar um objeto real, então ` +
      `nenhuma inicialização carrega o registro e o valor da entrada é usado sem verificação. Defina o objeto cujo ` +
      `ID de registro a entrada carrega, ou remova o objeto se a entrada não for um ID de registro.`,
    ru: (p) =>
      `Поток «${p.flow}» объявляет входной параметр «${p.input}» записью, не указывая реальный объект, поэтому ни ` +
      `один запуск не загружает запись, а значение параметра используется без проверки. Укажите объект, ID записи ` +
      `которого передаёт параметр, или удалите объект, если параметр не является ID записи.`,
    de: (p) =>
      `Der Flow „${p.flow}“ deklariert die Eingabe „${p.input}“ als Datensatz, ohne ein echtes Objekt zu nennen. ` +
      `Daher lädt kein Start den Datensatz, und der Wert der Eingabe wird ungeprüft verwendet. Legen Sie das ` +
      `Objekt fest, dessen Datensatz-ID die Eingabe trägt, oder entfernen Sie das Objekt, wenn die Eingabe keine ` +
      `Datensatz-ID ist.`,
    ja: (p) =>
      `フロー「${p.flow}」は入力「${p.input}」をレコードとして宣言していますが、実際のオブジェクトを指定していないため、` +
      `どの起動でもレコードが読み込まれず、入力値は確認されないまま使われます。入力が持つレコード ID のオブジェクトを設定するか、` +
      `入力がレコード ID でない場合はオブジェクトの指定を削除してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"는 입력 "${p.input}"을(를) 실제 개체를 지정하지 않은 레코드로 선언하므로, 어떤 시작에서도 ` +
      `레코드를 불러오지 않고 입력 값이 검사 없이 사용됩니다. 입력이 담는 레코드 ID의 개체를 지정하거나, 입력이 ` +
      `레코드 ID가 아니라면 개체 지정을 제거하세요.`,
  },
  [FLOW_INPUT_RECORD_READ_AS_LIST]: {
    en: (p) =>
      `Flow "${p.flow}" declares input "${p.input}" as one "${p.object}" record ID, but node "${p.node}" reads it ` +
      `as a list of "${p.listObject}" IDs, so every start that passes this input is refused. If the input ` +
      `carries a list of IDs, remove its object; otherwise read it as a single ID.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”将输入“${p.input}”声明为一个“${p.object}”记录 ID，但节点“${p.node}”把它当作“${p.listObject}”的 ID 列表读取，` +
      `因此每次传入该输入的启动都会被拒绝。如果该输入携带的是 ID 列表，请删除它的对象设置；否则请按单个 ID 读取它。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」將輸入「${p.input}」宣告為一個「${p.object}」記錄 ID，但節點「${p.node}」把它當作「${p.listObject}」的 ID 清單讀取，` +
      `因此每次傳入該輸入的啟動都會被拒絕。如果該輸入攜帶的是 ID 清單，請刪除它的物件設定；否則請按單一 ID 讀取它。`,
    es: (p) =>
      `El flujo "${p.flow}" declara la entrada "${p.input}" como un único ID de registro de "${p.object}", pero el ` +
      `nodo "${p.node}" la lee como una lista de IDs de "${p.listObject}", así que se rechazará cada inicio que ` +
      `pase esta entrada. Si la entrada lleva una lista de IDs, quite su objeto; si no, léala como un único ID.`,
    ar: (p) =>
      `يعرّف التدفق "${p.flow}" المُدخل "${p.input}" على أنه معرّف سجل واحد من "${p.object}"، لكن العقدة ` +
      `"${p.node}" تقرؤه كقائمة معرّفات من "${p.listObject}"، لذلك سيُرفض كل تشغيل يمرّر هذا المُدخل. إذا كان ` +
      `المُدخل يحمل قائمة معرّفات، فأزل كائنه؛ وإلا فاقرأه كمعرّف واحد.`,
    fr: (p) =>
      `Le flux « ${p.flow} » déclare l’entrée « ${p.input} » comme un seul ID d’enregistrement de « ${p.object} », ` +
      `mais le nœud « ${p.node} » la lit comme une liste d’ID de « ${p.listObject} » : chaque démarrage qui ` +
      `transmet cette entrée sera donc refusé. Si l’entrée porte une liste d’ID, supprimez son objet ; sinon, ` +
      `lisez-la comme un seul ID.`,
    'pt-BR': (p) =>
      `O fluxo "${p.flow}" declara a entrada "${p.input}" como um único ID de registro de "${p.object}", mas o nó ` +
      `"${p.node}" a lê como uma lista de IDs de "${p.listObject}", então toda inicialização que passar essa ` +
      `entrada será recusada. Se a entrada carrega uma lista de IDs, remova o objeto dela; caso contrário, leia-a ` +
      `como um único ID.`,
    ru: (p) =>
      `Поток «${p.flow}» объявляет входной параметр «${p.input}» одним ID записи «${p.object}», но узел ` +
      `«${p.node}» читает его как список ID «${p.listObject}», поэтому каждый запуск с этим параметром будет ` +
      `отклонён. Если параметр передаёт список ID, удалите у него объект; иначе читайте его как один ID.`,
    de: (p) =>
      `Der Flow „${p.flow}“ deklariert die Eingabe „${p.input}“ als eine einzelne Datensatz-ID von „${p.object}“, ` +
      `aber der Knoten „${p.node}“ liest sie als Liste von „${p.listObject}“-IDs. Daher wird jeder Start ` +
      `abgelehnt, der diese Eingabe übergibt. Trägt die Eingabe eine Liste von IDs, entfernen Sie ihr Objekt; ` +
      `andernfalls lesen Sie sie als einzelne ID.`,
    ja: (p) =>
      `フロー「${p.flow}」は入力「${p.input}」を「${p.object}」のレコード ID 1 件として宣言していますが、ノード「${p.node}」は` +
      `これを「${p.listObject}」の ID のリストとして読み取るため、この入力を渡す起動はすべて拒否されます。入力が ID のリストなら` +
      `オブジェクトの指定を削除し、そうでなければ 1 件の ID として読み取ってください。`,
    ko: (p) =>
      `플로우 "${p.flow}"는 입력 "${p.input}"을(를) "${p.object}" 레코드 ID 하나로 선언하지만, 노드 "${p.node}"는 이를 ` +
      `"${p.listObject}" ID 목록으로 읽으므로 이 입력을 전달하는 모든 시작이 거부됩니다. 입력이 ID 목록이라면 개체 ` +
      `지정을 제거하고, 아니라면 하나의 ID로 읽으세요.`,
  },
  [FLOW_DRAFT_STATUS_AMBIGUOUS]: {
    en: (p) =>
      `Flow "${p.flow}" is a draft, and a draft flow still runs when its trigger fires. Set its status to ` +
      `"active" to run it on purpose, or to "obsolete" to turn it off.`,
    'zh-Hans': (p) =>
      `流程“${p.flow}”是草稿，而草稿流程在触发条件满足时仍会运行。如果有意让它运行，请将状态设为“active”；如果要停用，请设为“obsolete”。`,
    'zh-Hant': (p) =>
      `流程「${p.flow}」是草稿，而草稿流程在觸發條件滿足時仍會執行。如果有意讓它執行，請將狀態設為「active」；如果要停用，請設為「obsolete」。`,
    es: (p) =>
      `El flujo "${p.flow}" es un borrador, y un flujo en borrador se ejecuta igualmente cuando se activa su ` +
      `disparador. Ponga su estado en "active" para ejecutarlo a propósito, o en "obsolete" para desactivarlo.`,
    ar: (p) =>
      `التدفق "${p.flow}" مسودة، والتدفق المسودة يعمل مع ذلك عند تنشيط مشغّله. اضبط حالته على "active" لتشغيله ` +
      `عن قصد، أو على "obsolete" لإيقافه.`,
    fr: (p) =>
      `Le flux « ${p.flow} » est un brouillon, et un flux en brouillon s’exécute quand même lorsque son ` +
      `déclencheur se produit. Passez son statut à « active » pour l’exécuter délibérément, ou à « obsolete » pour ` +
      `le désactiver.`,
    'pt-BR': (p) =>
      `O fluxo "${p.flow}" é um rascunho, e um fluxo em rascunho ainda é executado quando seu gatilho dispara. ` +
      `Defina o status como "active" para executá-lo de propósito, ou como "obsolete" para desativá-lo.`,
    ru: (p) =>
      `Поток «${p.flow}» — черновик, а черновик всё равно запускается при срабатывании триггера. Задайте статус ` +
      `«active», чтобы запускать его осознанно, или «obsolete», чтобы отключить.`,
    de: (p) =>
      `Der Flow „${p.flow}“ ist ein Entwurf, und ein Entwurf läuft trotzdem, wenn sein Auslöser eintritt. Setzen ` +
      `Sie den Status auf „active“, um ihn bewusst auszuführen, oder auf „obsolete“, um ihn abzuschalten.`,
    ja: (p) =>
      `フロー「${p.flow}」は下書きですが、下書きのフローもトリガーが発生すると実行されます。意図して実行する場合は` +
      `ステータスを「active」に、無効にする場合は「obsolete」に設定してください。`,
    ko: (p) =>
      `플로우 "${p.flow}"는 초안이지만, 초안 플로우도 트리거가 발생하면 실행됩니다. 의도적으로 실행하려면 상태를 ` +
      `"active"로, 끄려면 "obsolete"로 설정하세요.`,
  },
});
