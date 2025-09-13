# CMSModule

## Overview

CMSModule provides a comprehensive Content Management System for the Deservefirst platform. It offers flexible content creation, management, and delivery capabilities with support for multiple content types, media management, and multi-tenant architecture.

## Features

- **Content Management**: Create, edit, and manage various content types
- **Media Library**: Upload, organize, and manage media files
- **Content Types**: Flexible schema-based content type definitions
- **Version Control**: Track content changes and maintain revision history
- **Publishing Workflow**: Draft, review, and publish content with approval workflows
- **SEO Optimization**: Built-in SEO tools and meta tag management
- **Multi-Language Support**: Internationalization and localization features
- **Template System**: Customizable content templates and layouts
- **API-First**: RESTful API for headless CMS capabilities
- **Multi-Tenant**: Isolated content management per tenant
- **Caching**: Redis-based content caching for performance
- **Search**: Full-text search capabilities

## Installation

```bash
npm install @deservefirst/cms-module
```

## Quick Start

### Basic Setup

```typescript
import { ModuleOrchestrator } from '@deservefirst/core-module';

const orchestrator = ModuleOrchestrator.getInstance();

// Register CMS Module
await orchestrator.registerModule('CMSModule', {
  name: 'CMSModule',
  version: '1.0.0',
  category: 'content',
  dependencies: ['CoreModule', 'RBACModule'],
  routes: [
    {
      method: 'get',
      path: '/content',
      handler: (req, res) => {
        res.json({ content: ['page1', 'page2', 'blog1'] });
      }
    },
    {
      method: 'post',
      path: '/content',
      handler: (req, res) => {
        res.json({ message: 'Content created successfully' });
      }
    },
    {
      method: 'get',
      path: '/media',
      handler: (req, res) => {
        res.json({ media: ['image1.jpg', 'video1.mp4'] });
      }
    }
  ]
});
```

### Environment Variables

```bash
# CMS Configuration
CMS_UPLOAD_PATH=/uploads
CMS_MAX_FILE_SIZE=10485760
CMS_ALLOWED_EXTENSIONS=jpg,jpeg,png,gif,pdf,doc,docx
CMS_ENABLE_VERSIONING=true
CMS_CACHE_TTL=3600

# Storage Configuration
STORAGE_PROVIDER=local
AWS_S3_BUCKET=my-cms-bucket
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Database (inherited from CoreModule)
MYSQL_URL=mysql://username:password@localhost:3306/database_name
REDIS_URL=redis://localhost:6379
```

## Core Concepts

### Content Types
Define the structure and fields for different types of content (pages, blog posts, products, etc.)

### Content Items
Actual content instances based on content type definitions

### Media Assets
Files (images, videos, documents) managed by the media library

### Templates
Reusable layouts and designs for content presentation

### Workflows
Content approval and publishing processes

## API Reference

### Content Management

#### Create Content Type
```typescript
import { ContentTypeService } from '@deservefirst/cms-module';

const contentTypeService = new ContentTypeService();

// Define a blog post content type
const blogPostType = await contentTypeService.createContentType({
  tenantId: 'tenant-123',
  name: 'blog-post',
  displayName: 'Blog Post',
  description: 'Blog post content type',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 200
    },
    {
      name: 'content',
      type: 'richtext',
      required: true
    },
    {
      name: 'author',
      type: 'reference',
      referenceType: 'user',
      required: true
    },
    {
      name: 'tags',
      type: 'array',
      itemType: 'text'
    },
    {
      name: 'publishDate',
      type: 'datetime',
      required: true
    },
    {
      name: 'featuredImage',
      type: 'media',
      allowedTypes: ['image']
    }
  ],
  settings: {
    enableVersioning: true,
    enableComments: true,
    seoEnabled: true
  }
});
```

