import { buildApp } from './app.js';
import { readApiConfig } from './config.js';

const app = buildApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 5000).unref();
    void app
      .close()
      .then(() => {
        clearTimeout(deadline);
      })
      .catch(() => {
        process.exitCode = 1;
      });
  });
}

try {
  const config = readApiConfig(process.env);
  await app.listen(config);
  console.info(
    `Cai API listening at http://${config.host}:${String(config.port)}`,
  );
} catch {
  console.error(
    'API startup failed. Check HOST, PORT and local port availability.',
  );
  await app.close();
  process.exitCode = 1;
}
