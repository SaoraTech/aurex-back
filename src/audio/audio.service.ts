import { Injectable,Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException,badRequest,payloadTooLarge } from '../common/errors';
import { newId } from '../common/ids';
import { ProviderError,providerErrorToHttp,toProviderError } from '../common/provider-error';
import { PlansService } from '../plans/plans.service';
import { QuotasService } from '../quotas/quotas.service';
import { UsageService } from '../observability/usage.service';
import { AzureSpeechService } from './azure-speech.service';
import { sniffAudio } from '../storage/file-signature';
import { normalizeForSpeech } from './speech-text';
export interface SynthesisResult{audio:Buffer;contentType:string;provider:'azure-speech';fallback:false;}
export interface TranscriptionResult{text:string;languageCode?:string;durationMilliseconds:number;provider:'azure-speech';fallback:false;}
@Injectable()
export class AudioService{
 private readonly logger=new Logger(AudioService.name);
 constructor(private readonly config:ConfigService,private readonly azure:AzureSpeechService,private readonly plans:PlansService,
  private readonly quotas:QuotasService,private readonly usage:UsageService){}
 async synthesize(userId:string,rawText:string,languageCode?:string,requestId?:string):Promise<SynthesisResult>{
  const language=languageCode??this.config.get<string>('audioDefaultLanguage')??'fr';
  const spoken=normalizeForSpeech(rawText,language);
  const maxChars=this.config.get<number>('azureSpeechMaxTextChars')??5000;
  if(!spoken)throw badRequest('EMPTY_TEXT','Le texte est vide.');
  if(spoken.length>maxChars)throw payloadTooLarge('TEXT_TOO_LONG',`Le texte dépasse ${maxChars} caractères.`);
  if(!this.azure.isEnabled())throw providerErrorToHttp(new ProviderError('azure-speech','not_configured','Azure Speech is not configured'),'Le service de synthèse vocale');
  const plan=await this.plans.getEffectivePlan(userId),opId=requestId??newId();
  const quota=await this.quotas.reserveQuota(userId,'tts_speech',plan,opId,spoken.length);
  if(!quota.allowed)throw new AppException(429,quota.errorCode??'TTS_QUOTA_EXCEEDED',quota.errorMessage??'Quota de synthèse vocale atteint.',
   {feature:quota.feature,limit:quota.limit,used:quota.used,remaining:quota.remaining,resetAt:quota.resetAt,retryAfterSeconds:quota.retryAfterSeconds},quota.retryAfterSeconds);
  const started=Date.now();
  try{
   const result=await this.azure.synthesize(spoken,language);await this.quotas.commitQuota(opId);
   await this.usage.record({userId,kind:'tts_chars',provider:'azure-speech',units:spoken.length,latencyMs:Date.now()-started,outcome:'ok',requestId});
   return {...result,provider:'azure-speech',fallback:false};
  }catch(error){
   await this.quotas.compensateQuota(opId);const err=toProviderError('azure-speech',error);this.logFailure(err,'tts',started,requestId);
   await this.usage.record({userId,kind:'tts_chars',provider:'azure-speech',units:0,latencyMs:Date.now()-started,outcome:'error',requestId});
   throw providerErrorToHttp(err,'La synthèse vocale');
  }
 }
 async transcribe(userId:string,body:Buffer|undefined,options:{declaredMime?:string;filename?:string;language?:string}={},requestId?:string):Promise<TranscriptionResult>{
  if(!body?.length)throw badRequest('EMPTY_BODY','Fichier audio manquant.');
  const maxBytes=this.config.get<number>('audioMaxUploadBytes')??20971520;
  if(body.length>maxBytes)throw payloadTooLarge('AUDIO_TOO_LARGE',`Audio trop volumineux (max ${Math.round(maxBytes/1048576)} Mo).`);
  const kind=sniffAudio(body);if(!kind)throw badRequest('INVALID_AUDIO','Format audio non reconnu.');
  if(!this.azure.isEnabled())throw providerErrorToHttp(new ProviderError('azure-speech','not_configured','Azure Speech is not configured'),'Le service de reconnaissance vocale');
  const plan=await this.plans.getEffectivePlan(userId),opId=requestId??newId();
  const quota=await this.quotas.reserveQuota(userId,'stt_transcription',plan,opId,1);
  if(!quota.allowed)throw new AppException(429,quota.errorCode??'STT_QUOTA_EXCEEDED',quota.errorMessage??'Quota de reconnaissance vocale atteint.',
   {feature:quota.feature,limit:quota.limit,used:quota.used,remaining:quota.remaining,resetAt:quota.resetAt,retryAfterSeconds:quota.retryAfterSeconds},quota.retryAfterSeconds);
  const file=options.filename??`audio.${kind.ext}`,language=options.language??this.config.get<string>('audioDefaultLanguage')??'fr';
  const started=Date.now();
  try{
   const result=await this.azure.transcribe(body,kind.mime,file,language);await this.quotas.commitQuota(opId);
   await this.usage.record({userId,kind:'stt_call',provider:'azure-speech',units:1,latencyMs:Date.now()-started,outcome:'ok',requestId});
   if(result.durationMilliseconds>0)await this.usage.record({userId,kind:'stt_seconds',provider:'azure-speech',units:Math.ceil(result.durationMilliseconds/1000),latencyMs:Date.now()-started,outcome:'ok',requestId});
   return {...result,provider:'azure-speech',fallback:false};
  }catch(error){
   await this.quotas.compensateQuota(opId);const err=toProviderError('azure-speech',error);this.logFailure(err,'stt',started,requestId);
   await this.usage.record({userId,kind:'stt_call',provider:'azure-speech',units:0,latencyMs:Date.now()-started,outcome:'error',requestId});
   throw providerErrorToHttp(err,'La reconnaissance vocale');
  }
 }
 private logFailure(error:ProviderError,operation:'stt'|'tts',started:number,requestId?:string){
  this.logger.warn(JSON.stringify({event:'audio.provider_failure',provider:error.provider,operation,kind:error.kind,
   httpStatus:error.status??null,durationMs:Date.now()-started,requestId:requestId??null}));
 }
}
