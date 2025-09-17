const fs = require('fs');
const path = require('path');

class ModuleTemplateSystemTester {
  constructor() {
    this.passed = 0;
    this.failed = 0;
  }

  async runTest(testName, testFn) {
    try {
      console.log(`🧪 Running: ${testName}`);
      await testFn();
      console.log(`✅ PASSED: ${testName}`);
      this.passed++;
    } catch (error) {
      console.log(`❌ FAILED: ${testName}`);
      console.log(`   Error: ${error.message}`);
      this.failed++;
    }
  }

  async testModuleDirectoryStructure() {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals');
    
    if (!fs.existsSync(modulePath)) {
      throw new Error('Module directory not found');
    }

    const expectedDirs = [
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

    for (const dir of expectedDirs) {
      const dirPath = path.join(modulePath, dir);
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory ${dir} not found`);
      }
    }

    console.log(`   Module directory: ${modulePath}`);
    console.log(`   All required directories created`);
  }

  async testPackageJsonStructure() {
    const packageJsonPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Check required fields
    const requiredFields = ['name', 'version', 'description', 'author', 'license', 'main', 'types'];
    for (const field of requiredFields) {
      if (!packageJson[field]) {
        throw new Error(`Required field ${field} not found in package.json`);
      }
    }

    // Check Deservefirst module configuration
    if (!packageJson.deservefirst) {
      throw new Error('deservefirst configuration not found');
    }

    const deservefirstConfig = packageJson.deservefirst;
    if (!deservefirstConfig.module) {
      throw new Error('deservefirst.module not set to true');
    }

    if (!deservefirstConfig.services || !Array.isArray(deservefirstConfig.services)) {
      throw new Error('deservefirst.services not found or not an array');
    }

    if (deservefirstConfig.services.length !== 10) {
      throw new Error(`Expected 10 services, found ${deservefirstConfig.services.length}`);
    }

    console.log(`   Package name: ${packageJson.name}`);
    console.log(`   Version: ${packageJson.version}`);
    console.log(`   Services: ${deservefirstConfig.services.length}`);
    console.log(`   Store level: ${deservefirstConfig.storeLevel}`);
    console.log(`   Custom fields: ${deservefirstConfig.customFields}`);
  }

  async testServiceFiles() {
    const servicesDir = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'src', 'services');
    
    if (!fs.existsSync(servicesDir)) {
      throw new Error('Services directory not found');
    }

    const serviceFiles = fs.readdirSync(servicesDir);
    const expectedServices = ['ABC', 'XYZ', 'ANF', 'AKI', 'AJK', 'KLR', 'AKD', 'AKLO', 'KL'];
    
    for (const service of expectedServices) {
      const serviceFile = `${service}.service.ts`;
      if (!serviceFiles.includes(serviceFile)) {
        throw new Error(`Service file ${serviceFile} not found`);
      }

      const servicePath = path.join(servicesDir, serviceFile);
      const content = fs.readFileSync(servicePath, 'utf8');
      
      if (!content.includes(`export class ${service}Service`)) {
        throw new Error(`Service class ${service}Service not found in ${serviceFile}`);
      }

      if (!content.includes('@Injectable()')) {
        throw new Error(`@Injectable() decorator not found in ${serviceFile}`);
      }
    }

    console.log(`   Service files: ${serviceFiles.length}`);
    console.log(`   All services have proper structure`);
  }

  async testConfigurationFiles() {
    const modulePath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals');
    
    const configFiles = [
      'tsconfig.json',
      'jest.config.js',
      '.eslintrc.js',
    ];

    for (const configFile of configFiles) {
      const configPath = path.join(modulePath, configFile);
      if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file ${configFile} not found`);
      }
    }

