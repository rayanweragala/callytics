import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { BackupInterval } from '../backup.types';

@Entity({ name: 'backup_config' })
export class BackupConfigEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 32 })
  interval!: BackupInterval;

  @Column({ name: 'cron_expression', type: 'varchar', length: 120, nullable: true })
  cronExpression!: string | null;

  @Column({ name: 'include_recordings', type: 'boolean', default: true })
  includeRecordings!: boolean;

  @Column({ name: 'retention_count', type: 'integer', default: 5 })
  retentionCount!: number;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt!: Date;
}
