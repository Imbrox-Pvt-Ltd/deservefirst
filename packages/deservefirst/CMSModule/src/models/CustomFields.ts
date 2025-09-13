import { Database } from '@deservefirst/core-module';
import { CustomFieldsSchema } from '../schema/CustomFieldsSchema';

export default Database.model('customfields', CustomFieldsSchema);
