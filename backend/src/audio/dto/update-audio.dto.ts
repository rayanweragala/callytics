import { IsString } from 'class-validator';

export class UpdateAudioDto {
  @IsString()
  name!: string;
}
