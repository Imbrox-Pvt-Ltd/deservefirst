import { Database } from '@deservefirst/core-module';
import { RoleSchema } from '../schema/RoleSchema';

export default Database.model('roles', RoleSchema);
