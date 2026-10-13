import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlansModule } from '../plans/plans.module';
import { StorageModule } from '../storage/storage.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
@Module({ imports: [StorageModule, PlansModule, AuditModule], controllers: [LibraryController], providers: [LibraryService], exports: [LibraryService] })
export class LibraryModule {}
