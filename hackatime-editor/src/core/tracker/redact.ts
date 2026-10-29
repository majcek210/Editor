/**
 * Redaction for anything shown in the Tracking Log. The native plugin redacts
 * before it writes the log; the UI redacts again before display.
 */
export const REDACTED = '<redacted>';

// Same shape the CLI accepts: pkg/params/params.go apiKeyRegex.
const KEY_RE = /(waka_)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/gi;

export function redactText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join(REDACTED);
    const b64 = toBase64(s);
    if (b64) out = out.split(b64).join(REDACTED);
  }
  out = out.replace(/(--key[= ])\S+/g, `$1${REDACTED}`);
  out = out.replace(/(api_key\s*=\s*)\S+/g, `$1${REDACTED}`);
  out = out.replace(/(Basic\s+)[A-Za-z0-9+/=]{8,}/g, `$1${REDACTED}`);
  return out.replace(KEY_RE, REDACTED);
}

export function redactArgs(args: string[], secrets: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--key') {
      out.push(a);
      if (i + 1 < args.length) {
        out.push(REDACTED);
        i++;
      }
      continue;
    }
    if (a.startsWith('--key=')) {
      out.push(`--key=${REDACTED}`);
      continue;
    }
    out.push(redactText(a, secrets));
  }
  return out;
}

function toBase64(s: string): string {
  try {
    return btoa(s);
  } catch {
    return '';
  }
}
