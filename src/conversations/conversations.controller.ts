import { Protect } from '../security/protect.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUserId } from '../common/user.decorator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { ConversationsService } from './conversations.service';
class CreateConversationDto { @IsOptional() @IsString() @MaxLength(160) title?: string; @IsOptional() @IsIn(['calculus','algebra','geometry','statistics','general']) subject?: any; }
class RenameConversationDto { @IsString() @MinLength(1) @MaxLength(160) title!: string; }
@ApiTags('conversations') @ApiBearerAuth() @UseGuards(RequireUserGuard) @Protect('read') @Controller('conversations')
export class ConversationsController {
  constructor(private readonly service:ConversationsService){}
  @Get() list(@CurrentUserId() uid:string){return this.service.list(uid);}
  @Get('page') page(@CurrentUserId() uid:string,@Query('limit') limit?:string,@Query('cursor') cursor?:string,@Query('q') q?:string,@Query('archived') archived?:'true'|'false'|'all'){return this.service.page(uid,{limit:Number(limit),cursor,q,archived});}
  @Post() create(@CurrentUserId() uid:string,@Body() dto:CreateConversationDto){return this.service.create(uid,dto);}
  @Get(':id/messages') messages(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.getMessages(uid,id);}
  @Get(':id/messages/page') messagesPage(@CurrentUserId() uid:string,@Param('id') id:string,@Query('limit') limit?:string,@Query('cursor') cursor?:string){return this.service.messagesPage(uid,id,{limit:Number(limit),cursor});}
  @Patch(':id') @Protect('chat') rename(@CurrentUserId() uid:string,@Param('id') id:string,@Body() dto:RenameConversationDto){return this.service.rename(uid,id,dto.title);}
  @Post(':id/archive') @Protect('chat') archive(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.archive(uid,id);}
  @Post(':id/unarchive') @Protect('chat') unarchive(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.unarchive(uid,id);}
  @Post(':id/pin') @Protect('chat') pin(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.pin(uid,id);}
  @Post(':id/unpin') @Protect('chat') unpin(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.unpin(uid,id);}
  @Delete() @Protect('chat') deleteAll(@CurrentUserId() uid:string){return this.service.deleteAll(uid);}
  @Delete(':id') @Protect('chat') remove(@CurrentUserId() uid:string,@Param('id') id:string){return this.service.delete(uid,id);}
}