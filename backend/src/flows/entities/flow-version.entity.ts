import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'flow_versions' })
export class FlowVersionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'flow_id', type: 'integer', nullable: true })
  flowId!: number | null;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber!: number;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
