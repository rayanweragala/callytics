import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class RestoreBackupQueryDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  restoreDb!: boolean;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  restoreRecordings!: boolean;
}
