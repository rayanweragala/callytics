import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('operators')
export class OperatorEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'pin_hash', type: 'text' })
  pinHash!: string;

  @Column({ name: 'extension_id', type: 'integer', nullable: true })
  extensionId!: number | null;

  @Column({ name: 'contact_number_id', type: 'integer', nullable: true })
  contactNumberId!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
