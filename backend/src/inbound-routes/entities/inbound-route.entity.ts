import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'inbound_routes' })
export class InboundRouteEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 32, unique: true })
  did!: string;

  @Column({ name: 'flow_id', type: 'integer' })
  flowId!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  label!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;
}
