import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'call_flows' })
export class CallFlowEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status!: string;

  @Column({ name: 'entry_type', type: 'varchar', length: 50, default: 'default' })
  entryType!: string;

  @Column({ name: 'entry_value', type: 'varchar', length: 255, nullable: true })
  entryValue!: string | null;

  @Column({ name: 'current_version_id', type: 'integer', nullable: true })
  currentVersionId!: number | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
