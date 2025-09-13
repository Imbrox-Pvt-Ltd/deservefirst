const dotenv = require('dotenv');
const express = require('express');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    console.log('🚀 Starting Deservefirst Platform...');
    
    // Create Express server
    const app = express();
    
    // Basic middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.version
        }
      };
      res.json(healthStatus);
    });
    
    // Basic info endpoint
    app.get('/', (req, res) => {
      res.json({
        name: 'Deservefirst Platform',
        version: '1.0.0',
        status: 'running',
        endpoints: {
          health: '/health',
          info: '/'
        }
      });
    });
    
    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Deservefirst Platform is running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`ℹ️  Info: http://localhost:${PORT}/`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start Deservefirst Platform:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the application
bootstrap();