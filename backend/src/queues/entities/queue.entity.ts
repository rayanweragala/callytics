import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('queues')
export class QueueEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ name: 'wait_audio_file_id', type: 'integer', nullable: true })
  waitAudioFileId!: number | null;

  @Column({ name: 'max_wait_seconds', type: 'integer', default: 300 })
  maxWaitSeconds!: number;

  @Column({ name: 'pin_retry_attempts', type: 'integer', default: 3 })
  pinRetryAttempts!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
