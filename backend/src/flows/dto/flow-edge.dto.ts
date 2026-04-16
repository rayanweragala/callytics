import { IsIn, IsOptional, IsString } from 'class-validator';

const allowedConditions = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'timeout', 'invalid', 'default', 'complete'];

export class FlowEdgeDto {
  @IsString()
  sourceNodeKey!: string;

  @IsString()
  targetNodeKey!: string;

  @IsOptional()
  @IsString()
  branchKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(allowedConditions)
  condition?: string;
}
