export interface WebSource {
  id: string;            // S1, S2, ...
  url: string; title: string; snippet: string;
  publishedDate?: string; score?: number;
  /** Longer extracted content (deep research only). */
  extract?: string;
}
export interface WebSearchSummary {
  requested: boolean; performed: boolean;
  queries: string[]; sources: Array<Pick<WebSource, 'id' | 'url' | 'title' | 'publishedDate'>>;
  failureCode?: string;
  coverage?: { queriesPlanned: number; queriesSucceeded: number; queriesFailed: number; extractionsFailed: number; truncated: boolean };
}
export interface WebBundle {
  queries: string[]; sources: WebSource[];
  coverage: NonNullable<WebSearchSummary['coverage']>;
  failureCode?: string;
}
