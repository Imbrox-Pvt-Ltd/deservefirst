export class TenantCreated {
  constructor(
    public readonly tenantId: string,
    public readonly tenantName: string,
    public readonly subdomain: string,
    public readonly plan: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
