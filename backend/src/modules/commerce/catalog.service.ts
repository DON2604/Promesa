import { Injectable } from '@nestjs/common';
import { type IntentSpec, type OffersResponse } from '@promesa/contracts';
import { PrismaService } from '../../infra/prisma.service';
import { type CatalogItem, SOLVER_VERSION, solveOffers } from './offer-solver';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async loadCatalog(productKind: string): Promise<CatalogItem[]> {
    const rows = await this.prisma.catalogProduct.findMany({
      where: { productKind },
      include: { seller: { include: { merchantConnections: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      title: r.title,
      productKind: r.productKind,
      attributes: r.attributes as string[],
      unitPriceMinor: r.unitPriceMinor,
      currency: r.currency,
      inventoryQty: r.inventoryQty,
      leadTimeHours: r.leadTimeHours,
      deliveryTerms: r.deliveryTerms,
      source: r.source,
      isDemo: r.isDemo,
      lastVerifiedAt: r.lastVerifiedAt,
      merchant: {
        tenantId: r.sellerTenantId ?? 'unlisted',
        name: r.seller?.name ?? 'Unlisted seller',
        paypalConnected:
          r.seller?.merchantConnections.some((c) => c.status === 'CONNECTED') ?? false,
      },
    }));
  }

  async offersFor(
    intent: IntentSpec,
    now: Date,
    aggregateVersion: number,
    simulationMode: boolean,
  ): Promise<OffersResponse> {
    const catalog = await this.loadCatalog(intent.productKind);
    const result = solveOffers(intent, catalog, now);
    return {
      schemaVersion: 1,
      aggregateVersion,
      asOf: now.toISOString(),
      simulationMode,
      solverVersion: SOLVER_VERSION,
      ...result,
    };
  }
}
