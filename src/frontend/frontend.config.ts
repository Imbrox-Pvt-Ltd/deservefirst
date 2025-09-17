export interface FrontendConfig {
  // Theme Configuration
  theme: {
    name: string;
    version: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    borderColor: string;
    shadowColor: string;
    borderRadius: string;
    fontFamily: string;
    fontSize: {
      xs: string;
      sm: string;
      base: string;
      lg: string;
      xl: string;
      '2xl': string;
      '3xl': string;
    };
    spacing: {
      xs: string;
      sm: string;
      md: string;
      lg: string;
      xl: string;
      '2xl': string;
    };
    breakpoints: {
      sm: string;
      md: string;
      lg: string;
      xl: string;
      '2xl': string;
    };
  };

  // Layout Configuration
  layout: {
    header: {
      height: string;
      sticky: boolean;
      transparent: boolean;
      showLogo: boolean;
      showSearch: boolean;
      showNotifications: boolean;
      showUserMenu: boolean;
    };
    sidebar: {
      width: string;
      collapsedWidth: string;
      collapsible: boolean;
      defaultCollapsed: boolean;
      showLogo: boolean;
      showUserInfo: boolean;
    };
    footer: {
      height: string;
      showCopyright: boolean;
      showLinks: boolean;
      showSocial: boolean;
    };
    content: {
      padding: string;
      maxWidth: string;
      minHeight: string;
    };
  };

  // Component Configuration
  components: {
    buttons: {
      primary: {
        backgroundColor: string;
        textColor: string;
        borderColor: string;
        hoverBackgroundColor: string;
        disabledBackgroundColor: string;
      };
      secondary: {
        backgroundColor: string;
        textColor: string;
        borderColor: string;
        hoverBackgroundColor: string;
        disabledBackgroundColor: string;
      };
      sizes: {
        sm: string;
        md: string;
        lg: string;
      };
    };
    inputs: {
      backgroundColor: string;
      borderColor: string;
      focusBorderColor: string;
      errorBorderColor: string;
      textColor: string;
      placeholderColor: string;
      disabledBackgroundColor: string;
    };
    cards: {
      backgroundColor: string;
      borderColor: string;
      shadowColor: string;
      borderRadius: string;
      padding: string;
    };
    tables: {
      headerBackgroundColor: string;
      rowBackgroundColor: string;
      alternateRowBackgroundColor: string;
      borderColor: string;
      hoverBackgroundColor: string;
    };
    modals: {
      backgroundColor: string;
      overlayColor: string;
      borderRadius: string;
      shadowColor: string;
      maxWidth: string;
    };
  };

  // Skeleton Loading Configuration
  skeleton: {
    enabled: boolean;
    animation: 'pulse' | 'wave' | 'shimmer';
    duration: number; // milliseconds
    colors: {
      base: string;
      highlight: string;
    };
    components: {
      card: boolean;
      table: boolean;
      form: boolean;
      list: boolean;
      chart: boolean;
      image: boolean;
    };
  };

  // Navigation Configuration
  navigation: {
    main: {
      items: Array<{
        id: string;
        label: string;
        icon: string;
        path: string;
        children?: Array<{
          id: string;
          label: string;
          path: string;
          icon?: string;
        }>;
      }>;
    };
    user: {
      items: Array<{
        id: string;
        label: string;
        icon: string;
        path: string;
        divider?: boolean;
      }>;
    };
    breadcrumb: {
      enabled: boolean;
      showHome: boolean;
      separator: string;
    };
  };

  // Page Configuration
  pages: {
    dashboard: {
      title: string;
      description: string;
      widgets: string[];
      layout: 'grid' | 'list' | 'custom';
    };
    settings: {
      title: string;
      description: string;
      sections: string[];
      layout: 'tabs' | 'accordion' | 'custom';
    };
    profile: {
      title: string;
      description: string;
      sections: string[];
      layout: 'tabs' | 'accordion' | 'custom';
    };
  };

  // Responsive Configuration
  responsive: {
    mobile: {
      enabled: boolean;
      breakpoint: string;
      sidebar: 'overlay' | 'hidden' | 'collapsed';
      header: 'compact' | 'full';
    };
    tablet: {
      enabled: boolean;
      breakpoint: string;
      sidebar: 'collapsed' | 'full';
      header: 'full';
    };
    desktop: {
      enabled: boolean;
      breakpoint: string;
      sidebar: 'full';
      header: 'full';
    };
  };

  // Animation Configuration
  animations: {
    enabled: boolean;
    duration: {
      fast: number;
      normal: number;
      slow: number;
    };
    easing: {
      easeIn: string;
      easeOut: string;
      easeInOut: string;
    };
    transitions: {
      fade: boolean;
      slide: boolean;
      scale: boolean;
      rotate: boolean;
    };
  };

  // Accessibility Configuration
  accessibility: {
    enabled: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
    focusVisible: boolean;
    keyboardNavigation: boolean;
    screenReader: boolean;
  };

  // Internationalization Configuration
  i18n: {
    enabled: boolean;
    defaultLanguage: string;
    supportedLanguages: string[];
    fallbackLanguage: string;
    rtl: boolean;
  };

  // Performance Configuration
  performance: {
    lazyLoading: boolean;
    codeSplitting: boolean;
    imageOptimization: boolean;
    cssOptimization: boolean;
    jsOptimization: boolean;
    preloading: boolean;
  };
}

