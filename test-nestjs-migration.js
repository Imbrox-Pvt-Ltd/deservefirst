const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

class NestJSMigrationTester {
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

  async testCoreModule() {
    const response = await axios.get(`${BASE_URL}/api/core/info`);
    if (response.status !== 200) throw new Error('Core module info failed');
    if (!response.data.name) throw new Error('Core module name not found');
    if (!response.data.version) throw new Error('Core module version not found');
    console.log(`   Platform: ${response.data.name}`);
    console.log(`   Version: ${response.data.version}`);
    console.log(`   Status: ${response.data.status}`);
  }

  async testModulesEndpoint() {
    const response = await axios.get(`${BASE_URL}/api/core/modules`);
    if (response.status !== 200) throw new Error('Modules endpoint failed');
    if (!response.data.allModules) throw new Error('Modules list not found');
    if (response.data.totalModules !== 3) throw new Error('Expected 3 modules');
    console.log(`   Total Modules: ${response.data.totalModules}`);
    console.log(`   Active Modules: ${response.data.activeModules}`);
    response.data.allModules.forEach(module => {
      console.log(`   - ${module.name}: ${module.status}`);
    });
  }

  async testRBACModule() {
    const response = await axios.get(`${BASE_URL}/api/rbac/roles`);
    if (response.status !== 200) throw new Error('RBAC roles failed');
    if (!Array.isArray(response.data)) throw new Error('Roles should be an array');
    if (response.data.length !== 3) throw new Error('Expected 3 roles');
    console.log(`   Roles: ${response.data.map(r => r.name).join(', ')}`);
  }

  async testCMSModule() {
    const response = await axios.get(`${BASE_URL}/api/cms/content`);
    if (response.status !== 200) throw new Error('CMS content failed');
    if (!Array.isArray(response.data)) throw new Error('Content should be an array');
    if (response.data.length !== 3) throw new Error('Expected 3 content items');
    console.log(`   Content Items: ${response.data.map(c => c.title).join(', ')}`);
  }

  async testHealthEndpoint() {
    const response = await axios.get(`${BASE_URL}/api/health`);
    if (response.status !== 200) throw new Error('Health endpoint failed');
    if (!response.data.status) throw new Error('Health status not found');
    if (response.data.status !== 'healthy') throw new Error('System not healthy');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Database: ${response.data.database?.status || 'unknown'}`);
    console.log(`   Cache: ${response.data.cache?.status || 'unknown'}`);
  }

  async testMetricsEndpoint() {
    const response = await axios.get(`${BASE_URL}/api/metrics`);
    if (response.status !== 200) throw new Error('Metrics endpoint failed');
    if (!response.data.system) throw new Error('System metrics not found');
    console.log(`   Uptime: ${Math.round(response.data.system.uptime)}s`);
    console.log(`   Memory: ${Math.round(response.data.system.memory.heapUsed / 1024 / 1024)}MB`);
  }

  async testSwaggerDocumentation() {
    const response = await axios.get(`${BASE_URL}/api/docs`);
    if (response.status !== 200) throw new Error('Swagger docs failed');
    if (!response.data.includes('swagger')) throw new Error('Swagger UI not found');
    console.log(`   Swagger UI: Available at /api/docs`);
  }

  async testDatabaseConnection() {
    const response = await axios.get(`${BASE_URL}/api/health`);
    if (response.data.database?.status !== 'connected') {
      throw new Error('Database not connected');
    }
    console.log(`   Database Type: ${response.data.database?.type || 'unknown'}`);
    console.log(`   Connection Status: ${response.data.database?.status}`);
  }

  async testErrorHandling() {
    try {
      await axios.get(`${BASE_URL}/api/nonexistent`);
      throw new Error('Should have returned 404');
    } catch (error) {
      if (error.response?.status !== 404) {
        throw new Error('Expected 404 for non-existent endpoint');
      }
      console.log(`   Correctly returns 404 for non-existent routes`);
    }
  }

  async runAllTests() {
    console.log('🚀 Starting NestJS Migration Tests\n');

    await this.runTest('Core Module Info', () => this.testCoreModule());
    await this.runTest('Modules Endpoint', () => this.testModulesEndpoint());
    await this.runTest('RBAC Module', () => this.testRBACModule());
    await this.runTest('CMS Module', () => this.testCMSModule());
    await this.runTest('Health Endpoint', () => this.testHealthEndpoint());
    await this.runTest('Metrics Endpoint', () => this.testMetricsEndpoint());
    await this.runTest('Swagger Documentation', () => this.testSwaggerDocumentation());
    await this.runTest('Database Connection', () => this.testDatabaseConnection());
    await this.runTest('Error Handling', () => this.testErrorHandling());

    console.log('\n📊 Test Results Summary');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total: ${this.passed + this.failed}`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! NestJS migration successful!');
      console.log('🚀 Deservefirst Platform is now running on NestJS!');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the issues above.');
    }
  }
}

// Run the tests
const tester = new NestJSMigrationTester();
tester.runAllTests().catch(console.error);