    console.log(`   Configuration files: ${configFiles.length}`);
    console.log(`   All config files created`);
  }

  async testTypeScriptConfig() {
    const tsconfigPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    
    if (!tsconfig.compilerOptions) {
      throw new Error('TypeScript compiler options not found');
    }

    const requiredOptions = ['target', 'module', 'declaration', 'outDir', 'rootDir', 'strict'];
    for (const option of requiredOptions) {
      if (!tsconfig.compilerOptions[option]) {
        throw new Error(`TypeScript option ${option} not found`);
      }
    }

    console.log(`   TypeScript target: ${tsconfig.compilerOptions.target}`);
    console.log(`   Output directory: ${tsconfig.compilerOptions.outDir}`);
    console.log(`   Strict mode: ${tsconfig.compilerOptions.strict}`);
  }

  async testJestConfig() {
    const jestConfigPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'jest.config.js');
    
    if (!fs.existsSync(jestConfigPath)) {
      throw new Error('Jest configuration not found');
    }

    const jestConfig = require(jestConfigPath);
    
    if (!jestConfig.preset) {
      throw new Error('Jest preset not configured');
    }

    if (jestConfig.preset !== 'ts-jest') {
      throw new Error(`Expected ts-jest preset, found ${jestConfig.preset}`);
    }

    console.log(`   Jest preset: ${jestConfig.preset}`);
    console.log(`   Test environment: ${jestConfig.testEnvironment}`);
  }

  async testESLintConfig() {
    const eslintConfigPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', '.eslintrc.js');
    
    if (!fs.existsSync(eslintConfigPath)) {
      throw new Error('ESLint configuration not found');
    }

    const eslintConfig = require(eslintConfigPath);
    
    if (!eslintConfig.parser) {
      throw new Error('ESLint parser not configured');
    }

    if (eslintConfig.parser !== '@typescript-eslint/parser') {
      throw new Error(`Expected @typescript-eslint/parser, found ${eslintConfig.parser}`);
    }

    console.log(`   ESLint parser: ${eslintConfig.parser}`);
    console.log(`   Extends: ${eslintConfig.extends.join(', ')}`);
  }

  async testReadmeFile() {
    const readmePath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'README.md');
    
    if (!fs.existsSync(readmePath)) {
      throw new Error('README.md not found');
    }

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    
    if (!readmeContent.includes('@deservefirst/Proposals')) {
      throw new Error('Module name not found in README');
    }

    if (!readmeContent.includes('## Installation')) {
      throw new Error('Installation section not found in README');
    }

    if (!readmeContent.includes('## Usage')) {
      throw new Error('Usage section not found in README');
    }

    console.log(`   README.md created`);
    console.log(`   Contains installation instructions`);
    console.log(`   Contains usage examples`);
  }

  async testModuleIndexFile() {
    const indexPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'src', 'index.ts');
    
    if (!fs.existsSync(indexPath)) {
      throw new Error('src/index.ts not found');
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    
    if (!indexContent.includes('export * from')) {
      throw new Error('Export statements not found in index.ts');
    }

    if (!indexContent.includes('@Module')) {
      throw new Error('NestJS @Module decorator not found');
    }

    console.log(`   Module index file created`);
    console.log(`   Contains proper exports`);
    console.log(`   Contains NestJS module definition`);
  }

  async testScriptsInPackageJson() {
    const packageJsonPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    const requiredScripts = ['build', 'dev', 'test', 'test:watch', 'test:coverage', 'lint', 'lint:fix', 'prepublishOnly'];
    
    for (const script of requiredScripts) {
      if (!packageJson.scripts[script]) {
        throw new Error(`Script ${script} not found in package.json`);
      }
    }

    console.log(`   Scripts: ${Object.keys(packageJson.scripts).length}`);
    console.log(`   All required scripts present`);
  }

  async testPeerDependencies() {
    const packageJsonPath = path.join(process.cwd(), 'modules', '@deservefirst', 'Proposals', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    const requiredPeerDeps = ['@nestjs/common', '@nestjs/core', '@nestjs/typeorm', 'typeorm'];
    
    for (const dep of requiredPeerDeps) {
      if (!packageJson.peerDependencies[dep]) {
        throw new Error(`Peer dependency ${dep} not found`);
      }
    }

    console.log(`   Peer dependencies: ${Object.keys(packageJson.peerDependencies).length}`);
    console.log(`   All required peer dependencies present`);
  }

  async runAllTests() {
    console.log('🚀 Starting Module Template System Tests\n');

    await this.runTest('Module Directory Structure', () => this.testModuleDirectoryStructure());
    await this.runTest('Package.json Structure', () => this.testPackageJsonStructure());
    await this.runTest('Service Files Generation', () => this.testServiceFiles());
    await this.runTest('Configuration Files', () => this.testConfigurationFiles());
    await this.runTest('TypeScript Configuration', () => this.testTypeScriptConfig());
    await this.runTest('Jest Configuration', () => this.testJestConfig());
    await this.runTest('ESLint Configuration', () => this.testESLintConfig());
    await this.runTest('README File', () => this.testReadmeFile());
    await this.runTest('Module Index File', () => this.testModuleIndexFile());
    await this.runTest('Package.json Scripts', () => this.testScriptsInPackageJson());
    await this.runTest('Peer Dependencies', () => this.testPeerDependencies());

    console.log('\n📊 Test Results Summary');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total: ${this.passed + this.failed}`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! Module Template System is working perfectly!');
      console.log('🚀 CLI tool can generate complete, production-ready modules!');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the issues above.');
    }
  }
}

// Run the tests
const tester = new ModuleTemplateSystemTester();
tester.runAllTests().catch(console.error);
