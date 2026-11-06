import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [PlansModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
