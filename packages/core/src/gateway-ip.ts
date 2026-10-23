import {isIP} from 'node:net';
import {z} from 'zod';

/** Compare socket addresses directly; forwarded headers never establish membership. */
export function normalizeGatewayIP(value: string): string | undefined {
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return;
  // Scoped link-local addresses cannot be represented as an exact portable allowlist entry.
  if (value.includes('%')) return;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return normalized;
}

export const gatewayIPAddress = z.string().trim().refine(value => {
  try { return normalizeGatewayIP(value) !== undefined; } catch { return false; }
}, '请输入完整的 IPv4 或 IPv6 地址').transform(value => normalizeGatewayIP(value)!);
