import { IsOptional, IsString } from 'class-validator';

export class FlowEdgeDto {
  @IsString()
  sourceNodeKey!: string;

  @IsString()
  targetNodeKey!: string;

  @IsOptional()
  @IsString()
  branchKey?: string;
}
