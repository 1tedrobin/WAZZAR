import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PartnerOperator } from '../../../database/entities/partner-operator.entity';

// Usage: ingestPing(@CurrentPartnerOperator() operator: PartnerOperator)
// — only populated on routes behind PartnerApiKeyGuard, which is what
// actually authenticates the caller and attaches request.partnerOperator
// (parallel to how CurrentUser reads request.user, attached by
// JwtAuthGuard).
export const CurrentPartnerOperator = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerOperator => {
    const request = ctx.switchToHttp().getRequest();
    return request.partnerOperator;
  },
);
