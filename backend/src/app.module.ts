import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ProblemFilter } from './common/errors';
import { ENV, type Env, loadEnv } from './config/env';
import { PrismaService } from './infra/prisma.service';
import { CompositeLLMProvider } from './modules/agents/composite-provider';
import { FixtureLLMProvider } from './modules/agents/fixture-provider';
import { GeminiBudget, freeTierBudget } from './modules/agents/gemini-budget';
import { LLM_PROVIDER } from './modules/agents/llm-provider';
import { OpenAICompatibleProvider } from './modules/agents/openai-compatible-provider';
import {
  IntentController,
  MissionsController,
  PurchasesController,
  TwinsController,
} from './modules/api.controllers';
import { AuditService } from './modules/audit/audit.service';
import { CatalogService } from './modules/commerce/catalog.service';
import { DemoService } from './modules/demo/demo.service';
import { OutboxService } from './modules/events/outbox.service';
import { AuthController } from './modules/identity/auth.controller';
import { AuthGuard } from './modules/identity/auth.guard';
import { IntentService } from './modules/intent/intent.service';
import { MissionsService } from './modules/missions/missions.service';
import {
  NeedMeshController,
  PayPalWebhookController,
} from './modules/needmesh/needmesh.controller';
import { NeedMeshService } from './modules/needmesh/needmesh.service';
import { MarketplaceController } from './modules/needmesh/marketplace.controller';
import { MarketplaceService } from './modules/needmesh/marketplace.service';
import {
  PAYPAL_RAIL,
  SandboxPayPalRail,
  SimulatedPayPalRail,
} from './modules/needmesh/paypal-rail';
import { PayPalGateway } from './modules/paypal/paypal-gateway';
import { PAYPAL_MCP, PayPalMcpAdapter } from './modules/paypal/paypal-mcp.adapter';
import { PAYPAL_GATEWAY, PayPalController } from './modules/paypal/paypal.controller';
import {
  DemoController,
  HealthController,
  OperationsController,
  StreamController,
} from './modules/platform.controllers';
import { PurchasesService } from './modules/purchases/purchases.service';
import { TwinEngine } from './modules/promisetwin/twin-engine';
import { TwinsService } from './modules/promisetwin/twins.service';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: loadEnv }, PrismaService, OutboxService, AuditService],
  exports: [ENV, PrismaService, OutboxService, AuditService],
})
class CoreModule {}

@Module({
  imports: [CoreModule],
  controllers: [
    HealthController,
    AuthController,
    IntentController,
    PurchasesController,
    MissionsController,
    NeedMeshController,
    MarketplaceController,
    TwinsController,
    OperationsController,
    StreamController,
    PayPalController,
    PayPalWebhookController,
    DemoController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
    {
      provide: LLM_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => {
        const fixture = new FixtureLLMProvider();
        if (env.LLM_PROVIDER === 'fixture') return fixture;
        // Real models narrate plans and recovery decisions; intent compilation stays deterministic.
        if (env.LLM_PROVIDER === 'openai') {
          if (!env.OPENAI_API_KEY) throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY.');
          return new CompositeLLMProvider(
            new OpenAICompatibleProvider({
              name: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: env.OPENAI_API_KEY,
              model: env.LLM_MODEL ?? 'gpt-4o-mini',
            }),
            fixture,
          );
        }
        if (env.LLM_PROVIDER === 'gemini') {
          if (!env.GEMINI_API_KEY) throw new Error('LLM_PROVIDER=gemini requires GEMINI_API_KEY.');
          // 2.0-flash's free quota is reported as zero, so the default is a model that still has one.
          const model = env.LLM_MODEL ?? 'gemini-2.5-flash-lite';
          const base = freeTierBudget(model);
          const budget = new GeminiBudget(
            {
              requestsPerMinute: env.GEMINI_RPM ?? base.requestsPerMinute,
              requestsPerDay: env.GEMINI_RPD ?? base.requestsPerDay,
              tokensPerMinute: env.GEMINI_TPM ?? base.tokensPerMinute,
            },
            { file: join(process.cwd(), '.data', 'gemini-budget.json') },
          );
          return new CompositeLLMProvider(
            new OpenAICompatibleProvider({
              name: 'gemini',
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
              apiKey: env.GEMINI_API_KEY,
              model,
              budget,
            }),
            fixture,
          );
        }
        throw new Error(
          `LLM_PROVIDER=${env.LLM_PROVIDER} is not implemented yet. Use fixture, openai or gemini.`,
        );
      },
    },
    {
      provide: PAYPAL_GATEWAY,
      inject: [ENV],
      useFactory: (env: Env) =>
        new PayPalGateway({
          environment: env.PAYPAL_ENVIRONMENT,
          clientId: env.PAYPAL_CLIENT_ID,
          clientSecret: env.PAYPAL_CLIENT_SECRET,
          liveWritesEnabled: env.ENABLE_LIVE_PAYPAL_WRITES,
        }),
    },
    {
      provide: PAYPAL_MCP,
      inject: [ENV, PAYPAL_GATEWAY],
      useFactory: (env: Env, gateway: PayPalGateway) => new PayPalMcpAdapter(env, gateway),
    },
    {
      // Real PayPal Sandbox only when credentials AND writes are enabled; otherwise the labelled simulated rail.
      provide: PAYPAL_RAIL,
      inject: [ENV, PAYPAL_GATEWAY],
      useFactory: (env: Env, gateway: PayPalGateway) =>
        gateway.configured && env.ENABLE_LIVE_PAYPAL_WRITES && env.PAYPAL_ENVIRONMENT === 'sandbox'
          ? new SandboxPayPalRail(gateway)
          : new SimulatedPayPalRail(),
    },
    NeedMeshService,
    MarketplaceService,
    IntentService,
    CatalogService,
    TwinEngine,
    TwinsService,
    PurchasesService,
    MissionsService,
    DemoService,
  ],
})
export class AppModule {}
