import {Logger} from '@nestjs/common';
import {ProviderError} from '../common/provider-error';
import {AudioService} from './audio.service';
const WEBM=Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0]);
function build(o:{azure?:Partial<any>;cfg?:Record<string,unknown>;quotaAllowed?:boolean}={}){
 const azure:any={isEnabled:()=>true,synthesize:jest.fn().mockResolvedValue({audio:Buffer.from('mp3'),contentType:'audio/mpeg'}),
  transcribe:jest.fn().mockResolvedValue({text:'bonjour',languageCode:'fr-FR',durationMilliseconds:4200}),...o.azure};
 const config:any={get:(k:string)=>({azureSpeechMaxTextChars:100,audioMaxUploadBytes:1000,audioDefaultLanguage:'fr',...o.cfg})[k]};
 const plans:any={getEffectivePlan:jest.fn().mockResolvedValue('free')};
 const quotas:any={reserveQuota:jest.fn().mockResolvedValue({allowed:o.quotaAllowed??true,limit:10,used:0,remaining:10,resetAt:new Date().toISOString()}),
  commitQuota:jest.fn().mockResolvedValue(undefined),compensateQuota:jest.fn().mockResolvedValue(undefined)};
 const usage:any={record:jest.fn().mockResolvedValue(undefined)};
 return {svc:new AudioService(config,azure,plans,quotas,usage),azure,quotas,usage};
}
describe('AudioService - Azure AI Speech and plan quotas',()=>{
 it('synthesizes with Azure and reserves TTS characters',async()=>{
  const {svc,azure,quotas,usage}=build();const r=await svc.synthesize('u1','Bonjour');
  expect(r.provider).toBe('azure-speech');expect(r.fallback).toBe(false);expect(azure.synthesize).toHaveBeenCalledWith('Bonjour','fr');
  expect(quotas.reserveQuota).toHaveBeenCalledWith('u1','tts_speech','free',expect.any(String),7);expect(quotas.commitQuota).toHaveBeenCalled();
  expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({kind:'tts_chars',provider:'azure-speech',units:7}));
 });
 it('rejects overlong text before quota reservation',async()=>{const {svc,quotas}=build();await expect(svc.synthesize('u1','a'.repeat(101))).rejects.toMatchObject({status:413});expect(quotas.reserveQuota).not.toHaveBeenCalled();});
 it('rejects exhausted TTS quota',async()=>{const {svc}=build({quotaAllowed:false});await expect(svc.synthesize('u1','Bonjour')).rejects.toMatchObject({status:429});});
 it('compensates quota if Azure TTS fails',async()=>{
  const {svc,quotas}=build({azure:{synthesize:jest.fn().mockRejectedValue(new ProviderError('azure-speech','unavailable','provider detail'))}});
  await expect(svc.synthesize('u1','Bonjour')).rejects.toMatchObject({status:502});expect(quotas.compensateQuota).toHaveBeenCalled();
 });
 it('logs sanitized provider diagnostics only',async()=>{
  const warn=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined);
  const {svc}=build({azure:{synthesize:jest.fn().mockRejectedValue(new ProviderError('azure-speech','auth','private detail',401))}});
  await expect(svc.synthesize('u1','PRIVATE_USER_TEXT','fr','req-audio-123')).rejects.toMatchObject({status:502});
  const logged=String(warn.mock.calls[0][0]);expect(JSON.parse(logged)).toMatchObject({provider:'azure-speech',operation:'tts',kind:'auth',httpStatus:401,requestId:'req-audio-123'});
  expect(logged).not.toContain('PRIVATE_USER_TEXT');expect(logged).not.toContain('private detail');warn.mockRestore();
 });
 it('transcribes and records call count and actual audio duration',async()=>{
  const {svc,azure,quotas,usage}=build();const r=await svc.transcribe('u1',WEBM);
  expect(r).toMatchObject({text:'bonjour',provider:'azure-speech',durationMilliseconds:4200,fallback:false});
  expect(quotas.reserveQuota).toHaveBeenCalledWith('u1','stt_transcription','free',expect.any(String),1);
  expect(azure.transcribe).toHaveBeenCalledWith(WEBM,'audio/webm','audio.webm','fr');
  expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({kind:'stt_seconds',provider:'azure-speech',units:5}));
 });
 it('rejects invalid audio before quota reservation',async()=>{const {svc,quotas}=build();await expect(svc.transcribe('u1',Buffer.from('not audio'))).rejects.toMatchObject({status:400});expect(quotas.reserveQuota).not.toHaveBeenCalled();});
});
