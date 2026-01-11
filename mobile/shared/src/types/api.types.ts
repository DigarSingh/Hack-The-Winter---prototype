export interface SessionResponse {
  session_id: string;
  ephemeral_token: string;
  token_type: 'BLE' | 'QR';
  expires_at: string;
  ttl_seconds: number;
}
