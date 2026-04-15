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

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot!: Record<string, unknown> | null;

  @Column({ name: 'node_count', type: 'integer', nullable: true })
  nodeCount!: number | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
