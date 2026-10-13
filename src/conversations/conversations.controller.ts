import { Protect } from '../security/protect.decorator';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUserId } from '../common/user.decorator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { ConversationsService } from './conversations.service';

class CreateConversationDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsIn(['calculus','algebra','geometry','statistics','general']) subject?: any;
}
@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Protect('read')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}
  @Get() list(@CurrentUserId() userId: string) { return this.service.list(userId); }
  @Post() create(@CurrentUserId() userId: string, @Body() dto: CreateConversationDto) { return this.service.create(userId, dto); }
  @Get(':id/messages') messages(@CurrentUserId() userId: string, @Param('id') id: string) { return this.service.getMessages(userId, id); }
  @Delete(':id') delete(@CurrentUserId() userId: string, @Param('id') id: string) { return this.service.delete(userId, id); }
}
