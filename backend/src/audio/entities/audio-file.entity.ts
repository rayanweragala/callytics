import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'audio_files' })
export class AudioFileEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType!: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 255, nullable: true })
  originalFilename!: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 255, nullable: true })
  mimeType!: string | null;

  @Column({ name: 'duration_ms', type: 'integer', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'storage_path_original', type: 'text', nullable: true })
  storagePathOriginal!: string | null;

  @Column({ name: 'storage_path_converted', type: 'text', nullable: true })
  storagePathConverted!: string | null;

  @Column({ name: 'storage_path_preview', type: 'text', nullable: true })
  storagePathPreview!: string | null;

  @Column({ name: 'conversion_status', type: 'varchar', length: 50, default: 'pending' })
  conversionStatus!: string;

  @Column({ name: 'tts_text', type: 'text', nullable: true })
  ttsText!: string | null;

  @Column({ name: 'tts_voice', type: 'varchar', length: 255, nullable: true })
  ttsVoice!: string | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
