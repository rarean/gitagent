import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exportToKiro } from '../adapters/kiro.js';
import { AgentManifest } from '../utils/loader.js';
import { error, info } from '../utils/format.js';

export function runWithKiro(agentDir: string, manifest: AgentManifest): void {
  const exp = exportToKiro(agentDir);
  const kiroDir = join(process.cwd(), '.kiro');

  // Write agent JSON
  const agentsDir = join(kiroDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${exp.agentFileName}.json`), JSON.stringify(exp.agentJson, null, 2), 'utf-8');

  // Write steering files
  const steeringDir = join(kiroDir, 'steering');
  mkdirSync(steeringDir, { recursive: true });
  for (const f of exp.steeringFiles) {
    writeFileSync(join(steeringDir, f.name), f.content, 'utf-8');
  }

  // Write skills
  for (const skill of exp.skills) {
    const skillDir = join(kiroDir, 'skills', skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
  }

  info(`Agent "${manifest.name}" written to .kiro/`);
  info(`Launching kiro-cli chat --agent ${exp.agentFileName}...`);

  const result = spawnSync('kiro-cli', ['chat', '--agent', exp.agentFileName], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    error(`Failed to launch kiro-cli: ${result.error.message}`);
    info('Make sure kiro-cli is installed: npm install -g kiro-cli');
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}
