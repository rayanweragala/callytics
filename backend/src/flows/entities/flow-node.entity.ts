import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'flow_nodes' })
export class FlowNodeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'flow_version_id', type: 'integer', nullable: true })
  flowVersionId!: number | null;

  @Column({ name: 'node_key', type: 'varchar', length: 255 })
  nodeKey!: string;

  @Column({ type: 'varchar', length: 100 })
  type!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label!: string | null;

  @Column({ name: 'position_x', type: 'double precision', default: 0 })
  positionX!: number;

  @Column({ name: 'position_y', type: 'double precision', default: 0 })
  positionY!: number;

  @Column({ name: 'config_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  configJson!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
