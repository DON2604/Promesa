// Starts a real PostgreSQL 17 server from embedded binaries for machines without Docker.
// Data lives in .data/postgres (git-ignored). Stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const databaseDir = join(process.cwd(), '.data', 'postgres-utf8');
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'promesa',
  password: 'promesa',
  port,
  persistent: true,
  // Windows defaults to the WIN1252 locale; the app stores UTF-8 text (e.g. "≤", "×").
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const firstRun = !existsSync(join(databaseDir, 'PG_VERSION'));
if (firstRun) {
  console.log(`Initialising PostgreSQL cluster in ${databaseDir}`);
  await pg.initialise();
}
await pg.start();
if (firstRun) {
  await pg.createDatabase('promesa');
}
console.log(`PostgreSQL ready on postgresql://promesa:promesa@localhost:${port}/promesa`);

const shutdown = async () => {
  console.log('Stopping PostgreSQL…');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
