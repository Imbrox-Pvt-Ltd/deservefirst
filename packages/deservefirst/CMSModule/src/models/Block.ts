import { Database } from '@deservefirst/core-module';
import { BlockSchema } from '../schema/BlockSchema';

export default Database.model('blocks', BlockSchema);
