/**
 * OpenAI provider — chat completions with optional tool use
 */
import { appendOutput } from '../db.js'
import { emitReefEvent } from '../events.js'
import { exec } from 'child_process'
import { promisify } from 'util'

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

export async function runOpenAIAgent(
  sessionId: string,
  task: string,
  model: string,
  workdir: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  // Dynamic import to avoid issues if package missing
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey })

  const messages: Array<any> = [
    {
      role: 'system',
      content: 'You are a helpful assistant. You can execute shell commands using the shell tool.',
    },
    { role: 'user', content: task },
  ]

  let turns = 0
  const maxTurns = 10

  while (turns < maxTurns) {
    turns++

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: TOOL_DEFS,
    })

    const choice = response.choices[0]
    if (!choice?.message) break

    const msg = choice.message
    messages.push(msg)

    // Emit text content
    if (msg.content) {
      appendOutput(sessionId, msg.content)
      emitReefEvent('output', sessionId, { text: msg.content })
    }

    // Handle tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const fn = (tc as any).function
        if (!fn) continue
        const args = JSON.parse(fn.arguments || '{}')
        emitReefEvent('tool.start', sessionId, { toolName: fn.name, args })
        appendOutput(sessionId, `⚡ ${fn.name}(${args.command || ''})`)

        let result: string
        try {
          const { stdout, stderr } = await execAsync(args.command, { cwd: workdir, timeout: 30000 })
          result = (stdout + stderr).slice(0, 4000)
        } catch (err: any) {
          result = `Error: ${err.message}\n${(err.stdout || '') + (err.stderr || '')}`.slice(
            0,
            4000
          )
        }

        appendOutput(sessionId, result)
        emitReefEvent('tool.end', sessionId, { toolName: fn.name })
        emitReefEvent('output', sessionId, { text: result })

        messages.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result,
        })
      }
      // Continue loop for model to process tool results
      continue
    }

    // No tool calls — done
    break
  }
}
