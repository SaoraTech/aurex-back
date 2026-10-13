# Aurex API V1 & V1.1 (Routes et Contrats d'Interface)

Base path : `/api/v1`. Authentication routes : `/api/auth/*` (Better Auth).

| Méthode | Chemin | Description / Rôle | Auth Requise |
|---|---|---|---|
| GET | `/health` | Liveness check du backend | Non |
| GET | `/health/ready` | PostgreSQL readiness (Neon) | Non |
| GET | `/plans` | Liste des plans configurés (Free, Plus, Pro) | Non |
| GET/POST | `/conversations` | Lister / Créer des conversations | Oui |
| GET | `/conversations/:id/messages` | Messages d'une conversation appartenant à l'utilisateur | Oui |
| DELETE | `/conversations/:id` | Supprimer une conversation possédée | Oui |
| POST | `/chat/messages` | Envoi d'un message avec identité officielle Aurex et routage IA | Oui |
| GET | `/ai/models` | Modèles autorisés selon l'abonnement actif | Oui |
| POST | `/math/compute` | Calcul symbolique et résolution (Wolfram\|Alpha) | Oui |
| GET | `/audio/status` | Statut des fournisseurs audio (ElevenLabs, Groq) | Oui |
| POST | `/audio/speech` | Synthèse vocale TTS (ElevenLabs officiel + repli Groq) | Oui |
| POST | `/audio/transcriptions` | Transcription vocale STT (Whisper multipart upload) | Oui |
| GET | `/storage/status` | Statut de la configuration Cloudflare R2 | Oui |
| POST | `/storage/presigned-upload` | Générer une URL présignée de téléversement privé R2 (anti-IDOR) | Oui |
| POST | `/storage/presigned-download` | Générer une URL présignée de téléchargement privé R2 (durée limitée) | Oui |
| DELETE | `/storage/objects` | Supprimer un objet R2 appartenant à l'utilisateur | Oui |
| GET | `/storage/objects/metadata` | Métadonnées de l'objet (taille, MIME, date) | Oui |
| GET | `/memory` | Lister les préférences et contexte de mémoire persistante | Oui |
| POST | `/memory` | Créer une entrée de mémoire persistante | Oui |
| PATCH/DELETE | `/memory/:id` | Mettre à jour / supprimer une entrée de mémoire | Oui |
| GET/POST | `/artifacts` | Lister / créer des artefacts de code et documents versionnés | Oui |
| GET/POST | `/artifacts/:id/versions` | Lister / ajouter des versions à un artefact | Oui |
| GET | `/library/documents` | Consulter les métadonnées de la bibliothèque | Oui |
| GET | `/billing/history` | Historique des paiements et souscriptions | Oui |
| POST | `/billing/checkout` | Initialisation de paiement (désactivé jusqu'à validation adaptateur) | Oui |
| GET | `/privacy/export` | Export complet des données utilisateur JSON (RGPD) | Oui |
| POST | `/privacy/delete-account` | Enregistrement de la demande de suppression définitive | Oui |

### Sécurité du stockage privé (Cloudflare R2)
- Toutes les clés créées côté serveur suivent strictement le format : `{userId}/{objectId}-{sanitizedFilename}`.
- Tout appel de téléchargement ou suppression vérifie l'appartenance du préfixe `userId/` pour neutraliser les failles IDOR/BOLA.
- Les URLs d'upload expirent en 15 minutes, celles de téléchargement en 60 minutes.

### Synthèse & Transcription vocale (Audio)
- La synthèse utilise ElevenLabs (`eleven_multilingual_v2`) comme fournisseur officiel prioritaire.
- En cas de panne temporaire ou d'absence de clé, le backend bascule automatiquement sur Groq TTS (`playai-tts`).
- La transcription utilise Whisper Large V3 via Groq pour une latence minimale et une grande précision sur le français et les accents d'Afrique de l'Ouest.
