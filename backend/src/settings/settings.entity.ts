import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'settings' })
export class SettingsEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'key', type: 'varchar', length: 255, unique: true })
  key!: string;

  @Column({ name: 'value', type: 'text', nullable: true })
  value!: string | null;
}
