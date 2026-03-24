import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportCommand } from './export.js';

function makeAgentDir(name = 'test-agent'): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-export-test-'));
  writeFileSync(join(dir, 'agent.yaml'), `spec_version: '0.1.0'\nname: ${name}\nversion: '0.1.0'\ndescription: 'Test'\n`);
  writeFileSync(join(dir, 'SOUL.md'), '# Soul', 'utf-8');
  mkdirSync(join(dir, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: A skill\n---\nDo it.\n', 'utf-8');
  return dir;
}

async function runExport(agentDir: string, outputDir: string): Promise<void> {
  await exportCommand.parseAsync(['node', 'export', '-f', 'kiro', '-d', agentDir, '-o', outputDir]);
}

async function runExportNoOutput(agentDir: string): Promise<void> {
  exportCommand.setOptionValue('output', undefined);
  await exportCommand.parseAsync(['node', 'export', '-f', 'kiro', '-d', agentDir]);
}

// All export tests run sequentially to avoid Commander.js shared state issues
// and process.chdir race conditions between describe blocks.
describe('export kiro', { concurrency: 1 }, () => {
  describe('with -o flag', { concurrency: 1 }, () => {
    test('creates ./kiro/agents/<name>.json', async () => {
      const agentDir = makeAgentDir('my-agent');
      const outputDir = mkdtempSync(join(tmpdir(), 'gitagent-kiro-out-'));
      await runExport(agentDir, outputDir);
      assert.ok(existsSync(join(outputDir, 'kiro', 'agents', 'my-agent.json')));
    });

    test('creates ./kiro/steering/<name>-SOUL.md', async () => {
      const agentDir = makeAgentDir('my-agent');
      const outputDir = mkdtempSync(join(tmpdir(), 'gitagent-kiro-out-'));
      await runExport(agentDir, outputDir);
      assert.ok(existsSync(join(outputDir, 'kiro', 'steering', 'my-agent-SOUL.md')));
    });

    test('creates ./kiro/skills/<name>/SKILL.md', async () => {
      const agentDir = makeAgentDir('my-agent');
      const outputDir = mkdtempSync(join(tmpdir(), 'gitagent-kiro-out-'));
      await runExport(agentDir, outputDir);
      assert.ok(existsSync(join(outputDir, 'kiro', 'skills', 'my-skill', 'SKILL.md')));
    });

    test('agent JSON contains correct name', async () => {
      const agentDir = makeAgentDir('my-agent');
      const outputDir = mkdtempSync(join(tmpdir(), 'gitagent-kiro-out-'));
      await runExport(agentDir, outputDir);
      const json = JSON.parse(readFileSync(join(outputDir, 'kiro', 'agents', 'my-agent.json'), 'utf-8'));
      assert.equal(json.name, 'my-agent');
    });
  });

  describe('without -o flag (defaults to cwd)', { concurrency: 1 }, () => {
    test('creates ./kiro/agents/<name>.json in cwd', async () => {
      const agentDir = makeAgentDir('my-agent');
      const cwd = process.cwd();
      const tmpOut = mkdtempSync(join(tmpdir(), 'gitagent-kiro-cwd-'));
      process.chdir(tmpOut);
      try {
        await runExportNoOutput(agentDir);
        assert.ok(existsSync(join(tmpOut, 'kiro', 'agents', 'my-agent.json')));
      } finally {
        process.chdir(cwd);
      }
    });

    test('creates ./kiro/steering/<name>-SOUL.md in cwd', async () => {
      const agentDir = makeAgentDir('my-agent');
      const cwd = process.cwd();
      const tmpOut = mkdtempSync(join(tmpdir(), 'gitagent-kiro-cwd-'));
      process.chdir(tmpOut);
      try {
        await runExportNoOutput(agentDir);
        assert.ok(existsSync(join(tmpOut, 'kiro', 'steering', 'my-agent-SOUL.md')));
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
