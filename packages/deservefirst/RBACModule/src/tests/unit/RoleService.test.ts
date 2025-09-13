import { expect } from 'chai';
import { RoleService } from '../../services/RoleService';
import sinon from 'sinon';
import { Database } from '@deservefirst/core-module';

describe('RoleService', () => {
  it('should create a role', async () => {
    const stub = sinon.stub(Database, 'create').resolves({ id: 1, name: 'Admin' });
    const role = await RoleService.createRole('tenant1', { name: 'Admin' });
    expect(role.name).to.equal('Admin');
    stub.restore();
  });
});
