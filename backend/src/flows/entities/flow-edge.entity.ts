import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'flow_edges' })
export class FlowEdgeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'flow_version_id', type: 'integer', nullable: true })
  flowVersionId!: number | null;

  @Column({ name: 'source_node_key', type: 'varchar', length: 255 })
  sourceNodeKey!: string;

  @Column({ name: 'target_node_key', type: 'varchar', length: 255 })
  targetNodeKey!: string;

  @Column({ name: 'branch_key', type: 'varchar', length: 100, default: 'default' })
  branchKey!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  condition!: string | null;

  @Column({ name: 'source_handle', type: 'varchar', length: 100, nullable: true })
  sourceHandle!: string | null;

  @Column({ name: 'target_handle', type: 'varchar', length: 100, nullable: true })
  targetHandle!: string | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
