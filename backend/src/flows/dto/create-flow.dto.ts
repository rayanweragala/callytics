import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { FlowEdgeDto } from './flow-edge.dto';
import { FlowNodeDto } from './flow-node.dto';

export class CreateFlowDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  versionMessage?: string;

  @IsOptional()
  @IsNumber()
  parentFlowId?: number;

  @IsOptional()
  @IsString()
  parentNodeKey?: string;

  @IsOptional()
  @IsString()
  parentBranchKey?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlowNodeDto)
  nodes!: FlowNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowEdgeDto)
  edges!: FlowEdgeDto[];
}
