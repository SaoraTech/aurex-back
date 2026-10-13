import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AppException, tooManyRequests } from '../common/errors';
import { ProviderError, providerErrorToHttp } from '../common/provider-error';
import { IdentityService } from '../identity/identity.service';
import { UsageService, startOfUtcDay } from '../observability/usage.service';
import { PlanName, PlansService } from '../plans/plans.service';
import { renderWebBlock, normalizeUrl, shouldSearchWeb, stripUnknownCitations, WEB_TAG } from './prompt-safety';
import { TavilyService } from './tavily.service';
import { WebBundle, WebSearchSummary, WebSource } from './research.types';

const PlanSchema = z.object({ queries: z.array(z.string().min(3).max(200)).min(1).max(8) });

@Injectable()
export class WebResearchService {
  private readonly logger = new Logger(WebResearchService.name);
  constructor(
    private readonly tavily: TavilyService, private readonly ai: AiOrchestratorService, private readonly identity: IdentityService,
    private readonly plans: PlansService, private readonly usage: UsageService, private readonly config: ConfigService,
  ) {}

  isAvailable() { return this.tavily.isConfigured(); }

  /** Plain search, no LLM. Counts against the daily web-search quota. */
  async search(userId: string, input: { query: string; topic?: 'general' | 'news'; timeRange?: 'day' | 'week' | 'month' | 'year' }, requestId?: string) {
    await this.assertQuota(userId, 'web_search', 1, 'dailyWebSearches');
    const bundle = await this.gather(userId, [input.query], { topic: input.topic, timeRange: input.timeRange }, 5, 0, requestId);
    if (bundle.failureCode) throw new AppException(503, bundle.failureCode, 'La recherche web est indisponible.');
    return { queries: bundle.queries, sources: bundle.sources.map(({ extract, ...s }) => s), coverage: bundle.coverage };
  }

  /**
   * Lightweight context for a chat turn: at most ONE standard search, no LLM planning. Never throws for provider
   * problems: the failure is reported so the model and the UI state honestly that no web check happened.
   */
  async chatContext(userId: string, question: string, mode: 'off' | 'on' | 'auto', requestId?: string): Promise<{ summary: WebSearchSummary; block?: string }> {
    const requested = mode === 'on' || (mode === 'auto' && shouldSearchWeb(question));
    const none = (failureCode?: string): { summary: WebSearchSummary } => ({ summary: { requested, performed: false, queries: [], sources: [], failureCode } });
    if (!requested) return none();
    if (!this.tavily.isConfigured()) return none('WEB_SEARCH_NOT_CONFIGURED');
    try { await this.assertQuota(userId, 'web_search', 1, 'dailyWebSearches'); }
    catch (e) { if (e instanceof AppException) return none(e.code); throw e; }
    const bundle = await this.gather(userId, [question], {}, 5, 0, requestId);
    if (bundle.failureCode || !bundle.sources.length) return none(bundle.failureCode ?? 'WEB_SEARCH_NO_RESULTS');
    return {
      summary: { requested, performed: true, queries: bundle.queries, sources: bundle.sources.map(s => ({ id: s.id, url: s.url, title: s.title, publishedDate: s.publishedDate })), coverage: bundle.coverage },
      block: renderWebBlock(bundle.sources),
    };
  }

  /** Bounded multi-step research: plan queries → search → dedupe → extract top pages → synthesise with citations. */
  async deepResearch(userId: string, plan: PlanName, input: { question: string; depth?: 'standard' | 'deep' }, requestId?: string) {
    const deep = input.depth === 'deep';
    await this.assertQuota(userId, 'deep_research', 1, 'dailyDeepResearch');
    const deadline = Date.now() + (this.config.get<number>('researchDeadlineMs') ?? 60000);
    const ceiling = this.config.get<number>('researchMaxSearches') ?? 5;
    const maxSearches = Math.min(deep ? ceiling : Math.min(3, ceiling), ceiling);
    const queries = await this.planQueries(plan, input.question, maxSearches);
    const maxExtracts = deep ? this.config.get<number>('researchMaxExtracts') ?? 3 : 0;
    const bundle = await this.gather(userId, queries, {}, deep ? 8 : 5, maxExtracts, requestId, deadline);
    await this.usage.record({ userId, kind: 'deep_research', provider: 'tavily', units: 1, outcome: bundle.failureCode ? 'error' : 'ok', requestId });
    // Never synthesise "verified" answers without real results.
    if (bundle.failureCode || !bundle.sources.length) throw new AppException(503, bundle.failureCode ?? 'WEB_SEARCH_NO_RESULTS', "Aucune source web n'a pu être obtenue ; aucune réponse vérifiée par le Web ne peut être produite.");

    const system = this.identity.buildSystemInstruction({
      conversation: { subject: 'recherche' },
      web: { requested: true, performed: true, sourceCount: bundle.sources.length },
    });
    const prompt = `Question de l'utilisateur :\n${input.question}\n\nRédige une réponse synthétique et rigoureuse fondée UNIQUEMENT sur les sources ci-dessous, avec des citations [S1], [S2]… Signale les contradictions et les limites de couverture.\n\n${renderWebBlock(bundle.sources)}`;
    const generated = await this.ai.generate(plan, [{ role: 'user', content: prompt }], undefined, { systemInstruction: system, temperature: 0.2 });
    const { text, cited } = stripUnknownCitations(generated.text, new Set(bundle.sources.map(s => s.id)));
    return {
      answer: text, provider: generated.provider, model: generated.model, fallbackFrom: generated.fallbackFrom,
      sources: bundle.sources.map(({ extract, snippet, ...s }) => ({ ...s, cited: cited.includes(s.id) })),
      queries: bundle.queries, coverage: bundle.coverage,
      notes: bundle.coverage.queriesFailed || bundle.coverage.extractionsFailed || bundle.coverage.truncated ? 'Couverture partielle : certaines recherches ou extractions ont échoué ou ont été limitées.' : undefined,
    };
  }

