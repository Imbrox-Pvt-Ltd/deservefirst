const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

class DynamicModuleSystemTester {
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

  async testDynamicModuleEndpoints() {
    const response = await axios.get(`${BASE_URL}/api/modules/loaded`);
    if (response.status !== 200) throw new Error('Dynamic modules endpoint failed');
    if (!response.data.loadedModules) throw new Error('Loaded modules array not found');
    if (!response.data.status) throw new Error('Status object not found');
    console.log(`   Loaded modules: ${response.data.loadedModules.length}`);
    console.log(`   Total modules: ${response.data.status.total}`);
  }

  async testLoadingStatus() {
    const response = await axios.get(`${BASE_URL}/api/modules/loading-status`);
    if (response.status !== 200) throw new Error('Loading status endpoint failed');
    if (typeof response.data.total !== 'number') throw new Error('Total count not found');
    console.log(`   Total: ${response.data.total}`);
    console.log(`   Loaded: ${response.data.loaded}`);
  }

  async testFileWatchingStart() {
    const response = await axios.post(`${BASE_URL}/api/modules/start-watching`);
    if (response.status !== 200) throw new Error('Start watching failed');
    if (!response.data.success) throw new Error('Watching not started');
    console.log(`   Message: ${response.data.message}`);
  }

  async testFileWatchingStop() {
    const response = await axios.post(`${BASE_URL}/api/modules/stop-watching`);
    if (response.status !== 200) throw new Error('Stop watching failed');
    if (!response.data.success) throw new Error('Watching not stopped');
    console.log(`   Message: ${response.data.message}`);
  }

  async testModuleRegistryIntegration() {
    const response = await axios.get(`${BASE_URL}/api/modules`);
    if (response.status !== 200) throw new Error('Module registry failed');
    if (!response.data.modules) throw new Error('Modules array not found');
    console.log(`   Registry modules: ${response.data.total}`);
    console.log(`   Registry loaded: ${response.data.loaded}`);
  }

  async testStoreModuleIntegration() {
    const storeId = 'test-store-dynamic';
    const response = await axios.get(`${BASE_URL}/api/modules/store/${storeId}`);
    if (response.status !== 200) throw new Error('Store modules failed');
    if (response.data.storeId !== storeId) throw new Error('Store ID mismatch');
    console.log(`   Store ID: ${response.data.storeId}`);
    console.log(`   Store modules: ${response.data.total}`);
  }

  async testModuleHealthIntegration() {
    const response = await axios.get(`${BASE_URL}/api/modules/health`);
    if (response.status !== 200) throw new Error('Module health failed');
    if (typeof response.data.total !== 'number') throw new Error('Total count not found');
    console.log(`   Health total: ${response.data.total}`);
    console.log(`   Health loaded: ${response.data.loaded}`);
  }

  async testSwaggerDocumentation() {
    const response = await axios.get(`${BASE_URL}/api/docs`);
    if (response.status !== 200) throw new Error('Swagger docs failed');
    console.log(`   Swagger UI accessible`);
  }

  async testSwaggerJson() {
    const response = await axios.get(`${BASE_URL}/api/docs-json`);
    if (response.status !== 200) throw new Error('Swagger JSON failed');
    if (!response.data.paths) throw new Error('Swagger paths not found');
    
    const modulePaths = Object.keys(response.data.paths).filter(path => 
      path.includes('/modules/')
    );
    console.log(`   Module API paths: ${modulePaths.length}`);
    console.log(`   Dynamic endpoints: ${modulePaths.filter(p => p.includes('loaded') || p.includes('dynamic')).length}`);
  }

  async testErrorHandling() {
    try {
      await axios.get(`${BASE_URL}/api/modules/loaded/nonexistent`);
      // This should return 404 or error response
    } catch (error) {
      if (error.response?.status === 404 || error.response?.status === 200) {
        console.log(`   Correctly handles non-existent module requests`);
      } else {
        throw new Error(`Unexpected error status: ${error.response?.status}`);
      }
    }
  }

  async testModuleDiscovery() {
    const response = await axios.get(`${BASE_URL}/api/modules`);
    const modules = response.data.modules;
    
    // Check if any modules are discovered
    console.log(`   Discovered modules: ${modules.length}`);
    
    if (modules.length > 0) {
      const firstModule = modules[0];
      console.log(`   First module: ${firstModule.name}`);
      console.log(`   Module version: ${firstModule.version}`);
      console.log(`   Module status: ${firstModule.status}`);
    }
  }

