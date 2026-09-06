import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PartnerOperatorStatus } from '../../../database/entities/partner-operator.entity';
import { PartnerOperatorsService } from '../partner-operators.service';

// A partner operator's own systems (route/schedule pushes, tracking-
// channel ingestion — see TrackingChannelsController) are external
// software, not a WAZZAR user account, so they don't go through
// JwtAuthGuard/RolesGuard. Same `Authorization: Bearer <key>` header
// shape as the JWT guard for consistency, but the token is a partner
// API key (PartnerOperatorsService.verifyApiKey), not a JWT. On success,
// attaches the authenticated PartnerOperator to `request.partnerOperator`
// (parallel to how JwtAuthGuard attaches `request.user`) for controllers
// to read via the CurrentPartnerOperator decorator.
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(private readonly partnerOperatorsService: PartnerOperatorsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing partner API key');
    }

    const presentedKey = authHeader.slice('Bearer '.length).trim();
    const operator = await this.partnerOperatorsService.verifyApiKey(presentedKey);

    if (!operator) {
      throw new UnauthorizedException('Invalid partner API key');
    }
    if (operator.status !== PartnerOperatorStatus.ACTIVE) {
      throw new UnauthorizedException('This partner operator account is suspended');
    }

    request.partnerOperator = operator;
    return true;
  }
}
