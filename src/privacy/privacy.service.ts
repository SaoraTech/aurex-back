import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { artifact, artifactVersion, conversation, libraryDocument, memoryItem, message, privacyRequest, subscription } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class PrivacyService {
  constructor(@Inject(DRIZZLE) private readonly db:any) {}
  async exportUserData(userId:string) {
    const conversations = await this.db.select().from(conversation).where(eq(conversation.userId,userId));
    const conversationIds = conversations.map((c:any)=>c.id);
    const messages:any[] = conversationIds.length ? await this.db.select().from(message).where(inArray(message.conversationId,conversationIds)) : [];
    const memories = await this.db.select().from(memoryItem).where(eq(memoryItem.userId,userId));
    const artifacts = await this.db.select().from(artifact).where(eq(artifact.userId,userId));
    const docs = await this.db.select({id:libraryDocument.id,filename:libraryDocument.filename,mimeType:libraryDocument.mimeType,sizeBytes:libraryDocument.sizeBytes,status:libraryDocument.status,createdAt:libraryDocument.createdAt}).from(libraryDocument).where(eq(libraryDocument.userId,userId));
    const subs = await this.db.select({plan:subscription.plan,status:subscription.status,currentPeriodStart:subscription.currentPeriodStart,currentPeriodEnd:subscription.currentPeriodEnd}).from(subscription).where(eq(subscription.userId,userId));
    return { schemaVersion:1, exportedAt:new Date().toISOString(), userId, conversations, messages, memories, artifacts, documents:docs, subscriptions:subs };
  }
  async requestDeletion(userId:string) {
    const item={id:newId(),userId,type:'delete_account',status:'pending' as const,createdAt:new Date()};
    await this.db.insert(privacyRequest).values(item);
    // Destructive account deletion is deliberately asynchronous and not performed in the request handler.
    // A verified job must delete storage objects, provider data where possible, auth records and audit data
    // according to retention obligations; never delete billing evidence needed by law without policy review.
    return {requestId:item.id,status:item.status,message:'Deletion request registered; operator/job processing is required.'};
  }
}
