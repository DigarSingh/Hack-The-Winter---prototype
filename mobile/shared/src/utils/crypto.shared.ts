import crypto from 'crypto-js';

export const sha256Hex = (input: string) => crypto.SHA256(input).toString(crypto.enc.Hex);
