import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PreferencesSchema,
  ProposalDecisionSchema,
  PublishMissionSchema,
  RepeatMissionSchema,
  SubmitProposalSchema,
  VerificationRequestSchema,
  type Preferences,
  type ProposalDecisionRequest,
  type PublishMissionRequest,
  type RepeatMissionRequest,
  type SubmitProposalRequest,
  type VerificationRequest,
} from '@promesa/contracts';
import { ZodPipe, openApiSchema } from '../../common/zod';
import {
  CorrelationId,
  CurrentPrincipal,
  OptionalPrincipal,
  type Principal,
  Public,
  RequireRoles,
} from '../identity/principal';
import { MarketplaceService } from './marketplace.service';

@ApiTags('needmesh-marketplace')
@Controller('v1')
export class MarketplaceController {
  constructor(private readonly market: MarketplaceService) {}

  @Public()
  @Get('marketplace/missions')
  @ApiOperation({
    summary:
      'Public reverse marketplace of published missions. Public-safe fields only; signed-in sponsors also get match scores.',
  })
  marketplace(
    @OptionalPrincipal() viewer: Principal | null,
    @Query('q') q?: string,
    @Query('category') category?: string,
  ) {
    return this.market.marketplace(viewer, {
      q: q?.slice(0, 80),
      category: category?.slice(0, 40),
    });
  }

  @Post('missions/:id/publish')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN')
  @ApiOperation({
    summary: 'Publish or unpublish a mission. Publishing requires a verified organization.',
  })
  @ApiBody({ schema: openApiSchema(PublishMissionSchema) })
  publish(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PublishMissionSchema)) body: PublishMissionRequest,
  ) {
    return this.market.publish(principal, id, body, correlationId);
  }

  @Post('missions/:id/repeat')
  @HttpCode(201)
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR')
  @ApiOperation({ summary: 'Start a new mission with the same confirmed need and a new deadline.' })
  @ApiBody({ schema: openApiSchema(RepeatMissionSchema) })
  repeat(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RepeatMissionSchema)) body: RepeatMissionRequest,
  ) {
    return this.market.repeat(principal, id, body, correlationId);
  }

  @Post('missions/:id/proposals')
  @HttpCode(201)
  @RequireRoles('MERCHANT_ADMIN', 'MERCHANT_OPERATOR')
  @ApiOperation({
    summary:
      'A connected merchant offers terms for one of its own listings. The Negotiation agent evaluates it; nothing is agreed until both sides accept.',
  })
  @ApiBody({ schema: openApiSchema(SubmitProposalSchema) })
  submit(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SubmitProposalSchema)) body: SubmitProposalRequest,
  ) {
    return this.market.submitProposal(principal, id, body, correlationId);
  }

  @Post('proposals/:proposalId/decision')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR', 'MERCHANT_ADMIN', 'MERCHANT_OPERATOR')
  @ApiOperation({
    summary: 'Accept, counter, decline (organization) or accept counter / withdraw (merchant).',
  })
  @ApiBody({ schema: openApiSchema(ProposalDecisionSchema) })
  decide(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body(new ZodPipe(ProposalDecisionSchema)) body: ProposalDecisionRequest,
  ) {
    return this.market.decide(principal, proposalId, body, correlationId);
  }

  @Get('merchant/workspace')
  @RequireRoles('MERCHANT_ADMIN', 'MERCHANT_OPERATOR')
  @ApiOperation({
    summary: 'Merchant dashboard: catalog, matching opportunities, offers and orders.',
  })
  merchantWorkspace(@CurrentPrincipal() principal: Principal) {
    return this.market.merchantWorkspace(principal);
  }

  @Get('org/profile')
  @ApiOperation({
    summary: 'Organization verification status, public profile and saved preferences.',
  })
  profile(@CurrentPrincipal() principal: Principal) {
    return this.market.profile(principal);
  }

  @Put('org/preferences')
  @ApiOperation({ summary: 'Save purchasing preferences (org) or funding interests (sponsor).' })
  @ApiBody({ schema: openApiSchema(PreferencesSchema) })
  preferences(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Body(new ZodPipe(PreferencesSchema)) body: Preferences,
  ) {
    return this.market.savePreferences(principal, body, correlationId);
  }

  @Post('org/verification')
  @HttpCode(200)
  @RequireRoles('ORG_ADMIN')
  @ApiOperation({
    summary:
      'Submit organization verification details (demo review; no external registry is queried).',
  })
  @ApiBody({ schema: openApiSchema(VerificationRequestSchema) })
  verify(
    @CurrentPrincipal() principal: Principal,
    @CorrelationId() correlationId: string,
    @Body(new ZodPipe(VerificationRequestSchema)) body: VerificationRequest,
  ) {
    return this.market.requestVerification(principal, body, correlationId);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Mission-level outcomes for the current role scope.' })
  analytics(@CurrentPrincipal() principal: Principal) {
    return this.market.analytics(principal);
  }

  @Get('forecast')
  @RequireRoles('ORG_ADMIN', 'ORG_OPERATOR')
  @ApiOperation({ summary: 'Shortage forecast from the organization’s own mission history.' })
  forecast(@CurrentPrincipal() principal: Principal) {
    return this.market.forecast(principal);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Pending actions for the current role and recent mission activity.' })
  notifications(@CurrentPrincipal() principal: Principal) {
    return this.market.notifications(principal);
  }
}
