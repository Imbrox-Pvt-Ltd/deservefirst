import { expect } from 'chai';
import { ConfigManager } from '../../config/ConfigManager';
import sinon from 'sinon';

describe('ConfigManager', () => {
  it('should get default config value', async () => {
    const result = await ConfigManager.getDefaultValue('core.default_language');
    expect(result).to.equal('en');
  });
});
