import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { TenantSettings } from './tenant-settings.entity';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ unique: true })
  subdomain!: string;

  @Column()
  displayName!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ default: 'free' })
  plan!: string; // free, basic, premium, enterprise

  @Column({ type: 'json', nullable: true })
  settings!: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  customFields!: Record<string, any>;

  @Column({ nullable: true })
  logoUrl?: string;

  @Column({ nullable: true })
  websiteUrl?: string;

  @Column({ nullable: true })
  supportEmail?: string;

  @Column({ nullable: true })
  timezone!: string;

  @Column({ nullable: true })
  locale!: string;

  @Column({ default: 0 })
  maxUsers!: number;

  @Column({ default: 0 })
  maxStores!: number;

  @Column({ default: 0 })
  maxProducts!: number;

  @Column({ type: 'timestamp', nullable: true })
  trialEndsAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  subscriptionEndsAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => TenantSettings, settings => settings.tenant)
  settings!: TenantSettings[];
}
