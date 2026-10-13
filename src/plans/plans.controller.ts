import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Protect } from '../security/protect.decorator';
import { PlansService } from './plans.service';
@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}
  @Get() @Protect('public') list() { return this.plans.list(); }
}
