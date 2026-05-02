import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sip_trunks' })
export class SipTrunkEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'provider_preset', type: 'varchar', length: 50, default: 'generic' })
  providerPreset!: string;

  @Column({ type: 'varchar', length: 255 })
  host!: string;

  @Column({ type: 'integer', default: 5060 })
  port!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password!: string | null;

  @Column({ name: 'from_domain', type: 'varchar', length: 255, nullable: true })
  fromDomain!: string | null;

  @Column({ name: 'from_user', type: 'varchar', length: 255, nullable: true })
  fromUser!: string | null;

  @Column({ name: 'dial_format', type: 'varchar', length: 50, default: '{number}' })
  dialFormat!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'NOW()' })
  createdAt!: Date;
}
