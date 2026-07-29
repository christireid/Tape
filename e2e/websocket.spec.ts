import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The WebSocket transport, end to end: the Node feed server runs the same
// model and codec as the browser; the worker's sequencing, conflation and
// recovery must be indistinguishable across transports (§5.2, ADR 007).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8181;

let server: ChildProcess | null = null;

function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const sock = connect({ port, host: '127.0.0.1' }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

test.beforeAll(async () => {
  server = spawn('node', ['--experimental-strip-types', 'server/feed-server.ts'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  await waitForPort(PORT);
});

test.afterAll(() => {
  server?.kill();
  server = null;
});

test('ticks flow over the wire through the same conflation path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.waitForTimeout(1000);

  await page.evaluate(() => window.__tape?.setTransport('websocket'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__tape?.resetSamples());
  await page.waitForTimeout(4000);

  const t = await page.evaluate(() => {
    const s = window.__tape;
    if (!s) return null;
    const x = s.getTelemetry();
    return {
      connected: x.connected,
      health: x.health,
      inps: Math.round(x.msgsInPerSec),
      outps: Math.round(x.rowsOutPerSec),
      gaps: x.gapsRecovered,
      p50: x.t2sP50,
    };
  });
  expect(t).not.toBeNull();
  expect(t?.connected).toBeTruthy();
  expect(t?.health).toBe('live');
  expect(t?.inps ?? 0).toBeGreaterThan(1000); // real throughput over the wire
  expect(t?.outps ?? 0).toBeGreaterThan(0); // conflation ran on decoded ticks
  expect(t?.gaps).toBe(0); // wire sequence discipline holds
  expect(t?.p50 ?? 0).toBeGreaterThan(0); // same latency instrumentation
});

test('disconnect drops the socket, recovery resyncs with zero false gaps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Synthetic data')).toBeVisible();
  await page.evaluate(() => window.__tape?.setTransport('websocket'));
  await page.waitForTimeout(1500);

  await page.evaluate(() => window.__tape?.injectFault('disconnect'));
  await page.waitForTimeout(2500);
  const down = await page.evaluate(() => window.__tape?.getTelemetry().health);
  expect(down === 'down' || down === 'stale').toBeTruthy();

  await page.waitForTimeout(5500);
  const back = await page.evaluate(() => {
    const x = window.__tape?.getTelemetry();
    return x ? { connected: x.connected, gaps: x.gapsRecovered, health: x.health } : null;
  });
  expect(back?.connected).toBeTruthy();
  expect(back?.health).toBe('live');
  expect(back?.gaps).toBe(0); // reconnect resynced baselines, no false gaps

  // Switching back to the simulator is seamless.
  await page.evaluate(() => window.__tape?.setTransport('simulator'));
  await page.waitForTimeout(1500);
  const sim = await page.evaluate(() => window.__tape?.getTelemetry());
  expect(sim?.health).toBe('live');
  expect(sim?.gapsRecovered).toBe(0);
});
