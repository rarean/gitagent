import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { loadAgentManifest, loadFileIfExists } from '../utils/loader.js';
import { buildComplianceSection } from './shared.js';

/**
 * Export a gitagent to Kiro CLI custom agent format.
 *
 * Kiro uses:
 *   - .kiro/agents/<name>.json         (agent config JSON)
 *   - .kiro/steering/<name>-*.md       (steering docs)
 *   - .kiro/skills/<name>/SKILL.md     (skill files with YAML frontmatter)
 */
export interface KiroExport {
  agentJson: Record<string, unknown>;
  agentFileName: string;
  steeringFiles: Array<{ name: string; content: string }>;
  skills: Array<{ name: string; content: string }>;
}

export function exportToKiro(dir: string): KiroExport {
  const agentDir = resolve(dir);
  const manifest = loadAgentManifest(agentDir);
  const slug = slugify(manifest.name);

  const steeringFiles = buildSteeringFiles(agentDir, manifest, slug);
  const skills = collectSkills(agentDir);
  const agentJson = buildAgentJson(agentDir, manifest, slug, steeringFiles, skills);

  return { agentJson, agentFileName: slug, steeringFiles, skills };
}

export function exportToKiroString(dir: string): string {
  const exp = exportToKiro(dir);
  const parts: string[] = [];

  parts.push(`# === .kiro/agents/${exp.agentFileName}.json ===`);
  parts.push(JSON.stringify(exp.agentJson, null, 2));

  for (const f of exp.steeringFiles) {
    parts.push(`\n# === .kiro/steering/${f.name} ===`);
    parts.push(f.content);
  }

  for (const skill of exp.skills) {
    parts.push(`\n# === .kiro/skills/${skill.name}/SKILL.md ===`);
    parts.push(skill.content);
  }

  return parts.join('\n');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildSteeringFiles(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
  slug: string,
): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];

  const addFile = (suffix: string, path: string) => {
    const content = loadFileIfExists(path);
    if (content) files.push({ name: `${slug}-${suffix}`, content });
  };

  addFile('SOUL.md', join(agentDir, 'SOUL.md'));
  addFile('RULES.md', join(agentDir, 'RULES.md'));
  addFile('DUTIES.md', join(agentDir, 'DUTIES.md'));
  addFile('PROMPT.md', join(agentDir, 'AGENTS.md'));

  if (manifest.compliance) {
    const section = buildComplianceSection(manifest.compliance);
    if (section) files.push({ name: `${slug}-COMPLIANCE.md`, content: section });
  }

  const memory = loadFileIfExists(join(agentDir, 'memory', 'MEMORY.md'));
  if (memory) files.push({ name: `${slug}-MEMORY.md`, content: memory });

  return files;
}

function buildAgentJson(
  agentDir: string,
  manifest: ReturnType<typeof loadAgentManifest>,
  slug: string,
  steeringFiles: Array<{ name: string; content: string }>,
  skills: Array<{ name: string; content: string }>,
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    prompt: `file://../steering/${slug}-SOUL.md`,
    mcpServers: {},
    tools: ['*'],
    toolAliases: {},
    allowedTools: [],
    resources: [],
    hooks: {},
    toolsSettings: {},
    includeMcpJson: false,
    model: null,
  };

  if (manifest.model?.preferred) {
    json.model = manifest.model.preferred;
  }

  const mcpServers = collectMcpServers(agentDir);
  if (Object.keys(mcpServers).length > 0) {
    json.mcpServers = mcpServers;
  }

  const resources: unknown[] = [];
  if (steeringFiles.length > 0) {
    resources.push(`file://../steering/${slug}-*.md`);
  }
  if (skills.length > 0) {
    resources.push('skill://../skills/**/SKILL.md');
  }
  const knowledgeDir = join(agentDir, 'knowledge');
  if (existsSync(knowledgeDir)) {
    resources.push({
      type: 'knowledgeBase',
      source: 'file://../knowledge',
      name: `${manifest.name} Knowledge`,
      description: `Knowledge base for ${manifest.name}`,
    });
  }
  if (resources.length > 0) {
    json.resources = resources;
  }

  const hooks: Record<string, unknown> = {};
  const bootstrap = loadFileIfExists(join(agentDir, 'hooks', 'bootstrap.md'));
  if (bootstrap) {
    hooks.agentSpawn = [{ command: `cat .kiro/steering/${slug}-SOUL.md` }];
  }
  const teardown = loadFileIfExists(join(agentDir, 'hooks', 'teardown.md'));
  if (teardown) {
    hooks.stop = [{ command: 'echo "Agent session ended"' }];
  }
  if (Object.keys(hooks).length > 0) {
    json.hooks = hooks;
  }

  return json;
}

function collectMcpServers(agentDir: string): Record<string, unknown> {
  const toolsDir = join(agentDir, 'tools');
  if (!existsSync(toolsDir)) return {};

  const servers: Record<string, unknown> = {};
  for (const file of readdirSync(toolsDir).filter(f => f.endsWith('.yaml'))) {
    try {
      const tool = yaml.load(readFileSync(join(toolsDir, file), 'utf-8')) as {
        name?: string; command?: string; args?: string[];
        type?: string; url?: string; oauth?: unknown;
      };
      if (!tool?.name) continue;
      if (tool.command) {
        servers[tool.name] = { command: tool.command, args: tool.args ?? [] };
      } else if (tool.type === 'http' && tool.url) {
        const entry: Record<string, unknown> = { type: 'http', url: tool.url };
        if (tool.oauth) entry.oauth = tool.oauth;
        servers[tool.name] = entry;
      }
    } catch { /* skip malformed */ }
  }
  return servers;
}

function collectSkills(agentDir: string): Array<{ name: string; content: string }> {
  const skillsDir = join(agentDir, 'skills');
  if (!existsSync(skillsDir)) return [];

  const skills: Array<{ name: string; content: string }> = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;
    skills.push({ name: entry.name, content: readFileSync(skillMdPath, 'utf-8') });
  }
  return skills;
}
