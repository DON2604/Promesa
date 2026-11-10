import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PinoNestLogger, createRootLogger } from './common/logger';
import { loadEnv } from './config/env';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT = new Set(['/v1/paypal/webhooks']);

async function bootstrap() {
  const env = loadEnv();
  const logger = createRootLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    disableRequestLogging: false,
    bodyLimit: 256 * 1024,
    trustProxy: env.NODE_ENV === 'production',
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers['x-correlation-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new PinoNestLogger(logger),
    rawBody: true,
  });

  await app.register(fastifyCookie);
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Promesa-Csrf', 'X-Correlation-Id', 'Last-Event-ID'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  const fastify = app.getHttpAdapter().getInstance();
  // CSRF defence for cookie sessions: unsafe requests must carry a custom header (forces a CORS
  // preflight that only allow-listed origins pass) and, when present, an allow-listed Origin.
  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('X-Correlation-Id', String(request.id));
    if (!UNSAFE_METHODS.has(request.method) || CSRF_EXEMPT.has(request.url.split('?')[0] ?? ''))
      return;
    const origin = request.headers.origin;
    const csrf = request.headers['x-promesa-csrf'];
    if ((origin && !env.ALLOWED_ORIGINS.includes(origin)) || csrf !== '1') {
      await reply.status(403).send({
        error: {
          code: 'CSRF_REJECTED',
          message: 'Request blocked by CSRF protection.',
          correlationId: String(request.id),
        },
      });
    }
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Promesa API')
      .setDescription(
        'NeedMesh missions + PromiseTwin. Independent prototype; not an official PayPal product.',
      )
      .setVersion('0.1.0')
      .addCookieAuth('promesa_session')
      .build(),
  );
  fastify.get('/openapi.json', async () => document);
  if (env.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, document);

  app.enableShutdownHooks();
  // Containers/hosts need 0.0.0.0; local development stays on loopback so the API is not exposed to the LAN.
  await app.listen(
    env.PORT,
    process.env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  );
  logger.info(
    { port: env.PORT, demoMode: env.DEMO_MODE, paypalEnv: env.PAYPAL_ENVIRONMENT },
    'Promesa API listening',
  );
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
