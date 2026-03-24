import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { importCommand } from './import.js';

function makeKiroDir(opts: {
  agentJson?: Record<string, unknown>;
  steering?: Record<string, string>;
  skills?: Record<string, string>;
}): string {
  const root = join(tmpdir(), `kiro-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const agentsDir = join(root, '.kiro', 'agents');
  mkdirSync(agentsDir, { recursive: true });

  const agentJson = opts.agentJson ?? { name: 'test-agent', description: 'Test', model: 'claude-3-5-sonnet' };
  writeFileSync(join(agentsDir, 'test-agent.json'), JSON.stringify(agentJson), 'utf-8');

  if (opts.steering) {
    const steeringDir = join(root, '.kiro', 'steering');
    mkdirSync(steeringDir, { recursive: true });
    for (const [file, content] of Object.entries(opts.steering)) {
      writeFileSync(join(steeringDir, file), content, 'utf-8');
    }
  }

  if (opts.skills) {
    for (const [name, content] of Object.entries(opts.skills)) {
      const skillDir = join(root, '.kiro', 'skills', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
    }
  }

  return root;
}

async function runImport(src: string, target: string): Promise<void> {
  await importCommand.parseAsync(['node', 'import', '--from', 'kiro', '--dir', target, src]);
}

let targetDir: string;
beforeEach(() => {
  targetDir = join(tmpdir(), `kiro-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(targetDir, { recursive: true });
});

