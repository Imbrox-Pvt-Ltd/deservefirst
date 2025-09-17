const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

class EnhancedModuleSystemTester {
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

  async testModuleRegistry() {
    const response = await axios.get(`${BASE_URL}/api/modules`);
    if (response.status !== 200) throw new Error('Module registry failed');
    if (!response.data.modules) throw new Error('Modules array not found');
    if (!response.data.health) throw new Error('Health data not found');
    console.log(`   Total Modules: ${response.data.total}`);
    console.log(`   Loaded Modules: ${response.data.loaded}`);
    console.log(`   Health Status: ${JSON.stringify(response.data.health)}`);
  }

  async testModuleHealth() {
    const response = await axios.get(`${BASE_URL}/api/modules/health`);
    if (response.status !== 200) throw new Error('Module health failed');
    if (typeof response.data.total !== 'number') throw new Error('Total count not found');
    console.log(`   Total: ${response.data.total}`);
    console.log(`   Loaded: ${response.data.loaded}`);
    console.log(`   Active: ${response.data.active}`);
    console.log(`   Errors: ${response.data.errors}`);
  }

  async testStoreModuleSystem() {
    const storeId = 'test-store-123';
    const response = await axios.get(`${BASE_URL}/api/modules/store/${storeId}`);
    if (response.status !== 200) throw new Error('Store modules failed');
    if (response.data.storeId !== storeId) throw new Error('Store ID mismatch');
    console.log(`   Store ID: ${response.data.storeId}`);
    console.log(`   Total Modules: ${response.data.total}`);
    console.log(`   Enabled Modules: ${response.data.enabled}`);
  }

  async testEnableStoreModule() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    const settings = { testSetting: 'test-value' };
    
    const response = await axios.post(`${BASE_URL}/api/modules/store/${storeId}/enable`, {
      moduleName,
      settings,
    });
    
    if (response.status !== 200) throw new Error('Enable store module failed');
    if (!response.data.success) throw new Error('Module not enabled');
    console.log(`   Module: ${moduleName}`);
    console.log(`   Store: ${storeId}`);
    console.log(`   Message: ${response.data.message}`);
  }

  async testDisableStoreModule() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    
    const response = await axios.post(`${BASE_URL}/api/modules/store/${storeId}/disable`, {
      moduleName,
    });
    
    if (response.status !== 200) throw new Error('Disable store module failed');
    if (!response.data.success) throw new Error('Module not disabled');
    console.log(`   Module: ${moduleName}`);
    console.log(`   Store: ${storeId}`);
    console.log(`   Message: ${response.data.message}`);
  }

  async testUpdateModuleSettings() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    const settings = { updatedSetting: 'updated-value' };
    
    const response = await axios.put(`${BASE_URL}/api/modules/store/${storeId}/settings`, {
      moduleName,
      settings,
    });
    
    if (response.status !== 200) throw new Error('Update settings failed');
    if (!response.data.success) throw new Error('Settings not updated');
    console.log(`   Module: ${moduleName}`);
    console.log(`   Settings: ${JSON.stringify(settings)}`);
    console.log(`   Message: ${response.data.message}`);
  }

  async testAddCustomField() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    const customField = {
      name: 'test-field',
      type: 'text',
      label: 'Test Field',
      description: 'A test custom field',
      required: true,
      defaultValue: 'default-value',
    };
    
    const response = await axios.post(`${BASE_URL}/api/modules/store/${storeId}/custom-fields`, {
      moduleName,
      customField,
    });
    
    if (response.status !== 200) throw new Error('Add custom field failed');
    if (!response.data.success) throw new Error('Custom field not added');
    console.log(`   Field Name: ${customField.name}`);
    console.log(`   Field Type: ${customField.type}`);
    console.log(`   Message: ${response.data.message}`);
  }

  async testGetCustomFields() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    
    const response = await axios.get(`${BASE_URL}/api/modules/store/${storeId}/custom-fields?moduleName=${moduleName}`);
    
    if (response.status !== 200) throw new Error('Get custom fields failed');
    if (!response.data.storeId) throw new Error('Store ID not found');
    console.log(`   Store ID: ${response.data.storeId}`);
    console.log(`   Module Name: ${response.data.moduleName}`);
    console.log(`   Custom Fields: ${response.data.customFields.length}`);
  }

  async testValidateCustomField() {
    const storeId = 'test-store-123';
    const moduleName = 'test-module';
    const fieldName = 'test-field';
    const value = 'valid-value';
    
    const response = await axios.post(`${BASE_URL}/api/modules/store/${storeId}/validate-custom-field`, {
      moduleName,
      fieldName,
      value,
    });
    
    if (response.status !== 200) throw new Error('Validate custom field failed');
    if (typeof response.data.valid !== 'boolean') throw new Error('Validation result not found');
    console.log(`   Field: ${fieldName}`);
    console.log(`   Value: ${value}`);
    console.log(`   Valid: ${response.data.valid}`);
    if (response.data.error) console.log(`   Error: ${response.data.error}`);
  }

  async testStoreModuleHealth() {
    const storeId = 'test-store-123';
    
    const response = await axios.get(`${BASE_URL}/api/modules/store/${storeId}/health`);
    
    if (response.status !== 200) throw new Error('Store module health failed');
    if (response.data.storeId !== storeId) throw new Error('Store ID mismatch');
    console.log(`   Store ID: ${response.data.storeId}`);
    console.log(`   Total Modules: ${response.data.totalModules}`);
    console.log(`   Enabled Modules: ${response.data.enabledModules}`);
    console.log(`   Custom Fields: ${response.data.totalCustomFields}`);
  }

  async testErrorHandling() {
    try {
      await axios.get(`${BASE_URL}/api/modules/nonexistent`);
      throw new Error('Should have returned 404');
    } catch (error) {
      if (error.response?.status !== 404) {
        throw new Error('Expected 404 for non-existent endpoint');
      }
      console.log(`   Correctly returns 404 for non-existent routes`);
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Enhanced Module System Tests\n');

    await this.runTest('Module Registry System', () => this.testModuleRegistry());
    await this.runTest('Module Health Status', () => this.testModuleHealth());
    await this.runTest('Store Module System', () => this.testStoreModuleSystem());
    await this.runTest('Enable Store Module', () => this.testEnableStoreModule());
    await this.runTest('Disable Store Module', () => this.testDisableStoreModule());
    await this.runTest('Update Module Settings', () => this.testUpdateModuleSettings());
    await this.runTest('Add Custom Field', () => this.testAddCustomField());
    await this.runTest('Get Custom Fields', () => this.testGetCustomFields());
    await this.runTest('Validate Custom Field', () => this.testValidateCustomField());
    await this.runTest('Store Module Health', () => this.testStoreModuleHealth());
    await this.runTest('Error Handling', () => this.testErrorHandling());

    console.log('\n📊 Test Results Summary');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total: ${this.passed + this.failed}`);

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! Enhanced Module System is working perfectly!');
      console.log('🚀 Magento-style npm module system is ready!');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the issues above.');
    }
  }
}

// Run the tests
const tester = new EnhancedModuleSystemTester();
tester.runAllTests().catch(console.error);
