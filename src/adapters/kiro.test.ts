/**
 * Tests for the Kiro adapter.
 *
 * Uses Node.js built-in test runner (node --test).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { exportToKiro, exportToKiroString } from './kiro.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDir(opts: {
  name?: string;
  description?: string;
  model?: string;
  soul?: string;
  rules?: string;
  duties?: string;
  agents?: string;
  compliance?: boolean;
  memory?: boolean;
  knowledge?: boolean;
  bootstrap?: boolean;
  teardown?: boolean;
  skills?: Array<{ name: string; description: string; instructions: string }>;
  tools?: Array<{ name: string; command: string; args?: string[] }>;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitagent-kiro-test-'));
  const name = opts.name ?? 'test-agent';
  const description = opts.description ?? 'A test agent';

  let manifest = `spec_version: '0.1.0'\nname: ${name}\nversion: '0.1.0'\ndescription: '${description}'\n`;
  if (opts.model) manifest += `model:\n  preferred: ${opts.model}\n`;
  if (opts.compliance) {
    manifest += `compliance:\n  supervision:\n    human_in_the_loop: always\n`;
  }
  writeFileSync(join(dir, 'agent.yaml'), manifest, 'utf-8');

  if (opts.soul !== undefined) writeFileSync(join(dir, 'SOUL.md'), opts.soul, 'utf-8');
  if (opts.rules !== undefined) writeFileSync(join(dir, 'RULES.md'), opts.rules, 'utf-8');
  if (opts.duties !== undefined) writeFileSync(join(dir, 'DUTIES.md'), opts.duties, 'utf-8');
  if (opts.agents !== undefined) writeFileSync(join(dir, 'AGENTS.md'), opts.agents, 'utf-8');

  if (opts.memory) {
    mkdirSync(join(dir, 'memory'), { recursive: true });
    writeFileSync(join(dir, 'memory', 'MEMORY.md'), '# Memory\nSome memory.', 'utf-8');
  }

  if (opts.knowledge) {
    mkdirSync(join(dir, 'knowledge'), { recursive: true });
    writeFileSync(join(dir, 'knowledge', 'index.yaml'), 'documents: []', 'utf-8');
  }

  if (opts.bootstrap) {
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hooks', 'bootstrap.md'), '# Bootstrap\nRun on start.', 'utf-8');
  }

  if (opts.teardown) {
    mkdirSync(join(dir, 'hooks'), { recursive: true });
    writeFileSync(join(dir, 'hooks', 'teardown.md'), '# Teardown\nRun on stop.', 'utf-8');
  }

  if (opts.skills) {
    for (const skill of opts.skills) {
      const skillDir = join(dir, 'skills', skill.name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skill.name}\ndescription: '${skill.description}'\n---\n\n${skill.instructions}\n`,
        'utf-8',
      );
    }
  }

  if (opts.tools) {
    mkdirSync(join(dir, 'tools'), { recursive: true });
    for (const tool of opts.tools) {
      const content = `name: ${tool.name}\ncommand: ${tool.command}\nargs: [${(tool.args ?? []).join(', ')}]\n`;
      writeFileSync(join(dir, 'tools', `${tool.name}.yaml`), content, 'utf-8');
    }
  }

  return dir;
}

// ---------------------------------------------------------------------------
// exportToKiro — agent JSON
// ---------------------------------------------------------------------------

describe('exportToKiro — agent JSON', () => {
  test('sets name and description from manifest', () => {
    const dir = makeAgentDir({ name: 'my-agent', description: 'Does things' });
    const exp = exportToKiro(dir);
    assert.equal(exp.agentJson.name, 'my-agent');
    assert.equal(exp.agentJson.description, 'Does things');
  });

  test('slugifies agent file name', () => {
    const dir = makeAgentDir({ name: 'My Cool Agent' });
    const exp = exportToKiro(dir);
    assert.equal(exp.agentFileName, 'my-cool-agent');
  });

  test('sets model when present in manifest', () => {
    const dir = makeAgentDir({ model: 'claude-opus-4' });
    const exp = exportToKiro(dir);
    assert.equal(exp.agentJson.model, 'claude-opus-4');
  });

  test('sets model to null when not in manifest', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.equal(exp.agentJson.model, null);
  });

  test('prompt points to SOUL steering file', () => {
    const dir = makeAgentDir({ name: 'my-agent', soul: '# Soul' });
    const exp = exportToKiro(dir);
    assert.equal(exp.agentJson.prompt, 'file://../steering/my-agent-SOUL.md');
  });

  test('tools defaults to ["*"]', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.deepEqual(exp.agentJson.tools, ['*']);
  });

  test('includes required fields with correct defaults', () => {
    const dir = makeAgentDir({ description: 'Hello there' });
    const exp = exportToKiro(dir);
    assert.equal(exp.agentJson.description, 'Hello there');
    assert.deepEqual(exp.agentJson.mcpServers, {});
    assert.deepEqual(exp.agentJson.tools, ['*']);
    assert.deepEqual(exp.agentJson.toolAliases, {});
    assert.deepEqual(exp.agentJson.allowedTools, []);
    assert.deepEqual(exp.agentJson.resources, []);
    assert.deepEqual(exp.agentJson.hooks, {});
    assert.deepEqual(exp.agentJson.toolsSettings, {});
    assert.equal(exp.agentJson.includeMcpJson, false);
    assert.equal(exp.agentJson.model, null);
  });
});

// ---------------------------------------------------------------------------
// exportToKiro — steering files
// ---------------------------------------------------------------------------

describe('exportToKiro — steering files', () => {
  test('includes SOUL.md as steering file', () => {
    const dir = makeAgentDir({ name: 'agent', soul: '# Soul content' });
    const exp = exportToKiro(dir);
    const soul = exp.steeringFiles.find(f => f.name === 'agent-SOUL.md');
    assert.ok(soul, 'Expected agent-SOUL.md');
    assert.match(soul!.content, /Soul content/);
  });

  test('includes RULES.md as steering file', () => {
    const dir = makeAgentDir({ name: 'agent', rules: '# Never lie' });
    const exp = exportToKiro(dir);
    const rules = exp.steeringFiles.find(f => f.name === 'agent-RULES.md');
    assert.ok(rules);
    assert.match(rules!.content, /Never lie/);
  });

  test('includes DUTIES.md as steering file', () => {
    const dir = makeAgentDir({ name: 'agent', duties: '# Duties' });
    const exp = exportToKiro(dir);
    assert.ok(exp.steeringFiles.find(f => f.name === 'agent-DUTIES.md'));
  });

  test('maps AGENTS.md to PROMPT.md steering file', () => {
    const dir = makeAgentDir({ name: 'agent', agents: '# Prompt content' });
    const exp = exportToKiro(dir);
    const prompt = exp.steeringFiles.find(f => f.name === 'agent-PROMPT.md');
    assert.ok(prompt);
    assert.match(prompt!.content, /Prompt content/);
  });

  test('includes COMPLIANCE.md when compliance is configured', () => {
    const dir = makeAgentDir({ name: 'agent', compliance: true });
    const exp = exportToKiro(dir);
    assert.ok(exp.steeringFiles.find(f => f.name === 'agent-COMPLIANCE.md'));
  });

  test('includes MEMORY.md when memory exists', () => {
    const dir = makeAgentDir({ name: 'agent', memory: true });
    const exp = exportToKiro(dir);
    assert.ok(exp.steeringFiles.find(f => f.name === 'agent-MEMORY.md'));
  });

  test('omits steering files that do not exist', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.equal(exp.steeringFiles.length, 0);
  });
});

// ---------------------------------------------------------------------------
// exportToKiro — resources
// ---------------------------------------------------------------------------

describe('exportToKiro — resources', () => {
  test('adds steering glob to resources when steering files exist', () => {
    const dir = makeAgentDir({ name: 'agent', soul: '# Soul' });
    const exp = exportToKiro(dir);
    const resources = exp.agentJson.resources as string[];
    assert.ok(resources.some(r => r === 'file://../steering/agent-*.md'));
  });

  test('adds skill glob to resources when skills exist', () => {
    const dir = makeAgentDir({
      skills: [{ name: 'my-skill', description: 'Skill', instructions: 'Do it.' }],
    });
    const exp = exportToKiro(dir);
    const resources = exp.agentJson.resources as string[];
    assert.ok(resources.some(r => r === 'skill://../skills/**/SKILL.md'));
  });

  test('adds knowledgeBase resource when knowledge/ exists', () => {
    const dir = makeAgentDir({ knowledge: true });
    const exp = exportToKiro(dir);
    const resources = exp.agentJson.resources as unknown[];
    const kb = resources.find(r => typeof r === 'object' && (r as Record<string, unknown>).type === 'knowledgeBase');
    assert.ok(kb);
  });

  test('includes empty resources array when nothing to include', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.deepEqual(exp.agentJson.resources, []);
  });
});

