import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { PlansService } from '../plans/plans.service';
import { Protect } from '../security/protect.decorator';
import { WebResearchService } from './web-research.service';

class SearchDto {
  @IsString() @MinLength(2) @MaxLength(400) query!: string;
  @IsOptional() @IsIn(['general', 'news']) topic?: 'general' | 'news';
  @IsOptional() @IsIn(['day', 'week', 'month', 'year']) timeRange?: 'day' | 'week' | 'month' | 'year';
}
class DeepDto {
  @IsString() @MinLength(5) @MaxLength(1000) question!: string;
  @IsOptional() @IsIn(['standard', 'deep']) depth?: 'standard' | 'deep';
}

@ApiTags('research') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('research')
export class ResearchController {
  constructor(private readonly research: WebResearchService, private readonly plans: PlansService) {}

  @Post('search') @Protect('research') @HttpCode(200)
  search(@CurrentUserId() uid: string, @RequestId() rid: string, @Body() dto: SearchDto) { return this.research.search(uid, dto, rid); }

  @Post('deep') @Protect('deep_research') @HttpCode(200)
  async deep(@CurrentUserId() uid: string, @RequestId() rid: string, @Body() dto: DeepDto) {
    return this.research.deepResearch(uid, await this.plans.getEffectivePlan(uid), dto, rid);
  }
}
