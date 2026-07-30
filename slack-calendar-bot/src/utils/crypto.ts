import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推奨の 96bit
const VERSION = 'v1';

/**
 * Google OAuth トークンなどの秘密情報を AES-256-GCM で暗号化する。
 * DB には常にこの形式の文字列だけを保存し、平文は保存しない。
 *
 * 形式: v1:<iv(base64)>:<authTag(base64)>:<ciphertext(base64)>
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY は base64 で 32 バイトである必要があります');
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('暗号化トークンの形式が不正です');
    }
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** null 安全なラッパー（未連携ユーザーは null を持ちうる） */
  encryptNullable(plaintext: string | null | undefined): string | null {
    return plaintext ? this.encrypt(plaintext) : null;
  }

  decryptNullable(payload: string | null | undefined): string | null {
    return payload ? this.decrypt(payload) : null;
  }
}

/** OAuth state など、推測困難なランダム文字列を生成する */
export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** タイミング攻撃に強い文字列比較 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
