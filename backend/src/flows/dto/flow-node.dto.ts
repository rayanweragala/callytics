import { IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class FlowNodeDto {
  @IsString()
  nodeKey!: string;

  @IsString()
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
}
