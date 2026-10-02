import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
for (const key of ['containers', 'durable_objects', 'r2_buckets', 'd1_databases', 'kv_namespaces', 'ai', 'browser', 'queues', 'workflows', 'hyperdrive', 'send_email', 'services', 'triggers']) {
  if (config[key] !== undefined) throw new Error(`This deployment permits only a standalone Worker on Workers Free; unexpected binding: ${key}`);
}
if (config.account_id !== '25eb8d3849be3adbff3678f4ec781804') throw new Error('Unexpected destination account');
console.log('Standalone Worker configuration verified. Keep the destination account on Workers Free.');
