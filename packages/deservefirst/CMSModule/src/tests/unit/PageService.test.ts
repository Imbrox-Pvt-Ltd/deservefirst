import { expect } from 'chai';
import { PageService } from '../../services/PageService';
import sinon from 'sinon';
import { Database } from '@deservefirst/core-module';

describe('PageService', () => {
  it('should create a page', async () => {
    const stub = sinon.stub(Database, 'create').resolves({ id: 1, title: 'Test Page' });
    const page = await PageService.createPage('tenant1', 'store1', { title: 'Test Page', urlKey: 'test-page' });
    expect(page.title).to.equal('Test Page');
    stub.restore();
  });
});
