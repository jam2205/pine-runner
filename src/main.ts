// SPDX-License-Identifier: AGPL-3.0-only
// Part of @quantpad/pine-runner — the process-isolated Pine execution engine.
// Copyright (C) 2026 QuantPad. Licensed under the GNU AGPL-3.0; see ../LICENSE.
// Corresponding source: https://github.com/QuantPad/pine-runner
/**
 * Pine runner CLI entry point (child process).
 *
 * Invocation: `node main.cjs <requestFile>`
 *   - <requestFile>: path to a JSON file holding a PineRunnerRequest.
 *   - For `run`, the request references a separate bars file (compact rows).
 *
 * Output: a single sentinel-encoded PineRunnerResponse envelope on stdout.
 * Handled errors are returned as `{ ok: false, error }` with exit code 0;
 * only unexpected crashes exit nonzero.
 */
import { readFileSync } from 'node:fs';

import { encodeSpecials } from './codec';
import {
  type CompactBarRow,
  type PineRunnerRequest,
  type PineRunnerResponse,
} from './protocol';
import { runPine, scanPine } from './run';
import { type OhlcvBar } from './types';

function readRequest(path: string): PineRunnerRequest {
  return JSON.parse(readFileSync(path, 'utf8')) as PineRunnerRequest;
}

function readBars(path: string): OhlcvBar[] {
  const rows = JSON.parse(readFileSync(path, 'utf8')) as CompactBarRow[];
  return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
}

async function handle(req: PineRunnerRequest): Promise<PineRunnerResponse> {
  if (req.op === 'scan') {
    return { ok: true, result: scanPine(req) };
  }
  if (req.op === 'run') {
    const bars = readBars(req.barsFile);
    return { ok: true, result: await runPine(req, bars) };
  }
  return { ok: false, error: { message: `Unknown op: ${(req as { op?: string }).op}`, status: 400 } };
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    writeAndExit(
      encodeSpecials({ ok: false, error: { message: 'Missing request file argument', status: 400 } }),
    );
    return;
  }

  let response: PineRunnerResponse;
  try {
    const req = readRequest(requestPath);
    response = await handle(req);
  } catch (err: any) {
    response = {
      ok: false,
      error: { message: err?.message || 'Pine runner failed', status: 500 },
    };
  }
  writeAndExit(encodeSpecials(response));
}

/**
 * Write the payload and exit only AFTER it has flushed. `process.exit(0)`
 * immediately after a write truncates large piped stdout (the write is async
 * when the destination is a pipe), which the parent would see as unparseable
 * output.
 */
function writeAndExit(payload: string): void {
  process.stdout.write(payload, () => process.exit(0));
}

main().catch((err) => {
  // Last-resort: an error escaping main() (e.g. stdout write failure). Exit
  // nonzero so the parent maps it to a generic runner failure.
  process.stderr.write(String(err?.stack || err) + '\n');
  process.exit(1);
});
