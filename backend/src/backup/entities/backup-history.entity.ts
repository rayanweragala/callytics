import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { BackupStatus, BackupType } from '../backup.types';

@Entity({ name: 'backup_history' })
export class BackupHistoryEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: BackupType;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: BackupStatus;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
