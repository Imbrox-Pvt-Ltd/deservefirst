import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { TenantCreated } from '../events/tenant-created.event';
import { TenantUpdated } from '../events/tenant-updated.event';

export interface CreateTenantDto {
  name: string;
  subdomain: string;
  displayName: string;
  description?: string;
  plan?: string;
  settings?: Record<string, any>;
  customFields?: Record<string, any>;
  logoUrl?: string;
  websiteUrl?: string;
  supportEmail?: string;
  timezone?: string;
  locale?: string;
  maxUsers?: number;
  maxStores?: number;
  maxProducts?: number;
  trialEndsAt?: Date;
}

export interface UpdateTenantDto {
  displayName?: string;
  description?: string;
  plan?: string;
  settings?: Record<string, any>;
  customFields?: Record<string, any>;
  logoUrl?: string;
  websiteUrl?: string;
  supportEmail?: string;
  timezone?: string;
  locale?: string;
  maxUsers?: number;
  maxStores?: number;
  maxProducts?: number;
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date;
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async findAll(): Promise<Tenant[]> {
    this.logger.log('Finding all tenants');
    return this.tenantRepository.find({
      relations: ['settings'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Tenant> {
    this.logger.log(`Finding tenant with id: ${id}`);
    const tenant = await this.tenantRepository.findOne({
      where: { id },
      relations: ['settings'],
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with id ${id} not found`);
    }

    return tenant;
  }

  async findBySubdomain(subdomain: string): Promise<Tenant> {
    this.logger.log(`Finding tenant with subdomain: ${subdomain}`);
    const tenant = await this.tenantRepository.findOne({
      where: { subdomain },
      relations: ['settings'],
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with subdomain ${subdomain} not found`);
    }

    return tenant;
  }

  async create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    this.logger.log(`Creating tenant: ${createTenantDto.name}`);

    // Check if tenant with same name or subdomain already exists
    const existingTenant = await this.tenantRepository.findOne({
      where: [
        { name: createTenantDto.name },
        { subdomain: createTenantDto.subdomain },
      ],
    });

    if (existingTenant) {
      throw new ConflictException('Tenant with this name or subdomain already exists');
    }

    const tenant = this.tenantRepository.create({
      ...createTenantDto,
      active: true,
      plan: createTenantDto.plan || 'free',
      settings: createTenantDto.settings || {},
      customFields: createTenantDto.customFields || {},
      timezone: createTenantDto.timezone || 'UTC',
      locale: createTenantDto.locale || 'en',
      maxUsers: createTenantDto.maxUsers || 0,
      maxStores: createTenantDto.maxStores || 0,
      maxProducts: createTenantDto.maxProducts || 0,
    });

    const savedTenant = await this.tenantRepository.save(tenant);

    // Emit tenant created event
    this.logger.log(`Tenant created: ${savedTenant.id}`);
    // TODO: Emit TenantCreated event

    return savedTenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto): Promise<Tenant> {
    this.logger.log(`Updating tenant: ${id}`);

    const tenant = await this.findOne(id);
    
    Object.assign(tenant, updateTenantDto);
    const updatedTenant = await this.tenantRepository.save(tenant);

    // Emit tenant updated event
    this.logger.log(`Tenant updated: ${updatedTenant.id}`);
    // TODO: Emit TenantUpdated event

    return updatedTenant;
  }

  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting tenant: ${id}`);

    const tenant = await this.findOne(id);
    await this.tenantRepository.remove(tenant);

    this.logger.log(`Tenant deleted: ${id}`);
    return true;
  }

  async activate(id: string): Promise<Tenant> {
    this.logger.log(`Activating tenant: ${id}`);
    return this.update(id, { active: true });
  }

  async deactivate(id: string): Promise<Tenant> {
    this.logger.log(`Deactivating tenant: ${id}`);
    return this.update(id, { active: false });
  }

  async updatePlan(id: string, plan: string): Promise<Tenant> {
    this.logger.log(`Updating tenant plan: ${id} to ${plan}`);
    return this.update(id, { plan });
  }

  async getTenantStats(id: string): Promise<Record<string, any>> {
    this.logger.log(`Getting tenant stats: ${id}`);
    
    const tenant = await this.findOne(id);
    
    // TODO: Implement actual stats calculation
    return {
      tenantId: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      active: tenant.active,
      createdAt: tenant.createdAt,
      // Add more stats as needed
    };
  }

  async searchTenants(query: string): Promise<Tenant[]> {
    this.logger.log(`Searching tenants with query: ${query}`);
    
    return this.tenantRepository
      .createQueryBuilder('tenant')
      .where('tenant.name ILIKE :query', { query: `%${query}%` })
      .orWhere('tenant.displayName ILIKE :query', { query: `%${query}%` })
      .orWhere('tenant.subdomain ILIKE :query', { query: `%${query}%` })
      .getMany();
  }
}
