import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Domain error with a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(resource: string) {
    return new AppError('NOT_FOUND', `${resource} was not found.`, HttpStatus.NOT_FOUND);
  }
  static forbidden(message = 'You do not have permission for this action.') {
    return new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
  static conflict(code: string, message: string) {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = String(request.id);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong on our side. Please retry with the reference below.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_FAILED';
      message = 'The request did not pass validation.';
      details = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      status = HttpStatus.CONFLICT;
      code = 'DUPLICATE';
      message = 'This operation conflicts with an existing record.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : `HTTP_${status}`;
      const response = exception.getResponse();
      message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string }).message ?? exception.message);
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} failed [${correlationId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (reply.sent) return;
    void reply.status(status).send({ error: { code, message, details, correlationId } });
  }
}
