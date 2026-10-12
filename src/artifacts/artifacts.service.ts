import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { artifact, artifactVersion } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class ArtifactsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}
  async list(userId: string) { return this.db.select().from(artifact).where(eq(artifact.userId,userId)).orderBy(desc(artifact.updatedAt)).limit(100); }
  async create(userId: string, input: {title:string;type:'equation'|'graph'|'proof'|'solution'|'document'|'other';content:unknown;note?:string}) {
    const id = newId(); const now = new Date();
    await this.db.transaction(async (tx: any) => {
      await tx.insert(artifact).values({id,userId,title:input.title,type:input.type,currentVersion:1,createdAt:now,updatedAt:now});
      await tx.insert(artifactVersion).values({id:newId(),artifactId:id,version:1,content:input.content,note:input.note ?? null,createdAt:now});
    });
    return {id,userId,title:input.title,type:input.type,currentVersion:1,createdAt:now,updatedAt:now};
  }
  async versions(userId:string,id:string) {
    const [owned] = await this.db.select().from(artifact).where(and(eq(artifact.id,id),eq(artifact.userId,userId))).limit(1);
    if (!owned) throw new NotFoundException('Artifact not found');
    return this.db.select().from(artifactVersion).where(eq(artifactVersion.artifactId,id)).orderBy(desc(artifactVersion.version));
  }
  async appendVersion(userId:string,id:string,input:{content:unknown;note?:string}) {
    const [owned] = await this.db.select().from(artifact).where(and(eq(artifact.id,id),eq(artifact.userId,userId))).limit(1);
    if (!owned) throw new NotFoundException('Artifact not found');
    const next = owned.currentVersion + 1; const now = new Date();
    await this.db.transaction(async (tx:any) => {
      await tx.insert(artifactVersion).values({id:newId(),artifactId:id,version:next,content:input.content,note:input.note ?? null,createdAt:now});
      await tx.update(artifact).set({currentVersion:next,updatedAt:now}).where(eq(artifact.id,id));
    });
    return {artifactId:id,version:next,createdAt:now};
  }
}
