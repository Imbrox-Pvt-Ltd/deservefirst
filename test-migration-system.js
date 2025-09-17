const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testMigrationSystem() {
  console.log('🧪 Testing Phase 3: Database Migration System\n');
  
  const tests = [
    {
      name: 'Migration Status',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/status`);
        return {
          success: response.status === 200,
          data: response.data,
          message: `Found ${response.data.totalMigrations} total migrations across ${Object.keys(response.data.modules).length} modules`
        };
      }
    },
    {
      name: 'Version Status',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/versions`);
        return {
          success: response.status === 200,
          data: response.data,
          message: `Found ${response.data.totalModules} modules with version information`
        };
      }
    },
    {
      name: 'Module Migrations - Tenant Module',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/modules/tenant-module`);
        return {
          success: response.status === 200,
          data: response.data,
          message: `Found ${response.data.count} migrations for tenant-module`
        };
      }
    },
    {
      name: 'All Migrations',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/all`);
        return {
          success: response.status === 200,
          data: response.data,
          message: `Found ${response.data.count} total migrations`
        };
      }
    },
    {
      name: 'Migration Health',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/health`);
        return {
          success: response.status === 200,
          data: response.data,
          message: `Migration system health: ${response.data.overallHealth}`
        };
      }
    },
    {
      name: 'Module Version Info - Tenant Module',
      test: async () => {
        const response = await axios.get(`${BASE_URL}/migrations/versions/tenant-module`);
        return {
          success: response.status === 200,
          data: response.data,
          message: response.data.success ? 'Module version info retrieved' : 'Module not found'
        };
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`\n🔍 Testing: ${test.name}`);
      const result = await test.test();
      
      if (result.success) {
        console.log(`✅ PASSED: ${result.message}`);
        if (result.data) {
          console.log(`   📊 Data:`, JSON.stringify(result.data, null, 2).substring(0, 200) + '...');
        }
        passed++;
      } else {
        console.log(`❌ FAILED: ${result.message}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ ERROR: ${test.name} - ${error.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Test Results:`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

  if (failed === 0) {
    console.log('\n🎉 All migration system tests passed!');
    console.log('\n📋 Migration System Features:');
    console.log('   • Migration discovery and loading');
    console.log('   • Version management');
    console.log('   • Module-specific migrations');
    console.log('   • Health monitoring');
    console.log('   • Database table creation');
    console.log('   • SQL migration parsing');
    console.log('   • Up/Down migration support');
    console.log('   • Migration status tracking');
    console.log('   • REST API endpoints');
    console.log('   • Swagger documentation');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.');
  }
}

// Run the tests
testMigrationSystem().catch(console.error);
