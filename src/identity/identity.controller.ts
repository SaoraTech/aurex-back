import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Protect } from '../security/protect.decorator';
import { IdentityService } from './identity.service';

@ApiTags('identity')
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  /** Public, secret-free: official facts, honest capability/provider states ("configured" ≠ "verified"). */
  @Get() @Protect('public') get() { return this.identity.describe(); }
}
