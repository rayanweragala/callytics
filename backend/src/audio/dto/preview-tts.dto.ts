import { IsNumber, IsString, Max, Min } from 'class-validator';

export class PreviewTtsDto {
  @IsString()
  text!: string;

  @IsString()
  voice!: string;

  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed: number = 1;
}
