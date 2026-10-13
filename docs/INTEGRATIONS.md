# Intégrations : comportement réel, configuration, limites

## Identité d'Aurex (`src/identity/`)
`aurex-identity.ts` est la source de vérité versionnée (`AUREX_IDENTITY_VERSION`). Six catégories, jamais mélangées, chacune dans sa section du contexte modèle :
1 faits officiels · 2 comportement · 3 capacités réelles (calculées à l'exécution) · 4 fournisseurs configurés · 5 données utilisateur (mémoire épinglée, traitée comme **donnée**) · 6 contexte de conversation.
Les informations non fournies (date de création, statut juridique de Saora, titres…) sont listées dans `NOT_PROVIDED` : le modèle doit répondre qu'il ne les connaît pas.
`GET /api/v1/identity` (public, sans secret) expose faits, capacités et états. « configured » = clés présentes, **pas** « vérifié par appel ».
Le chat n'utilise **pas** Wolfram|Alpha automatiquement : le prompt l'indique, Aurex ne doit donc pas prétendre avoir vérifié par calcul formel.

## Arcjet (`src/security/`)
- Politique centrale `arcjet.policies.ts` : une catégorie par type de route (`signup`, `auth`, `chat`, `math`, `research`, `deep_research`, `tts`, `stt`, `upload`, `files`, `read`, `public`, `default`, `exempt`).
- Chaque route déclare `@Protect('<catégorie>')`. `ProtectGuard` (global) authentifie d'abord les catégories utilisateur, puis appelle Arcjet avec l'**id utilisateur de la session** (jamais un id client) + limite IP. Les routes sans décorateur prennent la politique `default`.
- `/api/auth/*` (hors routeur Nest) est protégé par un middleware Express (`signup` plus strict que `auth`).
- Règles : Shield partout ; détection de bots sur les routes publiques/auth uniquement. **Les clients natifs (OkHttp, URLSession) sont des clients « programmatiques »** : `ARCJET_BOT_ALLOW=CATEGORY:PROGRAMMATIC` les autorise ; retirez-le seulement pour des routes consommées exclusivement par navigateur.
- Le SDK `@arcjet/*` est ESM-only alors que le projet compile en CommonJS : chargement par `import()` natif ; Node ≥ 22.21.
- **Indisponibilité d'Arcjet** : erreur de configuration → échec au démarrage en production ; décision `ERROR`/exception → limiteur local **dégradé (50 %)** pour les routes coûteuses (jamais « tout autoriser ») ; `ARCJET_FAIL_MODE=deny` → 503 ; lectures peu risquées → autorisées. Distinction tracée en logs/métriques (`aurex_arcjet_decisions_total`).
- Mode `disabled` : limiteur local seul (par instance), avertissement au démarrage ; refusé en production sauf `ARCJET_ALLOW_DISABLED_IN_PRODUCTION=true`.
- IP : `TRUSTED_PROXIES` configure `trust proxy` Express **et** Arcjet. Vide = adresse socket (non falsifiable) ; derrière un load balancer, **obligatoire**.
- Les clés Arcjet ne protègent que les routes qui passent par ce chemin ; `/health*` et `/metrics` sont volontairement exemptés (`exempt`, `/metrics` protégé par jeton).

## ElevenLabs + repli Groq (`src/audio/`)
- `POST /api/v1/audio/speech` `{ text, languageCode? }` → flux `audio/mpeg`. Voix, modèle et format viennent **uniquement** de la configuration serveur (le DTO rejette toute autre propriété).
- `POST /api/v1/audio/transcriptions?languageCode=fr` : octets audio dans le corps. Le conteneur est identifié **par les octets** (webm/ogg/wav/flac/mp3/m4a) ; le `Content-Type` client est ignoré. Aucun fichier temporaire n'est écrit sur disque (tampon mémoire libéré avec la requête).
- Quotas par forfait (caractères TTS/jour, transcriptions/jour) via `provider_usage` ; plafond de texte et de taille.
- Repli : STT ElevenLabs → Groq Whisper (par défaut) ; TTS → Groq **seulement** si `AUDIO_TTS_FALLBACK_PROVIDER=groq` et Groq activé. Le repli n'a lieu que pour des pannes **fournisseur** (timeout, quota, 429, 5xx, auth, réponse invalide) — jamais pour une entrée invalide (aucun second appel facturé). Aucun retry.
- En-têtes `X-Aurex-Audio-Provider` / `X-Aurex-Audio-Fallback` indiquent le fournisseur réel.

## Cloudflare R2 (`src/storage/`, `src/library/`)
- Bucket **privé** ; aucun `R2_PUBLIC_BASE_URL`. Clés générées côté serveur : `users/<userId>/<uuid>`. La propriété est vérifiée en base (`library_document`), pas dans le chemin fourni par le client.
- `POST /library/documents` (octets bruts + `X-File-Content-Type`, `X-File-Name` encodé URL), `GET /library/documents[/:id]`, `GET /library/documents/:id/download-url` (URL présignée 30 s–1 h, `attachment`), `DELETE /library/documents/:id`.
- Types autorisés : PDF, texte UTF-8, JPEG, PNG, WebP, DOCX/PPTX/XLSX — **signature d'octets vérifiée**. Limites : par fichier (forfait, plafonné par `UPLOAD_MAX_BYTES`) et espace total par forfait.
- **Risque fichiers malveillants** : seule la cohérence type/octets est contrôlée. **Il n'existe ni antivirus ni analyse de contenu.** Un PDF/Office valide peut contenir du contenu actif ; les fichiers sont servis en téléchargement forcé et jamais interprétés par le backend. Ajouter une analyse (ex. ClamAV/service tiers) avant tout traitement automatique.
- Compensation : si l'insertion en base échoue après l'envoi, l'objet est supprimé. Un crash entre les deux étapes pourrait laisser un orphelin (à balayer par un job).
- Hors périmètre : téléversement direct client→R2 (URL présignée PUT) pour les gros fichiers ; suppression R2 à la suppression de compte (`removeAllForUser` disponible, non branché).

## Tavily (`src/research/`)
API officielle utilisée : `POST https://api.tavily.com/search` et `/extract` (Bearer). La recherche approfondie est orchestrée **par Aurex** (budget maîtrisé) plutôt que par l'endpoint asynchrone `/research` de Tavily.
- Chat : `webSearch: 'off' | 'on' | 'auto'` (défaut `off`). `auto` ne déclenche que sur indices explicites (« aujourd'hui », « dernières », « cherche sur le web »…). Une seule recherche standard, sans LLM.
- `POST /research/search` (sans LLM) et `POST /research/deep` : planification de requêtes (JSON validé, repli sur la question), recherches plafonnées (standard ≤ 3, approfondie ≤ `RESEARCH_MAX_SEARCHES`), déduplication par URL normalisée, extraction des meilleures pages (approfondie), synthèse avec citations `[S1]…` ; les citations inconnues sont supprimées ; couverture et échecs renvoyés.
- Jamais de réponse « vérifiée par le Web » sans recherche réelle : échec total → 503 sans synthèse ; en chat, l'échec est signalé au modèle et au client (`webSearch.performed=false`, `failureCode`).
- **Contenu web = donnée non fiable** : bloc `<donnees_web_non_fiables>` ajouté au tour utilisateur courant uniquement (jamais persisté comme texte utilisateur, jamais dans le prompt système), balises de clôture neutralisées, taille bornée, règle explicite dans le prompt. Le modèle n'a **aucun outil** : un texte web ne peut déclencher aucune action privilégiée. Aucun code de page n'est exécuté ; aucune URL fournie par l'utilisateur n'est extraite.
- Coûts : pas de retry (facturation par crédit), cache mémoire par paramètres exacts (TTL 600 s, 120 s pour l'actualité), quotas quotidiens par forfait, délai global `RESEARCH_DEADLINE_MS`, timeouts par appel.

## Fournisseurs d'IA (`src/ai/`)
Conservés : Gemini, Groq, Kimi, Qwen, DeepSeek, Grok. Ajoutés : timeouts configurables, erreurs typées (`not_configured`, `invalid_request`, `auth`, `rate_limited`, `quota`, `timeout`, `unavailable`, `bad_response`), repli contrôlé dans les modèles **autorisés par le forfait** (≤ `AI_MAX_FALLBACKS`), fournisseur effectif et `fallbackFrom` renvoyés, latence et tokens enregistrés. Un modèle demandé non autorisé → 400 sans appel.

## Observabilité
Logs JSON (`LOG_LEVEL`), redaction des clés/jetons, `X-Request-Id` (accepté s'il est court et sûr). Le contenu des messages et les requêtes ne sont jamais journalisés. `GET /api/v1/metrics` (Prometheus, jeton `METRICS_TOKEN`, 404 sinon) : appels fournisseurs par résultat, latences, décisions Arcjet, cache Tavily. Compteurs **par instance**. `/health/ready` : DB réelle (503 si indisponible) + états « configured » (sans appel payant).
