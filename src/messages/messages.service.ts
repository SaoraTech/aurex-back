import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { auditEvent, conversation, message } from '../db/schema';
import { ConversationsService } from '../conversations/conversations.service';
import { newId } from '../common/ids';
@Injectable()
export class MessagesService {
  constructor(@Inject(DRIZZLE) private readonly db:any, private readonly conversations:ConversationsService){}
  private async getOwnedMessage(userId:string,conversationId:string,messageId:string){
    await this.conversations.getOwned(userId,conversationId);
    const [item]=await this.db.select().from(message).where(and(eq(message.id,messageId),eq(message.conversationId,conversationId))).limit(1);
    if(!item) throw new NotFoundException('Message not found'); return item;
  }
  async edit(userId:string,conversationId:string,messageId:string,content:string){
    const item=await this.getOwnedMessage(userId,conversationId,messageId);
    if(item.role!=='user') throw new BadRequestException('Only user messages can be edited');
    const clean=content.trim(); if(!clean||clean.length>20000) throw new BadRequestException('Message content must contain 1 to 20000 characters');
    await this.db.insert(auditEvent).values({id:newId(),actorUserId:userId,action:'message.edited',targetType:'message',targetId:messageId,metadata:{previousContent:item.content},createdAt:new Date()});
    const [updated]=await this.db.update(message).set({content:clean}).where(and(eq(message.id,messageId),eq(message.conversationId,conversationId))).returning();
    await this.db.update(conversation).set({updatedAt:new Date()}).where(eq(conversation.id,conversationId));
    return {message:updated,edited:true};
  }
  async versions(userId:string,conversationId:string,messageId:string){
    const current=await this.getOwnedMessage(userId,conversationId,messageId);
    const revisions=await this.db.select().from(auditEvent).where(and(eq(auditEvent.actorUserId,userId),eq(auditEvent.targetType,'message'),eq(auditEvent.targetId,messageId),inArray(auditEvent.action,['message.edited','message.alternative']))).orderBy(desc(auditEvent.createdAt)).limit(50);
    return {current:{content:current.content,createdAt:current.createdAt},previous:revisions.filter((e:any)=>e.action==='message.edited').map((e:any)=>({content:e.metadata?.previousContent??null,createdAt:e.createdAt})).filter((e:any)=>typeof e.content==='string'),alternatives:revisions.filter((e:any)=>e.action==='message.alternative').map((e:any)=>({content:e.metadata?.content??null,messageId:e.metadata?.alternativeMessageId??null,createdAt:e.createdAt})).filter((e:any)=>typeof e.content==='string')};
  }
  async remove(userId:string,conversationId:string,messageId:string){
    const item=await this.getOwnedMessage(userId,conversationId,messageId);
    await this.db.delete(message).where(and(eq(message.id,messageId),eq(message.conversationId,conversationId)));
    await this.db.insert(auditEvent).values({id:newId(),actorUserId:userId,action:'message.deleted',targetType:'message',targetId:messageId,metadata:{role:item.role},createdAt:new Date()});
    await this.db.update(conversation).set({updatedAt:new Date()}).where(eq(conversation.id,conversationId));
    return {deleted:true,messageId};
  }
  async feedback(userId:string,conversationId:string,messageId:string,input:{type:'positive'|'negative'|'report'|'math_error';reason?:string}){
    const item=await this.getOwnedMessage(userId,conversationId,messageId);
    if(item.role!=='assistant') throw new BadRequestException('Feedback can only target assistant messages');
    if((input.type==='report'||input.type==='math_error')&&!input.reason?.trim()) throw new BadRequestException('A reason is required for this feedback type');
    await this.db.insert(auditEvent).values({id:newId(),actorUserId:userId,action:'message.feedback',targetType:'message',targetId:messageId,metadata:{type:input.type,reason:input.reason?.trim().slice(0,1000)??null},createdAt:new Date()});
    return {recorded:true,type:input.type,messageId};
  }
}