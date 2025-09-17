#!/usr/bin/env node

import { ModuleGenerator } from './module-generator';

const commands: Record<string, () => Promise<void> | void> = {
  'generate-module': async () => {
    const generator = new ModuleGenerator();
    await generator.generateModule();
  },
  'help': () => {
    console.log('🚀 Deservefirst CLI Tools');
    console.log('========================\n');
    console.log('Available commands:');
    console.log('  generate-module    Generate a new module');
    console.log('  help              Show this help message');
    console.log('\nUsage:');
    console.log('  npm run cli generate-module');
    console.log('  npm run cli help');
  },
};

async function main() {
  const command = process.argv[2] || 'help';
  
  if (commands[command]) {
    await commands[command]();
  } else {
    console.log(`❌ Unknown command: ${command}`);
    console.log('Run "npm run cli help" to see available commands');
    process.exit(1);
  }
}

main().catch(console.error);