#### Create Content
```typescript
import { ContentService } from '@deservefirst/cms-module';

const contentService = new ContentService();

// Create a blog post
const blogPost = await contentService.createContent({
  tenantId: 'tenant-123',
  contentTypeId: blogPostType.id,
  title: 'My First Blog Post',
  slug: 'my-first-blog-post',
  status: 'draft',
  data: {
    title: 'Getting Started with Deservefirst CMS',
    content: '<p>This is my first blog post using the CMS...</p>',
    author: 'user-456',
    tags: ['cms', 'tutorial', 'getting-started'],
    publishDate: '2024-01-15T10:00:00Z',
    featuredImage: 'media-789'
  },
  metadata: {
    seo: {
      title: 'Getting Started with Deservefirst CMS - Complete Guide',
      description: 'Learn how to use Deservefirst CMS effectively',
      keywords: ['cms', 'tutorial', 'guide']
    }
  }
});
```

#### Query Content
```typescript
// Get all content for a tenant
const allContent = await contentService.getContent('tenant-123', {
  limit: 20,
  offset: 0,
  status: 'published'
});

// Get content by type
const blogPosts = await contentService.getContentByType(
  'tenant-123',
  'blog-post',
  {
    limit: 10,
    sortBy: 'publishDate',
    sortOrder: 'desc'
  }
);

// Search content
const searchResults = await contentService.searchContent('tenant-123', {
  query: 'tutorial',
  contentTypes: ['blog-post', 'page'],
  fields: ['title', 'content'],
  limit: 10
});

// Get content by slug
const content = await contentService.getContentBySlug(
  'tenant-123',
  'my-first-blog-post'
);
```

#### Update Content
```typescript
// Update content
const updatedContent = await contentService.updateContent(
  'tenant-123',
  'content-id',
  {
    data: {
      title: 'Updated Blog Post Title',
      content: '<p>Updated content...</p>'
    },
    status: 'published'
  }
);

// Publish content
const publishedContent = await contentService.publishContent(
  'tenant-123',
  'content-id',
  {
    publishDate: new Date(),
    publishedBy: 'user-456'
  }
);
```

### Media Management

#### Upload Media
```typescript
import { MediaService } from '@deservefirst/cms-module';
import multer from 'multer';

const mediaService = new MediaService();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Upload single file
app.post('/api/media/upload', upload.single('file'), async (req, res) => {
  const media = await mediaService.uploadFile({
    tenantId: req.headers['tenant-id'],
    file: req.file,
    metadata: {
      alt: req.body.alt,
      caption: req.body.caption,
      tags: req.body.tags?.split(',') || []
    }
  });
  
  res.json(media);
});

// Upload multiple files
app.post('/api/media/upload-multiple', upload.array('files'), async (req, res) => {
  const mediaFiles = await mediaService.uploadMultipleFiles({
    tenantId: req.headers['tenant-id'],
    files: req.files,
    folder: req.body.folder
  });
  
  res.json(mediaFiles);
});
```

#### Manage Media
```typescript
// Get media library
const mediaLibrary = await mediaService.getMediaLibrary('tenant-123', {
  limit: 20,
  offset: 0,
  type: 'image',
  folder: 'blog-images'
});

// Get media by ID
const media = await mediaService.getMedia('tenant-123', 'media-id');

// Update media metadata
const updatedMedia = await mediaService.updateMedia('tenant-123', 'media-id', {
  alt: 'Updated alt text',
  caption: 'Updated caption',
  tags: ['updated', 'media']
});

// Delete media
const deleted = await mediaService.deleteMedia('tenant-123', 'media-id');

// Create media folder
const folder = await mediaService.createFolder('tenant-123', {
  name: 'product-images',
  parentId: 'parent-folder-id'
});
```

### Template System

