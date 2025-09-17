# Shopify-Style Design System

## 🎯 Overview
Create a **Shopify-inspired design system** with consistent navigation, dashboard layout, and UI components that merchants will love.

## 🎨 **Design Principles**

### **1. Shopify's Core Design Values**
- **Clarity**: Clear, intuitive interfaces
- **Efficiency**: Fast, streamlined workflows
- **Consistency**: Uniform experience across all features
- **Accessibility**: Inclusive design for all users
- **Scalability**: Works for small stores to enterprise

### **2. Visual Hierarchy**
- **Primary Actions**: Green buttons, prominent placement
- **Secondary Actions**: Gray buttons, subtle placement
- **Destructive Actions**: Red buttons, careful placement
- **Information**: Blue for links and info
- **Warning**: Orange for alerts

## 🏗️ **Layout Structure**

### **1. Main Layout (Shopify Admin Style)**
```
┌─────────────────────────────────────────────────────────────┐
│ Top Bar (Header)                                           │
├─────────────┬───────────────────────────────────────────────┤
│             │                                               │
│ Sidebar     │ Main Content Area                            │
│ Navigation  │                                               │
│             │ ┌─────────────────────────────────────────┐   │
│             │ │ Page Header (Breadcrumbs + Actions)    │   │
│             │ ├─────────────────────────────────────────┤   │
│             │ │ Content Area                            │   │
│             │ │                                         │   │
│             │ │                                         │   │
│             │ └─────────────────────────────────────────┘   │
│             │                                               │
└─────────────┴───────────────────────────────────────────────┘
```

### **2. Responsive Breakpoints**
```css
/* Mobile First Approach */
xs: 0px      /* Mobile */
sm: 640px    /* Large Mobile */
md: 768px    /* Tablet */
lg: 1024px   /* Desktop */
xl: 1280px   /* Large Desktop */
2xl: 1536px  /* Extra Large Desktop */
```

## 🎨 **Color Palette (Shopify Inspired)**

### **1. Primary Colors**
```css
:root {
  /* Shopify Green */
  --color-primary: #008060;
  --color-primary-hover: #006b51;
  --color-primary-light: #e6f7f2;
  
  /* Shopify Blue */
  --color-info: #0066cc;
  --color-info-hover: #004499;
  --color-info-light: #e6f2ff;
  
  /* Shopify Red */
  --color-danger: #d72c0d;
  --color-danger-hover: #b91c0c;
  --color-danger-light: #fef2f2;
  
  /* Shopify Orange */
  --color-warning: #ff8c00;
  --color-warning-hover: #e67e00;
  --color-warning-light: #fff7ed;
}
```

### **2. Neutral Colors**
```css
:root {
  /* Grays (Shopify Style) */
  --color-gray-50: #f9fafb;
  --color-gray-100: #f3f4f6;
  --color-gray-200: #e5e7eb;
  --color-gray-300: #d1d5db;
  --color-gray-400: #9ca3af;
  --color-gray-500: #6b7280;
  --color-gray-600: #4b5563;
  --color-gray-700: #374151;
  --color-gray-800: #1f2937;
  --color-gray-900: #111827;
  
  /* Background Colors */
  --color-background: #ffffff;
  --color-background-secondary: #f9fafb;
  --color-background-tertiary: #f3f4f6;
  
  /* Border Colors */
  --color-border: #e5e7eb;
  --color-border-light: #f3f4f6;
  --color-border-dark: #d1d5db;
}
```

## 🧩 **Component Library**

### **1. Buttons (Shopify Style)**
```tsx
// Button Variants
export const ButtonVariants = {
  primary: 'bg-green-600 hover:bg-green-700 text-white',
  secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900',
  outline: 'border border-gray-300 hover:bg-gray-50 text-gray-700',
  ghost: 'hover:bg-gray-100 text-gray-700',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  link: 'text-blue-600 hover:text-blue-800 underline'
};

// Button Sizes
export const ButtonSizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
  xl: 'px-8 py-4 text-xl'
};
```

### **2. Cards (Shopify Style)**
```tsx
// Card Component
export const Card = ({ children, className = '', ...props }) => (
  <div 
    className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}
    {...props}
  >
    {children}
  </div>
);

// Card Header
export const CardHeader = ({ children, className = '', ...props }) => (
  <div 
    className={`px-6 py-4 border-b border-gray-200 ${className}`}
    {...props}
  >
    {children}
  </div>
);

// Card Content
export const CardContent = ({ children, className = '', ...props }) => (
  <div 
    className={`px-6 py-4 ${className}`}
    {...props}
  >
    {children}
  </div>
);
```

### **3. Forms (Shopify Style)**
```tsx
// Input Component
export const Input = ({ 
  label, 
  error, 
  helpText, 
  className = '', 
  ...props 
}) => (
  <div className="space-y-1">
    {label && (
      <label className="block text-sm font-medium text-gray-700">
        {label}
      </label>
    )}
    <input
      className={`block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${error ? 'border-red-300' : ''} ${className}`}
      {...props}
    />
    {error && (
      <p className="text-sm text-red-600">{error}</p>
    )}
    {helpText && (
      <p className="text-sm text-gray-500">{helpText}</p>
    )}
  </div>
);
```

## 🧭 **Navigation System**

