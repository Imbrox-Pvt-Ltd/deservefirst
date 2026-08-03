/**
 * Catalog · api/product.controller.ts
 * A thin transport adapter: parse, authorize, serialize, then call an
 * application use-case. No business logic lives here, which is what lets REST,
 * GraphQL and the worker share one implementation (§13.1). Note it imports
 * application/ and never infrastructure/ — the layer law, fitness-enforced.
 * Layer: api.
 */

import {
  type ListQuery,
  moneyFromDecimalString,
  parseListQuery,
  toDecimalString,
} from '@deservefirst/contracts';

import { type ApiResponse, paginated, success } from '../../../core';

import type { ProductService } from '../application';
import type { Product } from '../domain';

/** The wire shape. Money is a string, never a float — JSON has no decimals. */
export interface ProductDto {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly vendor: string | null;
  readonly productType: string | null;
  readonly price: { amount: string; currency: string };
  readonly compareAtPrice: { amount: string; currency: string } | null;
  readonly publishedChannels: readonly string[];
  readonly version: number;
}

export function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    description: product.description,
    status: product.status,
    vendor: product.vendor,
    productType: product.productType,
    price: { amount: toDecimalString(product.price), currency: product.price.currency },
    compareAtPrice: product.compareAtPrice
      ? { amount: toDecimalString(product.compareAtPrice), currency: product.compareAtPrice.currency }
      : null,
    publishedChannels: product.publishedChannels,
    version: product.version,
  };
}

export interface RequestLike {
  readonly requestId: string;
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly params: Record<string, string>;
}

export class ProductController {
  constructor(private readonly service: ProductService) {}

  /** List state is read from the URL, never from a body (§24.3). */
  async list(request: RequestLike): Promise<ApiResponse<readonly ProductDto[]>> {
    const query: ListQuery = parseListQuery(new URL(request.url, 'http://internal').searchParams);
    const connection = await this.service.list(query);
    return paginated(
      { ...connection, nodes: connection.nodes.map(toProductDto) },
      { requestId: request.requestId },
    );
  }

  async get(request: RequestLike): Promise<ApiResponse<ProductDto>> {
    const product = await this.service.get(request.params.id ?? '');
    return success(toProductDto(product), { requestId: request.requestId });
  }

  async create(request: RequestLike): Promise<ApiResponse<ProductDto>> {
    const body = request.body;
    const product = await this.service.create({
      title: String(body.title ?? ''),
      description: body.description === undefined ? undefined : String(body.description),
      handle: body.handle === undefined ? undefined : String(body.handle),
      vendor: body.vendor === undefined ? undefined : (body.vendor as string | null),
      productType: body.productType === undefined ? undefined : (body.productType as string | null),
      price: parseMoney(body.price),
      compareAtPrice: body.compareAtPrice === undefined ? undefined : parseMoney(body.compareAtPrice),
    });
    return success(toProductDto(product), { requestId: request.requestId });
  }

  async update(request: RequestLike): Promise<ApiResponse<ProductDto>> {
    const body = request.body;
    const product = await this.service.update({
      id: request.params.id ?? '',
      expectedVersion: Number(body.version ?? 0),
      ...(body.title === undefined ? {} : { title: String(body.title) }),
      ...(body.description === undefined ? {} : { description: String(body.description) }),
      ...(body.handle === undefined ? {} : { handle: String(body.handle) }),
      ...(body.status === undefined ? {} : { status: body.status as Product['status'] }),
      ...(body.price === undefined ? {} : { price: parseMoney(body.price) }),
    });
    return success(toProductDto(product), { requestId: request.requestId });
  }

  async publish(request: RequestLike): Promise<ApiResponse<ProductDto>> {
    const channels = Array.isArray(request.body.channels)
      ? (request.body.channels as unknown[]).map(String)
      : [];
    const product = await this.service.publish(
      request.params.id ?? '',
      channels,
      Number(request.body.version ?? 0),
    );
    return success(toProductDto(product), { requestId: request.requestId });
  }
}

/** Accepts `{ amount: "19.99", currency: "USD" }` and refuses anything else. */
function parseMoney(value: unknown) {
  const candidate = value as { amount?: unknown; currency?: unknown } | undefined;
  if (!candidate || typeof candidate.amount !== 'string' || typeof candidate.currency !== 'string') {
    throw new Error('price must be { amount: "19.99", currency: "USD" }');
  }
  return moneyFromDecimalString(candidate.amount, candidate.currency);
}
