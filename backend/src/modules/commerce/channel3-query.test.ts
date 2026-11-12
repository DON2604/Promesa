import type { IntentSpec } from '@promesa/contracts';
import { describe, expect, it } from 'vitest';
import {
  channel3MaxPrice,
  channel3SearchQuery,
  channel3UserId,
  matchingCategorySlug,
  toChannel3Products,
  type Channel3ProductSource,
} from './channel3-query';

const spec: IntentSpec = {
  productKind: 'packaging-box',
  productLabel: 'food-safe paper boxes',
  quantity: 100,
  unit: 'boxes',
  requiredAttributes: ['paper', 'food-safe'],
  prohibitedAttributes: ['plastic'],
  budgetMinor: '10000',
  currency: 'USD',
  deadlineISO: '2026-11-13T17:00:00-05:00',
  timezone: 'America/New_York',
  hardConstraints: [],
  softPreferences: [],
  assumptions: [],
  unresolvedQuestions: [],
};

describe('channel3 search request', () => {
  it('puts material constraints in the query and the budget in major units', () => {
    expect(channel3SearchQuery(spec)).toBe(
      'food-safe paper boxes. must be paper, food-safe. must not be plastic. 100 boxes',
    );
    expect(channel3MaxPrice(spec)).toBe(100);
  });

  it('keeps a uuid user id and drops anything Channel3 would reject', () => {
    expect(channel3UserId('6d9f1c0a-1b2c-4d3e-8f90-aabbccddeeff')).toBe(
      '6d9f1c0a-1b2c-4d3e-8f90-aabbccddeeff',
    );
    expect(channel3UserId('has a space')).toBeUndefined();
    expect(channel3UserId('')).toBeUndefined();
  });

  it('uses a discovered category only when it shares a word with the label', () => {
    expect(
      matchingCategorySlug('food-safe paper boxes', [
        { slug: 'running-shoes', title: 'Running shoes' },
        { slug: 'shipping-boxes', title: 'Shipping boxes' },
      ]),
    ).toBe('shipping-boxes');
    expect(
      matchingCategorySlug('hygiene kits', [{ slug: 'sofas', title: 'Sofas' }]),
    ).toBeUndefined();
  });
});

describe('toChannel3Products', () => {
  const product: Channel3ProductSource = {
    id: 'prod_1',
    title: 'Kraft mailer',
    brands: [{ name: 'Northwind' }],
    images: [
      {
        url: 'https://cdn.example/raw.jpg',
        cleaned_url: 'https://cdn.example/clean.jpg',
        is_main_image: true,
      },
    ],
    category: { title: 'Shipping boxes' },
    offers: [
      {
        url: 'https://shop.example/a',
        domain: 'shop.example',
        price: { price: 12.5, currency: 'USD', compare_at_price: 15 },
        availability: 'OutOfStock',
      },
      {
        url: 'javascript:alert(1)',
        domain: 'evil.example',
        price: { price: 1, currency: 'USD' },
        availability: 'InStock',
      },
      {
        url: 'https://other.example/b',
        domain: 'other.example',
        price: { price: 9, currency: 'USD' },
        availability: 'InStock',
      },
    ],
  };

  it('keeps https affiliate links, prefers in-stock offers, and drops unsafe urls', () => {
    const [view] = toChannel3Products([product]);
    expect(view?.imageUrl).toBe('https://cdn.example/clean.jpg');
    expect(view?.brand).toBe('Northwind');
    expect(view?.offers.map((offer) => offer.domain)).toEqual(['other.example', 'shop.example']);
    expect(view?.offers[0]).toMatchObject({ price: 9, availability: 'InStock' });
    expect(view?.offers[1]?.compareAtPrice).toBe(15);
  });
});
