import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { MessagesService } from './messages.service';
class EditMessageDto { @IsString() @MinLength(1) @MaxLength(20000) content!:string; }
class FeedbackDto { @IsIn(['positive','negative','report','math_error']) type!:'positive'|'negative'|'report'|'math_error'; @IsOptional() @IsString() @MaxLength(1000) reason?:string; }
@ApiTags('messages') @ApiBearerAuth() @UseGuards(RequireUserGuard) @Protect('read') @Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messages:MessagesService){}
  @Get(':messageId/versions') versions(@CurrentUserId() uid:string,@Param('conversationId') cid:string,@Param('messageId') mid:string){return this.messages.versions(uid,cid,mid);}
  @Patch(':messageId') @Protect('chat') edit(@CurrentUserId() uid:string,@Param('conversationId') cid:string,@Param('messageId') mid:string,@Body() dto:EditMessageDto){return this.messages.edit(uid,cid,mid,dto.content);}
  @Post(':messageId/versions/:versionId/restore') @Protect('chat') restoreVersion(@CurrentUserId() uid:string,@Param('conversationId') cid:string,@Param('messageId') mid:string,@Param('versionId') vid:string){return this.messages.restoreVersion(uid,cid,mid,vid);}
  @Delete(':messageId') @Protect('chat') remove(@CurrentUserId() uid:string,@Param('conversationId') cid:string,@Param('messageId') mid:string){return this.messages.remove(uid,cid,mid);}
  @Post(':messageId/feedback') @Protect('chat') feedback(@CurrentUserId() uid:string,@Param('conversationId') cid:string,@Param('messageId') mid:string,@Body() dto:FeedbackDto){return this.messages.feedback(uid,cid,mid,dto);}
}