/**
 * Seeds clearly labelled demo data by running the same services the API uses, so seeded
 * evaluations and snapshots are produced by the real evaluator rather than hand-written.
 */
import { PrismaService } from '../src/infra/prisma.service';
import { loadEnv } from '../src/config/env';
import { AuditService } from '../src/modules/audit/audit.service';
import { CatalogService } from '../src/modules/commerce/catalog.service';
import { DemoService } from '../src/modules/demo/demo.service';
import { OutboxService } from '../src/modules/events/outbox.service';
import { MissionsService } from '../src/modules/missions/missions.service';
import { PurchasesService } from '../src/modules/purchases/purchases.service';
import { TwinEngine } from '../src/modules/promisetwin/twin-engine';

async function main() {
  const env = loadEnv();
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const outbox = new OutboxService();
    const audit = new AuditService();
    const engine = new TwinEngine(outbox, audit);
    const catalog = new CatalogService(prisma);
    const purchases = new PurchasesService(prisma, engine, outbox, audit, catalog, env);
    const missions = new MissionsService(prisma, outbox, audit, catalog);
    const demo = new DemoService(prisma, purchases, missions, engine, outbox, audit, env);

    await demo.ensureBaseData();
    await demo.buildBakery();
    await demo.buildShelter();

    const twin = await prisma.promiseTwin.findFirstOrThrow({
      where: { purchase: { scenarioKey: 'DEMO-BAKERY-001' } },
    });
    const snapshots = await prisma.twinSnapshot.count({ where: { twinId: twin.id } });
    console.log(
      `Seeded demo data. Bakery PromiseTwin ${twin.id}: ${twin.health} (${snapshots} snapshots).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
