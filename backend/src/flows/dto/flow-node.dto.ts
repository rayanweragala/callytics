import { IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

const allowedNodeTypes = ['start', 'play_audio', 'get_digits', 'menu', 'hangup', 'transfer', 'hunt', 'group', 'business_hours', 'voicemail', 'webhook', 'queue_login', 'queue', 'conference', 'callback'];

export type TransferTargetType = 'extension' | 'pstn' | 'sip_uri';

export interface TransferNodeConfig {
  target_type: TransferTargetType;
  target_value: string;
  trunk_id?: number;
  timeout_ms?: number;
}

export interface HuntDestination {
  target_type: 'extension' | 'pstn';
  target_value: string;
  trunk_id?: number;
}

export interface HuntNodeConfig {
  destinations: HuntDestination[];
  ring_timeout_ms?: number;
}

export class FlowNodeDto {
  @IsString()
  nodeKey!: string;

  @IsString()
  @IsIn(allowedNodeTypes)
  type!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  groupId?: string | null;

  @IsOptional()
  @IsNumber()
  subflowId?: number | null;
}
