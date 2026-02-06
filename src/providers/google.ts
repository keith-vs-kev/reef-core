/**
 * Google Generative AI provider — Gemini models with optional tool use
 */
import { appendOutput, updateSession } from '../db.js';
import { emitReefEvent } from '../events.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Tool definition built after import to use SDK types
let SHELL_TOOL: any;

export async function runGoogleAgent(
  sessionId: string,
  task: string,
  model: string,
  workdir: string,
): Promise<void> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not set');

  const genai = await import('@google/genai');
  const { GoogleGenAI, Type } = genai;
  const ai = new GoogleGenAI({ apiKey });

  SHELL_TOOL = {
    functionDeclarations: [
      {
        name: 'shell',
        description: 'Execute a shell command and return stdout/stderr',
        parameters: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING, description: 'Shell command to run' },
          },
          required: ['command'],
        },
      },
    ],
  };

  let turns = 0;
  const maxTurns = 10;
  const contents: Array<any> = [{ role: 'user', parts: [{ text: task }] }];

  while (turns < maxTurns) {
    turns++;

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        tools: [SHELL_TOOL],
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    // Add model response to history
    contents.push({ role: 'model', parts: candidate.content.parts });

    let hasToolCalls = false;
    const toolResponseParts: any[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        appendOutput(sessionId, part.text);
        emitReefEvent('output', sessionId, { text: part.text });
      }

      if (part.functionCall) {
        hasToolCalls = true;
        const fc = part.functionCall;
        const args = fc.args as any || {};
        emitReefEvent('tool.start', sessionId, { toolName: fc.name, args });
        appendOutput(sessionId, `⚡ ${fc.name}(${args.command || ''})`);

        let result: string;
        try {
          const { stdout, stderr } = await execAsync(args.command, { cwd: workdir, timeout: 30000 });
          result = (stdout + stderr).slice(0, 4000);
        } catch (err: any) {
          result = `Error: ${err.message}\n${(err.stdout || '') + (err.stderr || '')}`.slice(0, 4000);
        }

        appendOutput(sessionId, result);
        emitReefEvent('tool.end', sessionId, { toolName: fc.name });
        emitReefEvent('output', sessionId, { text: result });

        toolResponseParts.push({
          functionResponse: {
            name: fc.name,
            response: { result },
          },
        });
      }
    }

    if (hasToolCalls && toolResponseParts.length > 0) {
      contents.push({ role: 'user', parts: toolResponseParts });
      continue;
    }

    break;
  }
}
