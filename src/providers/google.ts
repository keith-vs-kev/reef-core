/**
 * Google Generative AI provider — Gemini models with tool use
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import type { AgentProvider, ProviderContext } from './types.js'

const execAsync = promisify(exec)

export const googleProvider: AgentProvider = {
  name: 'google',

  async run(ctx: ProviderContext): Promise<void> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not set')

    const genai = await import('@google/genai')
    const { GoogleGenAI, Type } = genai
    const ai = new GoogleGenAI({ apiKey })

    const SHELL_TOOL = {
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
    }

    let turns = 0
    const maxTurns = 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: Array<any> = [{ role: 'user', parts: [{ text: ctx.task }] }]

    while (turns < maxTurns) {
      if (ctx.signal.aborted) break
      turns++

      const response = await ai.models.generateContent({
        model: ctx.model,
        contents,
        config: { tools: [SHELL_TOOL] },
      })

      const candidate = response.candidates?.[0]
      if (!candidate?.content?.parts) break

      contents.push({ role: 'model', parts: candidate.content.parts })

      let hasToolCalls = false
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResponseParts: any[] = []

      for (const part of candidate.content.parts) {
        if (part.text) {
          ctx.onOutput(part.text)
          ctx.onEvent({
            type: 'output',
            sessionId: ctx.sessionId,
            data: { text: part.text },
          })
        }

        if (part.functionCall) {
          hasToolCalls = true
          const fc = part.functionCall
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = (fc.args as any) || {}
          ctx.onEvent({
            type: 'tool.start',
            sessionId: ctx.sessionId,
            data: { toolName: fc.name || 'unknown', toolCallId: fc.name || 'unknown', args },
          })
          ctx.onOutput(`⚡ ${fc.name}(${args.command || ''})`)

          let result: string
          try {
            const { stdout, stderr } = await execAsync(args.command, {
              cwd: ctx.workdir,
              timeout: 30000,
            })
            result = (stdout + stderr).slice(0, 4000)
          } catch (err: unknown) {
            const e = err as { message: string; stdout?: string; stderr?: string }
            result = `Error: ${e.message}\n${(e.stdout || '') + (e.stderr || '')}`.slice(0, 4000)
          }

          ctx.onOutput(result)
          ctx.onEvent({
            type: 'tool.end',
            sessionId: ctx.sessionId,
            data: { toolName: fc.name || 'unknown', toolCallId: fc.name || 'unknown' },
          })
          ctx.onEvent({
            type: 'output',
            sessionId: ctx.sessionId,
            data: { text: result },
          })

          toolResponseParts.push({
            functionResponse: { name: fc.name, response: { result } },
          })
        }
      }

      if (hasToolCalls && toolResponseParts.length > 0) {
        contents.push({ role: 'user', parts: toolResponseParts })
        continue
      }

      break
    }
  },
}
