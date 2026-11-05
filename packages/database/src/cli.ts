import { createDatabase, readDatabaseUrl } from './index.js';

try {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'smoke')
    throw new Error('Unsupported database command.');
  const database = createDatabase(readDatabaseUrl(process.env.DATABASE_URL));
  try {
    await database[command]();
    console.info(`Database ${command} completed.`);
  } finally {
    await database.close();
  }
} catch {
  console.error(
    'Database command failed. Check the command, DATABASE_URL, PostgreSQL availability and migrations. Credentials are not logged.',
  );
  process.exitCode = 1;
}
