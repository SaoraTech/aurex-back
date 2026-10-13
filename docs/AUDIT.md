# Audit du Backend V1 d'Aurex — rapport initial et état consolidé

> Méthode : lecture intégrale du code du ZIP (≈1 140 lignes, 63 fichiers `.ts`), sans se fier au README ni aux rapports antérieurs.
> Limite essentielle : **l'environnement d'audit n'avait pas d'accès réseau** (registre npm injoignable). `npm install`, `nest build`, `jest`,
> les migrations et tout appel fournisseur n'ont donc **pas** pu être exécutés. Voir §6 pour ce qui a été réellement vérifié.

## 1. Architecture initiale

NestJS 11 / TypeScript (CommonJS) · Drizzle ORM + `pg` (Neon) · Better Auth (cookies + plugin Bearer) · Zod pour l'environnement.
Chemin d'une requête : Express → Helmet/CORS → `app.use('/api/auth', toNodeHandler(auth))` → body parsers → `ThrottlerGuard` global (en mémoire, 90/min/IP) →
`RequireUserGuard` (session Better Auth) → contrôleur → service → Drizzle. Chat : quota quotidien → conversation → insertion du message → `AiOrchestrator` (un seul fournisseur selon le plan) → insertion de la réponse.

## 2. Points forts conservés

Modules cohérents ; plan effectif dérivé de la base (jamais du client) ; identifiant utilisateur toujours issu de la session ; contrôle de propriété sur conversations/mémoire/artefacts (`and(id, userId)`) ;
secrets validés par Zod au démarrage ; Helmet + CORS en liste blanche ; ValidationPipe `whitelist + forbidNonWhitelisted` ; table `privacy_request`, `audit_event`, versionnage d'artefacts ; schéma de plans configurable.

## 3. Défauts et vulnérabilités constatés

| # | Gravité | Constat | Traitement |
|---|---|---|---|
| 1 | **Bloquant** | `db/schema.ts` : parenthèse en trop (`}));`) — erreur de syntaxe TS1005, le projet ne compile pas | Corrigé |
| 2 | **Bloquant** | `TooManyRequestsException` n'existe pas dans `@nestjs/common` | Remplacé par `AppException` 429 typée |
| 3 | **Bloquant** | `import express from 'express'` sans `esModuleInterop` → `express.json` indéfini à l'exécution | `esModuleInterop: true` |
| 4 | Élevé | Better Auth monté via `app.use('/api/auth', …)` : Express retire le préfixe de `req.url`, risque de 404 sur le chemin de base | `app.all('/api/auth/*splat', …)` (forme documentée Better Auth/Express 5) — **à valider à l'exécution** |
| 5 | Élevé | Seule protection : Throttler en mémoire, par IP, sans Shield/bot, sans trust-proxy (IP forgeable ou IP du load balancer partagée) | Arcjet réel + limiteur local + `TRUSTED_PROXIES` |
| 6 | Élevé | Aucun prompt système dans le chat : l'identité d'Aurex n'existait que dans un prompt par défaut de Gemini ; les autres fournisseurs n'en avaient aucun | Source de vérité d'identité centralisée |
| 7 | Élevé | Aucun repli entre fournisseurs malgré le mandat (Groq) ; pas de timeout Gemini | Orchestrateur avec repli contrôlé + timeouts |
| 8 | Moyen | `getEffectivePlan` dupliqué (chat, ai.controller) ; tri `ORDER BY updatedAt` ascendant → renvoie l'**abonnement le plus ancien** | Centralisé dans `PlansService`, tri corrigé, plus haut forfait prioritaire |
| 9 | Moyen | Quota mensuel défini mais jamais appliqué ; quota quotidien sur l'heure locale du serveur ; une génération échouée consommait le quota | UTC, mensuel appliqué, unité = réponse livrée |
| 10 | Moyen | Idempotence non atomique : deux requêtes concurrentes même `requestId` créent deux messages ; retry après échec dupliquait le message utilisateur | Index unique partiel + réutilisation du message + 409 |
| 11 | Moyen | `getMessages` renvoyait les 500 **plus anciens** messages ; le contexte IA prenait donc l'historique ancien des longues conversations | Fenêtre des plus récents |
| 12 | Moyen | Pool `pg` jamais fermé ; pas de handler `error` (un client inactif fermé par Neon peut tuer le process) | `onModuleDestroy` + handler |
| 13 | Moyen | `/health/ready` : une panne DB donnait un 500 brut | 503 typé, timeout 3 s |
| 14 | Moyen | Erreurs fournisseurs : tout échec = 503 générique, impossible de distinguer entrée invalide / quota / panne | `ProviderError` typée + mapping HTTP |
| 15 | Moyen | `GroqSpeechService` / `MathService` : tout `!ok` = 503 ; Wolfram 501 (« pas de réponse courte ») traité comme panne | Typé ; 501 → 422 |
| 16 | Moyen | Export RGPD en N+1 requêtes ; routes de bibliothèque `registerMetadata` = `NotImplemented` ; `AuditService` jamais appelé ; `R2_PUBLIC_BASE_URL` dans `.env.example` (encourage un bucket public) | Corrigé / branché / supprimé |
| 17 | Faible | Pas de corrélation de requêtes, pas de logs structurés, pas de métriques | Ajoutés |
| 18 | Info | `@google/generative-ai` est le SDK historique de Google ; conservé (pas de remplacement sans justification) mais à planifier | Documenté |
| 19 | Info | `NOVU`, `RESEND`, paiements : variables présentes, **aucun adaptateur actif** | Jamais présentés comme actifs (`not_implemented`) |