// ---------------------------------------------------------------------------
// exportToKiro — skills
// ---------------------------------------------------------------------------

describe('exportToKiro — skills', () => {
  test('collects skills from skills/ directory', () => {
    const dir = makeAgentDir({
      skills: [
        { name: 'skill-a', description: 'A', instructions: 'Do A.' },
        { name: 'skill-b', description: 'B', instructions: 'Do B.' },
      ],
    });
    const exp = exportToKiro(dir);
    assert.equal(exp.skills.length, 2);
    assert.ok(exp.skills.find(s => s.name === 'skill-a'));
    assert.ok(exp.skills.find(s => s.name === 'skill-b'));
  });

  test('skill content preserves YAML frontmatter', () => {
    const dir = makeAgentDir({
      skills: [{ name: 'my-skill', description: 'My skill', instructions: 'Instructions here.' }],
    });
    const exp = exportToKiro(dir);
    const skill = exp.skills.find(s => s.name === 'my-skill');
    assert.ok(skill);
    assert.match(skill!.content, /^---/);
    assert.match(skill!.content, /name: my-skill/);
    assert.match(skill!.content, /description:/);
  });

  test('returns empty skills array when no skills/ dir', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.equal(exp.skills.length, 0);
  });
});

// ---------------------------------------------------------------------------
// exportToKiro — MCP servers
// ---------------------------------------------------------------------------

