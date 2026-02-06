/**
 * OpenAI provider — chat completions with tool use
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import type { AgentProvider, ProviderContext } from './types.js'

const execAsync = promisify(exec)

const TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'shell',
      description: 'Execute a shell command and return stdout/stderr',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
]

export const openaiProvider: AgentProvider = {
  name: 'openai',

  async run(ctx: ProviderContext): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not set')

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: Array<any> = [
      {
        role: 'system',
        content:
          'You are a helpful assistant. You can execute shell commands using the shell tool.',
      },
      { role: 'user', content: ctx.task },
    ]

    let turns = 0
    const maxTurns = 10

    while (turns < maxTurns) {
      if (ctx.signal.aborted) break
      turns++

      const response = await client.chat.completions.create({
        model: ctx.model,
        messages,
        tools: TOOL_DEFS,
      })

      const choice = response.choices[0]
      if (!choice?.message) break

      const msg = choice.message
      messages.push(msg)

      if (msg.content) {
        ctx.onOutput(msg.content)
        ctx.onEvent({
          type: 'output',
          sessionId: ctx.sessionId,
          data: { text: msg.content },
        })
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fn = (tc as any).function
          if (!fn) continue
          const args = JSON.parse(fn.arguments || '{}')
          ctx.onEvent({
            type: 'tool.start',
            sessionId: ctx.sessionId,
            data: { toolName: fn.name, toolCallId: tc.id, args },
          })
          ctx.onOutput(`⚡ ${fn.name}(${args.command || ''})`)

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
            data: { toolName: fn.name, toolCallId: tc.id },
          })
          ctx.onEvent({
            type: 'output',
            sessionId: ctx.sessionId,
            data: { text: result },
          })

          messages.push({
            role: 'tool' as const,
            tool_call_id: tc.id,
            content: result,
          })
        }
        continue
      }

      break
    }
  },
}