describe('importFromKiro — agent.yaml', () => {
  test('writes name, description, model from JSON', async () => {
    const src = makeKiroDir({ agentJson: { name: 'my-agent', description: 'Desc', model: 'gpt-4o' } });
    await runImport(src, targetDir);
    const agent = yaml.load(readFileSync(join(targetDir, 'agent.yaml'), 'utf-8')) as Record<string, unknown>;
    assert.equal(agent.name, 'my-agent');
    assert.equal(agent.description, 'Desc');
    assert.deepEqual(agent.model, { preferred: 'gpt-4o' });
  });

  test('omits model field when null or not present in JSON', async () => {
    const src1 = makeKiroDir({ agentJson: { name: 'no-model', description: 'x' } });
    await runImport(src1, targetDir);
    const agent1 = yaml.load(readFileSync(join(targetDir, 'agent.yaml'), 'utf-8')) as Record<string, unknown>;
    assert.equal(agent1.model, undefined);

    // Clean up for second test
    const targetDir2 = join(tmpdir(), `kiro-target-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(targetDir2, { recursive: true });
    
    const src2 = makeKiroDir({ agentJson: { name: 'null-model', description: 'x', model: null } });
    await runImport(src2, targetDir2);
    const agent2 = yaml.load(readFileSync(join(targetDir2, 'agent.yaml'), 'utf-8')) as Record<string, unknown>;
    assert.equal(agent2.model, undefined);
  });
});

describe('importFromKiro — steering files (prefixed)', () => {
  test('maps <slug>-SOUL.md → SOUL.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-SOUL.md': '# Soul content' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'SOUL.md')));
    assert.match(readFileSync(join(targetDir, 'SOUL.md'), 'utf-8'), /Soul content/);
  });

  test('maps <slug>-RULES.md → RULES.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-RULES.md': '# Rules' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'RULES.md')));
  });

  test('maps <slug>-DUTIES.md → DUTIES.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-DUTIES.md': '# Duties' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'DUTIES.md')));
  });

  test('maps <slug>-PROMPT.md → AGENTS.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-PROMPT.md': '# Prompt' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'AGENTS.md')));
  });

  test('maps <slug>-MEMORY.md → memory/MEMORY.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-MEMORY.md': '# Memory' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'memory', 'MEMORY.md')));
  });

  test('drops <slug>-COMPLIANCE.md', async () => {
    const src = makeKiroDir({ steering: { 'test-agent-COMPLIANCE.md': '# Compliance' } });
    await runImport(src, targetDir);
    assert.ok(!existsSync(join(targetDir, 'COMPLIANCE.md')));
  });
});

describe('importFromKiro — steering files (heuristic fallback)', () => {
  test('maps bare SOUL.md → SOUL.md', async () => {
    const src = makeKiroDir({ steering: { 'SOUL.md': '# Soul' } });
    await runImport(src, targetDir);
    assert.ok(existsSync(join(targetDir, 'SOUL.md')));
  });
});

describe('importFromKiro — prompt fallback', () => {
  test('uses inline prompt as SOUL.md when no steering files', async () => {
    const src = makeKiroDir({ agentJson: { name: 'a', description: 'b', prompt: 'You are helpful.' } });
    await runImport(src, targetDir);
    assert.match(readFileSync(join(targetDir, 'SOUL.md'), 'utf-8'), /You are helpful/);
  });

  test('resolves file:// prompt URI to SOUL.md', async () => {
    const src = makeKiroDir({ agentJson: { name: 'a', description: 'b', prompt: 'file://.kiro/steering/a-SOUL.md' } });
    mkdirSync(join(src, '.kiro', 'steering'), { recursive: true });
    writeFileSync(join(src, '.kiro', 'steering', 'a-SOUL.md'), 'Soul from file', 'utf-8');
    await runImport(src, targetDir);
    assert.match(readFileSync(join(targetDir, 'SOUL.md'), 'utf-8'), /Soul from file/);
  });
});

describe('importFromKiro — skills', () => {
  test('copies SKILL.md directly', async () => {
    const skillContent = '---\nname: my-skill\ndescription: Does stuff\n---\n\n# Skill';
    const src = makeKiroDir({ skills: { 'my-skill': skillContent } });
    await runImport(src, targetDir);
    const out = join(targetDir, 'skills', 'my-skill', 'SKILL.md');
    assert.ok(existsSync(out));
    assert.equal(readFileSync(out, 'utf-8'), skillContent);
  });
});

describe('importFromKiro — mcpServers', () => {
  test('writes stdio server as tools/<name>.yaml', async () => {
    const src = makeKiroDir({
      agentJson: { name: 'a', description: 'b', mcpServers: { 'git-mcp': { command: 'git-mcp-server', args: ['--verbose'] } } },
    });
    await runImport(src, targetDir);
    const tool = yaml.load(readFileSync(join(targetDir, 'tools', 'git-mcp.yaml'), 'utf-8')) as Record<string, unknown>;
    assert.equal(tool.name, 'git-mcp');
    assert.equal(tool.command, 'git-mcp-server');
    assert.deepEqual(tool.args, ['--verbose']);
  });

  test('writes http server as tools/<name>.yaml', async () => {
    const src = makeKiroDir({
      agentJson: { name: 'a', description: 'b', mcpServers: { github: { type: 'http', url: 'https://api.github.com/mcp', oauth: { oauthScopes: ['repo'] } } } },
    });
    await runImport(src, targetDir);
    const tool = yaml.load(readFileSync(join(targetDir, 'tools', 'github.yaml'), 'utf-8')) as Record<string, unknown>;
    assert.equal(tool.type, 'http');
    assert.equal(tool.url, 'https://api.github.com/mcp');
    assert.ok(tool.oauth);
  });
});

describe('importFromKiro — hooks', () => {
  test('writes agentSpawn commands to hooks/bootstrap.md', async () => {
    const src = makeKiroDir({
      agentJson: { name: 'a', description: 'b', hooks: { agentSpawn: [{ command: 'echo start' }] } },
    });
    await runImport(src, targetDir);
    assert.match(readFileSync(join(targetDir, 'hooks', 'bootstrap.md'), 'utf-8'), /echo start/);
  });

  test('writes stop commands to hooks/teardown.md', async () => {
    const src = makeKiroDir({
      agentJson: { name: 'a', description: 'b', hooks: { stop: [{ command: 'echo stop' }] } },
    });
    await runImport(src, targetDir);
    assert.match(readFileSync(join(targetDir, 'hooks', 'teardown.md'), 'utf-8'), /echo stop/);
  });
});

describe('importFromKiro — source path', () => {
  test('accepts direct .json file path', async () => {
    const src = makeKiroDir({});
    const jsonPath = join(src, '.kiro', 'agents', 'test-agent.json');
    await runImport(jsonPath, targetDir);
    assert.ok(existsSync(join(targetDir, 'agent.yaml')));
  });

  test('does nothing when .kiro/agents/ not found', async () => {
    const origExit = process.exit.bind(process);
    let exited = false;
    // @ts-expect-error override for test
    process.exit = () => { exited = true; };
    await importCommand.parseAsync(['node', 'import', '--from', 'kiro', '--dir', targetDir, tmpdir()]);
    process.exit = origExit;
    assert.ok(exited);
    assert.ok(!existsSync(join(targetDir, 'agent.yaml')));
  });
});
