const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'proximity_pod.db');

class Database {
     constructor() {
          this.db = null;
     }

     async initialize() {
          return new Promise((resolve, reject) => {
               this.db = new sqlite3.Database(DB_PATH, (err) => {
                    if (err) {
                         console.error('Database connection error:', err);
                         reject(err);
                    } else {
                         console.log('Connected to SQLite database');
                         this.createTables().then(resolve).catch(reject);
                    }
               });
          });
     }

     async createTables() {
          const schemas = [
               `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        ephemeral_token TEXT NOT NULL,
        token_type TEXT DEFAULT 'BLE',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      )`,

               `CREATE TABLE IF NOT EXISTS challenges (
        challenge_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        dp_id TEXT NOT NULL,
        challenge_nonce TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      )`,

               `CREATE TABLE IF NOT EXISTS delivery_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        order_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        dp_id TEXT NOT NULL,
        ephemeral_token_hash TEXT NOT NULL,
        challenge_nonce TEXT NOT NULL,
        dp_signature TEXT NOT NULL,
        evidence_hashes TEXT,
        timestamp TEXT NOT NULL,
        backend_received_at TEXT NOT NULL,
        anchor_hash TEXT,
        tx_hash TEXT,
        anchored_at TEXT,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      )`,

               `CREATE TABLE IF NOT EXISTS dp_keys (
        dp_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        key_type TEXT DEFAULT 'secp256k1',
        registered_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      )`,

               `CREATE INDEX IF NOT EXISTS idx_sessions_customer ON sessions(customer_id)`,
               `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
               `CREATE INDEX IF NOT EXISTS idx_challenges_session ON challenges(session_id)`,
               `CREATE INDEX IF NOT EXISTS idx_events_session ON delivery_events(session_id)`,
               `CREATE INDEX IF NOT EXISTS idx_events_dp ON delivery_events(dp_id)`,
               `CREATE INDEX IF NOT EXISTS idx_events_anchor ON delivery_events(anchor_hash)`
          ];

          for (const schema of schemas) {
               await this.run(schema);
          }

          console.log('Database tables created/verified');
     }

     run(sql, params = []) {
          return new Promise((resolve, reject) => {
               this.db.run(sql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
               });
          });
     }

     get(sql, params = []) {
          return new Promise((resolve, reject) => {
               this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
               });
          });
     }

     all(sql, params = []) {
          return new Promise((resolve, reject) => {
               this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
               });
          });
     }

     async close() {
          return new Promise((resolve, reject) => {
               this.db.close((err) => {
                    if (err) reject(err);
                    else resolve();
               });
          });
     }

     // Session methods
     async createSession(sessionData) {
          const { session_id, customer_id, order_id, ephemeral_token, token_type, created_at, expires_at } = sessionData;
          await this.run(
               `INSERT INTO sessions (session_id, customer_id, order_id, ephemeral_token, token_type, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
               [session_id, customer_id, order_id, ephemeral_token, token_type, created_at, expires_at]
          );
          return session_id;
     }

     async getSession(session_id) {
          return await this.get('SELECT * FROM sessions WHERE session_id = ?', [session_id]);
     }

     async updateSessionStatus(session_id, status) {
          await this.run('UPDATE sessions SET status = ? WHERE session_id = ?', [status, session_id]);
     }

     // Challenge methods
     async createChallenge(challengeData) {
          const { challenge_id, session_id, dp_id, challenge_nonce, created_at, expires_at } = challengeData;
          await this.run(
               `INSERT INTO challenges (challenge_id, session_id, dp_id, challenge_nonce, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
               [challenge_id, session_id, dp_id, challenge_nonce, created_at, expires_at]
          );
          return challenge_id;
     }

     async getChallenge(session_id, dp_id) {
          return await this.get(
               'SELECT * FROM challenges WHERE session_id = ? AND dp_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1',
               [session_id, dp_id]
          );
     }

     async markChallengeUsed(challenge_id) {
          await this.run('UPDATE challenges SET used = 1 WHERE challenge_id = ?', [challenge_id]);
     }

     // Delivery event methods
     async createDeliveryEvent(eventData) {
          const {
               event_id, session_id, order_id, customer_id, dp_id,
               ephemeral_token_hash, challenge_nonce, dp_signature,
               evidence_hashes, timestamp, backend_received_at
          } = eventData;

          await this.run(
               `INSERT INTO delivery_events 
       (event_id, session_id, order_id, customer_id, dp_id, ephemeral_token_hash, 
        challenge_nonce, dp_signature, evidence_hashes, timestamp, backend_received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
               [event_id, session_id, order_id, customer_id, dp_id, ephemeral_token_hash,
                    challenge_nonce, dp_signature, evidence_hashes, timestamp, backend_received_at]
          );
          return event_id;
     }

     async updateEventAnchor(event_id, anchor_hash, tx_hash, anchored_at) {
          await this.run(
               `UPDATE delivery_events 
       SET anchor_hash = ?, tx_hash = ?, anchored_at = ?, status = 'anchored'
       WHERE event_id = ?`,
               [anchor_hash, tx_hash, anchored_at, event_id]
          );
     }

     async getDeliveryEvent(event_id) {
          return await this.get('SELECT * FROM delivery_events WHERE event_id = ?', [event_id]);
     }

     // DP key management
     async registerDPKey(dp_id, public_key, key_type = 'secp256k1') {
          const registered_at = Date.now();
          await this.run(
               'INSERT OR REPLACE INTO dp_keys (dp_id, public_key, key_type, registered_at) VALUES (?, ?, ?, ?)',
               [dp_id, public_key, key_type, registered_at]
          );
     }

     async getDPKey(dp_id) {
          return await this.get('SELECT * FROM dp_keys WHERE dp_id = ? AND status = "active"', [dp_id]);
     }
}

module.exports = new Database();
