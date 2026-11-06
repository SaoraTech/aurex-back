import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertOk, fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';

const API_VERSION='2025-10-15';
const SSML_NS='http://www.w3.org/2001/10/synthesis';
const escapeXml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const localeFor=(language?:string)=>language==='en'?'en-US':'fr-FR';

@Injectable()
export class AzureSpeechService{
 constructor(private readonly config:ConfigService,private readonly metrics:MetricsService){}
 isEnabled():boolean{return this.config.get<string>('azureSpeechEnabled')==='true'&&!!this.config.get<string>('azureSpeechKey')&&!!this.config.get<string>('azureSpeechRegion')&&!!this.config.get<string>('azureSpeechResourceName');}
 private get credentials(){
  if(!this.isEnabled())throw new ProviderError('azure-speech','not_configured','Azure AI Speech is not configured');
  return {key:this.config.get<string>('azureSpeechKey')!,region:this.config.get<string>('azureSpeechRegion')!,resource:this.config.get<string>('azureSpeechResourceName')!};
 }
 private get timeout(){return this.config.get<number>('azureSpeechTimeoutMs')??30000;}
 async synthesize(text:string,language='fr'):Promise<{audio:Buffer;contentType:string}>{
  const {key,region}=this.credentials;
  const locale=localeFor(language);
  const voice=language==='en'?(this.config.get<string>('azureSpeechTtsVoiceEn')??'en-US-JennyNeural'):(this.config.get<string>('azureSpeechTtsVoiceFr')??'fr-FR-DeniseNeural');
  const ssml=\`<speak version="1.0" xmlns="\${SSML_NS}" xml:lang="\${locale}"><voice name="\${escapeXml(voice)}">\${escapeXml(text)}</voice></speak>\`;
  return this.metrics.track('azure-speech','tts',async()=>{
   const res=await fetchWithTimeout('azure-speech',\`https://\${region}.tts.speech.microsoft.com/cognitiveservices/v1\`,{
    method:'POST',headers:{'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml',
     'X-Microsoft-OutputFormat':this.config.get<string>('azureSpeechTtsOutputFormat')??'audio-16khz-128kbitrate-mono-mp3',
     'User-Agent':'AurexBackend/1.0',Accept:'audio/mpeg'},body:ssml,
   },this.timeout);
   assertOk('azure-speech',res,kindFromStatus);
   const audio=Buffer.from(await res.arrayBuffer());
   if(!audio.length)throw new ProviderError('azure-speech','bad_response','Azure returned empty audio');
   const contentType=res.headers.get('content-type')?.split(';')[0]||'audio/mpeg';
   if(!contentType.startsWith('audio/'))throw new ProviderError('azure-speech','bad_response','Azure returned a non-audio response');
   return {audio,contentType};
  });
 }
 async transcribe(audio:Buffer,mimeType:string,filename:string,language='fr'):Promise<{text:string;languageCode?:string;durationMilliseconds:number}>{
  const {key,resource}=this.credentials;
  return this.metrics.track('azure-speech','stt',async()=>{
   const form=new FormData();
   form.set('audio',new Blob([new Uint8Array(audio)],{type:mimeType}),filename);
   form.set('definition',JSON.stringify({locales:[localeFor(language)]}));
   const url=\`https://\${resource}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=\${API_VERSION}\`;
   const res=await fetchWithTimeout('azure-speech',url,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':key,Accept:'application/json'},body:form},this.timeout);
   assertOk('azure-speech',res,kindFromStatus);
   let payload:{durationMilliseconds?:unknown;combinedPhrases?:Array<{text?:unknown;locale?:unknown}>};
   try{payload=await res.json() as typeof payload;}catch{throw new ProviderError('azure-speech','bad_response','Azure returned invalid JSON');}
   const phrases=Array.isArray(payload.combinedPhrases)?payload.combinedPhrases:[];
   const text=phrases.map(p=>typeof p.text==='string'?p.text.trim():'').filter(Boolean).join(' ').trim();
   if(!text)throw new ProviderError('azure-speech','bad_response','Azure returned an empty transcript');
   const locale=phrases.find(p=>typeof p.locale==='string')?.locale;
   return {text,languageCode:typeof locale==='string'?locale:localeFor(language),
    durationMilliseconds:typeof payload.durationMilliseconds==='number'&&Number.isFinite(payload.durationMilliseconds)?Math.max(0,Math.round(payload.durationMilliseconds)):0};
  });
 }
}