## 4. Intégrations : état initial

Opérationnelles (en code, non vérifiées par appel réel) : Gemini, Groq/Kimi/Qwen/DeepSeek/Grok (génération), Wolfram|Alpha (`/math/compute`), Better Auth.
Squelettes : voix Groq (aucune route HTTP), bibliothèque (métadonnées sans stockage), Novu/Resend/paiements (désactivés).
Absentes : Arcjet, ElevenLabs, Cloudflare R2, Tavily, identité produit, observabilité.

## 5. Patch ElevenLabs + R2 fourni : analyse

Le patch a été écrit pour **une autre base** : il suppose `AuthMiddleware`/`req.user`, `WolframModule`, `ARCJET_KEY` en variable brute, et son `app.module.ts`, `main.ts`, `env.ts` et `package.json` **remplaceraient** ceux du V1 en supprimant modules, variables et dépendances (`@nestjs/throttler`, `@google/generative-ai`, `drizzle-kit`…).

| Élément du patch | Décision |
|---|---|
| `@Controller('api/v1/audio')` / `('api/v1/storage')` | **Faille de routage** : le préfixe global `api/v1` s'y ajoute → `/api/v1/api/v1/audio`. Contrôleurs réécrits (`audio`, `library`) |
| Auth par `AuthMiddleware` + `req.user` (inexistants dans V1) | Remplacé par `ProtectGuard` + `RequireUserGuard` (`req.aurexUser`) |
| Cache TTS global (hash du texte) dans R2 | **Non conservé** : un utilisateur pouvait déduire (via `X-Aurex-Audio-Cache: HIT`) qu'un texte précis avait été vocalisé par un autre (fuite par inférence d'appartenance) ; croissance non bornée sans règle de cycle de vie. Le coût TTS est maîtrisé par quotas |
| Stockage `/storage/*` sans catalogue, propriété encodée dans la clé | **Dédupliqué** : `StorageService` (R2 bas niveau) + `LibraryService` (propriété en base via `library_document`, ID serveur UUID, 404 identique pour « absent » et « à autrui ») |
| URL présignée jusqu'à 7 jours, rendu en ligne | Plafond 1 h (défaut 5 min), `Content-Disposition: attachment` |
| Validation de type partielle (pas de WebP/texte, MIME STT déclaré par le client) | Signatures d'octets pour tous les types ; audio identifié **par les octets** |
| Duplication Groq STT (`fetch` direct) | Réutilise `GroqSpeechService` existant (une seule implémentation) |
| Normalisation maths en anglais seulement, `x^2` → « x 2 » | FR/EN, puissances préservées, langue par défaut `fr` |
| `ELEVENLABS_ENABLED`, validation Zod `superRefine` | **Conservé** et étendu |
| ElevenLabs : modèles `eleven_multilingual_v2` / `scribe_v2`, `output_format`, `language_code` non envoyé à `multilingual_v2` | **Conservé** (confirmé par la documentation officielle) |
| Absence de client S3 « checksum WHEN_REQUIRED » | Ajouté (incompatibilité connue des SDK AWS récents avec R2) |

