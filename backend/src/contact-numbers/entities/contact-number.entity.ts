import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_numbers')
export class ContactNumberEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'varchar', length: 50 })
  number!: string;

  @Column({ name: 'trunk_id', type: 'integer', nullable: true })
  trunkId!: number | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;
}
