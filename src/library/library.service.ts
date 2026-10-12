import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { libraryDocument } from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class LibraryService {
  constructor(@Inject(DRIZZLE) private readonly db:any) {}
  async list(userId:string) {
    return this.db.select({id:libraryDocument.id,filename:libraryDocument.filename,mimeType:libraryDocument.mimeType,sizeBytes:libraryDocument.sizeBytes,status:libraryDocument.status,createdAt:libraryDocument.createdAt})
      .from(libraryDocument).where(eq(libraryDocument.userId,userId)).orderBy(desc(libraryDocument.createdAt)).limit(100);
  }
  async registerMetadata(_userId:string,_input:{filename:string;mimeType:string;sizeBytes:number}) {
    // Storage adapter is intentionally not stubbed with public URLs. Implement private R2 uploads,
    // content-type sniffing, malware scanning and short-lived signed URLs before enabling file upload.
    throw new NotImplementedException('Document upload is unavailable until the private object-storage adapter is configured');
  }
}
