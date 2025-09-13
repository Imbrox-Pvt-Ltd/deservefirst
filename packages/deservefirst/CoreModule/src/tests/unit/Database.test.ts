import { expect } from 'chai';
import { Database } from '../../database/Database';
import sinon from 'sinon';

describe('Database', () => {
  it('should create a record', async () => {
    const stub = sinon.stub(DatabaseProvider, 'create').resolves({ id: 1, title: 'Test' });
    const model = await Database.model('test', { fields: 'title VARCHAR(255)' });
    const result = await Database.create(model, { title: 'Test' });
    expect(result.title).to.equal('Test');
    stub.restore();
  });
});
