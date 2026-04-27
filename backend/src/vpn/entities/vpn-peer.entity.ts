import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'vpn_peers' })
export class VpnPeerEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'assigned_ip', type: 'inet', unique: true })
  assignedIp!: string;

  @Column({ name: 'public_key', type: 'text', unique: true })
  publicKey!: string;

  @Column({ name: 'private_key', type: 'text' })
  privateKey!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
