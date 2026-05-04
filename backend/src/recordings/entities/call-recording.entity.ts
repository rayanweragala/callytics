import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'call_recordings' })
export class CallRecordingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'call_id', type: 'varchar', length: 255 })
  callId!: string;

  @Column({ name: 'channel_id', type: 'varchar', length: 255 })
  channelId!: string;

  @Column({ name: 'flow_id', type: 'integer', nullable: true })
  flowId!: number | null;

  @Column({ name: 'file_name', type: 'varchar', length: 500 })
  fileName!: string;

  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath!: string;

  @Column({ type: 'varchar', length: 20, default: 'wav' })
  format!: string;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds!: number | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