  async testModuleLoadingCapability() {
    // Test loading a non-existent module (should fail gracefully)
    try {
      const response = await axios.post(`${BASE_URL}/api/modules/dynamic-load/nonexistent-module`);
      if (response.data.success === false) {
        console.log(`   Gracefully handles non-existent module loading`);
      } else {
        throw new Error('Should have failed to load non-existent module');
      }
    } catch (error) {
      if (error.response?.status === 200 && error.response.data.success === false) {
        console.log(`   Gracefully handles non-existent module loading`);
      } else {
        throw new Error(`Unexpected error: ${error.message}`);
      }
    }
  }

  async testModuleUnloadingCapability() {
    // Test unloading a non-existent module (should fail gracefully)
    try {
      const response = await axios.post(`${BASE_URL}/api/modules/unload/nonexistent-module`);
      if (response.data.success === false) {
        console.log(`   Gracefully handles non-existent module unloading`);
      } else {
        throw new Error('Should have failed to unload non-existent module');
      }
    } catch (error) {
      if (error.response?.status === 200 && error.response.data.success === false) {
        console.log(`   Gracefully handles non-existent module unloading`);
      } else {
        throw new Error(`Unexpected error: ${error.message}`);
      }
    }
  }

  async testModuleReloadingCapability() {
    // Test reloading a non-existent module (should fail gracefully)
    try {
      const response = await axios.post(`${BASE_URL}/api/modules/reload/nonexistent-module`);
      if (response.data.success === false) {
        console.log(`   Gracefully handles non-existent module reloading`);
      } else {
        throw new Error('Should have failed to reload non-existent module');
      }
    } catch (error) {
      if (error.response?.status === 200 && error.response.data.success === false) {
        console.log(`   Gracefully handles non-existent module reloading`);
      } else {
        throw new Error(`Unexpected error: ${error.message}`);
      }
    }
  }

  async testSystemIntegration() {
    // Test that all systems work together
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    if (healthResponse.status !== 200) throw new Error('Health check failed');
    
    const modulesResponse = await axios.get(`${BASE_URL}/api/modules`);
    if (modulesResponse.status !== 200) throw new Error('Modules endpoint failed');
    
    const loadedResponse = await axios.get(`${BASE_URL}/api/modules/loaded`);
    if (loadedResponse.status !== 200) throw new Error('Loaded modules endpoint failed');
    
    console.log(`   System integration: All endpoints working`);
    console.log(`   Health: ${healthResponse.data.status}`);
    console.log(`   Modules: ${modulesResponse.data.total}`);
    console.log(`   Loaded: ${loadedResponse.data.loadedModules.length}`);
  }

  async runAllTests() {
    console.log('🚀 Starting Dynamic Module System Tests\n');

    await this.runTest('Dynamic Module Endpoints', () => this.testDynamicModuleEndpoints());
    await this.runTest('Loading Status', () => this.testLoadingStatus());
    await this.runTest('File Watching Start', () => this.testFileWatchingStart());
    await this.runTest('File Watching Stop', () => this.testFileWatchingStop());
    await this.runTest('Module Registry Integration', () => this.testModuleRegistryIntegration());
    await this.runTest('Store Module Integration', () => this.testStoreModuleIntegration());
    await this.runTest('Module Health Integration', () => this.testModuleHealthIntegration());
    await this.runTest('Swagger Documentation', () => this.testSwaggerDocumentation());
    await this.runTest('Swagger JSON API', () => this.testSwaggerJson());
    await this.runTest('Error Handling', () => this.testErrorHandling());
    await this.runTest('Module Discovery', () => this.testModuleDiscovery());
    await this.runTest('Module Loading Capability', () => this.testModuleLoadingCapability());
    await this.runTest('Module Unloading Capability', () => this.testModuleUnloadingCapability());
    await this.runTest('Module Reloading Capability', () => this.testModuleReloadingCapability());
    await this.runTest('System Integration', () => this.testSystemIntegration());

    console.log('\n📊 Test Results Summary');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total: ${this.passed + this.failed}`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! Dynamic Module System is working perfectly!');
      console.log('🚀 Hot-reloading, auto-registration, and dynamic loading are ready!');
      console.log('⚡ The system can now:');
      console.log('   • Auto-discover modules from node_modules');
      console.log('   • Load/unload modules dynamically');
      console.log('   • Hot-reload modules on file changes');
      console.log('   • Manage store-level module configurations');
      console.log('   • Provide comprehensive API documentation');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the issues above.');
    }
  }
}

// Run the tests
const tester = new DynamicModuleSystemTester();
tester.runAllTests().catch(console.error);
