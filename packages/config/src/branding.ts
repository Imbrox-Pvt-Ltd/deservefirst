/**
 * Config · branding.ts
 * The single source for the platform name and every brand value (§33.1). Nothing
 * anywhere else may hardcode a brand string — renaming the platform is a one-file
 * change, and a fitness function fails the build on any hardcoded occurrence.
 * Layer: config (no framework, no I/O).
 */

export interface BrandingConfig {
  /** Product name as shown to users. */
  readonly platformName: string;
  /** Legal entity behind the product. */
  readonly legalName: string;
  /** Lowercase, URL-safe form used in package names, gids and storage prefixes. */
  readonly slug: string;
  readonly supportEmail: string;
  /**
   * Release train, shown as a pill beside the wordmark. Merchants and support
   * both need to know which shape of the admin they are looking at without
   * asking for a build number.
   */
  readonly release: string;
  readonly domains: {
    readonly marketing: string;
    readonly accounts: string;
    readonly admin: string;
    readonly partners: string;
    readonly developers: string;
    readonly api: string;
    readonly storefront: string;
  };
  readonly logo: {
    readonly light: string;
    readonly dark: string;
    readonly mark: string;
  };
}

/**
 * Values are placeholders until the brand is finalised; every consumer reads
 * through this object so changing them is a single edit.
 */
export const branding: BrandingConfig = {
  platformName: 'DeserveFirst',
  legalName: 'Deservefirst Pvt. Ltd.',
  slug: 'deservefirst',
  supportEmail: 'support@deservefirst.example',
  release: 'Autumn ’26',
  domains: {
    marketing: 'deservefirst.example',
    accounts: 'accounts.deservefirst.example',
    admin: 'admin.deservefirst.example',
    partners: 'partners.deservefirst.example',
    developers: 'dev.deservefirst.example',
    api: 'api.deservefirst.example',
    storefront: 'stores.deservefirst.example',
  },
  logo: {
    light: '/brand/logo-light.svg',
    dark: '/brand/logo-dark.svg',
    mark: '/brand/mark.svg',
  },
};

/**
 * Third-party platform aliases (§33.3). Shipped code, comments, UI and public
 * docs must never name a competitor platform; where an internal reference is
 * genuinely unavoidable, use these codenames. The lint rule in
 * tools/fitness enforces this.
 */
export const platformAliases = {
  SC: 'reference commerce platform',
  MP: 'reference content platform',
  WTO: 'reference modular commerce platform',
} as const;

export type PlatformAlias = keyof typeof platformAliases;