## 6. Ce qui a été vérifié — et ce qui ne l'a pas été

**Vérifié :**
- Analyse syntaxique TypeScript de **106 fichiers** : 0 erreur (avant : 1 erreur bloquante).
- **90 tests unitaires exécutés** (13 fichiers de spec) avec un harnais local : exécuteur de tests minimal + *stubs* de `@nestjs/common`, `zod` (partiel), `drizzle`, `@aws-sdk/*`. Ils valident la logique métier (repli, quotas, validation, injection web, mapping d'erreurs, Arcjet avec SDK simulé…) mais **pas** l'intégration réelle des bibliothèques.

**Non vérifié (à faire dans un environnement avec réseau) :**
1. `npm install`, `nest build` (typage complet contre les vraies bibliothèques), `jest` réel.
2. `src/config/env.spec.ts` (nécessite Zod réel) et les tests de `LibraryService`/`ChatService`/guards (non écrits : ils exigent une base ou des *mocks* Drizzle plus lourds).
3. Migrations : **aucune migration n'existait dans le ZIP** et `drizzle-kit` n'a pas pu s'exécuter. Les changements de schéma (voir §7) exigent `npm run db:generate` puis revue du SQL.
4. Tous les appels fournisseurs réels (Arcjet, ElevenLabs, R2, Tavily, LLM).
5. Noms d'API Arcjet (`@arcjet/node` v1 : `arcjet`, `shield`, `detectBot`, `slidingWindow`, `protect`) — écrits d'après la documentation officielle, non compilés ; vérifier la version avec `npm view @arcjet/node version`.
6. Le montage Better Auth via `app.all('/api/auth/*splat')`.

## 7. Modifications du schéma (migration à générer)

`message` : + `model`, `latency_ms`, `sources` (jsonb), index unique partiel `message_idempotency_uq (conversation_id, request_id, role) WHERE request_id IS NOT NULL`.
`library_document` : + `sha256`, statut par défaut `stored`, index unique `library_object_key_uq`.
Nouvelle table `provider_usage` (quotas et suivi des coûts). **Avant d'appliquer l'index unique `message_idempotency_uq` sur une base existante, vérifier l'absence de doublons.**

## 8. Éléments nécessitant une décision ou un secret que je n'ai pas

Clés/IDs : `ARCJET_KEY`, `ELEVENLABS_API_KEY` + **voix** (`ELEVENLABS_TTS_VOICE_ID`, choix produit pour le français d'Afrique de l'Ouest), identifiants R2 + création du bucket **privé**, `TAVILY_API_KEY`.
Décisions : quotas par forfait (valeurs provisoires), politique `ARCJET_FAIL_MODE`, activer ou non le repli TTS Groq (disponibilité du modèle non vérifiée), appel automatique de Wolfram|Alpha dans le chat (non fait : décision produit/coût), nom exact du SDK Gemini à migrer (`@google/genai`), règle de rétention/suppression R2 à la suppression de compte (méthode `LibraryService.removeAllForUser` prête, **non branchée** car la suppression de compte reste un traitement opérateur).
Informations non fournies sur Saora (date de création, statut juridique…) : signalées comme inconnues dans l'identité d'Aurex.
