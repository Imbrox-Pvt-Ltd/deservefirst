#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Current Deservefirst System
 * Tests all modules, APIs, and functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  async runTest(name, testFn) {
    try {
      console.log(`${COLORS.blue}🧪 Running: ${name}${COLORS.reset}`);
      await testFn();
      console.log(`${COLORS.green}✅ PASSED: ${name}${COLORS.reset}\n`);
      this.passed++;
    } catch (error) {
      console.log(`${COLORS.red}❌ FAILED: ${name}${COLORS.reset}`);
      console.log(`${COLORS.red}   Error: ${error.message}${COLORS.reset}\n`);
      this.failed++;
    }
  }

  async runAllTests() {
    console.log(`${COLORS.bold}${COLORS.blue}🚀 Starting Deservefirst System Tests${COLORS.reset}\n`);

    // Health and System Tests
    await this.runTest('Health Check', async () => {
      const response = await axios.get(`${BASE_URL}/health`);
      if (response.status !== 200) throw new Error('Health check failed');
      if (response.data.status !== 'healthy') throw new Error('System not healthy');
      console.log(`   Status: ${response.data.status}`);
      console.log(`   Uptime: ${Math.round(response.data.system.uptime)}s`);
      console.log(`   Memory: ${Math.round(response.data.system.memory.heapUsed / 1024 / 1024)}MB`);
    });

    await this.runTest('Module Status', async () => {
      const response = await axios.get(`${BASE_URL}/modules`);
      if (response.status !== 200) throw new Error('Module status check failed');
      console.log(`   Registered: ${response.data.registered.join(', ')}`);
      console.log(`   Loaded: ${response.data.loaded.join(', ')}`);
      console.log(`   Total Modules: ${response.data.allModules.length}`);
    });

    await this.runTest('App Status', async () => {
      const response = await axios.get(`${BASE_URL}/app/status`);
      if (response.status !== 200) throw new Error('App status check failed');
      console.log(`   Platform: ${response.data.platform}`);
      console.log(`   Version: ${response.data.version}`);
      console.log(`   Running Modules: ${response.data.modules.running}`);
    });

    await this.runTest('App Dashboard', async () => {
      const response = await axios.get(`${BASE_URL}/app/dashboard`);
      if (response.status !== 200) throw new Error('App dashboard check failed');
      console.log(`   Title: ${response.data.title}`);
      console.log(`   Modules: ${response.data.modules.join(', ')}`);
    });

    // Core Module Tests
    await this.runTest('Core Module Info', async () => {
      const response = await axios.get(`${BASE_URL}/api/coremodule/info`);
      if (response.status !== 200) throw new Error('Core module info failed');
      if (response.data.module !== 'CoreModule') throw new Error('Wrong module name');
      if (response.data.status !== 'active') throw new Error('Module not active');
      console.log(`   Module: ${response.data.module}`);
      console.log(`   Status: ${response.data.status}`);
    });

    // RBAC Module Tests
    await this.runTest('RBAC Roles', async () => {
      const response = await axios.get(`${BASE_URL}/api/rbacmodule/roles`);
      if (response.status !== 200) throw new Error('RBAC roles failed');
      if (!Array.isArray(response.data.roles)) throw new Error('Roles not an array');
      if (response.data.roles.length === 0) throw new Error('No roles found');
      console.log(`   Roles: ${response.data.roles.join(', ')}`);
    });

    await this.runTest('RBAC Permissions', async () => {
      const response = await axios.get(`${BASE_URL}/api/rbacmodule/permissions`);
      if (response.status !== 200) throw new Error('RBAC permissions failed');
      if (!Array.isArray(response.data.permissions)) throw new Error('Permissions not an array');
      if (response.data.permissions.length === 0) throw new Error('No permissions found');
      console.log(`   Permissions: ${response.data.permissions.join(', ')}`);
    });

    // CMS Module Tests
    await this.runTest('CMS Content List', async () => {
      const response = await axios.get(`${BASE_URL}/api/cmsmodule/content`);
      if (response.status !== 200) throw new Error('CMS content list failed');
      if (!Array.isArray(response.data.content)) throw new Error('Content not an array');
      console.log(`   Content Items: ${response.data.content.join(', ')}`);
    });

    await this.runTest('CMS Content Creation', async () => {
      const testContent = {
        title: 'Test Page',
        content: 'This is a test page created by the test suite',
        author: 'Test Suite'
      };
      
      const response = await axios.post(`${BASE_URL}/api/cmsmodule/content`, testContent);
      if (response.status !== 200) throw new Error('CMS content creation failed');
      if (!response.data.message) throw new Error('No success message');
      if (!response.data.id) throw new Error('No ID returned');
      console.log(`   Message: ${response.data.message}`);
      console.log(`   ID: ${response.data.id}`);
    });

    await this.runTest('CMS Media List', async () => {
      const response = await axios.get(`${BASE_URL}/api/cmsmodule/media`);
      if (response.status !== 200) throw new Error('CMS media list failed');
      if (!Array.isArray(response.data.media)) throw new Error('Media not an array');
      console.log(`   Media Items: ${response.data.media.join(', ')}`);
    });

    // Performance Tests
    await this.runTest('Performance Metrics', async () => {
      const response = await axios.get(`${BASE_URL}/metrics`);
      if (response.status !== 200) throw new Error('Performance metrics failed');
      console.log(`   Metrics available: ${Object.keys(response.data).length} categories`);
    });

    // Dashboard Tests
    await this.runTest('Dashboard HTML', async () => {
      const response = await axios.get(`${BASE_URL}/dashboard`);
      if (response.status !== 200) throw new Error('Dashboard HTML failed');
      if (!response.data.includes('Deservefirst Dashboard')) throw new Error('Dashboard title not found');
      if (!response.data.includes('shopify-green')) throw new Error('Shopify styling not found');
      console.log(`   Dashboard loaded successfully`);
      console.log(`   Contains Shopify styling: Yes`);
    });

    await this.runTest('React Dashboard', async () => {
      const response = await axios.get(`${BASE_URL}/react-dashboard`);
      if (response.status !== 200) throw new Error('React Dashboard failed');
      if (!response.data.includes('Deservefirst Dashboard - React')) throw new Error('React dashboard title not found');
      if (!response.data.includes('React')) throw new Error('React not found');
      if (!response.data.includes('shopify-green')) throw new Error('Shopify styling not found');
      if (!response.data.includes('animate-pulse')) throw new Error('Skeleton loading not found');
      if (!response.data.includes('SkeletonCard')) throw new Error('Skeleton components not found');
      console.log(`   React Dashboard loaded successfully`);
      console.log(`   Contains React components: Yes`);
      console.log(`   Contains Shopify styling: Yes`);
      console.log(`   Contains skeleton loading: Yes`);
    });

    // Error Handling Tests
    await this.runTest('404 Error Handling', async () => {
      try {
        await axios.get(`${BASE_URL}/nonexistent`);
        throw new Error('Should have returned 404');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log(`   Correctly returns 404 for non-existent routes`);
        } else {
          throw error;
        }
      }
    });

    await this.runTest('Invalid API Endpoint', async () => {
      try {
        await axios.get(`${BASE_URL}/api/invalidmodule/info`);
        throw new Error('Should have returned 404');
      } catch (error) {
        if (error.response && error.response.status === 404) {
          console.log(`   Correctly returns 404 for invalid module endpoints`);
        } else {
          throw error;
        }
      }
    });

    // Print Results
    console.log(`${COLORS.bold}${COLORS.blue}📊 Test Results Summary${COLORS.reset}`);
    console.log(`${COLORS.green}✅ Passed: ${this.passed}${COLORS.reset}`);
    console.log(`${COLORS.red}❌ Failed: ${this.failed}${COLORS.reset}`);
    console.log(`${COLORS.blue}📈 Total: ${this.passed + this.failed}${COLORS.reset}`);
    
    if (this.failed === 0) {
      console.log(`\n${COLORS.green}${COLORS.bold}🎉 All tests passed! System is working perfectly!${COLORS.reset}`);
    } else {
      console.log(`\n${COLORS.red}${COLORS.bold}⚠️  Some tests failed. Please check the errors above.${COLORS.reset}`);
    }
  }
}

// Run the tests
const testRunner = new TestRunner();
testRunner.runAllTests().catch(console.error);
