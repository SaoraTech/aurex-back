# Aurex Backend — Consolidation ElevenLabs & Cloudflare R2

Ce document synthétise les travaux d'audit, de correction et d'intégration réalisés sur le backend V1 d'Aurex.

## 1. Corrections Fondamentales et Vulnérabilités Résolues

1. **Erreur de compilation dans `src/chat/chat.service.ts` :**
   - Remplacement de l'import erroné `TooManyRequestsException` depuis `@nestjs/common` par `HttpException(..., HttpStatus.TOO_MANY_REQUESTS)`.
2. **Erreur de syntaxe dans `src/db/schema.ts` :**
   - Correction d'une parenthèse superflue sur la table `notificationPreference`.
3. **Conflit de dépendances résolu :**
   - Résolution du conflit de version entre `@better-auth/drizzle-adapter` et `drizzle-orm`.

---

## 2. Intégration ElevenLabs (Audio & Voix)

- **Module :** `src/audio/` (`AudioModule`, `AudioService`, `AudioController`).
- **Fournisseur officiel prioritaire :** ElevenLabs REST API (`/v1/text-to-speech/{voice_id}`).
- **Fournisseur de repli automatique :** `GroqSpeechService` (TTS via `playai-tts` et STT via `whisper-large-v3-turbo`).
- **Résilience :** Si ElevenLabs renvoie une erreur temporaire (503, 429 quota, timeout), le backend bascule automatiquement sur Groq pour garantir une disponibilité continue aux utilisateurs.
- **Sécurité :**
  - Validation de la longueur du texte (max 4 000 caractères configurables via `AUDIO_MAX_TTS_CHARS`).
  - Validation stricte des types MIME (`audio/webm`, `audio/wav`, `audio/mpeg`, etc.) et de la taille maximale des fichiers audio (25 Mo par défaut).
  - Routes protégées par `RequireUserGuard`.

---

## 3. Intégration Cloudflare R2 (Stockage d'Objets Privé)

- **Module :** `src/storage/` (`StorageModule`, `StorageService`, `StorageController`).
- **Technologie :** AWS SDK v3 S3 Client (`@aws-sdk/client-s3` et `@aws-sdk/s3-request-presigner`).
- **Isolation stricte et protection anti-IDOR/BOLA :**
  - Tout objet est impérativement préfixé par l'identifiant de l'utilisateur : `{userId}/{objectId}-{sanitizedFilename}`.
  - La méthode `assertOwnership(userId, key)` vérifie systématiquement que la clé commence par `{userId}/` et rejette toute tentative de traversée de répertoire (`..`, `/`, `\`).
- **Liens présignés temporaires :**
  - Téléversement (PUT) : 15 minutes.
  - Téléchargement (GET) : 60 minutes.
- **Bucket privé :** Aucun objet n'est rendu public par défaut.

---

## 4. Identité Officielle et Centralisée d'Aurex

- **Module :** `src/identity/aurex-identity.ts`.
- **Source de vérité :**
  - Concepteur officiel : Fousseyni DIALLO.
  - Organisation : Saora.
  - Vocation : Assistant conversationnel spécialisé dans les mathématiques, dédié aux étudiants de l'enseignement supérieur (particulièrement en Afrique de l'Ouest).
  - Pédagogie : Rigueur mathématique, explication étape par étape, notation LaTeX standard ($...$, $$...$$), autonomie intellectuelle.
- **Séparation étanche des 6 dimensions :**
  1. Faits officiels immuables.
  2. Principes pédagogiques et de comportement.
  3. Capacités techniques réelles du backend.
  4. Fournisseurs sous-jacents (transparents pour l'utilisateur).
  5. Préférences personnelles de l'apprenant.
  6. Contexte conversationnel.
