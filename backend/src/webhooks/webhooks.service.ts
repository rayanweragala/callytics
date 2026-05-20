import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AppLogger } from '../logger/app-logger';
import { WebhookDeliveryEntity } from './entities/webhook-delivery.entity';

export interface WebhookDeliveryEvent {
  flow_id: number | null;
  node_id: string | null;
  call_id: string | null;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  attempt_number: number;
  http_status: number | null;
  response_body: string | null;
  success: boolean;
  error_message: string | null;
  retry_enabled: boolean;
  max_attempts: number;
  retry_on_5xx: boolean;
  retry_on_timeout: boolean;
  retry_on_4xx: boolean;
}

export interface WebhookDeliveriesFilters {
  flow_id?: string;
  node_id?: string;
  success?: string;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export interface WebhookDeliveryResponse {
  id: string;
  flowId: number | null;
  nodeId: string | null;
  callId: string | null;
  url: string;
  attemptNumber: number;
  httpStatus: number | null;
  responseBody: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

interface WebhookDeliveryListResponse {
  data: WebhookDeliveryResponse[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new AppLogger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookDeliveryEntity)
    private readonly webhookDeliveriesRepository: Repository<WebhookDeliveryEntity>,
  ) {}

  async logDelivery(data: WebhookDeliveryEvent): Promise<WebhookDeliveryResponse> {
    try {
      const entity = this.webhookDeliveriesRepository.create({
        flowId: data.flow_id,
        nodeId: data.node_id,
        callId: data.call_id,
        url: data.url,
        attemptNumber: data.attempt_number,
        httpStatus: data.http_status,
        responseBody: this.truncateText(data.response_body, 500),
        success: data.success,
        errorMessage: this.truncateText(data.error_message, 500),
      });
      const saved = await this.webhookDeliveriesRepository.save(entity);
      return this.toResponse(saved);
    } catch (error) {
      this.logger.error('Failed to log webhook delivery', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async scheduleRetry(event: WebhookDeliveryEvent): Promise<void> {
    try {
      if (!this.shouldRetry(event)) {
        return;
      }

      const delayMs = 5000 * Math.pow(5, event.attempt_number - 1);
      setTimeout(() => {
        void this.runRetry(event);
      }, delayMs);
    } catch (error) {
      this.logger.error('Failed to schedule webhook retry', error instanceof Error ? error.stack : String(error));
    }
  }

  async getDeliveries(filters: WebhookDeliveriesFilters): Promise<WebhookDeliveryListResponse> {
    try {
      const page = Math.max(1, Number(filters.page || 1));
      const limit = Math.min(100, Math.max(1, Number(filters.limit || 20)));
      const where = this.buildWhere(filters);

      const [rows, total] = await this.webhookDeliveriesRepository.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      return {
        data: rows.map((row) => this.toResponse(row)),
        total,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error('Failed to load webhook deliveries', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async getNodeDeliveries(nodeId: string): Promise<{ data: WebhookDeliveryResponse[] }> {
    try {
      const rows = await this.webhookDeliveriesRepository.find({
        where: { nodeId },
        order: { createdAt: 'DESC' },
        take: 10,
      });

      return {
        data: rows.map((row) => this.toResponse(row)),
      };
    } catch (error) {
      this.logger.error('Failed to load node webhook deliveries', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  private async runRetry(event: WebhookDeliveryEvent): Promise<void> {
    try {
      const retryEvent = await this.executeRetry(event);
      await this.logDelivery(retryEvent);
      if (!retryEvent.success) {
        await this.scheduleRetry(retryEvent);
      }
    } catch (error) {
      this.logger.error('Failed during webhook retry execution', error instanceof Error ? error.stack : String(error));
    }
  }

  private async executeRetry(event: WebhookDeliveryEvent): Promise<WebhookDeliveryEvent> {
    const controller = new AbortController();
    const timeoutMs = 5000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestInit: RequestInit = {
        method: event.method,
        headers: event.headers,
        signal: controller.signal,
      };

      if (event.method !== 'GET' && event.body) {
        requestInit.body = event.body;
      }

      const response = await fetch(event.url, requestInit);
      const responseText = this.truncateText(await response.text(), 500);

      return {
        ...event,
        attempt_number: event.attempt_number + 1,
        http_status: response.status,
        response_body: responseText,
        success: response.ok,
        error_message: response.ok ? null : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...event,
        attempt_number: event.attempt_number + 1,
        http_status: null,
        response_body: null,
        success: false,
        error_message: this.truncateText(message, 500),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldRetry(event: WebhookDeliveryEvent): boolean {
    if (event.success || !event.retry_enabled) {
      return false;
    }

    if (event.attempt_number >= event.max_attempts) {
      return false;
    }

    if (event.http_status !== null) {
      if (event.http_status >= 500) {
        return event.retry_on_5xx;
      }
      if (event.http_status >= 400) {
        return event.retry_on_4xx;
      }
      return false;
    }

    return event.retry_on_timeout && this.isTimeoutOrNetworkError(event.error_message);
  }

  private isTimeoutOrNetworkError(errorMessage: string | null): boolean {
    if (!errorMessage) {
      return false;
    }

    const normalized = errorMessage.toLowerCase();
    return [
      'timeout',
      'timed out',
      'abort',
      'network',
      'fetch failed',
      'econnrefused',
      'econnreset',
      'enotfound',
      'socket',
    ].some((term) => normalized.includes(term));
  }

  private buildWhere(filters: WebhookDeliveriesFilters): FindOptionsWhere<WebhookDeliveryEntity> {
    const where: FindOptionsWhere<WebhookDeliveryEntity> = {};

    if (filters.flow_id !== undefined && filters.flow_id !== '') {
      const flowId = Number(filters.flow_id);
      if (Number.isFinite(flowId)) {
        where.flowId = flowId;
      }
    }

    if (filters.node_id?.trim()) {
      where.nodeId = filters.node_id.trim();
    }

    if (filters.success === 'true') {
      where.success = true;
    } else if (filters.success === 'false') {
      where.success = false;
    }

    const fromDate = this.parseDate(filters.from_date);
    const toDate = this.parseDate(filters.to_date);
    if (fromDate && toDate) {
      where.createdAt = Between(fromDate, toDate);
    } else if (fromDate) {
      where.createdAt = MoreThanOrEqual(fromDate);
    } else if (toDate) {
      where.createdAt = LessThanOrEqual(toDate);
    }

    return where;
  }

  private parseDate(value: string | undefined): Date | null {
    if (!value?.trim()) {
      return null;
    }

    const date = new Date(value.trim());
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }

  private truncateText(value: string | null, maxLength: number): string | null {
    if (value === null) {
      return null;
    }

    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  private toResponse(entity: WebhookDeliveryEntity): WebhookDeliveryResponse {
    return {
      id: entity.id,
      flowId: entity.flowId,
      nodeId: entity.nodeId,
      callId: entity.callId,
      url: entity.url,
      attemptNumber: entity.attemptNumber,
      httpStatus: entity.httpStatus,
      responseBody: entity.responseBody,
      success: entity.success,
      errorMessage: entity.errorMessage,
      createdAt: entity.createdAt.toISOString(),
    };
  }
}
