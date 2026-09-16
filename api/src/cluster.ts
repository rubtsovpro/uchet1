/**
 * Cluster entry: несколько процессов Node → меньше «всё зависло» при sync SQL.
 * Env: WMS_CLUSTER_WORKERS=4 (0 = один процесс, как раньше).
 */
import cluster from 'node:cluster';
import os from 'node:os';

const nEnv = String(process.env.WMS_CLUSTER_WORKERS || '').trim();
const n = nEnv ? Number(nEnv) : 0;

if (cluster.isPrimary && Number.isFinite(n) && n > 1) {
  const count = Math.min(16, Math.max(2, Math.floor(n) || os.cpus().length || 2));
  console.log(`[cluster] primary pid=${process.pid} workers=${count}`);
  for (let i = 0; i < count; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.warn(
      `[cluster] worker ${worker.process.pid} exit code=${code} signal=${signal} — restart`
    );
    cluster.fork();
  });
} else {
  await import('./server.js');
}
