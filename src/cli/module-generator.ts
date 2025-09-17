import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export interface ModuleTemplate {
  name: string;
  description: string;
  version: string;
  author: string;
  dependencies: string[];
  provides: string[];
  requires: string[];
  services: string[];
  controllers: string[];
  entities: string[];
  events: string[];
  hooks: string[];
  customFields: boolean;
  storeLevel: boolean;
}

export class ModuleGenerator {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start the interactive module generation process
   */
  async generateModule(): Promise<void> {
    console.log('🚀 Deservefirst Module Generator');
    console.log('================================\n');

    try {
      const template = await this.collectModuleInfo();
      await this.createModuleStructure(template);
      await this.generatePackageJson(template);
      await this.generateModuleFiles(template);
      await this.generateDocumentation(template);
      
      console.log('\n✅ Module generated successfully!');
      console.log(`📦 Module: @deservefirst/${template.name}`);
      console.log(`📁 Location: modules/@deservefirst/${template.name}`);
      console.log('\n🔧 Next steps:');
      console.log('1. cd modules/@deservefirst/' + template.name);
      console.log('2. npm install');
      console.log('3. npm run build');
      console.log('4. npm publish');
      
    } catch (error) {
      console.error('❌ Error generating module:', error);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Collect module information interactively
   */
  private async collectModuleInfo(): Promise<ModuleTemplate> {
    const name = await this.question('Module name (e.g., tenant-module): ');
    const description = await this.question('Description: ');
    const version = await this.question('Version (1.0.0): ') || '1.0.0';
    const author = await this.question('Author: ');

    console.log('\n📋 Module Features:');
    const hasServices = await this.yesNo('Include services? (y/n): ');
    const hasControllers = await this.yesNo('Include controllers? (y/n): ');
    const hasEntities = await this.yesNo('Include entities? (y/n): ');
    const hasEvents = await this.yesNo('Include events? (y/n): ');
    const hasHooks = await this.yesNo('Include hooks? (y/n): ');
    const hasCustomFields = await this.yesNo('Support custom fields? (y/n): ');
    const isStoreLevel = await this.yesNo('Store-level module? (y/n): ');

    const services: string[] = [];
    const controllers: string[] = [];
    const entities: string[] = [];
    const events: string[] = [];
    const hooks: string[] = [];

    if (hasServices) {
      const serviceCount = parseInt(await this.question('Number of services: ') || '1');
      for (let i = 0; i < serviceCount; i++) {
        services.push(await this.question(`Service ${i + 1} name: `));
      }
    }

    if (hasControllers) {
      const controllerCount = parseInt(await this.question('Number of controllers: ') || '1');
      for (let i = 0; i < controllerCount; i++) {
        controllers.push(await this.question(`Controller ${i + 1} name: `));
      }
    }

    if (hasEntities) {
      const entityCount = parseInt(await this.question('Number of entities: ') || '1');
      for (let i = 0; i < entityCount; i++) {
        entities.push(await this.question(`Entity ${i + 1} name: `));
      }
    }

    if (hasEvents) {
      const eventCount = parseInt(await this.question('Number of events: ') || '1');
      for (let i = 0; i < eventCount; i++) {
        events.push(await this.question(`Event ${i + 1} name: `));
      }
    }

    if (hasHooks) {
      const hookCount = parseInt(await this.question('Number of hooks: ') || '1');
      for (let i = 0; i < hookCount; i++) {
        hooks.push(await this.question(`Hook ${i + 1} name: `));
      }
    }

    const dependencies: string[] = [];
    const provides: string[] = [];
    const requires: string[] = [];

    if (isStoreLevel) {
      provides.push('store-level-module');
    }

    return {
      name,
      description,
      version,
      author,
      dependencies,
      provides,
      requires,
      services,
      controllers,
      entities,
      events,
      hooks,
      customFields: hasCustomFields,
      storeLevel: isStoreLevel,
    };
  }

  /**
   * Create the module directory structure
   */
  private async createModuleStructure(template: ModuleTemplate): Promise<void> {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', template.name);
    
    // Create main directories
    const dirs = [
      'src',
      'src/services',
      'src/controllers',
      'src/entities',
      'src/events',
      'src/hooks',
      'src/schemas',
      'src/tests',
      'src/tests/unit',
      'src/tests/integration',
      'docs',
      'public',
    ];

    for (const dir of dirs) {
      const dirPath = path.join(modulePath, dir);
      await fs.promises.mkdir(dirPath, { recursive: true });
    }

    console.log('📁 Created directory structure');
  }

  /**
   * Generate package.json for the module
   */
  private async generatePackageJson(template: ModuleTemplate): Promise<void> {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', template.name);
    const packageJson = {
      name: `@deservefirst/${template.name}`,
      version: template.version,
      description: template.description,
      author: template.author,
      license: 'MIT',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      scripts: {
        build: 'tsc',
        dev: 'tsc --watch',
        test: 'jest',
        'test:watch': 'jest --watch',
        'test:coverage': 'jest --coverage',
        lint: 'eslint src/**/*.ts',
        'lint:fix': 'eslint src/**/*.ts --fix',
        prepublishOnly: 'npm run build',
      },
      keywords: [
        'deservefirst',
        'module',
        'ecommerce',
        'saas',
        ...(template.storeLevel ? ['store-level'] : []),
        ...(template.customFields ? ['custom-fields'] : []),
      ],
      peerDependencies: {
        '@nestjs/common': '^10.0.0',
        '@nestjs/core': '^10.0.0',
        '@nestjs/typeorm': '^10.0.0',
        'typeorm': '^0.3.0',
      },
      devDependencies: {
        '@types/node': '^20.0.0',
        'typescript': '^5.0.0',
        'jest': '^29.0.0',
        '@types/jest': '^29.0.0',
        'eslint': '^8.0.0',
        '@typescript-eslint/eslint-plugin': '^6.0.0',
        '@typescript-eslint/parser': '^6.0.0',
      },
      deservefirst: {
        module: true,
        version: template.version,
        dependencies: template.dependencies,
        provides: template.provides,
        requires: template.requires,
        services: template.services,
        controllers: template.controllers,
        entities: template.entities,
        events: template.events,
        hooks: template.hooks,
        customFields: template.customFields,
        storeLevel: template.storeLevel,
        moduleClass: 'src/index.ts',
      },
      files: [
        'dist',
        'src',
        'docs',
        'README.md',
        'LICENSE',
      ],
    };

    await fs.promises.writeFile(
      path.join(modulePath, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );

    console.log('📦 Generated package.json');
  }

  /**
   * Generate module files
   */
  private async generateModuleFiles(template: ModuleTemplate): Promise<void> {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', template.name);
    
    // Generate main index.ts
    await this.generateIndexFile(template, modulePath);
    
    // Generate module class
    await this.generateModuleClass(template, modulePath);
    
    // Generate services
    for (const service of template.services) {
      await this.generateService(template, service, modulePath);
    }
    
    // Generate controllers
    for (const controller of template.controllers) {
      await this.generateController(template, controller, modulePath);
    }
    
    // Generate entities
    for (const entity of template.entities) {
      await this.generateEntity(template, entity, modulePath);
    }
    
    // Generate events
    for (const event of template.events) {
      await this.generateEvent(template, event, modulePath);
    }
    
    // Generate hooks
    for (const hook of template.hooks) {
      await this.generateHook(template, hook, modulePath);
    }
    
    // Generate TypeScript config
    await this.generateTsConfig(modulePath);
    
    // Generate Jest config
    await this.generateJestConfig(modulePath);
    
    // Generate ESLint config
    await this.generateEslintConfig(modulePath);
  }

  /**
   * Generate main index.ts file
   */
  private async generateIndexFile(template: ModuleTemplate, modulePath: string): Promise<void> {
    const content = `export * from './src/index';
export * from './src/services';
export * from './src/controllers';
export * from './src/entities';
export * from './src/events';
export * from './src/hooks';
`;
    
    await fs.promises.writeFile(path.join(modulePath, 'src', 'index.ts'), content);
    console.log('📄 Generated src/index.ts');
  }

  /**
   * Generate module class
   */
  private async generateModuleClass(template: ModuleTemplate, modulePath: string): Promise<void> {
    const serviceImports = template.services.map(s => `import { ${s}Service } from './services/${s}.service';`).join('\n');
    const controllerImports = template.controllers.map(c => `import { ${c}Controller } from './controllers/${c}.controller';`).join('\n');
    const entityImports = template.entities.map(e => `import { ${e} } from './entities/${e}.entity';`).join('\n');

    const content = `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
${serviceImports}
${controllerImports}
${entityImports}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ${template.entities.map(e => e).join(',\n      ')}
    ]),
  ],
  controllers: [
    ${template.controllers.map(c => `${c}Controller`).join(',\n    ')}
  ],
  providers: [
    ${template.services.map(s => `${s}Service`).join(',\n    ')}
  ],
  exports: [
    ${template.services.map(s => `${s}Service`).join(',\n    ')}
  ],
})
export class ${this.toPascalCase(template.name)}Module {}
`;
    
    await fs.promises.writeFile(path.join(modulePath, 'src', 'index.ts'), content);
    console.log('📄 Generated module class');
  }

  /**
   * Generate service file
   */
  private async generateService(template: ModuleTemplate, serviceName: string, modulePath: string): Promise<void> {
    const content = `import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ${serviceName}Service {
  private readonly logger = new Logger(${serviceName}Service.name);

  constructor() {
    this.logger.log('${serviceName}Service initialized');
  }

  // Add your service methods here
  async findAll(): Promise<any[]> {
    return [];
  }

  async findOne(id: string): Promise<any> {
    return null;
  }

  async create(data: any): Promise<any> {
    return data;
  }

  async update(id: string, data: any): Promise<any> {
    return { id, ...data };
  }

  async delete(id: string): Promise<boolean> {
    return true;
  }
}
`;
    
    await fs.promises.writeFile(
      path.join(modulePath, 'src', 'services', `${serviceName}.service.ts`),
      content
    );
    console.log(`📄 Generated ${serviceName}Service`);
  }

  /**
   * Generate controller file
   */
  private async generateController(template: ModuleTemplate, controllerName: string, modulePath: string): Promise<void> {
    const content = `import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ${controllerName}Service } from '../services/${controllerName}.service';

@ApiTags('${controllerName.toLowerCase()}')
@Controller('${controllerName.toLowerCase()}')
export class ${controllerName}Controller {
  constructor(private readonly ${controllerName.toLowerCase()}Service: ${controllerName}Service) {}

  @Get()
  @ApiOperation({ summary: 'Get all ${controllerName.toLowerCase()}' })
  @ApiResponse({ status: 200, description: 'List retrieved successfully' })
  async findAll() {
    return this.${controllerName.toLowerCase()}Service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ${controllerName.toLowerCase()} by id' })
  @ApiResponse({ status: 200, description: 'Item retrieved successfully' })
  async findOne(@Param('id') id: string) {
    return this.${controllerName.toLowerCase()}Service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new ${controllerName.toLowerCase()}' })
  @ApiResponse({ status: 201, description: 'Item created successfully' })
  async create(@Body() data: any) {
    return this.${controllerName.toLowerCase()}Service.create(data);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update ${controllerName.toLowerCase()}' })
  @ApiResponse({ status: 200, description: 'Item updated successfully' })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.${controllerName.toLowerCase()}Service.update(id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete ${controllerName.toLowerCase()}' })
  @ApiResponse({ status: 200, description: 'Item deleted successfully' })
  async delete(@Param('id') id: string) {
    return this.${controllerName.toLowerCase()}Service.delete(id);
  }
}
`;
    
    await fs.promises.writeFile(
      path.join(modulePath, 'src', 'controllers', `${controllerName}.controller.ts`),
      content
    );
    console.log(`📄 Generated ${controllerName}Controller`);
  }

  /**
   * Generate entity file
   */
  private async generateEntity(template: ModuleTemplate, entityName: string, modulePath: string): Promise<void> {
    const content = `import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('${entityName.toLowerCase()}')
export class ${entityName} {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
`;
    
    await fs.promises.writeFile(
      path.join(modulePath, 'src', 'entities', `${entityName}.entity.ts`),
      content
    );
    console.log(`📄 Generated ${entityName} entity`);
  }

  /**
   * Generate event file
   */
  private async generateEvent(template: ModuleTemplate, eventName: string, modulePath: string): Promise<void> {
    const content = `export class ${eventName}Event {
  constructor(
    public readonly data: any,
    public readonly timestamp: Date = new Date(),
  ) {}
}
`;
    
    await fs.promises.writeFile(
      path.join(modulePath, 'src', 'events', `${eventName}.event.ts`),
      content
    );
    console.log(`📄 Generated ${eventName}Event`);
  }

  /**
   * Generate hook file
   */
  private async generateHook(template: ModuleTemplate, hookName: string, modulePath: string): Promise<void> {
    const content = `export interface ${hookName}Hook {
  name: string;
  priority: number;
  execute(data: any): Promise<any>;
}

export class ${hookName}HookImpl implements ${hookName}Hook {
  name = '${hookName.toLowerCase()}';
  priority = 100;

  async execute(data: any): Promise<any> {
    // Add your hook logic here
    return data;
  }
}
`;
    
    await fs.promises.writeFile(
      path.join(modulePath, 'src', 'hooks', `${hookName}.hook.ts`),
      content
    );
    console.log(`📄 Generated ${hookName}Hook`);
  }

  /**
   * Generate TypeScript config
   */
  private async generateTsConfig(modulePath: string): Promise<void> {
    const content = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
`;
    
    await fs.promises.writeFile(path.join(modulePath, 'tsconfig.json'), content);
    console.log('📄 Generated tsconfig.json');
  }

  /**
   * Generate Jest config
   */
  private async generateJestConfig(modulePath: string): Promise<void> {
    const content = `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
`;
    
    await fs.promises.writeFile(path.join(modulePath, 'jest.config.js'), content);
    console.log('📄 Generated jest.config.js');
  }

  /**
   * Generate ESLint config
   */
  private async generateEslintConfig(modulePath: string): Promise<void> {
    const content = `module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'warn',
  },
};
`;
    
    await fs.promises.writeFile(path.join(modulePath, '.eslintrc.js'), content);
    console.log('📄 Generated .eslintrc.js');
  }

  /**
   * Generate documentation
   */
  private async generateDocumentation(template: ModuleTemplate): Promise<void> {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', template.name);
    
    // Generate README.md
    const readmeContent = `# @deservefirst/${template.name}

${template.description}

## Installation

\`\`\`bash
npm install @deservefirst/${template.name}
\`\`\`

## Usage

\`\`\`typescript
import { ${this.toPascalCase(template.name)}Module } from '@deservefirst/${template.name}';

// Add to your NestJS app
@Module({
  imports: [${this.toPascalCase(template.name)}Module],
})
export class AppModule {}
\`\`\`

## Features

${template.services.length > 0 ? `- **Services**: ${template.services.join(', ')}` : ''}
${template.controllers.length > 0 ? `- **Controllers**: ${template.controllers.join(', ')}` : ''}
${template.entities.length > 0 ? `- **Entities**: ${template.entities.join(', ')}` : ''}
${template.events.length > 0 ? `- **Events**: ${template.events.join(', ')}` : ''}
${template.hooks.length > 0 ? `- **Hooks**: ${template.hooks.join(', ')}` : ''}
${template.customFields ? '- **Custom Fields**: Supported' : ''}
${template.storeLevel ? '- **Store Level**: Yes' : ''}

## API Documentation

See the Swagger documentation at \`/api/docs\` when the module is loaded.

## License

MIT
`;
    
    await fs.promises.writeFile(path.join(modulePath, 'README.md'), readmeContent);
    console.log('📄 Generated README.md');
  }

  /**
   * Helper methods
   */
  private async question(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  private async yesNo(question: string): Promise<boolean> {
    const answer = await this.question(question);
    return answer.toLowerCase().startsWith('y');
  }

  private toPascalCase(str: string): string {
    return str
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}
