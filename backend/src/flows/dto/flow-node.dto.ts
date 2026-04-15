import { IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

const allowedNodeTypes = ['start', 'play_audio', 'get_digits', 'hangup', 'transfer', 'hunt', 'group'];

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
}
