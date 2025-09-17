import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('tenant_settings')
export class TenantSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tenantId!: string;

  @Column()
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ default: 'string' })
  type!: string; // string, number, boolean, json, array

  @Column({ default: false })
  isSecret!: boolean;

  @Column({ default: false })
  isRequired!: boolean;

  @Column({ type: 'json', nullable: true })
  validation!: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => Tenant, tenant => tenant.settings)
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;
}