#### Create Templates
```typescript
import { TemplateService } from '@deservefirst/cms-module';

const templateService = new TemplateService();

// Create a page template
const pageTemplate = await templateService.createTemplate({
  tenantId: 'tenant-123',
  name: 'blog-post-template',
  displayName: 'Blog Post Template',
  contentType: 'blog-post',
  template: `
    <article class="blog-post">
      <header>
        <h1>{{title}}</h1>
        <div class="meta">
          <span class="author">By {{author.name}}</span>
          <time datetime="{{publishDate}}">{{publishDate | date}}</time>
        </div>
        {{#if featuredImage}}
        <img src="{{featuredImage.url}}" alt="{{featuredImage.alt}}" class="featured-image">
        {{/if}}
      </header>
      
      <div class="content">
        {{{content}}}
      </div>
      
      {{#if tags}}
      <footer class="tags">
        {{#each tags}}
        <span class="tag">{{this}}</span>
        {{/each}}
      </footer>
      {{/if}}
    </article>
  `,
  styles: `
    .blog-post {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    .featured-image {
      width: 100%;
      height: auto;
      border-radius: 8px;
    }
    
    .tag {
      background: #e2e8f0;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.875rem;
    }
  `
});
```

#### Render Content
```typescript
// Render content with template
const renderedContent = await templateService.renderContent(
  'tenant-123',
  'content-id',
  'blog-post-template'
);

// Render with custom data
const customRendered = await templateService.renderTemplate(
  'tenant-123',
  'blog-post-template',
  {
    title: 'Custom Title',
    content: '<p>Custom content</p>',
    author: { name: 'John Doe' },
    publishDate: new Date()
  }
);
```

### Workflow Management

#### Define Workflows
```typescript
import { WorkflowService } from '@deservefirst/cms-module';

const workflowService = new WorkflowService();

// Create approval workflow
const approvalWorkflow = await workflowService.createWorkflow({
  tenantId: 'tenant-123',
  name: 'content-approval',
  displayName: 'Content Approval Workflow',
  contentTypes: ['blog-post', 'page'],
  steps: [
    {
      name: 'draft',
      displayName: 'Draft',
      permissions: ['content:create', 'content:edit'],
      actions: ['submit-for-review']
    },
    {
      name: 'review',
      displayName: 'Under Review',
      permissions: ['content:review'],
      actions: ['approve', 'reject', 'request-changes']
    },
    {
      name: 'approved',
      displayName: 'Approved',
      permissions: ['content:publish'],
      actions: ['publish', 'schedule']
    },
    {
      name: 'published',
      displayName: 'Published',
      permissions: ['content:unpublish'],
      actions: ['unpublish', 'archive']
    }
  ]
});
```

#### Execute Workflow Actions
```typescript
// Submit content for review
const reviewSubmission = await workflowService.executeAction(
  'tenant-123',
  'content-id',
  'submit-for-review',
  {
    userId: 'author-id',
    comment: 'Ready for review'
  }
);

// Approve content
const approval = await workflowService.executeAction(
  'tenant-123',
  'content-id',
  'approve',
  {
    userId: 'reviewer-id',
    comment: 'Looks good, approved for publishing'
  }
);

// Get workflow history
const workflowHistory = await workflowService.getWorkflowHistory(
  'tenant-123',
  'content-id'
);
```

## REST API Endpoints

### Content API

```http
# Get all content
GET /api/cmsmodule/content
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Create content
POST /api/cmsmodule/content
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "contentTypeId": "blog-post-type-id",
  "title": "My Blog Post",
  "slug": "my-blog-post",
  "status": "draft",
  "data": {
    "title": "Getting Started",
    "content": "<p>Content here...</p>"
  }
}

# Get specific content
GET /api/cmsmodule/content/{contentId}
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Update content
PUT /api/cmsmodule/content/{contentId}
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "data": {
    "title": "Updated Title"
  },
  "status": "published"
}

# Delete content
DELETE /api/cmsmodule/content/{contentId}
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Search content
GET /api/cmsmodule/content/search?q=tutorial&type=blog-post
Authorization: Bearer <token>
Tenant-ID: tenant-123
```

### Media API

```http
# Upload media
POST /api/cmsmodule/media
Content-Type: multipart/form-data
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Get media library
GET /api/cmsmodule/media
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Get specific media
GET /api/cmsmodule/media/{mediaId}
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Update media metadata
PUT /api/cmsmodule/media/{mediaId}
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "alt": "Updated alt text",
  "caption": "Updated caption"
}

# Delete media
DELETE /api/cmsmodule/media/{mediaId}
Authorization: Bearer <token>
Tenant-ID: tenant-123
```

### Content Types API

```http
# Get content types
GET /api/cmsmodule/content-types
Authorization: Bearer <token>
Tenant-ID: tenant-123

# Create content type
POST /api/cmsmodule/content-types
Content-Type: application/json
Authorization: Bearer <token>
Tenant-ID: tenant-123

{
  "name": "product",
  "displayName": "Product",
  "fields": [
    {
      "name": "name",
      "type": "text",
      "required": true
    },
    {
      "name": "price",
      "type": "number",
      "required": true
    }
  ]
}
```

## Advanced Features

### Content Versioning

```typescript
import { VersionService } from '@deservefirst/cms-module';

const versionService = new VersionService();

// Get content versions
const versions = await versionService.getVersions('tenant-123', 'content-id');

// Create version
const version = await versionService.createVersion('tenant-123', 'content-id', {
  comment: 'Updated content structure',
  userId: 'user-456'
});

// Restore version
const restored = await versionService.restoreVersion(
  'tenant-123',
  'content-id',
  'version-id'
);

// Compare versions
const diff = await versionService.compareVersions(
  'tenant-123',
  'version-1-id',
  'version-2-id'
);
```

### SEO Management

```typescript
import { SEOService } from '@deservefirst/cms-module';

const seoService = new SEOService();

// Analyze content SEO
const seoAnalysis = await seoService.analyzeContent('tenant-123', 'content-id');

// Generate sitemap
const sitemap = await seoService.generateSitemap('tenant-123', {
  includeImages: true,
  changeFreq: 'weekly',
  priority: 0.8
});

// Update meta tags
const metaTags = await seoService.updateMetaTags('tenant-123', 'content-id', {
  title: 'SEO Optimized Title',
  description: 'SEO friendly description',
  keywords: ['seo', 'optimization'],
  ogImage: 'media-id'
});
```

### Multi-Language Support

```typescript
import { LocalizationService } from '@deservefirst/cms-module';

const localizationService = new LocalizationService();

// Create localized content
const localizedContent = await localizationService.createLocalization(
  'tenant-123',
  'content-id',
  'es',
  {
    title: 'Título en Español',
    content: '<p>Contenido en español...</p>'
  }
);

// Get content in specific language
const spanishContent = await contentService.getContent(
  'tenant-123',
  'content-id',
  { language: 'es' }
);

// Get available languages
const languages = await localizationService.getAvailableLanguages(
  'tenant-123',
  'content-id'
);
```

### Caching Strategy

```typescript
import { CacheService } from '@deservefirst/cms-module';

const cacheService = new CacheService();

// Configure content caching
const cacheConfig = {
  contentTTL: 3600, // 1 hour
  mediaTTL: 86400, // 24 hours
  enableEdgeCache: true
};

// Cache content
await cacheService.cacheContent('tenant-123', 'content-id', content);

// Invalidate cache
await cacheService.invalidateContent('tenant-123', 'content-id');

// Warm up cache
await cacheService.warmUpCache('tenant-123', ['content-1', 'content-2']);
```

## Performance Optimization

### Database Optimization

```typescript
// Use database indexes for better query performance
const indexedQuery = await contentService.getContent('tenant-123', {
  filters: {
    status: 'published',
    contentType: 'blog-post'
  },
  useIndex: true
});

// Implement pagination for large datasets
const paginatedContent = await contentService.getContent('tenant-123', {
  limit: 20,
  offset: 40,
  sortBy: 'publishDate',
  sortOrder: 'desc'
});
```

### Media Optimization

```typescript
// Configure image optimization
const imageConfig = {
  enableWebP: true,
  enableLazyLoading: true,
  generateThumbnails: true,
  thumbnailSizes: [150, 300, 600, 1200]
};

// Optimize uploaded images
const optimizedMedia = await mediaService.optimizeImage('media-id', {
  quality: 85,
  format: 'webp',
  resize: { width: 1200, height: 800 }
});
```

## Security Best Practices

### Input Validation

```typescript
// Validate content data
const contentSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
    content: { type: 'string' },
    status: { enum: ['draft', 'published', 'archived'] }
  },
  required: ['title', 'content']
};

// Sanitize HTML content
const sanitizedContent = await contentService.sanitizeContent(content, {
  allowedTags: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'a', 'img'],
  allowedAttributes: {
    'a': ['href', 'title'],
    'img': ['src', 'alt', 'width', 'height']
  }
});
```

### File Upload Security

```typescript
// Configure secure file uploads
const uploadConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf'
  ],
  scanForViruses: true,
  validateFileHeaders: true
};

// Validate uploaded files
const isValidFile = await mediaService.validateFile(file, uploadConfig);
```

## Testing

### Unit Tests

```typescript
import { ContentService } from '@deservefirst/cms-module';
import { expect } from 'chai';

describe('ContentService', () => {
  let contentService: ContentService;

  beforeEach(() => {
    contentService = new ContentService();
  });

  it('should create content with valid data', async () => {
    const content = await contentService.createContent({
      tenantId: 'test-tenant',
      contentTypeId: 'blog-post',
      title: 'Test Post',
      data: { title: 'Test', content: 'Test content' }
    });

    expect(content.title).to.equal('Test Post');
    expect(content.status).to.equal('draft');
  });

  it('should validate required fields', async () => {
    try {
      await contentService.createContent({
        tenantId: 'test-tenant',
        contentTypeId: 'blog-post',
        data: {} // Missing required fields
      });
    } catch (error) {
      expect(error.message).to.include('validation');
    }
  });
});
```

### Integration Tests

```typescript
import request from 'supertest';
import { app } from '../app';

describe('CMS API', () => {
  it('should create content via API', async () => {
    const response = await request(app)
      .post('/api/cmsmodule/content')
      .set('Authorization', 'Bearer valid-token')
      .set('Tenant-ID', 'test-tenant')
      .send({
        contentTypeId: 'blog-post',
        title: 'API Test Post',
        data: {
          title: 'Test',
          content: 'Test content'
        }
      });

    expect(response.status).to.equal(201);
    expect(response.body.title).to.equal('API Test Post');
  });

  it('should upload media files', async () => {
    const response = await request(app)
      .post('/api/cmsmodule/media')
      .set('Authorization', 'Bearer valid-token')
      .set('Tenant-ID', 'test-tenant')
      .attach('file', 'test-image.jpg');

    expect(response.status).to.equal(201);
    expect(response.body.url).to.be.a('string');
  });
});
```

## Troubleshooting

### Common Issues

1. **File Upload Failures**
   ```typescript
   // Check upload configuration
   const uploadStatus = await mediaService.checkUploadConfig();
   console.log('Upload config:', uploadStatus);
   
   // Verify file permissions
   const permissions = await mediaService.checkFilePermissions();
   ```

2. **Content Not Appearing**
   ```typescript
   // Check content status and permissions
   const contentStatus = await contentService.getContentStatus(
     'tenant-123',
     'content-id'
   );
   
   // Verify cache status
   const cacheStatus = await cacheService.getCacheStatus('content-id');
   ```

3. **Template Rendering Issues**
   ```typescript
   // Debug template compilation
   const templateDebug = await templateService.debugTemplate(
     'template-id',
     sampleData
   );
   console.log('Template debug info:', templateDebug);
   ```

## Migration Guide

### Database Migrations

```sql
-- Create content tables
CREATE TABLE content_types (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  display_name VARCHAR(200),
  fields JSON,
  settings JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant_name (tenant_id, name)
);

CREATE TABLE content (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  content_type_id VARCHAR(36) NOT NULL,
  title VARCHAR(500),
  slug VARCHAR(500),
  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  data JSON,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  INDEX idx_tenant_type (tenant_id, content_type_id),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_tenant_slug (tenant_id, slug),
  FOREIGN KEY (content_type_id) REFERENCES content_types(id)
);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add comprehensive tests
4. Ensure all tests pass
5. Update documentation
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**Note**: This module requires CoreModule and optionally RBACModule as dependencies. Node.js 16+ required.