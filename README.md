# Aurex Backend V1 — Neon / Drizzle / Better Auth

API centrale NestJS + TypeScript pour Aurex Web, Android/Kotlin, iOS/Swift, React Native/Expo et Desktop/Electron.

## Architecture

- NestJS modulaire, TypeScript, API REST documentée avec Swagger.
- PostgreSQL managé par Neon, accès SQL via Drizzle ORM et migrations versionnées.
- Better Auth pour les sessions web et le Bearer plugin pour les clients natifs.
- Conversations et messages ; routage IA en fonction du plan, contrôlé côté serveur.
- Free : Kimi, Qwen, DeepSeek et Grok (identifiants de modèles configurables).
- Plus/Pro : Gemini et Groq pour la génération de réponses.
- Voix : ElevenLabs (TTS/STT) exposé via `/audio/*`, repli Groq contrôlé ; stockage privé Cloudflare R2 via `/library/*` ; recherche web/approfondie Tavily via `/research/*` et `webSearch` du chat ; sécurité applicative Arcjet ; identité d'Aurex centralisée. Détails : `docs/INTEGRATIONS.md`. Rapport d'audit : `docs/AUDIT.md`.
- Wolfram|Alpha pour les calculs ; abonnements/quota configurables ; abstraction paiement désactivée tant que le fournisseur n'est pas validé.
- Mémoire persistante, artefacts versionnés, métadonnées de bibliothèque, demandes de confidentialité, audit et adaptateur Novu facultatif.

## Démarrage local

1. Installer Node.js **22.21+** (requis par le SDK Arcjet).
2. Créer un projet/base PostgreSQL dans Neon et copier la chaîne de connexion **pooled** depuis le tableau de bord Neon. Garder `sslmode=require` et ne jamais committer de vraies clés.
3. `cp .env.example .env`, puis renseigner `DATABASE_URL`, un `BETTER_AUTH_SECRET` aléatoire d'au moins 32 caractères, et les clés des fournisseurs voulus.
4. `npm install`
5. `npm run db:generate` pour générer les migrations correspondant au schéma ; relire les fichiers SQL générés.
6. `npm run db:migrate`
7. `npm run start:dev`
8. Swagger : `http://localhost:3000/docs` ; health : `http://localhost:3000/api/v1/health`.

Ne pas utiliser `db:push` en production. Les migrations doivent être relues et appliquées d'abord sur une base de test.

## Routage des modèles

- `POST /api/v1/chat/messages` accepte un champ facultatif `model` (`kimi`, `qwen`, `deepseek`, `grok`, `gemini`, `groq`). Le backend vérifie le modèle autorisé pour le plan effectif avant l'appel fournisseur.
- `GET /api/v1/ai/models` retourne les modèles permis pour l'utilisateur connecté.
- Free utilise les quatre modèles Free ; Plus/Pro utilisent Gemini et Groq. Les modèles par défaut et leurs noms API sont configurables via `.env`.
- Les clés restent exclusivement côté backend. Les fournisseurs OpenAI-compatible utilisent leurs endpoints REST configurés ; les noms de modèle et les droits d'accès varient selon le compte et peuvent changer.
- Le plan effectif est dérivé d'un abonnement actif stocké en base ; le plan fourni par le client n'est pas utilisé. Les règles de période doivent être vérifiées pour les abonnements sans date de fin avant production.

## Limites à valider avant production

Ce dépôt est une base d'implémentation, pas une certification de production. Exécuter installation, build, tests et migrations dans un environnement avec accès réseau avant déploiement. Vérifier l'accès API et les modèles réels pour chaque fournisseur, la facturation, les quotas, la gestion des erreurs et les coûts.

- Les tarifs/quotas de `.env.example` sont provisoires et configurables.
- Les paiements restent désactivés par défaut. Aucun prestataire ne doit être activé avant validation de l'éligibilité, signatures webhook, idempotence, remboursements et rapprochement.
- R2, ElevenLabs, Tavily et Arcjet sont implémentés mais **non testés contre les services réels** ; Novu, Resend et les paiements ne sont pas implémentés. Aucune analyse antivirus des fichiers n'existe.
- L'export JSON et la demande de suppression ne remplacent pas une procédure complète de conformité et d'effacement vérifiable.
- Le limiteur local (secours/dev) est par instance : en production multi-instance, Arcjet est le contrôle effectif ; le dépôt n'a pas été compilé ni testé avec les vraies dépendances (voir `docs/AUDIT.md` §6).
- La connexion Neon doit être testée depuis l'environnement de déploiement ; ne pas désactiver la validation TLS de manière générale.

## Principes de sécurité

- Autorisation côté serveur à chaque lecture/écriture.
- Le client ne choisit jamais son plan, quota, montant facturé ou état de paiement.
- Secrets uniquement dans les variables d'environnement/gestionnaire de secrets, jamais dans les applications clientes.
- Ne pas enregistrer les prompts, secrets ou données privées dans les logs.
- Migrations versionnées ; aucun changement destructif sans sauvegarde et revue.
