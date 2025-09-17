export class TenantUpdated {
  constructor(
    public readonly tenantId: string,
    public readonly changes: Record<string, any>,
    public readonly timestamp: Date = new Date(),
  ) {}
}
