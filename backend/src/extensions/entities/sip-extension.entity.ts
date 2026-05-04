import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'sip_extensions' })
export class SipExtensionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  username!: string;

  @Column({ type: 'varchar', length: 128 })
  password!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 128, nullable: true })
  displayName!: string | null;

  @Column({ name: 'transport_type', type: 'varchar', length: 20, default: 'sip' })
  transportType!: 'sip' | 'webrtc';

  @Column({ name: 'vpn_only', type: 'boolean', default: false })
  vpnOnly!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;
}
