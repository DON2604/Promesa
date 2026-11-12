/**
 * Render free web services cannot run a pre-deploy command, so the API start command runs this
 * first: apply migrations, then seed the demo accounts only when the database is empty.
 * A later wake-up does not wipe a mission that is already in progress.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

execSync('npm run db:deploy -w @promesa/backend', { stdio: 'inherit' });

const prisma = new PrismaClient();
try {
  const users = await prisma.user.count();
  if (users === 0) {
    console.log('Empty database. Seeding demo accounts.');
    execSync('npm run db:seed -w @promesa/backend', { stdio: 'inherit' });
  } else {
    console.log(`Database already has ${users} users. Skipping seed.`);
  }
} finally {
  await prisma.$disconnect();
}
