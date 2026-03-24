import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { error, heading, info, success } from '../utils/format.js';
import {
  exportToSystemPrompt,
  exportToClaudeCode,
  exportToOpenAI,
  exportToCrewAI,
  exportToOpenClawString,
  exportToNanobotString,
  exportToCopilotString,
  exportToOpenCodeString,
  exportToCursorString,
  exportToKiroString,
} from '../adapters/index.js';
import { exportToKiro } from '../adapters/kiro.js';
import { exportToLyzrString } from '../adapters/lyzr.js';
import { exportToGitHubString } from '../adapters/github.js';

interface ExportOptions {
  format: string;
  dir: string;
  output: string | undefined;
}

export const exportCommand = new Command('export')
  .description('Export agent to other formats')
  .requiredOption('-f, --format <format>', 'Export format (system-prompt, claude-code, openai, crewai, openclaw, nanobot, lyzr, github, copilot, opencode, cursor, kiro)')
  .option('-d, --dir <dir>', 'Agent directory', '.')
  .option('-o, --output <output>', 'Output file path (or output directory for kiro format)')
  .action(async (options: ExportOptions) => {
    const dir = resolve(options.dir);

    heading('Exporting agent');
    info(`Format: ${options.format}`);

    try {
      let result: string;

      switch (options.format) {
        case 'system-prompt':
          result = exportToSystemPrompt(dir);
          break;
        case 'claude-code':
          result = exportToClaudeCode(dir);
          break;
        case 'openai':
          result = exportToOpenAI(dir);
          break;
        case 'crewai':
          result = exportToCrewAI(dir);
          break;
        case 'openclaw':
          result = exportToOpenClawString(dir);
          break;
        case 'nanobot':
          result = exportToNanobotString(dir);
          break;
        case 'lyzr':
          result = exportToLyzrString(dir);
          break;
        case 'github':
          result = exportToGitHubString(dir);
          break;
        case 'copilot':
          result = exportToCopilotString(dir);
          break;
        case 'opencode':
          result = exportToOpenCodeString(dir);
          break;
        case 'cursor':
          result = exportToCursorString(dir);
          break;
        case 'kiro':
          result = exportToKiroString(dir);
          break;
        default:
          error(`Unknown format: ${options.format}`);
          info('Supported formats: system-prompt, claude-code, openai, crewai, openclaw, nanobot, lyzr, github, copilot, opencode, cursor, kiro');
          process.exit(1);
          return;
      }

      if (options.format === 'kiro') {
        const outputDir = resolve(options.output ?? '.');
        const exp = exportToKiro(dir);
        const write = (filePath: string, content: string) => {
          const abs = join(outputDir, filePath);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content, 'utf-8');
          success(`  ${filePath}`);
        };
        write(`./kiro/agents/${exp.agentFileName}.json`, JSON.stringify(exp.agentJson, null, 2));
        for (const f of exp.steeringFiles) write(`./kiro/steering/${f.name}`, f.content);
        for (const s of exp.skills) write(`./kiro/skills/${s.name}/SKILL.md`, s.content);
      } else if (options.output) {
        writeFileSync(resolve(options.output), result, 'utf-8');
        success(`Exported to ${options.output}`);
      } else {
        console.log(result);
      }
    } catch (e) {
      error((e as Error).message);
      process.exit(1);
    }
  });
