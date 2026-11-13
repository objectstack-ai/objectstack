// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32712] Every sentence the upload-link page shows, one entry per language
 * on the platform locale table, read through the package's one locale reader
 * (`copy-locale.ts`). An absent locale, or one that names no language here,
 * is answered in English, the sentences every holder got before.
 *
 * The page is served in the request's language: `Accept-Language`, else the
 * workspace default (the `localization` settings), else English — the
 * platform's order for text addressed to a person (ruling C on #32440,
 * program #32654: composed by its producer, in the request's language, the
 * machine code unchanged). The doors resolve it (`storage-routes.ts`); this
 * table only answers for it.
 *
 * Two halves:
 *
 *  - The page's own copy: heading, instructions, the expiry, the picker and
 *    the status lines its script writes.
 *  - The refusals the link's `PUT` can answer, which the page shows as the
 *    upload's outcome. The door composes them here, by the refusal's `code`,
 *    and sends them as the envelope's `userMessage`; `message` keeps the
 *    diagnostic wording. ⛔ None of them names the record, the object or the
 *    field: the page names none of those (#30892), and the refusal is page
 *    copy. A code with no sentence here is answered with the producer's own
 *    text behind a lead-in that says the upload was refused, so the reader
 *    knows what the untranslated part is (the `storage-test-copy.ts` rule).
 */

import { copyLocaleOf, type CopyLocale } from './copy-locale.js';
import { UPLOAD_LINK_UNUSABLE_MESSAGE } from './upload-link-wire.js';

/** The refusals the page shows in its own words, each named for the `code` family it answers. */
export interface UploadLinkRefusalCopy {
  /** `AUTH_REQUIRED`: no session, so no user to act as. */
  signInRequired: string;
  /** `RESOURCE_NOT_FOUND`: the one answer for a used, expired, unknown or someone else's link. */
  unusable: string;
  /** `PAYLOAD_TOO_LARGE`: over the workspace's upload limit; the link is not spent. */
  tooLarge: string;
  /** `ERR_FILE_CONSTRAINT`: the field's own `accept` / `maxSize` refused the file. */
  fileNotAccepted: string;
  /** `PERMISSION_DENIED`: the user can no longer add a file to the record. */
  notAllowed: string;
  /** `FIELD_NOT_ACCESSIBLE`: the field is read-only on the record (statically or in its current state). */
  fieldReadOnly: string;
  /** `RECORD_LOCKED`: a pending approval locks the record. */
  recordLocked: string;
  /** `RECORD_NOT_FOUND`: the record is gone, or out of the user's reach. */
  recordGone: string;
  /** Any `503`: the platform could not take the upload now. */
  unavailable: string;
}

export interface UploadLinkCopy extends UploadLinkRefusalCopy {
  /** The page's language, for `<html lang>` and the expiry's date format. */
  lang: string;
  /** The page's writing direction. */
  dir: 'ltr' | 'rtl';
  /** The picker page's title and heading. */
  pageTitle: string;
  /** What the file is for: a record's attachments, or a file field of a record. */
  wanted(target: 'attachments' | 'field'): string;
  once: string;
  /** `until` is the expiry, already formatted in this language. */
  expires(until: string): string;
  fileLabel: string;
  send: string;
  uploading: string;
  attached: string;
  /**
   * [#32686] Done, for a link that names no record: the file was stored and
   * waits for the record the assistant creates, so nothing was attached yet.
   */
  received: string;
  /** The upload failed and the answer carried no sentence to show. */
  failed: string;
  connectionLost: string;
  /** The unusable-link page's title and heading. */
  unusableTitle: string;
  unusableHeading: string;
  /** A refusal with no sentence above; `reason` is the producer's own text, verbatim. */
  refused(reason: string): string;
}

export const UPLOAD_LINK_COPY: Record<CopyLocale, UploadLinkCopy> = {
  en: {
    lang: 'en',
    dir: 'ltr',
    pageTitle: 'Upload a file',
    wanted: (target) =>
      `A file was asked for, to be ${target === 'attachments' ? 'attached to a record' : 'put in a file field of a record'}. Pick one and send it.`,
    once: 'This link works once.',
    expires: (until) => `It stops working at ${until}.`,
    fileLabel: 'File',
    send: 'Send',
    uploading: 'Uploading…',
    attached: 'Done. The file was attached; you can close this page.',
    received: 'Done. The file was received; go back to the assistant to finish.',
    failed: 'The upload failed.',
    connectionLost: 'The upload failed: the connection was lost. Ask for a new link if this one no longer works.',
    unusableTitle: 'Upload link',
    unusableHeading: 'This link cannot be used',
    signInRequired: 'Sign in as the person this upload link was made for, then open the link again.',
    unusable: UPLOAD_LINK_UNUSABLE_MESSAGE,
    tooLarge: 'Nothing was sent: the file is larger than this workspace accepts. Pick a smaller file and send it again.',
    fileNotAccepted:
      'Nothing was attached: the field this link fills does not take a file of this type or size. Ask for a new link and pick another file.',
    notAllowed: 'Nothing was attached: you can no longer add a file to this record.',
    fieldReadOnly: 'Nothing was attached: the field this link was made for is read-only on this record, so it cannot take a file.',
    recordLocked:
      'Nothing was attached: the record is locked while an approval is in progress. Ask for a new link once the approval is decided.',
    recordGone: 'Nothing was attached: the record this link was made for no longer exists, or you can no longer reach it.',
    unavailable: 'The upload cannot be taken right now. Try again in a few minutes.',
    refused: (reason) => reason,
  },
  'zh-CN': {
    lang: 'zh-CN',
    dir: 'ltr',
    pageTitle: '上传文件',
    wanted: (target) =>
      target === 'attachments'
        ? '有人请你提供一个文件，它将作为附件添加到一条记录上。请选择文件并发送。'
        : '有人请你提供一个文件，它将放入一条记录的文件字段中。请选择文件并发送。',
    once: '此链接只能使用一次。',
    expires: (until) => `链接将于 ${until} 失效。`,
    fileLabel: '文件',
    send: '发送',
    uploading: '正在上传…',
    attached: '完成，文件已添加。你可以关闭此页面。',
    received: '完成，文件已收到。请回到助手那里完成后续操作。',
    failed: '上传失败。',
    connectionLost: '上传失败：连接已中断。如果此链接已无法使用，请索取新的链接。',
    unusableTitle: '上传链接',
    unusableHeading: '此链接无法使用',
    signInRequired: '请以此上传链接所属的用户身份登录，然后重新打开链接。',
    unusable: '此上传链接无法使用：它已被使用、已过期、是为其他人生成的，或者不存在。请索取新的链接。',
    tooLarge: '未发送任何内容：文件超过了此工作区允许的大小。请选择更小的文件后重新发送。',
    fileNotAccepted: '未添加任何文件：此链接对应的字段不接受这种类型或大小的文件。请索取新的链接并选择其他文件。',
    notAllowed: '未添加任何文件：你已无法再向这条记录添加文件。',
    fieldReadOnly: '未添加任何文件：此链接对应的字段在这条记录上是只读的，无法接收文件。',
    recordLocked: '未添加任何文件：这条记录正在审批中，已被锁定。请在审批完成后索取新的链接。',
    recordGone: '未添加任何文件：此链接对应的记录已不存在，或你已无法访问它。',
    unavailable: '暂时无法接收上传。请几分钟后重试。',
    refused: (reason) => `上传被拒绝：${reason}`,
  },
  'zh-Hant': {
    lang: 'zh-Hant',
    dir: 'ltr',
    pageTitle: '上傳檔案',
    wanted: (target) =>
      target === 'attachments'
        ? '有人請你提供一個檔案，它將作為附件新增到一筆記錄上。請選擇檔案並傳送。'
        : '有人請你提供一個檔案，它將放入一筆記錄的檔案欄位中。請選擇檔案並傳送。',
    once: '此連結只能使用一次。',
    expires: (until) => `連結將於 ${until} 失效。`,
    fileLabel: '檔案',
    send: '傳送',
    uploading: '正在上傳…',
    attached: '完成，檔案已新增。你可以關閉此頁面。',
    received: '完成，檔案已收到。請回到助理那裡完成後續操作。',
    failed: '上傳失敗。',
    connectionLost: '上傳失敗：連線已中斷。如果此連結已無法使用，請索取新的連結。',
    unusableTitle: '上傳連結',
    unusableHeading: '此連結無法使用',
    signInRequired: '請以此上傳連結所屬的使用者身分登入，然後重新開啟連結。',
    unusable: '此上傳連結無法使用：它已被使用、已過期、是為其他人產生的，或者不存在。請索取新的連結。',
    tooLarge: '未傳送任何內容：檔案超過了此工作區允許的大小。請選擇較小的檔案後重新傳送。',
    fileNotAccepted: '未新增任何檔案：此連結對應的欄位不接受這種類型或大小的檔案。請索取新的連結並選擇其他檔案。',
    notAllowed: '未新增任何檔案：你已無法再向這筆記錄新增檔案。',
    fieldReadOnly: '未新增任何檔案：此連結對應的欄位在這筆記錄上是唯讀的，無法接收檔案。',
    recordLocked: '未新增任何檔案：這筆記錄正在簽核中，已被鎖定。請在簽核完成後索取新的連結。',
    recordGone: '未新增任何檔案：此連結對應的記錄已不存在，或你已無法存取它。',
    unavailable: '暫時無法接收上傳。請幾分鐘後重試。',
    refused: (reason) => `上傳遭拒：${reason}`,
  },
  'ja-JP': {
    lang: 'ja-JP',
    dir: 'ltr',
    pageTitle: 'ファイルのアップロード',
    wanted: (target) =>
      target === 'attachments'
        ? 'レコードに添付するファイルが求められています。ファイルを選んで送信してください。'
        : 'レコードのファイル項目に入れるファイルが求められています。ファイルを選んで送信してください。',
    once: 'このリンクは 1 回だけ使えます。',
    expires: (until) => `${until} に無効になります。`,
    fileLabel: 'ファイル',
    send: '送信',
    uploading: 'アップロード中…',
    attached: '完了しました。ファイルが追加されました。このページは閉じてかまいません。',
    received: '完了しました。ファイルを受け取りました。アシスタントに戻って続きを進めてください。',
    failed: 'アップロードに失敗しました。',
    connectionLost: 'アップロードに失敗しました: 接続が切れました。このリンクが使えなくなった場合は、新しいリンクを依頼してください。',
    unusableTitle: 'アップロードリンク',
    unusableHeading: 'このリンクは使用できません',
    signInRequired: 'このアップロードリンクの発行対象のユーザーとしてサインインし、もう一度リンクを開いてください。',
    unusable: 'このアップロードリンクは使用できません。使用済み、期限切れ、別のユーザー向け、または存在しないリンクです。新しいリンクを依頼してください。',
    tooLarge: '何も送信されませんでした: ファイルがこのワークスペースで許可されているサイズを超えています。小さいファイルを選んで、もう一度送信してください。',
    fileNotAccepted: '何も追加されませんでした: このリンクの項目は、この種類またはサイズのファイルを受け付けません。新しいリンクを依頼し、別のファイルを選んでください。',
    notAllowed: '何も追加されませんでした: このレコードにはもうファイルを追加できません。',
    fieldReadOnly: '何も追加されませんでした: このリンクの項目はこのレコードでは読み取り専用のため、ファイルを受け付けません。',
    recordLocked: '何も追加されませんでした: 承認の処理中のため、レコードはロックされています。承認が完了してから新しいリンクを依頼してください。',
    recordGone: '何も追加されませんでした: このリンクのレコードは存在しないか、アクセスできなくなっています。',
    unavailable: '現在アップロードを受け付けられません。数分後にもう一度お試しください。',
    refused: (reason) => `アップロードが拒否されました: ${reason}`,
  },
  ko: {
    lang: 'ko',
    dir: 'ltr',
    pageTitle: '파일 업로드',
    wanted: (target) =>
      target === 'attachments'
        ? '레코드에 첨부할 파일이 요청되었습니다. 파일을 선택해 보내 주세요.'
        : '레코드의 파일 필드에 넣을 파일이 요청되었습니다. 파일을 선택해 보내 주세요.',
    once: '이 링크는 한 번만 사용할 수 있습니다.',
    expires: (until) => `${until}에 만료됩니다.`,
    fileLabel: '파일',
    send: '보내기',
    uploading: '업로드 중…',
    attached: '완료되었습니다. 파일이 추가되었으니 이 페이지를 닫아도 됩니다.',
    received: '완료되었습니다. 파일을 받았습니다. 어시스턴트로 돌아가 마무리하세요.',
    failed: '업로드에 실패했습니다.',
    connectionLost: '업로드에 실패했습니다: 연결이 끊어졌습니다. 이 링크가 더 이상 작동하지 않으면 새 링크를 요청하세요.',
    unusableTitle: '업로드 링크',
    unusableHeading: '이 링크는 사용할 수 없습니다',
    signInRequired: '이 업로드 링크가 만들어진 사용자로 로그인한 다음 링크를 다시 여세요.',
    unusable: '이 업로드 링크는 사용할 수 없습니다. 이미 사용되었거나, 만료되었거나, 다른 사람을 위해 만들어졌거나, 존재하지 않습니다. 새 링크를 요청하세요.',
    tooLarge: '아무것도 전송되지 않았습니다: 파일이 이 워크스페이스에서 허용하는 크기보다 큽니다. 더 작은 파일을 선택해 다시 보내 주세요.',
    fileNotAccepted: '아무것도 추가되지 않았습니다: 이 링크의 필드는 이 형식이나 크기의 파일을 받지 않습니다. 새 링크를 요청하고 다른 파일을 선택하세요.',
    notAllowed: '아무것도 추가되지 않았습니다: 이 레코드에 더 이상 파일을 추가할 수 없습니다.',
    fieldReadOnly: '아무것도 추가되지 않았습니다: 이 링크의 필드는 이 레코드에서 읽기 전용이므로 파일을 받을 수 없습니다.',
    recordLocked: '아무것도 추가되지 않았습니다: 승인이 진행 중이어서 레코드가 잠겨 있습니다. 승인이 결정된 후 새 링크를 요청하세요.',
    recordGone: '아무것도 추가되지 않았습니다: 이 링크의 레코드가 더 이상 없거나 더 이상 접근할 수 없습니다.',
    unavailable: '지금은 업로드를 받을 수 없습니다. 몇 분 후에 다시 시도하세요.',
    refused: (reason) => `업로드가 거부되었습니다: ${reason}`,
  },
  'es-ES': {
    lang: 'es-ES',
    dir: 'ltr',
    pageTitle: 'Subir un archivo',
    wanted: (target) =>
      target === 'attachments'
        ? 'Se ha pedido un archivo para adjuntarlo a un registro. Elige uno y envíalo.'
        : 'Se ha pedido un archivo para ponerlo en un campo de archivo de un registro. Elige uno y envíalo.',
    once: 'Este enlace solo funciona una vez.',
    expires: (until) => `Deja de funcionar el ${until}.`,
    fileLabel: 'Archivo',
    send: 'Enviar',
    uploading: 'Subiendo…',
    attached: 'Listo. El archivo se ha adjuntado; puedes cerrar esta página.',
    received: 'Listo. Se ha recibido el archivo; vuelve al asistente para terminar.',
    failed: 'La subida ha fallado.',
    connectionLost: 'La subida ha fallado: se ha perdido la conexión. Pide un enlace nuevo si este ya no funciona.',
    unusableTitle: 'Enlace de subida',
    unusableHeading: 'Este enlace no se puede usar',
    signInRequired: 'Inicia sesión como la persona para la que se creó este enlace de subida y vuelve a abrir el enlace.',
    unusable: 'Este enlace de subida no se puede usar: ya se usó, ha caducado, se creó para otra persona o no existe. Pide un enlace nuevo.',
    tooLarge: 'No se ha enviado nada: el archivo supera el tamaño que admite este espacio de trabajo. Elige un archivo más pequeño y vuelve a enviarlo.',
    fileNotAccepted: 'No se ha adjuntado nada: el campo de este enlace no admite un archivo de este tipo o tamaño. Pide un enlace nuevo y elige otro archivo.',
    notAllowed: 'No se ha adjuntado nada: ya no puedes añadir archivos a este registro.',
    fieldReadOnly: 'No se ha adjuntado nada: el campo de este enlace es de solo lectura en este registro, así que no admite archivos.',
    recordLocked: 'No se ha adjuntado nada: el registro está bloqueado mientras hay una aprobación en curso. Pide un enlace nuevo cuando se haya resuelto la aprobación.',
    recordGone: 'No se ha adjuntado nada: el registro de este enlace ya no existe o ya no tienes acceso a él.',
    unavailable: 'Ahora mismo no se puede recibir la subida. Vuelve a intentarlo dentro de unos minutos.',
    refused: (reason) => `Se ha rechazado la subida: ${reason}`,
  },
  ar: {
    lang: 'ar',
    dir: 'rtl',
    pageTitle: 'رفع ملف',
    wanted: (target) =>
      target === 'attachments'
        ? 'طُلب ملف لإرفاقه بسجل. اختر ملفًا وأرسله.'
        : 'طُلب ملف لوضعه في حقل ملف ضمن سجل. اختر ملفًا وأرسله.',
    once: 'يعمل هذا الرابط مرة واحدة فقط.',
    expires: (until) => `يتوقف عن العمل في ${until}.`,
    fileLabel: 'الملف',
    send: 'إرسال',
    uploading: 'جارٍ الرفع…',
    attached: 'تم. أُرفق الملف؛ يمكنك إغلاق هذه الصفحة.',
    received: 'تم. استُلم الملف؛ عد إلى المساعد لإكمال العملية.',
    failed: 'فشل الرفع.',
    connectionLost: 'فشل الرفع: انقطع الاتصال. اطلب رابطًا جديدًا إذا لم يعد هذا الرابط يعمل.',
    unusableTitle: 'رابط الرفع',
    unusableHeading: 'لا يمكن استخدام هذا الرابط',
    signInRequired: 'سجّل الدخول باسم الشخص الذي أُنشئ له رابط الرفع هذا، ثم افتح الرابط مرة أخرى.',
    unusable: 'لا يمكن استخدام رابط الرفع هذا: فقد استُخدم من قبل، أو انتهت صلاحيته، أو أُنشئ لشخص آخر، أو أنه غير موجود. اطلب رابطًا جديدًا.',
    tooLarge: 'لم يُرسل شيء: حجم الملف أكبر مما تسمح به مساحة العمل هذه. اختر ملفًا أصغر وأرسله مرة أخرى.',
    fileNotAccepted: 'لم يُرفق شيء: حقل هذا الرابط لا يقبل ملفًا من هذا النوع أو بهذا الحجم. اطلب رابطًا جديدًا واختر ملفًا آخر.',
    notAllowed: 'لم يُرفق شيء: لم يعد بإمكانك إضافة ملفات إلى هذا السجل.',
    fieldReadOnly: 'لم يُرفق شيء: حقل هذا الرابط للقراءة فقط في هذا السجل، لذا لا يمكنه استقبال ملف.',
    recordLocked: 'لم يُرفق شيء: السجل مقفل أثناء وجود موافقة قيد الإجراء. اطلب رابطًا جديدًا بعد البت في الموافقة.',
    recordGone: 'لم يُرفق شيء: سجل هذا الرابط لم يعد موجودًا، أو لم يعد بإمكانك الوصول إليه.',
    unavailable: 'لا يمكن استقبال الرفع الآن. حاول مرة أخرى بعد بضع دقائق.',
    refused: (reason) => `رُفض الرفع: ${reason}`,
  },
  fr: {
    lang: 'fr',
    dir: 'ltr',
    pageTitle: 'Envoyer un fichier',
    wanted: (target) =>
      target === 'attachments'
        ? 'Un fichier a été demandé, pour être joint à un enregistrement. Choisissez-en un et envoyez-le.'
        : 'Un fichier a été demandé, pour être placé dans un champ fichier d’un enregistrement. Choisissez-en un et envoyez-le.',
    once: 'Ce lien ne fonctionne qu’une fois.',
    expires: (until) => `Il cesse de fonctionner le ${until}.`,
    fileLabel: 'Fichier',
    send: 'Envoyer',
    uploading: 'Envoi en cours…',
    attached: 'Terminé. Le fichier a été joint ; vous pouvez fermer cette page.',
    received: 'Terminé. Le fichier a été reçu ; revenez à l’assistant pour terminer.',
    failed: 'L’envoi a échoué.',
    connectionLost: 'L’envoi a échoué : la connexion a été perdue. Demandez un nouveau lien si celui-ci ne fonctionne plus.',
    unusableTitle: 'Lien d’envoi',
    unusableHeading: 'Ce lien ne peut pas être utilisé',
    signInRequired: 'Connectez-vous en tant que la personne pour qui ce lien d’envoi a été créé, puis rouvrez le lien.',
    unusable: 'Ce lien d’envoi ne peut pas être utilisé : il a déjà servi, il a expiré, il a été créé pour quelqu’un d’autre ou il n’existe pas. Demandez un nouveau lien.',
    tooLarge: 'Rien n’a été envoyé : le fichier dépasse la taille acceptée par cet espace de travail. Choisissez un fichier plus petit et envoyez-le à nouveau.',
    fileNotAccepted: 'Rien n’a été joint : le champ de ce lien n’accepte pas un fichier de ce type ou de cette taille. Demandez un nouveau lien et choisissez un autre fichier.',
    notAllowed: 'Rien n’a été joint : vous ne pouvez plus ajouter de fichier à cet enregistrement.',
    fieldReadOnly: 'Rien n’a été joint : le champ de ce lien est en lecture seule sur cet enregistrement, il ne peut donc pas recevoir de fichier.',
    recordLocked: 'Rien n’a été joint : l’enregistrement est verrouillé pendant qu’une approbation est en cours. Demandez un nouveau lien une fois l’approbation décidée.',
    recordGone: 'Rien n’a été joint : l’enregistrement de ce lien n’existe plus, ou vous n’y avez plus accès.',
    unavailable: 'L’envoi ne peut pas être reçu pour le moment. Réessayez dans quelques minutes.',
    refused: (reason) => `L’envoi a été refusé : ${reason}`,
  },
  'pt-BR': {
    lang: 'pt-BR',
    dir: 'ltr',
    pageTitle: 'Enviar um arquivo',
    wanted: (target) =>
      target === 'attachments'
        ? 'Foi pedido um arquivo para ser anexado a um registro. Escolha um e envie.'
        : 'Foi pedido um arquivo para ser colocado em um campo de arquivo de um registro. Escolha um e envie.',
    once: 'Este link funciona uma única vez.',
    expires: (until) => `Ele deixa de funcionar em ${until}.`,
    fileLabel: 'Arquivo',
    send: 'Enviar',
    uploading: 'Enviando…',
    attached: 'Pronto. O arquivo foi anexado; você pode fechar esta página.',
    received: 'Pronto. O arquivo foi recebido; volte ao assistente para concluir.',
    failed: 'O envio falhou.',
    connectionLost: 'O envio falhou: a conexão foi perdida. Peça um novo link se este não funcionar mais.',
    unusableTitle: 'Link de envio',
    unusableHeading: 'Este link não pode ser usado',
    signInRequired: 'Entre como a pessoa para quem este link de envio foi criado e abra o link novamente.',
    unusable: 'Este link de envio não pode ser usado: ele já foi usado, expirou, foi criado para outra pessoa ou não existe. Peça um novo link.',
    tooLarge: 'Nada foi enviado: o arquivo é maior do que este espaço de trabalho aceita. Escolha um arquivo menor e envie novamente.',
    fileNotAccepted: 'Nada foi anexado: o campo deste link não aceita um arquivo deste tipo ou tamanho. Peça um novo link e escolha outro arquivo.',
    notAllowed: 'Nada foi anexado: você não pode mais adicionar arquivos a este registro.',
    fieldReadOnly: 'Nada foi anexado: o campo deste link é somente leitura neste registro, então não pode receber um arquivo.',
    recordLocked: 'Nada foi anexado: o registro está bloqueado enquanto uma aprovação está em andamento. Peça um novo link quando a aprovação for decidida.',
    recordGone: 'Nada foi anexado: o registro deste link não existe mais, ou você não tem mais acesso a ele.',
    unavailable: 'O envio não pode ser recebido agora. Tente novamente em alguns minutos.',
    refused: (reason) => `O envio foi recusado: ${reason}`,
  },
  ru: {
    lang: 'ru',
    dir: 'ltr',
    pageTitle: 'Загрузка файла',
    wanted: (target) =>
      target === 'attachments'
        ? 'Запрошен файл, который нужно прикрепить к записи. Выберите файл и отправьте его.'
        : 'Запрошен файл для поля-файла записи. Выберите файл и отправьте его.',
    once: 'Эта ссылка работает только один раз.',
    expires: (until) => `Ссылка перестанет работать ${until}.`,
    fileLabel: 'Файл',
    send: 'Отправить',
    uploading: 'Загрузка…',
    attached: 'Готово. Файл прикреплён; эту страницу можно закрыть.',
    received: 'Готово. Файл получен; вернитесь к ассистенту, чтобы завершить.',
    failed: 'Не удалось загрузить файл.',
    connectionLost: 'Не удалось загрузить файл: соединение прервалось. Если эта ссылка больше не работает, попросите новую.',
    unusableTitle: 'Ссылка для загрузки',
    unusableHeading: 'Эту ссылку нельзя использовать',
    signInRequired: 'Войдите как пользователь, для которого создана эта ссылка, и снова откройте её.',
    unusable: 'Эту ссылку для загрузки нельзя использовать: она уже использована, истекла, создана для другого человека или не существует. Попросите новую ссылку.',
    tooLarge: 'Ничего не отправлено: файл больше, чем допускает это рабочее пространство. Выберите файл поменьше и отправьте его снова.',
    fileNotAccepted: 'Ничего не прикреплено: поле этой ссылки не принимает файлы такого типа или размера. Попросите новую ссылку и выберите другой файл.',
    notAllowed: 'Ничего не прикреплено: вы больше не можете добавлять файлы к этой записи.',
    fieldReadOnly: 'Ничего не прикреплено: поле этой ссылки в этой записи доступно только для чтения и не может принять файл.',
    recordLocked: 'Ничего не прикреплено: запись заблокирована, пока идёт согласование. Попросите новую ссылку, когда по согласованию будет принято решение.',
    recordGone: 'Ничего не прикреплено: записи этой ссылки больше нет, или у вас больше нет к ней доступа.',
    unavailable: 'Сейчас загрузку принять невозможно. Попробуйте ещё раз через несколько минут.',
    refused: (reason) => `Загрузка отклонена: ${reason}`,
  },
  de: {
    lang: 'de',
    dir: 'ltr',
    pageTitle: 'Datei hochladen',
    wanted: (target) =>
      target === 'attachments'
        ? 'Es wurde eine Datei angefordert, die an einen Datensatz angehängt werden soll. Wählen Sie eine aus und senden Sie sie.'
        : 'Es wurde eine Datei angefordert, die in ein Dateifeld eines Datensatzes gelegt werden soll. Wählen Sie eine aus und senden Sie sie.',
    once: 'Dieser Link funktioniert nur einmal.',
    expires: (until) => `Er läuft am ${until} ab.`,
    fileLabel: 'Datei',
    send: 'Senden',
    uploading: 'Wird hochgeladen…',
    attached: 'Fertig. Die Datei wurde angehängt; Sie können diese Seite schließen.',
    received: 'Fertig. Die Datei ist angekommen; kehren Sie zum Assistenten zurück, um abzuschließen.',
    failed: 'Das Hochladen ist fehlgeschlagen.',
    connectionLost: 'Das Hochladen ist fehlgeschlagen: Die Verbindung wurde unterbrochen. Fordern Sie einen neuen Link an, wenn dieser nicht mehr funktioniert.',
    unusableTitle: 'Upload-Link',
    unusableHeading: 'Dieser Link kann nicht verwendet werden',
    signInRequired: 'Melden Sie sich als die Person an, für die dieser Upload-Link erstellt wurde, und öffnen Sie den Link erneut.',
    unusable: 'Dieser Upload-Link kann nicht verwendet werden: Er wurde bereits verwendet, ist abgelaufen, wurde für jemand anderen erstellt oder existiert nicht. Fordern Sie einen neuen Link an.',
    tooLarge: 'Es wurde nichts gesendet: Die Datei ist größer, als dieser Arbeitsbereich zulässt. Wählen Sie eine kleinere Datei und senden Sie sie erneut.',
    fileNotAccepted: 'Es wurde nichts angehängt: Das Feld dieses Links nimmt keine Datei dieses Typs oder dieser Größe an. Fordern Sie einen neuen Link an und wählen Sie eine andere Datei.',
    notAllowed: 'Es wurde nichts angehängt: Sie können diesem Datensatz keine Datei mehr hinzufügen.',
    fieldReadOnly: 'Es wurde nichts angehängt: Das Feld dieses Links ist in diesem Datensatz schreibgeschützt und kann keine Datei aufnehmen.',
    recordLocked: 'Es wurde nichts angehängt: Der Datensatz ist gesperrt, solange eine Genehmigung läuft. Fordern Sie einen neuen Link an, sobald über die Genehmigung entschieden ist.',
    recordGone: 'Es wurde nichts angehängt: Der Datensatz dieses Links existiert nicht mehr, oder Sie haben keinen Zugriff mehr darauf.',
    unavailable: 'Der Upload kann gerade nicht angenommen werden. Versuchen Sie es in einigen Minuten erneut.',
    refused: (reason) => `Der Upload wurde abgelehnt: ${reason}`,
  },
};

/** The page's copy for a request's locale; English when the code names no language on the table. */
export function uploadLinkCopy(locale: string | undefined): UploadLinkCopy {
  return UPLOAD_LINK_COPY[copyLocaleOf(locale) ?? 'en'];
}

/** The page's own sentence for each refusal code the link's doors can answer. */
const REFUSAL_BY_CODE: Readonly<Record<string, keyof UploadLinkRefusalCopy>> = {
  AUTH_REQUIRED: 'signInRequired',
  RESOURCE_NOT_FOUND: 'unusable',
  PAYLOAD_TOO_LARGE: 'tooLarge',
  ERR_FILE_CONSTRAINT: 'fileNotAccepted',
  PERMISSION_DENIED: 'notAllowed',
  FIELD_NOT_ACCESSIBLE: 'fieldReadOnly',
  RECORD_LOCKED: 'recordLocked',
  RECORD_NOT_FOUND: 'recordGone',
};

/**
 * The sentence the page shows for a refusal of the link's `PUT`: the page's
 * own words for its code (any `503` reads as "try again later"), else the
 * producer's `reason` behind the refusal lead-in. `reason` is the producer's
 * text with its own code prefix already stripped.
 */
export function uploadLinkRefusalText(copy: UploadLinkCopy, status: number, code: string, reason: string): string {
  if (status === 503) return copy.unavailable;
  const key = REFUSAL_BY_CODE[code];
  return key ? copy[key] : copy.refused(reason);
}

/** The link's expiry, written in the page's language; UTC, named. */
export function formatUploadLinkExpiry(copy: UploadLinkCopy, expiresAt: string): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return expiresAt;
  try {
    return new Intl.DateTimeFormat(copy.lang, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(at);
  } catch {
    // A runtime without the language's data: the date as the page wrote it before.
    return at.toUTCString();
  }
}