  private async planQueries(plan: PlanName, question: string, max: number): Promise<string[]> {
    const fallback = [question.trim().slice(0, 200)];
    if (max <= 1) return fallback;
    try {
      // Only the user's own question reaches the planner: no web content, no stored data.
      const r = await this.ai.generate(plan, [{ role: 'user', content: `Décompose cette question en au plus ${max} requêtes de recherche web courtes et distinctes. Réponds UNIQUEMENT par un JSON {"queries":["..."]}.\nQuestion : ${question.slice(0, 1000)}` }], undefined, { temperature: 0, maxOutputTokens: 400 });
      const raw = r.text.replace(/^```(?:json)?|```$/gim, '').trim();
      const parsed = PlanSchema.parse(JSON.parse(raw));
      const unique = [...new Set(parsed.queries.map(q => q.trim()))].slice(0, max);
      return unique.length ? unique : fallback;
    } catch (error) {
      this.logger.warn({ msg: 'research_plan_fallback', reason: error instanceof ProviderError ? error.kind : 'invalid_plan' });
      return fallback;
    }
  }

  private async gather(userId: string, queries: string[], opts: { topic?: 'general' | 'news'; timeRange?: 'day' | 'week' | 'month' | 'year' }, maxSources: number, maxExtracts: number, requestId?: string, deadline = Date.now() + 30000): Promise<WebBundle> {
    const coverage = { queriesPlanned: queries.length, queriesSucceeded: 0, queriesFailed: 0, extractionsFailed: 0, truncated: false };
    const merged = new Map<string, { hit: { url: string; title: string; content: string; score?: number; publishedDate?: string }; score: number }>();
    let lastFailure: string | undefined;
    for (const q of queries) {
      if (Date.now() >= deadline) { coverage.truncated = true; coverage.queriesFailed += 1; continue; }
      const started = Date.now();
      try {
        const { hits, cached } = await this.tavily.search({ query: q, topic: opts.topic, timeRange: opts.timeRange });
        if (!cached) await this.usage.record({ userId, kind: 'web_search', provider: 'tavily', units: 1, latencyMs: Date.now() - started, outcome: 'ok', requestId });
        coverage.queriesSucceeded++;
        for (const hit of hits) {
          const key = normalizeUrl(hit.url); if (!key) continue;
          const prev = merged.get(key);
          if (!prev || (hit.score ?? 0) > prev.score) merged.set(key, { hit, score: hit.score ?? 0 });
        }
      } catch (error) {
        coverage.queriesFailed++;
        const err = error instanceof ProviderError ? error : new ProviderError('tavily', 'unavailable', 'unexpected');
        lastFailure = err.kind === 'quota' ? 'WEB_SEARCH_QUOTA_EXCEEDED' : err.kind === 'not_configured' ? 'WEB_SEARCH_NOT_CONFIGURED' : 'WEB_SEARCH_UNAVAILABLE';
        await this.usage.record({ userId, kind: 'web_search', provider: 'tavily', units: 0, latencyMs: Date.now() - started, outcome: err.kind, requestId });
        this.logger.warn({ msg: 'tavily_search_failed', kind: err.kind });
      }
    }
    const ranked = [...merged.values()].sort((a, b) => b.score - a.score);
    if (ranked.length > maxSources) coverage.truncated = true;
    const sources: WebSource[] = ranked.slice(0, maxSources).map((r, i) => ({
      id: `S${i + 1}`, url: r.hit.url, title: r.hit.title || r.hit.url, snippet: r.hit.content, publishedDate: r.hit.publishedDate, score: r.score,
    }));
    if (maxExtracts > 0 && sources.length && Date.now() < deadline) {
      const targets = sources.slice(0, maxExtracts);
      try {
        const extracted = await this.tavily.extract(targets.map(s => s.url), queries[0]);
        const byUrl = new Map(extracted.map(e => [normalizeUrl(e.url), e.content]));
        for (const s of targets) { const c = byUrl.get(normalizeUrl(s.url)); if (c) s.extract = c; else coverage.extractionsFailed++; }
      } catch { coverage.extractionsFailed += targets.length; }
    } else if (maxExtracts > 0 && sources.length) coverage.truncated = true;
    return { queries, sources, coverage, failureCode: sources.length ? undefined : (coverage.queriesSucceeded ? 'WEB_SEARCH_NO_RESULTS' : lastFailure ?? 'WEB_SEARCH_UNAVAILABLE') };
  }

  private async assertQuota(userId: string, kind: 'web_search' | 'deep_research', needed: number, limitKey: 'dailyWebSearches' | 'dailyDeepResearch') {
    if (!this.tavily.isConfigured()) throw new AppException(503, 'WEB_SEARCH_NOT_CONFIGURED', "La recherche web n'est pas configurée sur ce serveur.");
    const plan = await this.plans.getEffectivePlan(userId);
    const used = await this.usage.sumSince(userId, kind, startOfUtcDay());
    if (used + needed > this.plans.getLimits()[plan][limitKey]) throw tooManyRequests(kind === 'web_search' ? 'WEB_SEARCH_QUOTA_EXCEEDED' : 'DEEP_RESEARCH_QUOTA_EXCEEDED', 'Quota quotidien de recherche atteint.');
  }
}
export { providerErrorToHttp, WEB_TAG };