describe('exportToKiro — mcpServers', () => {
  test('maps tools/*.yaml with command to mcpServers', () => {
    const dir = makeAgentDir({
      tools: [{ name: 'git-mcp', command: 'git-mcp-server', args: [] }],
    });
    const exp = exportToKiro(dir);
    const servers = exp.agentJson.mcpServers as Record<string, unknown>;
    assert.ok(servers['git-mcp']);
  });

  test('maps http-type tools to mcpServers', () => {
    const dir = makeAgentDir({});
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'github.yaml'), 'name: github\ntype: http\nurl: https://api.github.com/mcp\n', 'utf-8');
    const exp = exportToKiro(dir);
    const servers = exp.agentJson.mcpServers as Record<string, { type: string; url: string }>;
    assert.ok(servers['github']);
    assert.equal(servers['github'].type, 'http');
    assert.equal(servers['github'].url, 'https://api.github.com/mcp');
  });

  test('includes empty mcpServers object when no tools/ dir', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.deepEqual(exp.agentJson.mcpServers, {});
  });
});

// ---------------------------------------------------------------------------
// exportToKiro — hooks
// ---------------------------------------------------------------------------

describe('exportToKiro — hooks', () => {
  test('adds agentSpawn hook when bootstrap.md exists', () => {
    const dir = makeAgentDir({ bootstrap: true });
    const exp = exportToKiro(dir);
    const hooks = exp.agentJson.hooks as Record<string, unknown>;
    assert.ok(hooks?.agentSpawn);
  });

  test('adds stop hook when teardown.md exists', () => {
    const dir = makeAgentDir({ teardown: true });
    const exp = exportToKiro(dir);
    const hooks = exp.agentJson.hooks as Record<string, unknown>;
    assert.ok(hooks?.stop);
  });

  test('includes empty hooks object when no hook files exist', () => {
    const dir = makeAgentDir({});
    const exp = exportToKiro(dir);
    assert.deepEqual(exp.agentJson.hooks, {});
  });
});

// ---------------------------------------------------------------------------
// exportToKiroString
// ---------------------------------------------------------------------------

describe('exportToKiroString', () => {
  test('includes agent JSON file header', () => {
    const dir = makeAgentDir({ name: 'my-agent' });
    const output = exportToKiroString(dir);
    assert.match(output, /# === \.kiro\/agents\/my-agent\.json ===/);
  });

  test('includes steering file headers', () => {
    const dir = makeAgentDir({ name: 'my-agent', soul: '# Soul' });
    const output = exportToKiroString(dir);
    assert.match(output, /# === \.kiro\/steering\/my-agent-SOUL\.md ===/);
  });

  test('includes skill file headers', () => {
    const dir = makeAgentDir({
      skills: [{ name: 'my-skill', description: 'Skill', instructions: 'Do it.' }],
    });
    const output = exportToKiroString(dir);
    assert.match(output, /# === \.kiro\/skills\/my-skill\/SKILL\.md ===/);
  });

  test('output is a non-empty string', () => {
    const dir = makeAgentDir({ soul: '# Soul' });
    const output = exportToKiroString(dir);
    assert.ok(output.length > 0);
    assert.equal(typeof output, 'string');
  });
});
