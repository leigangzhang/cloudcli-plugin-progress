import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getExtractionTraceLogPath,
  writeExtractionTrace,
} from '../../src/core/trace.js';
import { createTempDir } from '../utils.js';

describe('extraction trace file logging', () => {
  it('uses the CloudCLI progress plugin directory by default', () => {
    expect(getExtractionTraceLogPath({}, '/home/ray')).toBe(
      path.join(
        '/home/ray',
        '.claude-code-ui',
        'plugins',
        'cloudcli-plugin-progress',
        'progress-plugin.log',
      ),
    );
  });

  it('honors trace log directory and filename overrides', () => {
    const file = getExtractionTraceLogPath({
      PROGRESS_TRACE_LOG_DIR: '/tmp/plugin-logs',
      PROGRESS_TRACE_LOG_FILE: 'codex-trace.log',
    });
    expect(file).toBe('/tmp/plugin-logs/codex-trace.log');
  });

  it('creates the log directory and appends one JSON event per line', () => {
    const tmp = createTempDir();
    const logDir = path.join(tmp.path, 'nested', 'logs');
    const env = {
      ...process.env,
      PROGRESS_TRACE_LOG_DIR: logDir,
      PROGRESS_TRACE_LOG_FILE: 'progress-plugin.log',
    };

    writeExtractionTrace(
      { source: 'progress-plugin', type: 'prompt', value: 'hello' },
      env,
      tmp.path,
    );
    writeExtractionTrace(
      { source: 'progress-plugin', type: 'usage', value: 'second' },
      env,
      tmp.path,
    );

    const logFile = path.join(logDir, 'progress-plugin.log');
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      source: 'progress-plugin',
      type: 'prompt',
      value: 'hello',
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      source: 'progress-plugin',
      type: 'usage',
      value: 'second',
    });

    tmp.cleanup();
  });
});
