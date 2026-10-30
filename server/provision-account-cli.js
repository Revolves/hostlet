import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { loadConfig } from './config.js';
import { createMailer } from './mailer.js';
import { provisionAccount } from './provision-account.js';

const usage = 'Usage: node --env-file-if-exists=.env server/provision-account-cli.js --email EMAIL\nPassword is read from stdin; terminal input is hidden.\n';
const errors = {
  INVALID_EMAIL: 'Invalid email address.', INVALID_PASSWORD: 'Invalid password.',
  EMAIL_EXISTS: 'Email is already registered.', MAIL_FAILED: 'Email delivery failed; the new account was removed.',
  LOCKED: 'Data directory is in use or requires offline lock recovery.',
  CLEANUP_FAILED: 'Cleanup failed; inspect the data directory offline.',
};

async function readPassword(input, output) {
  if (!input.isTTY) {
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 1026) throw new Error('Invalid input');
      chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    if (!text || /[\r\n\0\ufffd]/u.test(text)) throw new Error('Invalid input');
    return text;
  }
  if (typeof input.setRawMode !== 'function') throw new Error('Terminal cannot disable echo');
  output.write('Password: ');
  return await new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    const wasRaw = Boolean(input.isRaw);
    let value = '';
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      input.off('data', onData); input.off('end', onEnd); input.off('error', onError);
      input.pause();
      try { input.setRawMode(wasRaw); } catch { error = new Error('Terminal restore failed'); }
      output.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onEnd = () => finish(new Error('Input ended'));
    const onError = () => finish(new Error('Input failed'));
    const onData = chunk => {
      for (const char of decoder.write(Buffer.from(chunk))) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('Input cancelled'));
        if (char === '\r' || char === '\n') return finish(value ? null : new Error('Empty password'));
        if (char === '\b' || char === '\u007f') value = Array.from(value).slice(0, -1).join('');
        else if (char < ' ' || char === '\ufffd') return finish(new Error('Invalid input'));
        else value += char;
        if (Buffer.byteLength(value, 'utf8') > 1024) return finish(new Error('Input too long'));
      }
    };
    try {
      input.setRawMode(true);
      input.on('data', onData); input.once('end', onEnd); input.once('error', onError);
      input.resume();
    } catch { finish(new Error('Terminal input failed')); }
  });
}

/** Execute the CLI; injectable streams and transport allow isolated tests. */
export async function runCli({ args = process.argv.slice(2), env = process.env, input = process.stdin, output = process.stdout, errorOutput = process.stderr, createTransport } = {}) {
  if (args.length === 1 && args[0] === '--help') { output.write(usage); return 0; }
  if (args.length !== 2 || args[0] !== '--email' || !args[1] || args[1].startsWith('-')) {
    errorOutput.write('Invalid arguments. Use --help for usage.\n'); return 1;
  }
  let config, sender;
  try {
    config = loadConfig(env);
    if (!config.multiuserEnabled || !config.smtp) throw new Error('Multiuser is disabled');
    sender = createMailer(config.smtp, { createTransport });
  } catch {
    errorOutput.write('Invalid server or SMTP configuration.\n'); return 1;
  }
  let password;
  try { password = await readPassword(input, output); }
  catch { errorOutput.write('Unable to read password from stdin.\n'); return 1; }
  try {
    await provisionAccount({ dataDir: config.dataDir, email: args[1], password, sender });
    output.write('Account created. Verification email sent.\n');
    return 0;
  } catch (error) {
    errorOutput.write(`${Object.hasOwn(errors, error?.code) ? errors[error.code] : 'Account provisioning failed.'}\n`);
    return 1;
  } finally { password = undefined; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
