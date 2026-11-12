import {
  type Channel3OfferView,
  type Channel3ProductView,
  type IntentSpec,
  minorToMajorString,
} from '@promesa/contracts';

const USER_ID = /^[A-Za-z0-9._@-]{1,128}$/;
const RESULT_LIMIT = 6;
const OFFERS_PER_PRODUCT = 3;

export type Channel3CategoryHit = { slug: string; title: string };

/** Shape of a Channel3 product the mapper reads. Extra SDK fields are ignored. */
export type Channel3ProductSource = {
  id: string;
  title: string;
  brands?: Array<{ name: string }> | null;
  images?: Array<{ url: string; cleaned_url?: string | null; is_main_image?: boolean }> | null;
  category?: { title: string } | null;
  offers?: Array<{
    url: string;
    domain: string;
    price: { price: number; currency: string; compare_at_price?: number | null };
    availability: 'InStock' | 'OutOfStock';
  }> | null;
};

export type Channel3SearchFilters = {
  price?: { max_price: number };
  category_ids?: string[];
};

/**
 * Letters, numbers, and `. _ @ -` only, max 128. Anything else is omitted so the
 * request stays within Channel3's user-attribution rules.
 */
export function channel3UserId(userId: string | null | undefined): string | undefined {
  if (!userId || !USER_ID.test(userId)) return undefined;
  return userId;
}

/**
 * Constraints that have no Channel3 filter go in the query. Material words such as
 * "paper" or "plastic" are not sent as `filters.attributes` — those handles have to
 * be discovered per category, and guessing them is wrong. Color is not in the
 * intent vocabulary, so `filters.colors` is not set here either.
 */
export function channel3SearchQuery(
  spec: Pick<
    IntentSpec,
    'productLabel' | 'requiredAttributes' | 'prohibitedAttributes' | 'quantity' | 'unit'
  >,
): string {
  const parts = [spec.productLabel.trim()];
  if (spec.requiredAttributes.length > 0) {
    parts.push(`must be ${spec.requiredAttributes.join(', ')}`);
  }
  if (spec.prohibitedAttributes.length > 0) {
    parts.push(`must not be ${spec.prohibitedAttributes.join(', ')}`);
  }
  if (spec.quantity > 1) parts.push(`${spec.quantity} ${spec.unit}`.trim());
  return parts.filter(Boolean).join('. ').slice(0, 400);
}

/** Whole mission budget in major units. Channel3 prices are per unit, in dollars and cents. */
export function channel3MaxPrice(spec: Pick<IntentSpec, 'budgetMinor' | 'currency'>): number {
  return Number(minorToMajorString(spec.budgetMinor, spec.currency));
}

export function channel3PriceFilter(
  spec: Pick<IntentSpec, 'budgetMinor' | 'currency'>,
): { max_price: number } | undefined {
  const max = channel3MaxPrice(spec);
  if (!Number.isFinite(max) || max <= 0) return undefined;
  return { max_price: max };
}

/**
 * Use a category slug only when Channel3's own category search returned it and its
 * title or slug shares a word with the product label. Unknown slugs are not guessed.
 */
export function matchingCategorySlug(
  productLabel: string,
  categories: readonly Channel3CategoryHit[],
): string | undefined {
  const wanted = tokens(productLabel);
  if (wanted.size === 0) return undefined;
  for (const category of categories) {
    const have = tokens(`${category.title} ${category.slug}`);
    for (const token of wanted) {
      if (have.has(token)) return category.slug;
    }
  }
  return undefined;
}

export function toChannel3Products(
  products: readonly Channel3ProductSource[],
): Channel3ProductView[] {
  return products.slice(0, RESULT_LIMIT).flatMap((product) => {
    const title = product.title.trim();
    if (!product.id || !title) return [];
    const offers = (product.offers ?? [])
      .flatMap((offer): Channel3OfferView[] => {
        const url = httpsUrl(offer.url);
        const domain = offer.domain?.trim();
        if (!url || !domain) return [];
        if (!Number.isFinite(offer.price.price) || !offer.price.currency) return [];
        const compare = offer.price.compare_at_price;
        return [
          {
            domain,
            url,
            price: offer.price.price,
            currency: offer.price.currency,
            compareAtPrice:
              typeof compare === 'number' && Number.isFinite(compare) ? compare : null,
            availability: offer.availability,
          },
        ];
      })
      .sort((a, b) => {
        if (a.availability !== b.availability) return a.availability === 'InStock' ? -1 : 1;
        return a.price - b.price;
      })
      .slice(0, OFFERS_PER_PRODUCT);
    return [
      {
        id: product.id,
        title: title.slice(0, 200),
        brand: product.brands?.find((brand) => brand.name.trim())?.name.trim() ?? null,
        imageUrl: productImage(product),
        category: product.category?.title?.trim() || null,
        offers,
      },
    ];
  });
}

function productImage(product: Channel3ProductSource): string | null {
  const images = product.images ?? [];
  const main = images.find((image) => image.is_main_image) ?? images[0];
  if (!main) return null;
  return httpsUrl(main.cleaned_url) ?? httpsUrl(main.url);
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}
