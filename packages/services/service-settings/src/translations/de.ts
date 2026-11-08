// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * Deutsch (de) — built-in settings manifest translations.
 */
export const de: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: { env: 'Umgebung', global: 'Global', tenant: 'Organisation', user: 'Benutzer', default: 'Standard' },
  },
  settings: {
    mail: {
      title: 'E-Mail-Versand',
      description: 'Konfiguration von SMTP und dem Anbieter für Transaktions-E-Mails.',
      groups: {
        provider: { title: 'Anbieter', description: 'Legen Sie fest, wie dieses System ausgehende E-Mails versendet.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'API-Schlüssel' },
        from_address: { title: 'Absenderadresse' },
        delivery: { title: 'Zustellung', description: 'Wie ausgehende E-Mails an den Anbieter übergeben werden.' },
      },
      keys: {
        provider: {
          label: 'Anbieter',
          help: 'Aufgeführt sind nur Anbieter, über die dieser Server tatsächlich zustellen kann. SendGrid und Amazon SES werden als SMTP konfiguriert.',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: 'Keiner (nur Protokoll — keine echte Zustellung)',
          },
        },
        smtp_host: { label: 'Host', help: 'Beispiel: smtp.example.com' },
        smtp_port: { label: 'Port' },
        smtp_secure: { label: 'TLS verwenden' },
        smtp_user: { label: 'Benutzername' },
        smtp_password: { label: 'Passwort' },
        api_key: { label: 'API-Schlüssel' },
        from_email: { label: 'Absender-E-Mail', help: 'Beispiel: no-reply@example.com' },
        from_name: {
          label: 'Absendername',
          help: 'Leer lassen, um den Produktnamen (Branding) oder den bei der Einrichtung dieser Bereitstellung vergebenen Namen zu verwenden.',
        },
        queue_delivery: {
          label: 'Zustellung über dauerhafte Warteschlange',
          help: 'Übergibt jede Nachricht an die Job-Warteschlange, statt sie direkt zu senden, sodass ein Worker eine fehlgeschlagene Zustellung mit Backoff wiederholt und sie einen Neustart übersteht. Erfordert die Warteschlangen-Funktion mit einem dauerhaften Adapter. „Test-E-Mail senden“ sendet immer direkt.',
        },
      },
      actions: {
        test: { label: 'Test-E-Mail senden' },
      },
    },
    sms: {
      title: 'SMS-Versand',
      description: 'SMS-Anbieterkonfiguration für die Anmeldung per OTP, Einladungen und Benachrichtigungen.',
      groups: {
        provider: { title: 'Anbieter', description: 'Legen Sie fest, wie dieses System ausgehende SMS versendet.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: {
          title: 'Ausgabenlimits',
          description: 'Begrenzt das ausgehende SMS-Volumen der Bereitstellung. SMS ist ein kostenpflichtiger Kanal, und jeder Versand kostet echtes Geld.',
        },
      },
      keys: {
        provider: {
          label: 'Anbieter',
          options: {
            log: 'Keiner (nur Protokoll — keine echte Zustellung)',
            aliyun: 'Aliyun SMS (阿里云短信)',
            twilio: 'Twilio',
          },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: 'Signaturname (短信签名)' },
        aliyun_template_code: {
          label: 'Standard-Vorlagencode (短信模板)',
          help: 'Wird verwendet, wenn ein Versand keine Vorlage angibt. Eine Sammelvorlage mit einer einzigen Variablen ${content} ermöglicht allgemeine Benachrichtigungs-SMS.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Auth-Token' },
        twilio_from_number: {
          label: 'Absendernummer',
          help: 'Absender im E.164-Format, z. B. +15005550006. Entweder dies oder eine Messaging Service SID.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: 'Tägliches Versandlimit',
          help: 'Höchstzahl an SMS, die diese Bereitstellung pro UTC-Tag senden darf, über OTP-Anmeldung, Einladungen und Benachrichtigungen hinweg. 0 bedeutet kein Limit. Sendungen über dem Limit werden bis 00:00 UTC abgelehnt.',
        },
      },
      actions: {
        test: { label: 'Test-SMS senden' },
      },
    },
    branding: {
      title: 'Branding',
      description: 'Name, Logo und Farbe, die Konsole und Anmeldeseite anzeigen. Ein nicht gesetzter Wert fällt auf das Branding der Bereitstellung zurück.',
      groups: {
        identity: { title: 'Identität' },
        appearance: { title: 'Erscheinungsbild' },
      },
      keys: {
        workspace_name: {
          label: 'Produktname',
          help: 'Der Produktname in der Konsole, auf der Anmeldeseite und im Browsertitel sowie in Anmelde-E-Mails, der Authenticator-App und der MCP-Anmeldung. Leer lassen, um den bei der Einrichtung dieser Bereitstellung vergebenen Namen zu verwenden. Dies ist nicht der Name der Organisation selbst; der steht im Feld „Name“ des Organisationsdatensatzes.',
        },
        accent_color: {
          label: 'Akzentfarbe',
          help: 'Die Designfarbe von Browser und installierter App. Jede App behält ihre eigenen Farben.',
        },
        logo_url: {
          label: 'Logo-URL',
          help: 'Wird auf der Anmeldeseite, dem Ladebildschirm und im Startseiten-Header angezeigt. Beispiel: https://…/logo.svg',
        },
      },
    },
    company: {
      title: 'Unternehmen',
      description: 'Angaben zur juristischen Person — eingetragener Name, Anschrift, Steuernummern und Hauptansprechpartner.',
      groups: {
        identity: { title: 'Identität' },
        address: { title: 'Eingetragene Anschrift' },
        contact: { title: 'Kontakt' },
      },
      keys: {
        legal_name: {
          label: 'Rechtlicher Name',
          help: 'Eingetragener rechtlicher Name der Organisation, wie er auf Verträgen und Rechnungen steht.',
        },
        registration_number: {
          label: 'Registernummer',
          help: 'Handelsregister- bzw. Gründungsnummer des Unternehmens (z. B. EIN).',
        },
        tax_id: { label: 'Steuer-/USt-ID', help: 'Wird auf Rechnungen angezeigt (z. B. VAT, GST, ABN).' },
        address_line1: { label: 'Adresszeile 1' },
        address_line2: { label: 'Adresszeile 2' },
        city: { label: 'Stadt' },
        state: { label: 'Bundesland / Provinz' },
        postal_code: { label: 'Postleitzahl' },
        country: {
          label: 'Land',
          help: 'Land der eingetragenen Anschrift. Geben Sie einen Ländernamen ein und wählen Sie ihn aus der Liste.',
          options: countryOptionLabels('de'),
        },
        phone: { label: 'Telefon', help: 'E.164 empfohlen, z. B. +49 30 5555 0100.' },
        website: { label: 'Website', help: 'Beispiel: https://example.com' },
        primary_contact_name: { label: 'Name des Hauptansprechpartners' },
        primary_contact_email: { label: 'E-Mail des Hauptansprechpartners', help: 'Beispiel: ops@example.com' },
      },
    },
    localization: {
      title: 'Lokalisierung',
      description: 'Standard-Zeitzone, -Sprache, -Land, -Währung und Geschäftsjahr.',
      groups: {
        region: { title: 'Region' },
        finance: { title: 'Finanzen' },
      },
      keys: {
        timezone: {
          label: 'Standard-Zeitzone',
          help: 'Bestimmt, was „heute“ in Formeln bedeutet, wie Berichte Datumswerte gruppieren und wie Datum und Uhrzeit angezeigt werden. Akzeptiert jeden IANA-Zeitzonennamen (z. B. Europe/Berlin). Dies ist die für die Organisation geltende Zeitzone: Das Feld „Zeitzone“ im Organisationsdatensatz ändert sie nicht.',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) Los Angeles',
            'America/Denver': '(UTC−07/−06) Denver',
            'America/Chicago': '(UTC−06/−05) Chicago',
            'America/New_York': '(UTC−05/−04) New York',
            'America/Sao_Paulo': '(UTC−03) São Paulo',
            'Europe/London': '(UTC±00/+01) London',
            'Europe/Paris': '(UTC+01/+02) Paris',
            'Europe/Berlin': '(UTC+01/+02) Berlin',
            'Europe/Moscow': '(UTC+03) Moskau',
            'Asia/Dubai': '(UTC+04) Dubai',
            'Asia/Kolkata': '(UTC+05:30) Kolkata',
            'Asia/Singapore': '(UTC+08) Singapur',
            'Asia/Shanghai': '(UTC+08) Shanghai',
            'Asia/Tokyo': '(UTC+09) Tokio',
            'Australia/Sydney': '(UTC+10/+11) Sydney',
            'Pacific/Auckland': '(UTC+12/+13) Auckland',
          },
        },
        locale: {
          label: 'Standardsprache',
          help: 'BCP-47-Sprache für Meldungskataloge sowie Zahlen- und Datumsformate.',
        },
        default_country: {
          label: 'Standardland',
          help: 'Dient als Standard für Adressen und Telefonnummern. Geben Sie einen Ländernamen ein und wählen Sie ihn aus der Liste.',
          options: countryOptionLabels('de'),
        },
        currency: {
          label: 'Standardwährung',
          help: 'ISO-4217-Code, der gilt, wenn ein Währungsfeld keinen eigenen angibt. Leer lassen, um Beträge ohne Code als reine Zahlen darzustellen.',
          options: {
            USD: 'USD — US-Dollar',
            EUR: 'EUR — Euro',
            GBP: 'GBP — Britisches Pfund',
            JPY: 'JPY — Japanischer Yen',
            CNY: 'CNY — Chinesischer Yuan',
            INR: 'INR — Indische Rupie',
            AUD: 'AUD — Australischer Dollar',
            CAD: 'CAD — Kanadischer Dollar',
            BRL: 'BRL — Brasilianischer Real',
          },
        },
        fiscal_year_start: {
          label: 'Beginn des Geschäftsjahres',
          help: 'Erster Monat des Geschäftsjahres — bestimmt „dieses Quartal / Geschäftsjahr“ in Berichten.',
          options: {
            january: 'Januar',
            february: 'Februar',
            march: 'März',
            april: 'April',
            may: 'Mai',
            june: 'Juni',
            july: 'Juli',
            august: 'August',
            september: 'September',
            october: 'Oktober',
            november: 'November',
            december: 'Dezember',
          },
        },
      },
    },
    auth: {
      title: 'Authentifizierung',
      description: 'Anmeldung, Registrierung und integrierte Authentifizierungsfunktionen.',
      groups: {
        email_password: {
          title: 'E-Mail und Passwort',
          description: 'Steuert die lokale Anmeldung per E-Mail und Passwort sowie die Selbstregistrierung.',
        },
        membership: {
          title: 'Mitgliedschaft',
          description: 'Wem ein neu angelegter Benutzer beitritt. Gehört zur Selbstregistrierung oben.',
        },
        audience: {
          title: 'Zielgruppe',
          description: 'Wer Benutzer der Apps dieses Systems werden darf. Zugelassene E-Mail-Domains erzwingen immer die E-Mail-Bestätigung. „Offen“ erzwingt sie ebenfalls, sofern die Bereitstellung sie nicht abschaltet; ein in dieser Konsole gespeicherter Wert kann das nicht. Einladungen, von Administratoren angelegte Benutzer, SCIM-Provisionierung und Unternehmens-SSO werden in jedem Modus zugelassen.',
        },
        password_policy: {
          title: 'Passwortrichtlinie',
          description: 'Längengrenzen, die der Authentifizierungsanbieter bei Registrierung und Passwortzurücksetzung durchsetzt.',
        },
        anti_abuse: {
          title: 'Missbrauchsschutz',
          description: 'Schutz vor Brute-Force: Kontosperre pro Identität und Ratenbegrenzung pro IP an den Authentifizierungs-Endpunkten.',
        },
        multi_factor: {
          title: 'Mehrfaktor',
          description: 'Verlangt, dass Mitglieder ihr Konto mit einer Authenticator-App (TOTP) schützen.',
        },
        sessions: { title: 'Sitzungen', description: 'Wie lange eine angemeldete Sitzung gültig bleibt.' },
        network: { title: 'Netzwerk', description: 'Schränkt ein, von wo aus sich Benutzer anmelden können.' },
        api_keys: {
          title: 'API-Schlüssel',
          description: 'Wie lange persönliche API-Schlüssel gelten. Ein abgelaufener, über das Inaktivitätsfenster hinaus ungenutzter oder widerrufener Schlüssel wird mit eigenem Fehlercode abgelehnt; Abhilfe ist immer ein neuer Schlüssel.',
        },
        social: {
          title: 'Social Login',
          description: 'Konfiguriert den integrierten Google-Anmeldeanbieter. In der Serverkonfiguration gesetzte Anmeldedaten haben weiterhin Vorrang.',
        },
      },
      keys: {
        email_password_enabled: {
          label: 'Anmeldung per E-Mail/Passwort aktivieren',
          confirmOffText: 'Wer sich mit Passwort anmeldet, braucht dann einen anderen Zugang.',
        },
        signup_enabled: {
          label: 'E-Mail-Registrierung erlauben',
          help: 'Öffnet das Registrierungsformular mit E-Mail und Passwort. Wen es zulässt, bestimmt unten die Zielgruppe der Selbstregistrierung: bei „Nur auf Einladung“ nur eine Adresse mit offener Einladung; bei „Zugelassene E-Mail-Domains“ die zugelassenen Domains und eingeladene Adressen; bei „Offen“ jeden. Aus schließt das Formular bei jeder Zielgruppe, Einladungen eingeschlossen.',
        },
        require_email_verification: { label: 'E-Mail-Bestätigung verlangen' },
        membership_policy: {
          label: 'Mitgliedschaft neuer Benutzer',
          help: '„Automatisch“ bindet jeden neuen Benutzer an die Standardorganisation. „Nur auf Einladung“ gewährt die Mitgliedschaft nur durch eine ausdrückliche Handlung — eine Organisation anlegen, eine Einladung annehmen, von einem Administrator hinzugefügt oder per SSO Just-in-Time provisioniert werden.',
          options: {
            auto: 'Automatisch der Standardorganisation beitreten',
            'invite-only': 'Nur auf Einladung — nie automatisch beitreten',
          },
        },
        audience_posture: {
          label: 'Zielgruppe der Selbstregistrierung',
          help: '„Nur auf Einladung“ schließt die Selbstregistrierung: Personen werden nur Benutzer, wenn ein Administrator sie einlädt, anlegt oder importiert, oder über Verzeichnis-Provisionierung (SCIM) oder Unternehmens-Single-Sign-on. „Zugelassene E-Mail-Domains“ öffnet sie für die unten aufgeführten Domains. „Offen“ lässt jeden zu. Sowohl „Zugelassene E-Mail-Domains“ als auch „Offen“ benötigen den Berechtigungssatz für Selbstregistrierung unten. „Zugelassene E-Mail-Domains“ verlangt immer die E-Mail-Bestätigung. „Offen“ verlangt sie, sofern die Serverkonfiguration sie nicht abschaltet; sie in dieser Konsole abzuschalten, wird unter „Offen“ abgelehnt.',
          options: {
            invite_only: 'Nur auf Einladung — keine Selbstregistrierung (Standard)',
            email_domain: 'Nur zugelassene E-Mail-Domains',
            open: 'Offen — jeder darf sich selbst registrieren',
          },
        },
        audience_allowed_email_domains: {
          label: 'Zugelassene E-Mail-Domains',
          help: 'Reine Domains, eine pro Zeile oder durch Kommas getrennt (z. B. acme.com). Der Abgleich ist exakt und unabhängig von Groß-/Kleinschreibung; Subdomains brauchen eigene Einträge; keine Platzhalter.',
        },
        audience_self_registration_permission_set: {
          label: 'Berechtigungssatz für Selbstregistrierung',
          help: 'Name des Berechtigungssatzes, den jeder selbst registrierte Benutzer erhält. Der Standard-Mitgliedersatz genügt; der vollständige Administratorsatz wird abgelehnt. Pflicht, sobald die Zielgruppe Selbstregistrierung erlaubt.',
        },
        password_min_length: { label: 'Minimale Passwortlänge' },
        password_max_length: {
          label: 'Maximale Passwortlänge',
          help: 'Schützt vor Denial-of-Service durch das Hashen sehr langer Passwörter.',
        },
        password_reject_breached: {
          label: 'Kompromittierte Passwörter ablehnen',
          help: 'Blockiert Passwörter aus öffentlichen Datenlecks über Have I Been Pwned (Bereichsprüfung mit k-Anonymität; das Passwort wird nie vollständig gesendet).',
        },
        password_require_complexity: {
          label: 'Komplexe Passwörter verlangen',
          help: 'Verlangt bei Registrierung sowie Passwortänderung und -zurücksetzung eine Mischung von Zeichenklassen (Groß-, Kleinbuchstaben, Ziffern, Sonderzeichen).',
        },
        password_min_classes: {
          label: 'Mindestanzahl Zeichenklassen',
          help: 'Wie viele der vier Klassen (Groß / Klein / Ziffer / Sonderzeichen) ein Passwort enthalten muss.',
        },
        password_history_count: {
          label: 'Passwortverlauf (keine Wiederverwendung)',
          help: 'Verhindert bei Änderung oder Zurücksetzung die Wiederverwendung so vieler früherer Passwörter. 0 deaktiviert die Prüfung.',
        },
        password_expiry_days: {
          label: 'Passwortablauf (Tage)',
          help: 'Erzwingt nach so vielen Tagen eine Passwortänderung. 0 deaktiviert den Ablauf. Solange das Passwort abgelaufen ist, hat der Benutzer bis zur Änderung keinen Zugriff auf Daten.',
        },
        lockout_threshold: {
          label: 'Schwelle für Kontosperre',
          help: 'Sperrt ein Konto nach so vielen aufeinanderfolgenden fehlgeschlagenen Anmeldeversuchen — falsche Passwörter ebenso wie falsche Zwei-Faktor-Codes. Während der Sperre wird die Anmeldung selbst mit korrekten Anmeldedaten abgelehnt. 0 deaktiviert die Sperre in der Passwortstufe; die Zwei-Faktor-Prüfung behält dann ihr eingebautes Limit von 10 Versuchen pro 15 Minuten, da sie die letzte Prüfung vor der Ausgabe einer Sitzung ist.',
        },
        lockout_duration_minutes: {
          label: 'Sperrdauer (Minuten)',
          help: 'Wie lange ein Konto nach Überschreiten der Schwelle gesperrt bleibt, in beiden Anmeldestufen.',
        },
        rate_limit_max: {
          label: 'Auth-Ratenlimit: max. Anfragen',
          help: 'Maximale Anfragen pro IP und Zeitfenster an die Endpunkte für Anmeldung / Registrierung / Passwortzurücksetzung.',
        },
        rate_limit_window_seconds: {
          label: 'Auth-Ratenlimit: Zeitfenster (Sekunden)',
          help: 'Gleitendes Zeitfenster, in dem die obige Anfragegrenze gezählt wird.',
        },
        mfa_required: {
          label: 'Mehrfaktor-Authentifizierung verlangen',
          options: { off: 'Aus', administrators: 'Administratoren', everyone: 'Alle' },
          help: 'Benutzer ohne registrierten Authenticator verlieren nach Ablauf ihrer Schonfrist den Zugriff auf Daten. Das Aktivieren schaltet auch die Zwei-Faktor-Funktion ein, damit Benutzer sich registrieren können.',
        },
        mfa_grace_period_days: {
          label: 'MFA-Schonfrist (Tage)',
          help: 'Wie lange Benutzer die Registrierung vor der harten Sperre aufschieben dürfen. 0 sperrt sofort.',
        },
        session_expiry_days: {
          label: 'Sitzungsdauer (Tage)',
          help: 'Eine Sitzung läuft so viele Tage nach der Anmeldung ab.',
        },
        session_refresh_days: {
          label: 'Verlängerungsschwelle (Tage)',
          help: 'Eine aktive Sitzung wird verlängert, wenn sie älter als dieser Wert ist.',
        },
        session_idle_timeout_minutes: {
          label: 'Leerlauf-Timeout (Minuten)',
          help: 'Meldet einen Benutzer nach so vielen Minuten Inaktivität ab. 0 deaktiviert.',
        },
        session_absolute_max_hours: {
          label: 'Absolute Sitzungsdauer (Stunden)',
          help: 'Erzwingt so viele Stunden nach der Anmeldung eine erneute Authentifizierung, unabhängig von Aktivität. 0 deaktiviert.',
        },
        max_concurrent_sessions_per_user: {
          label: 'Max. gleichzeitige Sitzungen pro Benutzer',
          help: 'Begrenzt gleichzeitige Sitzungen pro Benutzer; über dem Limit werden die ältesten abgemeldet. 0 = unbegrenzt.',
        },
        allowed_ip_ranges: {
          label: 'Zugelassene IP-Bereiche',
          help: 'CIDR-Bereiche oder exakte IPs (eine pro Zeile oder durch Kommas getrennt), z. B. 203.0.113.0/24. Wenn gesetzt, wird die Anmeldung von außerhalb dieser Bereiche abgelehnt, ebenso jede Anfrage, deren Client-Adresse der Server nicht ermitteln kann. Leer = keine Einschränkung. Geprüft wird die Adresse, von der die Verbindung kommt; hinter einem Reverse-Proxy muss der Server so konfiguriert sein, dass er diesem Proxy vertraut, damit stattdessen die ursprüngliche Client-Adresse geprüft wird.',
        },
        api_key_default_expiry_days: {
          label: 'Standard-Schlüssellaufzeit (Tage)',
          help: 'Ein ohne Ablaufdatum erstellter Schlüssel läuft so viele Tage nach seiner Erstellung ab. Nie länger als die Höchstlaufzeit unten.',
        },
        api_key_max_expiry_days: {
          label: 'Maximale Schlüssellaufzeit (Tage)',
          help: 'Das späteste Ablaufdatum, das ein neuer Schlüssel anfordern darf, gerechnet ab Erstellung. Ein späteres wird abgelehnt; genau so viele Tage werden akzeptiert.',
        },
        api_key_inactivity_days: {
          label: 'Ablauf bei Inaktivität (Tage)',
          help: 'Ein Schlüssel ohne erfasste Nutzung seit so vielen Tagen wird abgelehnt. Er wird nicht widerrufen; erstellen Sie einen neuen Schlüssel. Ein nie genutzter Schlüssel zählt ab seiner Erstellung oder, falls älter, ab dem Richtlinienbeginn unten. 0 deaktiviert den Ablauf bei Inaktivität.',
        },
        api_key_policy_started_at: {
          label: 'Beginn der Schlüsselrichtlinie',
          help: 'Wird beim ersten Lauf des Servers mit dieser Richtlinie automatisch erfasst (UTC, ISO 8601). Davor ohne Ablaufdatum erstellte Schlüssel laufen ein Jahr danach ab; Schlüssel ohne erfasste Nutzung zählen ihre Inaktivität ab diesem Zeitpunkt. Eine Änderung verschiebt beide Daten für Schlüssel, denen noch keins zugewiesen ist.',
        },
        google_enabled: {
          label: 'Google-Anmeldung aktivieren',
          help: 'Bietet die Google-Anmeldung an, sobald Client-ID und Client-Secret beide verfügbar sind: unten gespeichert oder in der Serverkonfiguration gesetzt, die Vorrang vor gespeicherten Werten hat. Solange nicht beide verfügbar sind, zeigt die Anmeldeseite keine Google-Schaltfläche, auch wenn dies eingeschaltet ist. Aus entzieht die Google-Anmeldung, selbst wenn der Server beide setzt. Legen Sie den OAuth-Client in der Google Cloud Console an.',
        },
        google_client_id: {
          label: 'Google-Client-ID',
          help: 'OAuth-Client-ID aus der Google Cloud Console. Kann auch in der Serverkonfiguration gesetzt werden.',
        },
        google_client_secret: {
          label: 'Google-Client-Secret',
          help: 'Wird verschlüsselt gespeichert. Kann auch in der Serverkonfiguration gesetzt werden.',
        },
      },
    },
    access_policy: {
      title: 'Zugriffsrichtlinie',
      description: 'Die Anmeldebeschränkungen dieser Organisation. Die Authentifizierungseinstellungen der Bereitstellung gelten immer; diese können sie nur ergänzen.',
      groups: {
        network: { title: 'Netzwerk', description: 'Von wo aus sich Mitglieder dieser Organisation anmelden dürfen.' },
        sessions: { title: 'Sitzungen', description: 'Wie lange die Sitzung eines Mitglieds gültig bleibt. Jedes Limit kann nur kürzer sein als das der Bereitstellung.' },
        multi_factor: { title: 'Multi-Faktor', description: 'Wer in dieser Organisation sein Konto mit einer Authenticator-App (TOTP) schützen muss.' },
      },
      keys: {
        allowed_ip_ranges: { label: 'Erlaubte IP-Bereiche' },
        session_idle_timeout_minutes: { label: 'Leerlauf-Zeitlimit (Minuten)' },
        session_absolute_max_hours: { label: 'Maximale Sitzungsdauer (Stunden)' },
        max_concurrent_sessions_per_user: { label: 'Max. gleichzeitige Sitzungen pro Benutzer' },
        mfa_required: {
          label: 'Multi-Faktor-Authentifizierung verlangen',
          options: { off: 'Aus', administrators: 'Administratoren', everyone: 'Alle' },
        },
      },
    },

    storage: {
      title: 'Dateispeicher',
      description: 'Backend für Anhänge, Exporte und Benutzer-Uploads.',
      groups: {
        adapter: { title: 'Backend', description: 'Legen Sie fest, wo hochgeladene Dateien gespeichert werden.' },
        local: { title: 'Lokal' },
        s3: { title: 'S3' },
        limits: { title: 'Grenzen' },
      },
      keys: {
        adapter: {
          label: 'Adapter',
          options: { local: 'Lokales Dateisystem', s3: 'S3 / S3-kompatibel' },
        },
        local_root: {
          label: 'Stammverzeichnis',
          help: 'Dateisystempfad, unter dem Dateien gespeichert werden. Relative Pfade werden vom CWD des Servers aus aufgelöst.',
        },
        s3_bucket: {
          label: 'Bucket',
          help: 'Gemeinsamer Host-Bucket. Dateien pro Umgebung werden über das Präfix projects/<environmentId>/ getrennt.',
        },
        s3_region: { label: 'Region', help: 'Beispiel: us-east-1' },
        s3_endpoint: {
          label: 'Endpunkt',
          help: 'Eigener Endpunkt für S3-kompatible Anbieter (R2, MinIO, Wasabi). Für AWS S3 leer lassen.',
        },
        s3_access_key_id: { label: 'Zugriffsschlüssel-ID' },
        s3_secret_access_key: { label: 'Geheimer Zugriffsschlüssel' },
        s3_force_path_style: {
          label: 'URLs im Pfadstil erzwingen',
          help: 'Für MinIO und die meisten S3-kompatiblen Anbieter einschalten; für AWS S3 ausschalten.',
        },
        presigned_ttl: { label: 'Gültigkeit vorsignierter URLs (Sekunden)' },
        session_ttl: {
          label: 'Gültigkeit der Upload-Sitzung (Sekunden)',
          help: 'Wie lange eine Upload-Sitzung in Teilen fortsetzbar bleibt.',
        },
        max_upload_mb: { label: 'Max. Uploadgröße (MB)' },
      },
      actions: {
        test: { label: 'Verbindung testen' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Vorhandene Dateien werden nicht migriert',
          text: 'Ein Adapterwechsel migriert vorhandene Dateien nicht — mit dem bisherigen Adapter hochgeladene Dateien sind über den neuen nicht erreichbar.',
        },
      },
    },
    ai: {
      title: 'KI und Embedder',
      description: 'LLM-Anbieter, Modell, Anmeldedaten und Embedder-Konfiguration für die KI- und Wissensdienste der Plattform.',
      groups: {
        provider: {
          title: 'Anbieter',
          description: 'Wählen Sie das LLM-Backend. Der Memory-Modus gibt die Eingabe zurück — nützlich für Tests, nie für die Produktion.',
        },
        gateway: {
          title: 'Vercel AI Gateway',
          description: 'Router für mehrere Anbieter. Das Modell wird als provider/model geschrieben, z. B. openai/gpt-4o.',
        },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: {
          title: 'DeepSeek',
          description: 'OpenAI-kompatible API unter https://api.deepseek.com. Die Base URL wird automatisch ausgefüllt.',
        },
        dashscope: {
          title: '阿里通义 DashScope',
          description: 'OpenAI-kompatibler Endpunkt unter dashscope.aliyuncs.com/compatible-mode/v1. Die Base URL wird automatisch ausgefüllt.',
        },
        cloudflare: {
          title: 'Cloudflare AI Gateway',
          description: 'Nutzt den /compat-Endpunkt, daher wird das Modell als provider/model geschrieben (z. B. openai/gpt-4o-mini, anthropic/claude-3-5-sonnet, deepseek/deepseek-chat). Hinweis: alibaba/qwen* wird von Cloudflare /compat NICHT unterstützt — für Qwen den Anbieter DashScope verwenden.',
        },
        siliconflow: {
          title: '硅基流动 SiliconFlow',
          description: 'OpenAI-kompatibler Endpunkt unter api.siliconflow.cn/v1. Die Base URL wird automatisch ausgefüllt.',
        },
        openrouter: {
          title: 'OpenRouter',
          description: 'Router für mehrere Anbieter unter openrouter.ai/api/v1. Die Base URL wird automatisch ausgefüllt.',
        },
        titles: {
          title: 'Gesprächstitel',
          description: 'Erzeugt automatisch einen kurzen zusammenfassenden Titel für neue Gespräche.',
        },
        defaults: {
          title: 'Standardwerte für die Generierung',
          description: 'Gelten, wenn eine Agent- oder Chat-Anfrage keinen eigenen Wert angibt.',
        },
        observability: { title: 'Beobachtbarkeit' },
        embedder: {
          title: 'Embedder',
          description: 'Text→Vektor-Anbieter für Wissensquellen und RAG. Unabhängig vom Chat-Anbieter oben.',
        },
      },
      keys: {
        provider: {
          label: 'Anbieter',
          options: {
            memory: 'Memory (Echo — nur für Tests)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek (OpenAI-kompatibel)',
            dashscope: '阿里通义 DashScope (OpenAI-kompatibel)',
            cloudflare: 'Cloudflare AI Gateway (OpenAI-kompatibel)',
            siliconflow: '硅基流动 SiliconFlow (OpenAI-kompatibel)',
            openrouter: 'OpenRouter (OpenAI-kompatibel)',
          },
        },
        gateway_model: {
          label: 'Gateway-Modell',
          help: 'Wird anstelle des in der Serverkonfiguration gesetzten Modells verwendet. Beispiel: openai/gpt-4o',
        },
        gateway_api_key: {
          label: 'Gateway-API-Schlüssel',
          help: 'Optional — nur nötig, wenn das Gateway Authentifizierung erzwingt.',
        },
        openai_api_key: {
          label: 'OpenAI-API-Schlüssel',
          help: 'Wird anstelle des in der Serverkonfiguration gesetzten Schlüssels verwendet. Verschlüsselt gespeichert.',
        },
        openai_model: { label: 'Modell', help: 'Standard-Modell-ID. Überschreibungen pro Agent haben Vorrang.' },
        openai_base_url: {
          label: 'Base URL',
          help: 'Überschreibung für Azure OpenAI oder selbst gehostete Gateways. Für api.openai.com leer lassen.',
        },
        anthropic_api_key: {
          label: 'Anthropic-API-Schlüssel',
          help: 'Wird anstelle des in der Serverkonfiguration gesetzten Schlüssels verwendet. Verschlüsselt gespeichert.',
        },
        anthropic_model: { label: 'Modell' },
        google_api_key: {
          label: 'Google-API-Schlüssel',
          help: 'Wird anstelle des in der Serverkonfiguration gesetzten Schlüssels verwendet. Verschlüsselt gespeichert.',
        },
        google_model: { label: 'Modell' },
        deepseek_api_key: { label: 'DeepSeek-API-Schlüssel', help: 'sk-... — ausgestellt auf platform.deepseek.com.' },
        deepseek_model: { label: 'Modell', help: 'Beispiele: deepseek-chat (V3), deepseek-reasoner (R1 Reasoning).' },
        dashscope_api_key: {
          label: 'DashScope-API-Schlüssel',
          help: 'sk-... — ausgestellt auf dashscope.console.aliyun.com.',
        },
        dashscope_model: { label: 'Modell' },
        cloudflare_account_id: {
          label: 'Cloudflare-Konto-ID',
          help: 'Die 32-stellige Hex-ID aus der URL Ihres Cloudflare-Dashboards.',
        },
        cloudflare_gateway_id: {
          label: 'Gateway-ID',
          help: 'In Cloudflare → AI Gateway konfigurierter Gateway-Name. Standard ist „default“.',
        },
        cloudflare_api_key: {
          label: 'Cloudflare-AI-Gateway-Token',
          help: 'Ausgestellt in AI Gateway → Registerkarte „API tokens“ (cfut_… oder sk_…).',
        },
        cloudflare_model: { label: 'Modell' },
        siliconflow_api_key: { label: 'SiliconFlow-API-Schlüssel' },
        siliconflow_model: {
          label: 'Modell',
          help: 'Beispiele: Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.',
        },
        openrouter_api_key: { label: 'OpenRouter-API-Schlüssel', help: 'sk-or-...' },
        openrouter_model: {
          label: 'Modell',
          help: 'Format: provider/model (z. B. anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).',
        },
        title_generation_enabled: { label: 'Gesprächstitel automatisch zusammenfassen' },
        title_max_length: {
          label: 'Max. Titellänge (Zeichen)',
          help: 'Harte Obergrenze für den erzeugten Titel. Längeres wird serverseitig abgeschnitten.',
        },
        temperature: { label: 'Temperatur', help: '0 = deterministisch, 2 = sehr kreativ.' },
        max_tokens: { label: 'Max. Ausgabe-Tokens', help: 'Harte Obergrenze für die pro Antwort erzeugten Tokens.' },
        request_timeout_ms: { label: 'Anfrage-Timeout (ms)' },
        trace_enabled: {
          label: 'Traces aufzeichnen',
          help: 'Zeichnet jede KI-Anfrage samt Antwort auf, damit sich ein Gespräch bei Problemen prüfen und wiedergeben lässt.',
        },
        log_prompts: {
          label: 'Vollständige Prompts protokollieren',
          help: 'Nimmt die gerenderten Prompts (nicht nur Metadaten) in die Trace-Zeilen auf.',
        },
        embedder_provider: {
          label: 'Anbieter',
          options: {
            none: 'Deaktiviert (keine Embeddings)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (lokal)',
            custom: 'Benutzerdefiniert (OpenAI-kompatibel)',
          },
        },
        embedder_api_key: {
          label: 'Embedder-API-Schlüssel',
          help: 'Bearer-Token, das im Authorization-Header gesendet wird. Für Ollama genügt jeder nicht leere Wert.',
        },
        embedder_model: {
          label: 'Modell',
          help: 'Beispiele — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
        },
        embedder_base_url: {
          label: 'Base URL',
          help: 'Wurzel des Endpunkts (ohne /embeddings). Wird aus der Voreinstellung ausgefüllt; für Proxys oder selbst gehostete Gateways überschreiben.',
        },
        embedder_dimensions: {
          label: 'Dimensionen',
          help: 'Überschreibt die Ausgabedimension (nur Matryoshka-Modelle). Leer lassen für den Modellstandard.',
        },
        embedder_batch_size: {
          label: 'Batchgröße',
          help: 'Anzahl der Chunks, die pro Anfrage an den Embedding-Anbieter gehen. Verringern, wenn Raten- oder Größenlimits des Anbieters greifen.',
        },
      },
      actions: {
        test: { label: 'Verbindung testen' },
        test_embedder: { label: 'Embedder testen' },
        reset: { label: 'Auf Umgebungsstandards zurücksetzen' },
      },
      banners: {
        log_prompts_warning: {
          title: 'Prompts können personenbezogene Daten enthalten',
          text: 'Kann personenbezogene Daten preisgeben — in regulierten Umgebungen abschalten.',
        },
      },
    },
    knowledge: {
      title: 'Wissen',
      description: 'Vektorspeicher-Backend für RAG und Wissensquellen.',
      groups: {
        adapter: {
          title: 'Backend',
          description: 'Legen Sie fest, wo Dokument-Chunks und ihre Vektoren gespeichert werden.',
        },
        turso: {
          title: 'Turso / libSQL',
          description: 'Funktioniert mit verwaltetem Turso, lokaler Datei oder im Arbeitsspeicher.',
        },
        ragflow: {
          title: 'RAGFlow',
          description: 'Externe RAGFlow-Bereitstellung. Anleitung zum Selbsthosten unter https://ragflow.io.',
        },
        indexing: {
          title: 'Standardwerte für die Indexierung',
          description: 'Ein an der Wissensquelle selbst gesetzter Wert hat Vorrang vor diesen Standardwerten.',
        },
        permissions: { title: 'Berechtigungen' },
      },
      keys: {
        adapter: {
          label: 'Adapter',
          options: {
            memory: 'Im Arbeitsspeicher (nur Entwicklung / Test)',
            turso: 'Turso / libSQL (Cloud oder lokal)',
            ragflow: 'RAGFlow (extern)',
          },
        },
        turso_url: {
          label: 'Verbindungs-URL',
          help: 'Beispiele: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
        },
        turso_auth_token: { label: 'Auth-Token', help: 'Nur für verwaltete Turso-URLs erforderlich.' },
        ragflow_base_url: { label: 'Base URL', help: 'Beispiel: http://localhost:9380' },
        ragflow_api_key: { label: 'API-Schlüssel' },
        ragflow_default_dataset: {
          label: 'Standard-Dataset-ID',
          help: 'Wird verwendet, wenn eine Wissensquelle kein eigenes RAGFlow-Dataset nennt.',
        },
        chunk_target: {
          label: 'Ziel-Chunkgröße (Zeichen)',
          help: 'Weiche Obergrenze der Chunkgröße, bevor die tokenbasierte Aufteilung greift.',
        },
        chunk_overlap: {
          label: 'Chunk-Überlappung (Zeichen)',
          help: 'Aus dem vorigen Chunk übernommene Zeichen, damit der Kontext über die Grenze erhalten bleibt.',
        },
        over_fetch: {
          label: 'Over-Fetch-Faktor',
          help: 'Die Suche holt das Vielfache der angeforderten Ergebnisanzahl, damit nach dem Filtern nach Dokumentdetails genug zum Zurückgeben bleiben.',
        },
        enforce_rls: {
          label: 'RLS bei der Suche erzwingen',
          help: 'Prüft jeden Treffer erneut gegen die Berechtigungen des Aufrufers auf Datensatzebene.',
        },
      },
      actions: {
        test: { label: 'Verbindung testen' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Vorhandene Indizes werden nicht migriert',
          text: 'Ein Adapterwechsel migriert vorhandene Indizes NICHT — mit dem bisherigen Adapter indexierte Dokumente sind bis zur Neuindexierung nicht erreichbar.',
        },
        enforce_rls_warning: {
          title: 'RLS in der Produktion eingeschaltet lassen',
          text: 'Das Abschalten umgeht den plattformeigenen Schutz vor Datenabfluss aus dem Vektorspeicher — in der Produktion eingeschaltet lassen.',
        },
      },
    },
    lifecycle: {
      title: 'Datenlebenszyklus',
      description: 'Wie lange Systemdaten aufbewahrt werden: Aufbewahrungsfenster überschreiben, Zeilenanzahl pro Tabelle begrenzen und benachrichtigt werden, wenn eine Tabelle unerwartet wächst. Die Plattform wendet dies bei ihrer periodischen Bereinigung an.',
      keys: {
        enabled: {
          label: 'Lebenszyklus-Richtlinien durchsetzen',
          help: 'Hauptschalter der periodischen Bereinigung. Aus = deklarierte Aufbewahrungs-/TTL-/Rotationsrichtlinien werden nicht mehr durchgesetzt (Daten wachsen wieder unbegrenzt).',
        },
        retention_overrides: {
          label: 'Aufbewahrungs-Überschreibungen',
          help: 'Fensterüberschreibungen pro Objekt. Dauern verwenden h/d/w/y. Pro Organisation gesetzt, sodass eine regulierte Organisation Jahre aufbewahren kann, eine Entwicklungsorganisation nur Tage. Eine Überschreibung, die kürzer ist als das Minimum, das eine Plattformfunktion braucht (etwa das Duplikaterkennungsfenster der Job-Warteschlange), wird ignoriert und als Fehler protokolliert; das Standardfenster gilt weiter.',
        },
        quotas: {
          label: 'Zeilenkontingente',
          help: 'Maximale Zeilenanzahl pro Objekt. Eine Überschreitung löst eine Governance-Warnung aus — Kontingente löschen nie über die deklarierte Richtlinie hinaus.',
        },
        quota_defaults: {
          label: 'Standardkontingente pro Klasse',
          help: 'Ersatzkontingente nach Lebenszyklusklasse (telemetry, transient, event, audit).',
        },
        growth_alert_rows: {
          label: 'Wachstums-Warnschwelle (Zeilen pro Durchlauf)',
          help: 'Warnt, wenn eine Tabelle mit deklariertem Lebenszyklus zwischen zwei Durchläufen um mehr als so viele Zeilen wächst. 0 deaktiviert Wachstumswarnungen.',
        },
      },
    },
  },
};
