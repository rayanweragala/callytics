import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class CreateBackupDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeRecordings!: boolean;
}
