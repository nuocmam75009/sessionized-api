import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { JwtPayload } from '../../auth/types/jwt-payload.interface';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const start = Date.now();
    const actor = () =>
      request.user ? `${request.user.email} (${request.user.role})` : 'anonyme';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(
            `${method} ${originalUrl} ${response.statusCode} +${duration}ms — ${actor()}`,
          );
        },
        error: (err: { status?: number; message?: string }) => {
          const duration = Date.now() - start;
          const status = err.status ?? 500;
          this.logger.warn(
            `${method} ${originalUrl} ${status} +${duration}ms — ${actor()} — ${err.message ?? 'erreur inconnue'}`,
          );
        },
      }),
    );
  }
}
