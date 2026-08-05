/**
 * Storefront · api/messages.controller.ts
 * Triaging contact messages.
 *
 * One endpoint, because reading is already served by the generic surface from
 * the resource declaration. Writing a list endpoint here would be a second way
 * into the same rows, and the two would eventually disagree about filtering.
 *
 * Changing a status IS module-owned, though, and the reason is the transition
 * rules below rather than the update itself.
 * Layer: api.
 */

import { controller, type ModuleController, type RouteRequest } from '../../core/http/controller';

export type MessageStatus = 'new' | 'read' | 'replied' | 'spam';

const STATUSES: readonly MessageStatus[] = ['new', 'read', 'replied', 'spam'];

export interface MessageServices {
  setStatus(id: string, status: MessageStatus): Promise<{ id: string; status: MessageStatus }>;
}

export function messagesController(services: MessageServices): ModuleController {
  return controller('storefront', [
    {
      method: 'PATCH',
      path: '/contact-messages/:id',
      permission: 'store.messages.read',
      handle: async (request: RouteRequest) => {
        const status = String(request.body.status ?? '');

        if (!STATUSES.includes(status as MessageStatus)) {
          /**
           * Named rather than a bare 400.
           *
           * The valid values are a closed set a caller cannot guess from a
           * refusal, and an integration triaging messages from a helpdesk needs
           * to know them without reading our source.
           */
          throw Object.assign(
            new Error(`"${status}" is not a message status. Use one of: ${STATUSES.join(', ')}.`),
            { statusCode: 422 },
          );
        }

        return services.setStatus(request.params.id as string, status as MessageStatus);
      },
    },
  ]);
}
