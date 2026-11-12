import { Inject, Injectable } from '@nestjs/common';
import { Channel3, Channel3Error } from '@channel3/sdk';
import { type Channel3DiscoveryView, type IntentSpec } from '@promesa/contracts';
import { ENV, type Env } from '../../config/env';
import {
  type Channel3ProductSource,
  type Channel3SearchFilters,
  channel3PriceFilter,
  channel3SearchQuery,
  channel3UserId,
  matchingCategorySlug,
  toChannel3Products,
} from './channel3-query';

const SUCCESS_TTL_MS = 2 * 60 * 1000;
const FAILURE_TTL_MS = 20 * 1000;
const SEARCH_LIMIT = 6;

export type Channel3Catalog = {
  searchCategories(query: string): Promise<Array<{ slug: string; title: string }>>;
  searchProducts(
    query: string,
    filters: Channel3SearchFilters,
    userId: string | undefined,
  ): Promise<Channel3ProductSource[]>;
};

const NOT_CONFIGURED: Channel3DiscoveryView = {
  status: 'NOT_CONFIGURED',
  detail:
    'No CHANNEL3_API_KEY configured. Channel3 discovery is off; nothing here comes from Channel3.',
  query: null,
  observedAt: null,
  products: [],
};

/**
 * Channel3 catalog search for mission discovery. Results stay out of the orderable
 * catalog: sellers are not PayPal-connected merchants, and Channel3 does not guarantee stock.
 * Offer URLs are kept only for the short cache below, then fetched again.
 */
@Injectable()
export class Channel3Service {
  private readonly catalog: Channel3Catalog | null;
  private readonly cache = new Map<string, { expires: number; value: Channel3DiscoveryView }>();
  private readonly inflight = new Map<string, Promise<Channel3DiscoveryView>>();

  constructor(@Inject(ENV) env: Env) {
    this.catalog = env.CHANNEL3_API_KEY ? sdkCatalog(env.CHANNEL3_API_KEY) : null;
  }

  discover(spec: IntentSpec, userId: string | undefined): Promise<Channel3DiscoveryView> {
    if (!this.catalog) return Promise.resolve(NOT_CONFIGURED);
    const key = cacheKey(spec, userId);
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const run = discoverChannel3(this.catalog, spec, userId)
      .catch((): Channel3DiscoveryView =>
        unavailable(
          channel3SearchQuery(spec),
          'Channel3 search failed. Checkout continues with the connected merchant catalog.',
        ),
      )
      .then((value) => {
        this.cache.set(key, {
          expires: Date.now() + (value.status === 'UNAVAILABLE' ? FAILURE_TTL_MS : SUCCESS_TTL_MS),
          value,
        });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, run);
    return run;
  }
}

export async function discoverChannel3(
  catalog: Channel3Catalog,
  spec: IntentSpec,
  userId: string | undefined,
  now: Date = new Date(),
): Promise<Channel3DiscoveryView> {
  const query = channel3SearchQuery(spec);
  const price = channel3PriceFilter(spec);
  const attributed = channel3UserId(userId);
  let categoryId: string | undefined;
  try {
    const categories = await catalog.searchCategories(spec.productLabel);
    categoryId = matchingCategorySlug(spec.productLabel, categories);
  } catch {
    categoryId = undefined;
  }

  try {
    const filters: Channel3SearchFilters = {
      ...(price ? { price } : {}),
      ...(categoryId ? { category_ids: [categoryId] } : {}),
    };
    let products: Channel3ProductSource[];
    try {
      products = await catalog.searchProducts(query, filters, attributed);
    } catch (error) {
      if (!categoryId || statusCodeOf(error) !== 422) throw error;
      products = await catalog.searchProducts(query, price ? { price } : {}, attributed);
    }
    const views = toChannel3Products(products);
    const detail =
      views.length > 0
        ? `${views.length} Channel3 product${views.length === 1 ? '' : 's'} for “${spec.productLabel}”. Prices and buy links are merchant-reported affiliate links, not NeedMesh orders and not a stock guarantee. These sellers are not connected for PayPal checkout.`
        : `Channel3 returned no products for “${spec.productLabel}” within the mission budget. Checkout continues with the connected merchant catalog.`;
    return {
      status: 'ACTIVE',
      detail,
      query,
      observedAt: now.toISOString(),
      products: views,
    };
  } catch (error) {
    const status = statusCodeOf(error);
    return unavailable(
      query,
      status
        ? `Channel3 search failed (HTTP ${status}). Checkout continues with the connected merchant catalog.`
        : 'Channel3 search failed. Checkout continues with the connected merchant catalog.',
    );
  }
}

function unavailable(query: string, detail: string): Channel3DiscoveryView {
  return { status: 'UNAVAILABLE', detail, query, observedAt: null, products: [] };
}

function cacheKey(spec: IntentSpec, userId: string | undefined): string {
  return JSON.stringify({
    q: channel3SearchQuery(spec),
    max: channel3MaxPriceSafe(spec),
    user: channel3UserId(userId) ?? '',
  });
}

function channel3MaxPriceSafe(spec: IntentSpec): number | null {
  return channel3PriceFilter(spec)?.max_price ?? null;
}

function statusCodeOf(error: unknown): number | undefined {
  if (error instanceof Channel3Error && typeof error.statusCode === 'number')
    return error.statusCode;
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

function sdkCatalog(apiKey: string): Channel3Catalog {
  const client = new Channel3({
    apiKey,
    country: 'US',
    currency: 'USD',
    timeoutInSeconds: 8,
    maxRetries: 1,
    logging: { level: 'warn', silent: true },
  });
  return {
    async searchCategories(query) {
      const result = await client.categories.search({ query, limit: 5 });
      return result.categories.map((category) => ({ slug: category.slug, title: category.title }));
    },
    async searchProducts(query, filters, userId) {
      const page = await client.products.search({
        query,
        limit: SEARCH_LIMIT,
        filters,
        config: { mode: 'default', country: 'US', currency: 'USD' },
        ...(userId ? { 'x-user-id': userId } : {}),
      });
      return page.data;
    },
  };
}
