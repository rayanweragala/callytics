import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, tap, throwError } from 'rxjs';
import { AppLogger } from './app-logger';

interface HttpRequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
}

interface HttpResponseLike {
  statusCode?: number;
}

interface HttpErrorLike {
  getStatus?: () => number;
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();
    const logRequest = (statusCode: number) => {
      AppLogger.event('HttpRequest', {
        method: request.method || 'UNKNOWN',
        path: request.originalUrl || request.url || '',
        statusCode,
        durationMs: Date.now() - startedAt,
      });
    };
    return next.handle().pipe(
      tap(() => logRequest(Number(response.statusCode || 200))),
      catchError((error: HttpErrorLike) => {
        const statusCode = typeof error.getStatus === 'function' ? error.getStatus() : 500;
        logRequest(statusCode);
        AppLogger.errorEvent('HttpRequest', error);
        return throwError(() => error);
      }),
    );
  }
}