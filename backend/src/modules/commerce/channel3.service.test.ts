import type { IntentSpec } from '@promesa/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env';
import { channel3SearchQuery } from './channel3-query';
import { Channel3Service, discoverChannel3, type Channel3Catalog } from './channel3.service';

const spec: IntentSpec = {
  productKind: 'hygiene-kit',
  productLabel: 'hygiene kits',
  quantity: 40,
  unit: 'kits',
  requiredAttributes: ['fragrance-free'],
  prohibitedAttributes: ['latex'],
  budgetMinor: '25000',
  currency: 'USD',
  deadlineISO: '2026-11-20T17:00:00-05:00',
  timezone: 'America/New_York',
  hardConstraints: [],
  softPreferences: [],
  assumptions: [],
  unresolvedQuestions: [],
};

function catalog(partial: Partial<Channel3Catalog> = {}): Channel3Catalog {
  return {
    searchCategories: vi.fn(async () => [{ slug: 'personal-hygiene', title: 'Personal hygiene' }]),
    searchProducts: vi.fn(async () => [
      {
        id: 'prod_hygiene',
        title: 'Fragrance free kit',
        offers: [
          {
            url: 'https://merchant.example/kit',
            domain: 'merchant.example',
            price: { price: 18, currency: 'USD' },
            availability: 'InStock' as const,
          },
        ],
      },
    ]),
    ...partial,
  };
}

describe('discoverChannel3', () => {
  it('searches with the budget cap and a discovered category', async () => {
    const client = catalog();
    const found = await discoverChannel3(
      client,
      spec,
      'user_123',
      new Date('2026-11-12T12:00:00Z'),
    );
    expect(client.searchProducts).toHaveBeenCalledWith(
      channel3SearchQuery(spec),
      { price: { max_price: 250 }, category_ids: ['personal-hygiene'] },
      'user_123',
    );
    expect(found.status).toBe('ACTIVE');
    expect(found.products).toHaveLength(1);
    expect(found.observedAt).toBe('2026-11-12T12:00:00.000Z');
    expect(found.detail).toMatch(/not a stock guarantee/);
  });

  it('retries without the category when Channel3 rejects it', async () => {
    const searchProducts = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad category'), { statusCode: 422 }))
      .mockResolvedValueOnce([]);
    const found = await discoverChannel3(catalog({ searchProducts }), spec, undefined);
    expect(searchProducts).toHaveBeenCalledTimes(2);
    expect(searchProducts.mock.calls[1]?.[1]).toEqual({ price: { max_price: 250 } });
    expect(found.status).toBe('ACTIVE');
    expect(found.products).toEqual([]);
    expect(found.detail).toMatch(/no products/);
  });

  it('stays on the merchant catalog when search fails', async () => {
    const searchProducts = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { statusCode: 401 });
    });
    const found = await discoverChannel3(catalog({ searchProducts }), spec, undefined);
    expect(found.status).toBe('UNAVAILABLE');
    expect(found.detail).toBe(
      'Channel3 search failed (HTTP 401). Checkout continues with the connected merchant catalog.',
    );
    expect(found.products).toEqual([]);
  });

  it('still searches products when category lookup fails', async () => {
    const client = catalog({
      searchCategories: vi.fn(async () => {
        throw new Error('categories down');
      }),
    });
    const found = await discoverChannel3(client, spec, undefined);
    expect(client.searchProducts).toHaveBeenCalledWith(
      expect.any(String),
      { price: { max_price: 250 } },
      undefined,
    );
    expect(found.status).toBe('ACTIVE');
  });
});

describe('Channel3Service', () => {
  it('does not call Channel3 when the key is unset', async () => {
    const service = new Channel3Service({ CHANNEL3_API_KEY: undefined } as Env);
    const found = await service.discover(spec, 'user_123');
    expect(found.status).toBe('NOT_CONFIGURED');
    expect(found.products).toEqual([]);
  });
});
