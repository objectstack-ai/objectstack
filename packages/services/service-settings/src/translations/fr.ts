// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * Français (fr) — built-in settings manifest translations.
 */
export const fr: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: {
      env: 'Environnement',
      global: 'Global',
      tenant: 'Organisation',
      user: 'Utilisateur',
      default: 'Par défaut',
    },
  },
  settings: {
    mail: {
      title: 'Envoi des e-mails',
      description: 'Configuration SMTP et du fournisseur d’e-mails transactionnels.',
      groups: {
        provider: { title: 'Fournisseur', description: 'Choisissez comment ce système envoie les e-mails sortants.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'Clé API' },
        from_address: { title: 'Adresse d’expédition' },
        delivery: { title: 'Envoi', description: 'Comment les e-mails sortants sont remis au fournisseur.' },
      },
      keys: {
        provider: {
          label: 'Fournisseur',
          help: 'Seuls les fournisseurs par lesquels ce serveur peut réellement envoyer sont listés. SendGrid et Amazon SES se configurent en SMTP.',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: 'Aucun (journalisation seule — aucun envoi réel)',
          },
        },
        smtp_host: { label: 'Hôte', help: 'Exemple : smtp.example.com' },
        smtp_port: { label: 'Port' },
        smtp_secure: { label: 'Utiliser TLS' },
        smtp_user: { label: 'Nom d’utilisateur' },
        smtp_password: { label: 'Mot de passe' },
        api_key: { label: 'Clé API' },
        from_email: { label: 'E-mail d’expédition', help: 'Exemple : no-reply@example.com' },
        from_name: {
          label: 'Nom d’expéditeur',
          help: 'Laissez vide pour utiliser le nom du produit (Image de marque) ou le nom avec lequel ce déploiement a été configuré.',
        },
        queue_delivery: {
          label: 'Envoi via une file durable',
          help: 'Chaque message est confié à la file de tâches au lieu d’être envoyé directement : un envoi en échec est relancé par un worker avec un délai croissant et survit à un redémarrage. Nécessite la capacité de file avec un adaptateur durable. « Envoyer un e-mail de test » envoie toujours directement.',
        },
      },
      actions: {
        test: { label: 'Envoyer un e-mail de test' },
      },
    },
    sms: {
      title: 'Envoi des SMS',
      description: 'Configuration du fournisseur SMS pour la connexion par OTP, les invitations et les notifications.',
      groups: {
        provider: { title: 'Fournisseur', description: 'Choisissez comment ce système envoie les SMS sortants.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: {
          title: 'Limites de dépense',
          description: 'Plafonne le volume de SMS sortants du déploiement. Le SMS est un canal payant et chaque envoi coûte de l’argent réel.',
        },
      },
      keys: {
        provider: {
          label: 'Fournisseur',
          options: {
            log: 'Aucun (journalisation seule — aucun envoi réel)',
            aliyun: 'Aliyun SMS (阿里云短信)',
            twilio: 'Twilio',
          },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: 'Nom de signature (短信签名)' },
        aliyun_template_code: {
          label: 'Code de modèle par défaut (短信模板)',
          help: 'Utilisé lorsqu’un envoi ne précise aucun modèle. Un modèle générique avec une seule variable ${content} permet les SMS de notification génériques.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Jeton d’authentification' },
        twilio_from_number: {
          label: 'Numéro d’expédition',
          help: 'Expéditeur au format E.164, par ex. +15005550006. Soit ce numéro, soit un Messaging Service SID.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: 'Limite d’envoi quotidienne',
          help: 'Nombre maximal de SMS que ce déploiement peut envoyer par jour UTC, connexion par OTP, invitations et notifications comprises. 0 signifie aucune limite. Les envois au-delà de la limite sont refusés jusqu’à 00:00 UTC.',
        },
      },
      actions: {
        test: { label: 'Envoyer un SMS de test' },
      },
    },
    branding: {
      title: 'Image de marque',
      description: 'Le nom, le logo et la couleur affichés par la console et la page de connexion. Une valeur non définie reprend l’image de marque du déploiement.',
      groups: {
        identity: { title: 'Identité' },
        appearance: { title: 'Apparence' },
      },
      keys: {
        workspace_name: {
          label: 'Nom du produit',
          help: 'Le nom du produit dans la console, sur la page de connexion et dans le titre du navigateur, ainsi que dans les e-mails de connexion, l’application d’authentification et la connexion MCP. Laissez vide pour utiliser le nom avec lequel ce déploiement a été configuré. Ce n’est pas le nom de l’organisation elle-même, qui est le Nom de la fiche Organisation.',
        },
        accent_color: {
          label: 'Couleur d’accent',
          help: 'La couleur de thème du navigateur et de l’application installée. Chaque application garde ses propres couleurs.',
        },
        logo_url: {
          label: 'URL du logo',
          help: 'Affiché sur la page de connexion, l’écran de chargement et l’en-tête d’accueil. Exemple : https://…/logo.svg',
        },
      },
    },
    company: {
      title: 'Entreprise',
      description: 'Identité de l’entité juridique — raison sociale, adresse, identifiants fiscaux et contact principal.',
      groups: {
        identity: { title: 'Identité' },
        address: { title: 'Adresse du siège' },
        contact: { title: 'Contact' },
      },
      keys: {
        legal_name: {
          label: 'Raison sociale',
          help: 'Nom légal enregistré de l’organisation, tel qu’il figure sur les contrats et les factures.',
        },
        registration_number: {
          label: 'Numéro d’immatriculation',
          help: 'Numéro d’immatriculation ou de constitution de l’entreprise (par ex. EIN).',
        },
        tax_id: { label: 'N° fiscal / TVA', help: 'Affiché sur les factures (par ex. TVA, GST, ABN).' },
        address_line1: { label: 'Adresse (ligne 1)' },
        address_line2: { label: 'Adresse (ligne 2)' },
        city: { label: 'Ville' },
        state: { label: 'État / Province' },
        postal_code: { label: 'Code postal' },
        country: {
          label: 'Pays',
          help: 'Pays de l’adresse du siège. Saisissez un nom de pays et choisissez-le dans la liste.',
          options: countryOptionLabels('fr'),
        },
        phone: { label: 'Téléphone', help: 'Format E.164 recommandé, par ex. +33 1 55 55 01 00.' },
        website: { label: 'Site web', help: 'Exemple : https://example.com' },
        primary_contact_name: { label: 'Nom du contact principal' },
        primary_contact_email: { label: 'E-mail du contact principal', help: 'Exemple : ops@example.com' },
      },
    },
    localization: {
      title: 'Localisation',
      description: 'Fuseau horaire, langue, pays, devise et exercice fiscal par défaut.',
      groups: {
        region: { title: 'Région' },
        finance: { title: 'Finance' },
      },
      keys: {
        timezone: {
          label: 'Fuseau horaire par défaut',
          help: 'Détermine ce que « aujourd’hui » signifie dans les formules, comment les rapports regroupent les dates et comment les dates et heures s’affichent. Accepte tout nom de fuseau IANA (par ex. Europe/Paris). C’est le fuseau en vigueur pour l’organisation : le champ Fuseau horaire de la fiche Organisation ne le change pas.',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) Los Angeles',
            'America/Denver': '(UTC−07/−06) Denver',
            'America/Chicago': '(UTC−06/−05) Chicago',
            'America/New_York': '(UTC−05/−04) New York',
            'America/Sao_Paulo': '(UTC−03) São Paulo',
            'Europe/London': '(UTC±00/+01) Londres',
            'Europe/Paris': '(UTC+01/+02) Paris',
            'Europe/Berlin': '(UTC+01/+02) Berlin',
            'Europe/Moscow': '(UTC+03) Moscou',
            'Asia/Dubai': '(UTC+04) Dubaï',
            'Asia/Kolkata': '(UTC+05:30) Calcutta',
            'Asia/Singapore': '(UTC+08) Singapour',
            'Asia/Shanghai': '(UTC+08) Shanghai',
            'Asia/Tokyo': '(UTC+09) Tokyo',
            'Australia/Sydney': '(UTC+10/+11) Sydney',
            'Pacific/Auckland': '(UTC+12/+13) Auckland',
          },
        },
        locale: {
          label: 'Langue par défaut',
          help: 'Langue BCP-47 des catalogues de messages et du formatage des nombres et des dates.',
        },
        default_country: {
          label: 'Pays par défaut',
          help: 'Sert de valeur par défaut pour les adresses et les téléphones. Saisissez un nom de pays et choisissez-le dans la liste.',
          options: countryOptionLabels('fr'),
        },
        currency: {
          label: 'Devise par défaut',
          help: 'Code ISO 4217 appliqué lorsqu’un champ devise n’indique pas le sien. Laissez vide pour afficher les montants sans code comme de simples nombres.',
          options: {
            USD: 'USD — Dollar américain',
            EUR: 'EUR — Euro',
            GBP: 'GBP — Livre sterling',
            JPY: 'JPY — Yen japonais',
            CNY: 'CNY — Yuan chinois',
            INR: 'INR — Roupie indienne',
            AUD: 'AUD — Dollar australien',
            CAD: 'CAD — Dollar canadien',
            BRL: 'BRL — Réal brésilien',
          },
        },
        fiscal_year_start: {
          label: 'Début de l’exercice fiscal',
          help: 'Premier mois de l’exercice fiscal — détermine « ce trimestre / cet exercice » dans les rapports.',
          options: {
            january: 'Janvier',
            february: 'Février',
            march: 'Mars',
            april: 'Avril',
            may: 'Mai',
            june: 'Juin',
            july: 'Juillet',
            august: 'Août',
            september: 'Septembre',
            october: 'Octobre',
            november: 'Novembre',
            december: 'Décembre',
          },
        },
      },
    },
    auth: {
      title: 'Authentification',
      description: 'Connexion, inscription et réglages des fonctions d’authentification intégrées.',
      groups: {
        email_password: {
          title: 'E-mail et mot de passe',
          description: 'Gère la connexion locale par e-mail et mot de passe et l’inscription en libre-service.',
        },
        membership: {
          title: 'Adhésion',
          description: 'Ce que rejoint un utilisateur nouvellement créé. Va de pair avec l’inscription en libre-service ci-dessus.',
        },
        audience: {
          title: 'Public',
          description: 'Qui peut devenir utilisateur des applications de ce système. Les domaines e-mail autorisés imposent toujours la vérification de l’e-mail. Ouvert l’impose aussi, sauf si le déploiement la désactive ; une valeur enregistrée dans cette console ne le peut pas. Les invitations, les utilisateurs créés par un administrateur, le provisionnement SCIM et le SSO d’entreprise sont admis quel que soit le mode.',
        },
        password_policy: {
          title: 'Politique de mot de passe',
          description: 'Bornes de longueur imposées par le fournisseur d’authentification à l’inscription et à la réinitialisation du mot de passe.',
        },
        anti_abuse: {
          title: 'Anti-abus',
          description: 'Protection contre la force brute : verrouillage du compte par identité et limitation du débit par IP sur les points de terminaison d’authentification.',
        },
        multi_factor: {
          title: 'Multifacteur',
          description: 'Exige que les membres protègent leur compte avec une application d’authentification (TOTP).',
        },
        sessions: { title: 'Sessions', description: 'Durée de validité d’une session ouverte.' },
        network: {
          title: 'Réseau',
          description: 'Restreint les lieux depuis lesquels les utilisateurs peuvent s’authentifier.',
        },
        api_keys: {
          title: 'Clés API',
          description: 'Durée de vie des clés API personnelles. Une clé expirée, inutilisée au-delà de la période d’inactivité ou révoquée est refusée avec son propre code d’erreur, et le remède est toujours une nouvelle clé.',
        },
        social: {
          title: 'Connexion sociale',
          description: 'Configure le fournisseur de connexion Google intégré. Les identifiants définis dans la configuration du serveur restent prioritaires.',
        },
      },
      keys: {
        email_password_enabled: {
          label: 'Activer la connexion par e-mail et mot de passe',
          confirmOffText: 'Les personnes qui se connectent avec un mot de passe auront besoin d’un autre moyen d’accès.',
        },
        signup_enabled: {
          label: 'Autoriser l’inscription par e-mail',
          help: 'Ouvre le formulaire d’inscription par e-mail et mot de passe. Qui il admet dépend du Public de l’inscription libre ci-dessous : avec Sur invitation uniquement, seule une adresse ayant une invitation en attente ; avec Domaines e-mail autorisés, les domaines autorisés et les adresses invitées ; avec Ouvert, tout le monde. Désactivé, le formulaire est fermé quel que soit le public, invitations comprises.',
        },
        require_email_verification: { label: 'Exiger la vérification de l’e-mail' },
        membership_policy: {
          label: 'Adhésion des nouveaux utilisateurs',
          help: 'Automatique rattache chaque nouvel utilisateur à l’organisation par défaut. Sur invitation uniquement n’accorde l’adhésion que par un acte explicite — créer une organisation, accepter une invitation, être ajouté par un administrateur ou être provisionné à la volée par SSO.',
          options: {
            auto: 'Rejoindre automatiquement l’organisation par défaut',
            'invite-only': 'Sur invitation uniquement — jamais d’adhésion automatique',
          },
        },
        audience_posture: {
          label: 'Public de l’inscription libre',
          help: 'Sur invitation uniquement ferme l’inscription libre : on ne devient utilisateur que lorsqu’un administrateur vous invite, vous crée ou vous importe, ou via le provisionnement d’annuaire (SCIM) ou l’authentification unique d’entreprise. Domaines e-mail autorisés l’ouvre aux domaines listés ci-dessous. Ouvert admet tout le monde. Domaines e-mail autorisés comme Ouvert nécessitent l’ensemble d’autorisations d’inscription libre ci-dessous. Domaines e-mail autorisés exige toujours la vérification de l’e-mail. Ouvert l’exige sauf si la configuration du serveur la désactive ; la désactiver dans cette console est refusé en mode Ouvert.',
          options: {
            invite_only: 'Sur invitation uniquement — pas d’inscription libre (par défaut)',
            email_domain: 'Domaines e-mail autorisés uniquement',
            open: 'Ouvert — tout le monde peut s’inscrire',
          },
        },
        audience_allowed_email_domains: {
          label: 'Domaines e-mail autorisés',
          help: 'Domaines nus, un par ligne ou séparés par des virgules (par ex. acme.com). La correspondance est exacte et insensible à la casse ; les sous-domaines nécessitent leur propre entrée ; pas de caractères génériques.',
        },
        audience_self_registration_permission_set: {
          label: 'Ensemble d’autorisations de l’inscription libre',
          help: 'Nom de l’ensemble d’autorisations reçu par chaque utilisateur inscrit librement. L’ensemble membre standard convient ; l’ensemble administrateur complet est refusé. Obligatoire dès que le public permet l’inscription libre.',
        },
        password_min_length: { label: 'Longueur minimale du mot de passe' },
        password_max_length: {
          label: 'Longueur maximale du mot de passe',
          help: 'Protège contre le déni de service par hachage de mots de passe très longs.',
        },
        password_reject_breached: {
          label: 'Refuser les mots de passe compromis',
          help: 'Bloque les mots de passe présents dans les fuites publiques via Have I Been Pwned (vérification par plage en k-anonymat ; le mot de passe n’est jamais envoyé en entier).',
        },
        password_require_complexity: {
          label: 'Exiger des mots de passe complexes',
          help: 'Exige que les mots de passe mélangent des classes de caractères (majuscules, minuscules, chiffres, symboles) à l’inscription et lors du changement ou de la réinitialisation.',
        },
        password_min_classes: {
          label: 'Classes de caractères minimales',
          help: 'Combien des quatre classes (majuscule / minuscule / chiffre / symbole) un mot de passe doit contenir.',
        },
        password_history_count: {
          label: 'Historique des mots de passe (pas de réutilisation)',
          help: 'Empêche de réutiliser ce nombre de mots de passe précédents lors d’un changement ou d’une réinitialisation. 0 désactive la vérification.',
        },
        password_expiry_days: {
          label: 'Expiration du mot de passe (jours)',
          help: 'Impose un changement de mot de passe après ce nombre de jours. 0 désactive l’expiration. Tant que le mot de passe est expiré, l’utilisateur n’a plus accès aux données jusqu’à ce qu’il le change.',
        },
        lockout_threshold: {
          label: 'Seuil de verrouillage du compte',
          help: 'Verrouille un compte après ce nombre d’échecs de connexion consécutifs — mauvais mots de passe comme mauvais codes à deux facteurs. Pendant le verrouillage, la connexion est refusée même avec les bons identifiants. 0 désactive le verrouillage à l’étape du mot de passe ; la vérification à deux facteurs garde alors sa limite intégrée de 10 tentatives par 15 minutes, puisqu’elle est le dernier contrôle avant l’émission d’une session.',
        },
        lockout_duration_minutes: {
          label: 'Durée du verrouillage (minutes)',
          help: 'Durée pendant laquelle un compte reste verrouillé une fois le seuil franchi, à l’une ou l’autre étape de connexion.',
        },
        rate_limit_max: {
          label: 'Limitation d’authentification : requêtes max.',
          help: 'Nombre maximal de requêtes par IP et par fenêtre vers les points de terminaison de connexion / inscription / réinitialisation du mot de passe.',
        },
        rate_limit_window_seconds: {
          label: 'Limitation d’authentification : fenêtre (secondes)',
          help: 'Fenêtre glissante sur laquelle le plafond de requêtes ci-dessus est compté.',
        },
        mfa_required: {
          label: 'Exiger l’authentification multifacteur',
          help: 'Les utilisateurs sans application d’authentification enregistrée perdent l’accès aux données à la fin de leur délai de grâce. L’activer active aussi la fonction à deux facteurs pour que les utilisateurs puissent s’enregistrer.',
        },
        mfa_grace_period_days: {
          label: 'Délai de grâce MFA (jours)',
          help: 'Durée pendant laquelle les utilisateurs peuvent différer l’enregistrement avant le blocage. 0 bloque immédiatement.',
        },
        session_expiry_days: {
          label: 'Durée de session (jours)',
          help: 'Une session expire ce nombre de jours après la connexion.',
        },
        session_refresh_days: {
          label: 'Seuil de renouvellement (jours)',
          help: 'Une session active est prolongée lorsqu’elle est plus ancienne que cette durée.',
        },
        session_idle_timeout_minutes: {
          label: 'Délai d’inactivité (minutes)',
          help: 'Déconnecte un utilisateur après ce nombre de minutes d’inactivité. 0 désactive.',
        },
        session_absolute_max_hours: {
          label: 'Durée de session absolue (heures)',
          help: 'Impose une nouvelle authentification ce nombre d’heures après la connexion, quelle que soit l’activité. 0 désactive.',
        },
        max_concurrent_sessions_per_user: {
          label: 'Sessions simultanées max. par utilisateur',
          help: 'Plafonne les sessions ouvertes simultanément par utilisateur ; les plus anciennes sont déconnectées au-delà. 0 = illimité.',
        },
        allowed_ip_ranges: {
          label: 'Plages IP autorisées',
          help: 'Plages CIDR ou IP exactes (une par ligne, ou séparées par des virgules), par ex. 203.0.113.0/24. Une fois définies, la connexion depuis l’extérieur de ces plages est refusée, tout comme toute requête dont le serveur ne peut établir l’adresse cliente. Vide = aucune restriction. L’adresse jugée est celle d’où vient la connexion ; derrière un proxy inverse, le serveur doit être configuré pour faire confiance à ce proxy afin que l’adresse cliente d’origine soit jugée à la place.',
        },
        api_key_default_expiry_days: {
          label: 'Durée de vie par défaut des clés (jours)',
          help: 'Une clé créée sans date d’expiration expire ce nombre de jours après sa création. Jamais plus longtemps que la durée maximale ci-dessous.',
        },
        api_key_max_expiry_days: {
          label: 'Durée de vie maximale des clés (jours)',
          help: 'Date d’expiration la plus lointaine qu’une nouvelle clé peut demander, comptée depuis sa création. Au-delà, elle est refusée ; exactement ce nombre de jours est accepté.',
        },
        api_key_inactivity_days: {
          label: 'Expiration pour inactivité (jours)',
          help: 'Une clé sans utilisation enregistrée depuis ce nombre de jours est refusée. Elle n’est pas révoquée ; créez une nouvelle clé. Une clé jamais utilisée compte depuis sa création, ou depuis le début de la politique ci-dessous si elle est plus ancienne. 0 désactive l’expiration pour inactivité.',
        },
        api_key_policy_started_at: {
          label: 'Début de la politique des clés',
          help: 'Enregistré automatiquement (UTC, ISO 8601) la première fois que le serveur tourne avec cette politique. Les clés créées avant sans date d’expiration expirent un an après ; les clés sans utilisation enregistrée comptent leur inactivité à partir de là. Le modifier déplace ces deux dates pour les clés qui ne les ont pas encore reçues.',
        },
        google_enabled: {
          label: 'Activer la connexion Google',
          help: 'Propose la connexion Google dès qu’un ID client et un secret client sont tous deux disponibles : enregistrés ci-dessous, ou définis dans la configuration du serveur, qui l’emporte sur les valeurs enregistrées. Tant que les deux ne sont pas disponibles, la page de connexion n’affiche aucun bouton Google, même si ce réglage est activé. Désactivé, la connexion Google est retirée même si le serveur définit les deux. Créez le client OAuth dans Google Cloud Console.',
        },
        google_client_id: {
          label: 'ID client Google',
          help: 'ID client OAuth issu de Google Cloud Console. Il peut aussi être défini dans la configuration du serveur.',
        },
        google_client_secret: {
          label: 'Secret client Google',
          help: 'Stocké chiffré. Il peut aussi être défini dans la configuration du serveur.',
        },
      },
    },
    storage: {
      title: 'Stockage des fichiers',
      description: 'Backend utilisé pour les pièces jointes, les exports et les fichiers envoyés par les utilisateurs.',
      groups: {
        adapter: { title: 'Backend', description: 'Choisissez où sont stockés les fichiers envoyés.' },
        local: { title: 'Local' },
        s3: { title: 'S3' },
        limits: { title: 'Limites' },
      },
      keys: {
        adapter: {
          label: 'Adaptateur',
          options: { local: 'Système de fichiers local', s3: 'S3 / compatible S3' },
        },
        local_root: {
          label: 'Répertoire racine',
          help: 'Chemin du système de fichiers sous lequel les fichiers sont stockés. Les chemins relatifs sont résolus depuis le CWD du serveur.',
        },
        s3_bucket: {
          label: 'Bucket',
          help: 'Bucket partagé de l’hôte. Les fichiers de chaque environnement sont séparés par le préfixe projects/<environmentId>/.',
        },
        s3_region: { label: 'Région', help: 'Exemple : us-east-1' },
        s3_endpoint: {
          label: 'Point de terminaison',
          help: 'Point de terminaison personnalisé pour les fournisseurs compatibles S3 (R2, MinIO, Wasabi). Laissez vide pour AWS S3.',
        },
        s3_access_key_id: { label: 'ID de clé d’accès' },
        s3_secret_access_key: { label: 'Clé d’accès secrète' },
        s3_force_path_style: {
          label: 'Forcer les URL de style chemin',
          help: 'À activer pour MinIO et la plupart des fournisseurs compatibles S3 ; à désactiver pour AWS S3.',
        },
        presigned_ttl: { label: 'Durée de validité des URL présignées (secondes)' },
        session_ttl: {
          label: 'Durée de validité de la session d’envoi (secondes)',
          help: 'Durée pendant laquelle une session d’envoi par morceaux reste reprenable.',
        },
        max_upload_mb: { label: 'Taille d’envoi max. (Mo)' },
      },
      actions: {
        test: { label: 'Tester la connexion' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Les fichiers existants ne sont pas migrés',
          text: 'Changer d’adaptateur ne migre pas les fichiers existants — les fichiers envoyés avec l’adaptateur précédent deviennent inaccessibles via le nouveau.',
        },
      },
    },
    ai: {
      title: 'IA et Embedder',
      description: 'Fournisseur LLM, modèle, identifiants et configuration de l’Embedder utilisés par les services d’IA et de connaissances de la plateforme.',
      groups: {
        provider: {
          title: 'Fournisseur',
          description: 'Choisissez le backend LLM. Le mode Memory renvoie l’entrée telle quelle — utile pour les tests, jamais en production.',
        },
        gateway: {
          title: 'Vercel AI Gateway',
          description: 'Routeur multifournisseur. Le modèle s’écrit provider/model, par ex. openai/gpt-4o.',
        },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: {
          title: 'DeepSeek',
          description: 'API compatible OpenAI sur https://api.deepseek.com. La Base URL est renseignée automatiquement.',
        },
        dashscope: {
          title: '阿里通义 DashScope',
          description: 'Point de terminaison compatible OpenAI sur dashscope.aliyuncs.com/compatible-mode/v1. La Base URL est renseignée automatiquement.',
        },
        cloudflare: {
          title: 'Cloudflare AI Gateway',
          description: 'Utilise le point de terminaison /compat : le modèle s’écrit donc provider/model (par ex. openai/gpt-4o-mini, anthropic/claude-3-5-sonnet, deepseek/deepseek-chat). Remarque : alibaba/qwen* n’est PAS pris en charge par Cloudflare /compat — utilisez le fournisseur DashScope pour Qwen.',
        },
        siliconflow: {
          title: '硅基流动 SiliconFlow',
          description: 'Point de terminaison compatible OpenAI sur api.siliconflow.cn/v1. La Base URL est renseignée automatiquement.',
        },
        openrouter: {
          title: 'OpenRouter',
          description: 'Routeur multifournisseur sur openrouter.ai/api/v1. La Base URL est renseignée automatiquement.',
        },
        titles: {
          title: 'Titres des conversations',
          description: 'Génère automatiquement un court titre de synthèse pour les nouvelles conversations.',
        },
        defaults: {
          title: 'Valeurs de génération par défaut',
          description: 'Appliquées lorsqu’une requête d’agent ou de chat ne précise pas sa propre valeur.',
        },
        observability: { title: 'Observabilité' },
        embedder: {
          title: 'Embedder',
          description: 'Fournisseur texte → vecteur utilisé par les sources de connaissances et le RAG. Indépendant du fournisseur de chat ci-dessus.',
        },
      },
      keys: {
        provider: {
          label: 'Fournisseur',
          options: {
            memory: 'Memory (écho — tests uniquement)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek (compatible OpenAI)',
            dashscope: '阿里通义 DashScope (compatible OpenAI)',
            cloudflare: 'Cloudflare AI Gateway (compatible OpenAI)',
            siliconflow: '硅基流动 SiliconFlow (compatible OpenAI)',
            openrouter: 'OpenRouter (compatible OpenAI)',
          },
        },
        gateway_model: {
          label: 'Modèle Gateway',
          help: 'Utilisé à la place du modèle défini dans la configuration du serveur. Exemple : openai/gpt-4o',
        },
        gateway_api_key: {
          label: 'Clé API Gateway',
          help: 'Facultatif — nécessaire uniquement si la passerelle impose une authentification.',
        },
        openai_api_key: {
          label: 'Clé API OpenAI',
          help: 'Utilisée à la place de la clé définie dans la configuration du serveur. Stockée chiffrée.',
        },
        openai_model: { label: 'Modèle', help: 'ID du modèle par défaut. Les surcharges par agent sont prioritaires.' },
        openai_base_url: {
          label: 'Base URL',
          help: 'Surcharge pour Azure OpenAI ou des passerelles auto-hébergées. Laissez vide pour api.openai.com.',
        },
        anthropic_api_key: {
          label: 'Clé API Anthropic',
          help: 'Utilisée à la place de la clé définie dans la configuration du serveur. Stockée chiffrée.',
        },
        anthropic_model: { label: 'Modèle' },
        google_api_key: {
          label: 'Clé API Google',
          help: 'Utilisée à la place de la clé définie dans la configuration du serveur. Stockée chiffrée.',
        },
        google_model: { label: 'Modèle' },
        deepseek_api_key: { label: 'Clé API DeepSeek', help: 'sk-... — délivrée sur platform.deepseek.com.' },
        deepseek_model: {
          label: 'Modèle',
          help: 'Exemples : deepseek-chat (V3), deepseek-reasoner (raisonnement R1).',
        },
        dashscope_api_key: { label: 'Clé API DashScope', help: 'sk-... — délivrée sur dashscope.console.aliyun.com.' },
        dashscope_model: { label: 'Modèle' },
        cloudflare_account_id: {
          label: 'ID de compte Cloudflare',
          help: 'L’ID hexadécimal de 32 caractères présent dans l’URL de votre tableau de bord Cloudflare.',
        },
        cloudflare_gateway_id: {
          label: 'ID de la passerelle',
          help: 'Nom de passerelle configuré dans Cloudflare → AI Gateway. Par défaut « default ».',
        },
        cloudflare_api_key: {
          label: 'Jeton Cloudflare AI Gateway',
          help: 'Délivré dans AI Gateway → onglet « API tokens » (cfut_… ou sk_…).',
        },
        cloudflare_model: { label: 'Modèle' },
        siliconflow_api_key: { label: 'Clé API SiliconFlow' },
        siliconflow_model: {
          label: 'Modèle',
          help: 'Exemples : Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.',
        },
        openrouter_api_key: { label: 'Clé API OpenRouter', help: 'sk-or-...' },
        openrouter_model: {
          label: 'Modèle',
          help: 'Format : provider/model (par ex. anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).',
        },
        title_generation_enabled: { label: 'Résumer automatiquement les titres des conversations' },
        title_max_length: {
          label: 'Longueur max. du titre (caractères)',
          help: 'Plafond strict du titre généré. Tout dépassement est tronqué côté serveur.',
        },
        temperature: { label: 'Température', help: '0 = déterministe, 2 = très créatif.' },
        max_tokens: { label: 'Jetons de sortie max.', help: 'Plafond strict de jetons générés par réponse.' },
        request_timeout_ms: { label: 'Délai d’expiration de la requête (ms)' },
        trace_enabled: {
          label: 'Enregistrer les traces',
          help: 'Conserve une trace de chaque requête IA et de sa réponse, pour pouvoir inspecter et rejouer une conversation en cas de problème.',
        },
        log_prompts: {
          label: 'Journaliser les prompts complets',
          help: 'Inclut les prompts rendus (et pas seulement les métadonnées) dans les lignes de trace.',
        },
        embedder_provider: {
          label: 'Fournisseur',
          options: {
            none: 'Désactivé (aucun embedding)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (local)',
            custom: 'Personnalisé (compatible OpenAI)',
          },
        },
        embedder_api_key: {
          label: 'Clé API Embedder',
          help: 'Jeton Bearer envoyé dans l’en-tête Authorization. Pour Ollama, toute valeur non vide convient.',
        },
        embedder_model: {
          label: 'Modèle',
          help: 'Exemples — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
        },
        embedder_base_url: {
          label: 'Base URL',
          help: 'Racine du point de terminaison (sans /embeddings). Renseignée depuis le préréglage ; à surcharger pour un proxy ou une passerelle auto-hébergée.',
        },
        embedder_dimensions: {
          label: 'Dimensions',
          help: 'Surcharge la dimensionnalité de sortie (modèles Matryoshka uniquement). Laissez vide pour la valeur par défaut du modèle.',
        },
        embedder_batch_size: {
          label: 'Taille de lot',
          help: 'Nombre de morceaux envoyés au fournisseur d’embeddings par requête. Réduisez-le si vous atteignez les limites de débit ou de taille du fournisseur.',
        },
      },
      actions: {
        test: { label: 'Tester la connexion' },
        test_embedder: { label: 'Tester l’Embedder' },
        reset: { label: 'Rétablir les valeurs de l’environnement' },
      },
      banners: {
        log_prompts_warning: {
          title: 'Les prompts peuvent contenir des données personnelles',
          text: 'Risque de fuite de données personnelles — à désactiver dans les environnements réglementés.',
        },
      },
    },
    knowledge: {
      title: 'Connaissances',
      description: 'Backend de stockage vectoriel pour le RAG et les sources de connaissances.',
      groups: {
        adapter: {
          title: 'Backend',
          description: 'Choisissez où sont stockés les morceaux de documents et leurs vecteurs.',
        },
        turso: { title: 'Turso / libSQL', description: 'Fonctionne avec Turso géré, un fichier local ou en mémoire.' },
        ragflow: {
          title: 'RAGFlow',
          description: 'Déploiement RAGFlow externe. Voir https://ragflow.io pour l’auto-hébergement.',
        },
        indexing: {
          title: 'Valeurs d’indexation par défaut',
          description: 'Une valeur définie sur la source de connaissances elle-même l’emporte sur ces valeurs par défaut.',
        },
        permissions: { title: 'Autorisations' },
      },
      keys: {
        adapter: {
          label: 'Adaptateur',
          options: {
            memory: 'En mémoire (dév. / test uniquement)',
            turso: 'Turso / libSQL (cloud ou local)',
            ragflow: 'RAGFlow (externe)',
          },
        },
        turso_url: {
          label: 'URL de connexion',
          help: 'Exemples : libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
        },
        turso_auth_token: {
          label: 'Jeton d’authentification',
          help: 'Nécessaire uniquement pour les URL Turso gérées.',
        },
        ragflow_base_url: { label: 'Base URL', help: 'Exemple : http://localhost:9380' },
        ragflow_api_key: { label: 'Clé API' },
        ragflow_default_dataset: {
          label: 'ID du jeu de données par défaut',
          help: 'Utilisé lorsqu’une source de connaissances ne désigne pas son propre jeu de données RAGFlow.',
        },
        chunk_target: {
          label: 'Taille cible des morceaux (caractères)',
          help: 'Plafond souple de taille des morceaux avant que le découpage par jetons n’intervienne.',
        },
        chunk_overlap: {
          label: 'Chevauchement des morceaux (caractères)',
          help: 'Caractères repris du morceau précédent pour que le contexte franchisse la frontière.',
        },
        over_fetch: {
          label: 'Multiplicateur de sur-récupération',
          help: 'La recherche récupère ce multiple du nombre de résultats demandés, pour qu’il en reste assez à renvoyer après le filtrage selon les détails des documents.',
        },
        enforce_rls: {
          label: 'Appliquer la RLS à la recherche',
          help: 'Revérifie chaque résultat selon les autorisations au niveau des enregistrements de l’appelant.',
        },
      },
      actions: {
        test: { label: 'Tester la connexion' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Les index existants ne sont pas migrés',
          text: 'Changer d’adaptateur ne migre PAS les index existants — les documents indexés avec l’adaptateur précédent deviennent inaccessibles jusqu’à leur réindexation.',
        },
        enforce_rls_warning: {
          title: 'Laissez la RLS activée en production',
          text: 'La désactiver contourne la protection propre à la plateforme contre les fuites de données du stockage vectoriel — laissez-la activée en production.',
        },
      },
    },
    lifecycle: {
      title: 'Cycle de vie des données',
      description: 'Durée de conservation des données système : surcharger les fenêtres de rétention, plafonner le nombre de lignes par table et être alerté quand une table grossit de façon inattendue. La plateforme les applique lors de son nettoyage périodique.',
      keys: {
        enabled: {
          label: 'Appliquer les politiques de cycle de vie',
          help: 'Interrupteur général du nettoyage périodique. Désactivé = les politiques de rétention/TTL/rotation déclarées ne sont plus appliquées (les données recommencent à croître sans limite).',
        },
        retention_overrides: {
          label: 'Surcharges de rétention',
          help: 'Surcharges de fenêtre par objet : { "<object>": { "maxAge": "1y", "expireAfter": "30d" } }. Les durées utilisent h/d/w/y. Définies par organisation : une organisation réglementée peut conserver des années, une organisation de développement quelques jours. Une surcharge plus courte que le minimum requis par une fonction de la plateforme (par exemple la fenêtre de détection des doublons de la file de tâches) est ignorée et journalisée comme erreur, et la fenêtre par défaut continue de s’appliquer.',
        },
        quotas: {
          label: 'Quotas de lignes',
          help: 'Nombre maximal de lignes par objet : { "<object>": 1000000 }. Un dépassement déclenche une alerte de gouvernance — les quotas ne suppriment jamais au-delà de la politique déclarée.',
        },
        quota_defaults: {
          label: 'Quotas par défaut par classe',
          help: 'Quotas de repli par classe de cycle de vie : { "telemetry": 1000000, "transient": 500000, "event": 100000, "audit": 5000000 }.',
        },
        growth_alert_rows: {
          label: 'Seuil d’alerte de croissance (lignes par passage)',
          help: 'Alerte lorsqu’une table déclarant un cycle de vie gagne plus que ce nombre de lignes entre deux passages. 0 désactive les alertes de croissance.',
        },
      },
    },
  },
};