export const defaultFrontendConfig: FrontendConfig = {
  theme: {
    name: 'Deservefirst Theme',
    version: '1.0.0',
    primaryColor: '#008060', // Shopify green
    secondaryColor: '#6B7280',
    accentColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    borderColor: '#E5E7EB',
    shadowColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: '8px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
      '2xl': '3rem',
    },
    breakpoints: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  },

  layout: {
    header: {
      height: '64px',
      sticky: true,
      transparent: false,
      showLogo: true,
      showSearch: true,
      showNotifications: true,
      showUserMenu: true,
    },
    sidebar: {
      width: '256px',
      collapsedWidth: '64px',
      collapsible: true,
      defaultCollapsed: false,
      showLogo: true,
      showUserInfo: true,
    },
    footer: {
      height: '80px',
      showCopyright: true,
      showLinks: true,
      showSocial: false,
    },
    content: {
      padding: '1.5rem',
      maxWidth: '1200px',
      minHeight: 'calc(100vh - 64px)',
    },
  },

  components: {
    buttons: {
      primary: {
        backgroundColor: '#008060',
        textColor: '#FFFFFF',
        borderColor: '#008060',
        hoverBackgroundColor: '#006B4F',
        disabledBackgroundColor: '#D1D5DB',
      },
      secondary: {
        backgroundColor: '#FFFFFF',
        textColor: '#374151',
        borderColor: '#D1D5DB',
        hoverBackgroundColor: '#F9FAFB',
        disabledBackgroundColor: '#F3F4F6',
      },
      sizes: {
        sm: '0.5rem 0.75rem',
        md: '0.75rem 1rem',
        lg: '1rem 1.5rem',
      },
    },
    inputs: {
      backgroundColor: '#FFFFFF',
      borderColor: '#D1D5DB',
      focusBorderColor: '#008060',
      errorBorderColor: '#EF4444',
      textColor: '#374151',
      placeholderColor: '#9CA3AF',
      disabledBackgroundColor: '#F9FAFB',
    },
    cards: {
      backgroundColor: '#FFFFFF',
      borderColor: '#E5E7EB',
      shadowColor: 'rgba(0, 0, 0, 0.1)',
      borderRadius: '8px',
      padding: '1.5rem',
    },
    tables: {
      headerBackgroundColor: '#F9FAFB',
      rowBackgroundColor: '#FFFFFF',
      alternateRowBackgroundColor: '#F9FAFB',
      borderColor: '#E5E7EB',
      hoverBackgroundColor: '#F3F4F6',
    },
    modals: {
      backgroundColor: '#FFFFFF',
      overlayColor: 'rgba(0, 0, 0, 0.5)',
      borderRadius: '8px',
      shadowColor: 'rgba(0, 0, 0, 0.25)',
      maxWidth: '500px',
    },
  },

  skeleton: {
    enabled: true,
    animation: 'pulse',
    duration: 1500,
    colors: {
      base: '#E5E7EB',
      highlight: '#F3F4F6',
    },
    components: {
      card: true,
      table: true,
      form: true,
      list: true,
      chart: true,
      image: true,
    },
  },

  navigation: {
    main: {
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          icon: 'home',
          path: '/dashboard',
        },
        {
          id: 'modules',
          label: 'Modules',
          icon: 'puzzle',
          path: '/modules',
          children: [
            {
              id: 'core',
              label: 'Core Module',
              path: '/modules/core',
              icon: 'settings',
            },
            {
              id: 'rbac',
              label: 'RBAC Module',
              path: '/modules/rbac',
              icon: 'shield',
            },
            {
              id: 'cms',
              label: 'CMS Module',
              path: '/modules/cms',
              icon: 'document',
            },
          ],
        },
        {
          id: 'security',
          label: 'Security',
          icon: 'lock-closed',
          path: '/security',
        },
        {
          id: 'performance',
          label: 'Performance',
          icon: 'chart-bar',
          path: '/performance',
        },
        {
          id: 'settings',
          label: 'Settings',
          icon: 'cog',
          path: '/settings',
        },
      ],
    },
    user: {
      items: [
        {
          id: 'profile',
          label: 'Profile',
          icon: 'user',
          path: '/profile',
        },
        {
          id: 'preferences',
          label: 'Preferences',
          icon: 'adjustments',
          path: '/preferences',
        },
        {
          id: 'logout',
          label: 'Logout',
          icon: 'logout',
          path: '/logout',
          divider: true,
        },
      ],
    },
    breadcrumb: {
      enabled: true,
      showHome: true,
      separator: '/',
    },
  },

  pages: {
    dashboard: {
      title: 'Dashboard',
      description: 'Overview of your Deservefirst platform',
      widgets: ['stats', 'recent-activity', 'system-health', 'quick-actions'],
      layout: 'grid',
    },
    settings: {
      title: 'Settings',
      description: 'Configure your platform settings',
      sections: ['general', 'security', 'performance', 'modules'],
      layout: 'tabs',
    },
    profile: {
      title: 'Profile',
      description: 'Manage your user profile',
      sections: ['personal', 'security', 'preferences', 'notifications'],
      layout: 'tabs',
    },
  },

  responsive: {
    mobile: {
      enabled: true,
      breakpoint: '768px',
      sidebar: 'overlay',
      header: 'compact',
    },
    tablet: {
      enabled: true,
      breakpoint: '1024px',
      sidebar: 'collapsed',
      header: 'full',
    },
    desktop: {
      enabled: true,
      breakpoint: '1280px',
      sidebar: 'full',
      header: 'full',
    },
  },

  animations: {
    enabled: true,
    duration: {
      fast: 150,
      normal: 300,
      slow: 500,
    },
    easing: {
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    transitions: {
      fade: true,
      slide: true,
      scale: true,
      rotate: false,
    },
  },

  accessibility: {
    enabled: true,
    highContrast: false,
    reducedMotion: false,
    focusVisible: true,
    keyboardNavigation: true,
    screenReader: true,
  },

  i18n: {
    enabled: true,
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'es', 'fr'],
    fallbackLanguage: 'en',
    rtl: false,
  },

  performance: {
    lazyLoading: true,
    codeSplitting: true,
    imageOptimization: true,
    cssOptimization: true,
    jsOptimization: true,
    preloading: true,
  },
};
