import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'webhook_deliveries' })
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'flow_id', type: 'integer', nullable: true })
  flowId!: number | null;

  @Column({ name: 'node_id', type: 'varchar', length: 255, nullable: true })
  nodeId!: string | null;

  @Column({ name: 'call_id', type: 'varchar', length: 255, nullable: true })
  callId!: string | null;

  @Column({ type: 'varchar' })
  url!: string;

  @Column({ name: 'attempt_number', type: 'integer', default: 1 })
  attemptNumber!: number;

  @Column({ name: 'http_status', type: 'integer', nullable: true })
  httpStatus!: number | null;

  @Column({ name: 'response_body', type: 'varchar', length: 500, nullable: true })
  responseBody!: string | null;

  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ name: 'error_message', type: 'varchar', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;
}
