import readline from 'node:readline'
import { db } from '../db.js'
import { resetLocalUserPassword } from '../lib/password-reset.js'

function parseArgs(argv: string[]) {
  let username: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--username' || arg === '-u') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a username.`)
      }
      username = value
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  if (!username?.trim()) {
    throw new Error('Username is required.')
  }
  return { username }
}

function printUsage() {
  console.log('Usage: node dist-server/cli/reset-password.js --username <username>')
}

async function promptHidden(prompt: string) {
  const input = process.stdin
  const output = process.stdout
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Password reset requires an interactive TTY.')
  }

  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  })
  const mutableOutput = output as NodeJS.WriteStream & { muted?: boolean }

  const originalWrite = mutableOutput.write.bind(mutableOutput)
  mutableOutput.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    if (!mutableOutput.muted) {
      return originalWrite(chunk, encoding, callback)
    }
    const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk)
    if (text.includes('\n') || text.includes('\r')) {
      return originalWrite(chunk, encoding, callback)
    }
    if (typeof callback === 'function') callback()
    return true
  }) as typeof mutableOutput.write

  try {
    output.write(prompt)
    mutableOutput.muted = true
    const answer = await new Promise<string>((resolve) => {
      rl.question('', resolve)
    })
    mutableOutput.muted = false
    output.write('\n')
    return answer
  } finally {
    mutableOutput.muted = false
    mutableOutput.write = originalWrite as typeof mutableOutput.write
    rl.close()
  }
}

async function main() {
  const { username } = parseArgs(process.argv.slice(2))
  const password = await promptHidden('New password: ')
  const confirmation = await promptHidden('Confirm new password: ')
  if (password !== confirmation) {
    throw new Error('Passwords do not match.')
  }

  const result = resetLocalUserPassword({
    username,
    password,
    actor: 'system',
  })
  console.log(
    `Password reset for ${result.username}. Active sessions invalidated: ${result.sessionsInvalidated}.`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Password reset failed.')
  printUsage()
  process.exitCode = 1
} finally {
  db.close()
}
