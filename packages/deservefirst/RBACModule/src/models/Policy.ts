import { Database } from '@deservefirst/core-module';
import { PolicySchema } from '../schema/PolicySchema';

export default Database.model('policies', PolicySchema);
