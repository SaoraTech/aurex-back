import {Inject,Injectable,Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {and,eq,gte,sql} from 'drizzle-orm';
import {DRIZZLE} from '../db/db.constants';
import {providerUsage} from '../db/schema';
import {newId} from '../common/ids';
export type UsageKind='tts_chars'|'stt_call'|'stt_seconds'|'web_search'|'deep_research'|'llm_call'|'math_call';
export interface CostEstimate{costUsd:number|null;isEstimated:boolean;isUnknown:boolean;currency:'USD';note?:string;}
export interface UsageSummaryItem{kind:UsageKind;provider:string;totalUnits:number;callCount:number;avgLatencyMs:number|null;estimatedCostUsd:number|null;}
export const startOfUtcDay=(d=new Date())=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
export const startOfUtcMonth=(d=new Date())=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));
const DEFAULT_UNIT_PRICES_PER_1K:Record<UsageKind,number|null>={llm_call:0.0005,tts_chars:null,stt_call:null,stt_seconds:null,web_search:5,deep_research:20,math_call:2};
@Injectable()
export class UsageService{
 private readonly logger=new Logger(UsageService.name);
 constructor(@Inject(DRIZZLE)private readonly db:any,private readonly config?:ConfigService){}
 async record(input:{userId?:string|null;kind:UsageKind;provider:string;units?:number;latencyMs?:number;outcome:string;requestId?:string}){
  try{await this.db.insert(providerUsage).values({id:newId(),userId:input.userId??null,kind:input.kind,provider:input.provider,
   units:Math.max(0,Math.round(input.units??1)),latencyMs:input.latencyMs??null,outcome:input.outcome,requestId:input.requestId??null});}
  catch(error){this.logger.error({msg:'usage_record_failed',kind:input.kind,error:(error as Error).message});}
 }
 async sumSince(userId:string,kind:UsageKind,since:Date):Promise<number>{
  const rows=await this.db.select({total:sql<number>`coalesce(sum(${providerUsage.units}), 0)`}).from(providerUsage)
   .where(and(eq(providerUsage.userId,userId),eq(providerUsage.kind,kind),gte(providerUsage.createdAt,since)));
  return Number(rows[0]?.total??0);
 }
 estimateCost(input:{kind:UsageKind;units:number;provider?:string}):CostEstimate{
  let custom:Partial<Record<UsageKind,number>>={};const raw=this.config?.get<string>('MODEL_PRICING_JSON');
  if(raw){try{custom=JSON.parse(raw);}catch{/* ignore invalid optional override */}}
  const rate=custom[input.kind]??DEFAULT_UNIT_PRICES_PER_1K[input.kind];
  if(rate===null||rate===undefined)return{costUsd:null,isEstimated:false,isUnknown:true,currency:'USD',note:'Pricing not configured for provider/kind'};
  return{costUsd:Math.round(input.units/1000*rate*1_000_000)/1_000_000,isEstimated:true,isUnknown:false,currency:'USD'};
 }
 async getUserUsageSummary(userId:string,since=startOfUtcMonth()):Promise<UsageSummaryItem[]>{
  const rows=await this.db.select({kind:providerUsage.kind,provider:providerUsage.provider,totalUnits:sql<number>`coalesce(sum(${providerUsage.units}), 0)`,
   callCount:sql<number>`count(*)`,avgLatencyMs:sql<number>`round(avg(${providerUsage.latencyMs}))`}).from(providerUsage)
   .where(and(eq(providerUsage.userId,userId),gte(providerUsage.createdAt,since))).groupBy(providerUsage.kind,providerUsage.provider);
  return rows.map((r:any)=>{const units=Number(r.totalUnits??0),cost=this.estimateCost({kind:r.kind,units,provider:r.provider});
   return{kind:r.kind as UsageKind,provider:r.provider,totalUnits:units,callCount:Number(r.callCount??0),
    avgLatencyMs:r.avgLatencyMs!==null?Number(r.avgLatencyMs):null,estimatedCostUsd:cost.costUsd};});
 }
 async detectAbnormalConsumption(userId:string,thresholdUnits=50000,since=startOfUtcDay()){
  const rows=await this.db.select({totalUnits:sql<number>`coalesce(sum(${providerUsage.units}), 0)`}).from(providerUsage)
   .where(and(eq(providerUsage.userId,userId),gte(providerUsage.createdAt,since)));
  const consumed=Number(rows[0]?.totalUnits??0);return{userId,consumedUnits:consumed,thresholdUnits,isAbnormal:consumed>=thresholdUnits,evaluatedSince:since.toISOString()};
 }
}
