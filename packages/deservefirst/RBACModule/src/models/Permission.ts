import { Database } from '@deservefirst/core-module';
import { PermissionSchema } from '../schema/PermissionSchema';

export default Database.model('permissions', PermissionSchema);