### **1. Sidebar Navigation (Shopify Style)**
```tsx
// Sidebar Component
export const Sidebar = ({ isOpen, onClose }) => (
  <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}>
    {/* Logo */}
    <div className="flex items-center justify-center h-16 px-4 border-b border-gray-200">
      <img src="/logo.svg" alt="Deservefirst" className="h-8" />
    </div>
    
    {/* Navigation */}
    <nav className="mt-4">
      <NavigationMenu />
    </nav>
  </div>
);

// Navigation Menu
export const NavigationMenu = () => (
  <div className="px-4 space-y-1">
    <NavigationItem 
      icon="dashboard" 
      label="Dashboard" 
      href="/dashboard" 
      active 
    />
    <NavigationItem 
      icon="products" 
      label="Products" 
      href="/products" 
    />
    <NavigationItem 
      icon="orders" 
      label="Orders" 
      href="/orders" 
    />
    <NavigationItem 
      icon="customers" 
      label="Customers" 
      href="/customers" 
    />
    <NavigationItem 
      icon="analytics" 
      label="Analytics" 
      href="/analytics" 
    />
    <NavigationItem 
      icon="settings" 
      label="Settings" 
      href="/settings" 
    />
  </div>
);
```

### **2. Top Bar (Shopify Style)**
```tsx
// Top Bar Component
export const TopBar = ({ onMenuClick }) => (
  <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-4 lg:px-6">
    {/* Left Side */}
    <div className="flex items-center space-x-4">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
      >
        <MenuIcon className="h-6 w-6" />
      </button>
      
      {/* Search */}
      <div className="hidden md:block">
        <SearchInput />
      </div>
    </div>
    
    {/* Right Side */}
    <div className="flex items-center space-x-4">
      {/* Notifications */}
      <NotificationBell />
      
      {/* User Menu */}
      <UserMenu />
    </div>
  </header>
);
```

## 📊 **Dashboard Layout**

### **1. Dashboard Grid (Shopify Style)**
```tsx
// Dashboard Component
export const Dashboard = () => (
  <div className="p-6">
    {/* Page Header */}
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="text-gray-600">Welcome back! Here's what's happening with your store.</p>
    </div>
    
    {/* Stats Grid */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <StatCard 
        title="Total Sales" 
        value="$12,345" 
        change="+12%" 
        changeType="positive" 
      />
      <StatCard 
        title="Orders" 
        value="1,234" 
        change="+8%" 
        changeType="positive" 
      />
      <StatCard 
        title="Customers" 
        value="5,678" 
        change="+15%" 
        changeType="positive" 
      />
      <StatCard 
        title="Conversion Rate" 
        value="3.2%" 
        change="-2%" 
        changeType="negative" 
      />
    </div>
    
    {/* Charts Grid */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Sales Overview</h3>
        </CardHeader>
        <CardContent>
          <SalesChart />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Top Products</h3>
        </CardHeader>
        <CardContent>
          <TopProductsList />
        </CardContent>
      </Card>
    </div>
    
    {/* Recent Activity */}
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Recent Activity</h3>
      </CardHeader>
      <CardContent>
        <RecentActivityList />
      </CardContent>
    </Card>
  </div>
);
```

### **2. Data Tables (Shopify Style)**
```tsx
// Data Table Component
export const DataTable = ({ columns, data, onSort, onFilter }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              onClick={() => onSort(column.key)}
            >
              <div className="flex items-center space-x-1">
                <span>{column.label}</span>
                {column.sortable && <SortIcon />}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {data.map((row, index) => (
          <tr key={index} className="hover:bg-gray-50">
            {columns.map((column) => (
              <td key={column.key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {column.render ? column.render(row[column.key], row) : row[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

## 📱 **Responsive Design**

### **1. Mobile Navigation**
```tsx
// Mobile Navigation
export const MobileNavigation = ({ isOpen, onClose }) => (
  <div className={`fixed inset-0 z-50 lg:hidden ${isOpen ? 'block' : 'hidden'}`}>
    {/* Backdrop */}
    <div 
      className="fixed inset-0 bg-black bg-opacity-50" 
      onClick={onClose}
    />
    
    {/* Navigation Panel */}
    <div className="fixed inset-y-0 left-0 w-64 bg-white shadow-lg">
      <Sidebar onClose={onClose} />
    </div>
  </div>
);
```

### **2. Responsive Grid**
```tsx
// Responsive Grid System
export const ResponsiveGrid = ({ children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
    {children}
  </div>
);
```

## 🎨 **Typography (Shopify Style)**

### **1. Font System**
```css
/* Font Family */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;

/* Font Sizes */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
```

### **2. Font Weights**
```css
.font-light { font-weight: 300; }
.font-normal { font-weight: 400; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.font-extrabold { font-weight: 800; }
```

## 🎯 **Implementation Strategy**

### **1. Phase 1: Core Components** (Week 1)
- Button, Input, Card components
- Basic layout structure
- Color system and typography

### **2. Phase 2: Navigation** (Week 1-2)
- Sidebar navigation
- Top bar with search
- Mobile responsive navigation

### **3. Phase 3: Dashboard** (Week 2)
- Dashboard layout
- Data tables
- Charts and analytics

### **4. Phase 4: Advanced Features** (Week 3)
- Advanced forms
- Modals and overlays
- Loading states and animations

This design system will give you the **exact Shopify experience** that merchants love, with consistent navigation, beautiful components, and responsive design! 🚀
