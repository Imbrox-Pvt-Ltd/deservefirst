import { Injectable } from '@nestjs/common';

@Injectable()
export class CmsService {
  async getContent() {
    return [
      { id: '1', title: 'Home Page', slug: 'home', status: 'published', content: 'Welcome to our site' },
      { id: '2', title: 'About Page', slug: 'about', status: 'published', content: 'About us content' },
      { id: '3', title: 'Blog Post', slug: 'blog-post', status: 'draft', content: 'Blog content' },
    ];
  }

  async createContent(createContentDto: any) {
    return {
      id: Date.now().toString(),
      ...createContentDto,
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
  }

  async getMedia() {
    return [
      { id: '1', name: 'hero-image.jpg', type: 'image', url: '/media/hero-image.jpg', size: 1024000 },
      { id: '2', name: 'product-video.mp4', type: 'video', url: '/media/product-video.mp4', size: 5120000 },
    ];
  }
}
