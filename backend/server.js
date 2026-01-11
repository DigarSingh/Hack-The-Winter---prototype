const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const elliptic = require('elliptic');
const db = require('./db');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
app.use(express.json());

// Logging middleware
const isDev = process.env.NODE_ENV !== 'production';
app.use(morgan(isDev ? 'dev' : 'combined'));

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100,
     message: 'Too many requests from this IP, please try again later',
     standardHeaders: true,
     legacyHeaders: false,
});

// Apply rate limiting to all routes
app.use(limiter);

const PORT = process.env.PORT || 3000;
const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ec = new elliptic.ec('secp256k1');

// Load deployment info
let contractAddress, contract, provider, wallet;

async function initBlockchain() {
     try {
          const deploymentPath = path.join(__dirname, '../contracts/deployment.json');

          if (!fs.existsSync(deploymentPath)) {
               console.warn('⚠️  Deployment file not found. Run contract deployment first.');
               console.warn('   Blockchain anchoring will be disabled until contract is deployed.');
               return false;
          }

          const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
          contractAddress = deployment.contractAddress;

          // Connect to local Hardhat node
          const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
          provider = new ethers.JsonRpcProvider(rpcUrl);

          // Use configured signer
          wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, provider);

          // Load contract ABI
          const artifactPath = path.join(__dirname, '../contracts/artifacts/contracts/AnchorRegistry.sol/AnchorRegistry.json');
          const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
          contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

          console.log('✅ Blockchain initialized. Contract at:', contractAddress);
          return true;
     } catch (error) {
          console.error('❌ Blockchain initialization failed:', error.message);
          return false;
     }
}

// Utility functions
function generateToken(length = 32) {
     return crypto.randomBytes(length).toString('hex');
}

function generateId(prefix) {
     return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function hashString(data) {
     return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalizeEvent(eventData) {
     // Create canonical JSON representation for hashing
     return JSON.stringify({
          session_id: eventData.session_id,
          order_id: eventData.order_id,
          customer_id: eventData.customer_id,
          dp_id: eventData.dp_id,
          ephemeral_token_hash: eventData.ephemeral_token_hash,
          challenge_nonce: eventData.challenge_nonce,
          dp_signature: eventData.dp_signature,
          evidence_hashes: eventData.evidence_hashes || [],
          timestamp: eventData.timestamp,
          backend_received_at: eventData.backend_received_at
     });
}

function verifySignature(publicKeyHex, message, signatureHex) {
     try {
          if (!publicKeyHex || typeof publicKeyHex !== 'string') {
               console.error('Invalid public key: must be a string');
               return false;
          }

          if (!signatureHex || typeof signatureHex !== 'string') {
               console.error('Invalid signature: must be a string');
               return false;
          }

          if (!/^[0-9a-fA-F]*$/.test(signatureHex)) {
               console.error('Invalid signature: must be valid hex string');
               return false;
          }

          if (signatureHex.length !== 128) {
               console.error('Invalid signature length: expected 128 hex chars, got', signatureHex.length);
               return false;
          }

          const key = ec.keyFromPublic(publicKeyHex, 'hex');
          const msgHash = hashString(message);
          const signature = {
               r: signatureHex.slice(0, 64),
               s: signatureHex.slice(64, 128)
          };
          return key.verify(msgHash, signature);
     } catch (error) {
          console.error('Signature verification error:', error.message);
          return false;
     }
}

// API Endpoints

/**
 * POST /api/v1/sessions
 * Customer activates a delivery session
 */
app.post('/api/v1/sessions', async (req, res) => {
     try {
          const { customer_id, order_id, ttl_seconds = 300 } = req.body;

          if (!customer_id || !order_id) {
               return res.status(400).json({ error: 'customer_id and order_id required' });
          }

          const session_id = generateId('s');
          const ephemeral_token = generateToken();
          const created_at = Date.now();
          const expires_at = created_at + (ttl_seconds * 1000);

          await db.createSession({
               session_id,
               customer_id,
               order_id,
               ephemeral_token,
               token_type: 'BLE',
               created_at,
               expires_at
          });

          console.log(`✅ Session created: ${session_id} for customer: ${customer_id}`);

          res.json({
               session_id,
               ephemeral_token,
               token_type: 'BLE',
               expires_at: new Date(expires_at).toISOString(),
               ttl_seconds
          });
     } catch (error) {
          console.error('Session creation error:', error);
          res.status(500).json({ error: 'Internal server error' });
     }
});

/**
 * POST /api/v1/sessions/:session_id/challenge
 * Delivery Partner requests a challenge for proximity verification
 */
app.post('/api/v1/sessions/:session_id/challenge', async (req, res) => {
     try {
          const { session_id } = req.params;
          const { dp_id } = req.body;

          if (!dp_id) {
               return res.status(400).json({ error: 'dp_id required' });
          }

          // Verify session exists and is active
          const session = await db.getSession(session_id);
          if (!session) {
               return res.status(404).json({ error: 'Session not found' });
          }

          if (Date.now() > session.expires_at) {
               return res.status(400).json({ error: 'Session expired' });
          }

          if (session.status !== 'active') {
               return res.status(400).json({ error: 'Session not active' });
          }

          // Verify DP is registered
          const dpKey = await db.getDPKey(dp_id);
          if (!dpKey) {
               return res.status(403).json({ error: 'Delivery partner not registered' });
          }

          const challenge_id = generateId('ch');
          const challenge_nonce = generateToken(16);
          const created_at = Date.now();
          const expires_at = created_at + (60 * 1000); // 1 minute to respond

          await db.createChallenge({
               challenge_id,
               session_id,
               dp_id,
               challenge_nonce,
               created_at,
               expires_at
          });

          console.log(`✅ Challenge issued: ${challenge_id} for DP: ${dp_id}`);

          res.json({
               challenge_nonce,
               expires_at: new Date(expires_at).toISOString()
          });
     } catch (error) {
          console.error('Challenge creation error:', error);
          res.status(500).json({ error: 'Internal server error' });
     }
});

/**
 * POST /api/v1/deliveries
 * Delivery Partner submits signed delivery proof
 */
app.post('/api/v1/deliveries', async (req, res) => {
     try {
          const { session_id, dp_id, signed_blob, evidence_hashes = [] } = req.body;

          if (!session_id || !dp_id || !signed_blob) {
               return res.status(400).json({ error: 'session_id, dp_id, and signed_blob required' });
          }

          // Get session
          const session = await db.getSession(session_id);
          if (!session) {
               return res.status(404).json({ error: 'Session not found' });
          }

          // Get challenge
          const challenge = await db.getChallenge(session_id, dp_id);
          if (!challenge) {
               return res.status(400).json({ error: 'No active challenge found' });
          }

          if (Date.now() > challenge.expires_at) {
               return res.status(400).json({ error: 'Challenge expired' });
          }

          // Get DP public key
          const dpKey = await db.getDPKey(dp_id);
          if (!dpKey) {
               return res.status(403).json({ error: 'Delivery partner not registered' });
          }

          // Parse signed blob
          const signedData = JSON.parse(Buffer.from(signed_blob, 'base64').toString('utf8'));
          const { message, signature } = signedData;

          // Verify signature
          const isValid = verifySignature(dpKey.public_key, message, signature);
          if (!isValid) {
               return res.status(401).json({ error: 'Invalid signature' });
          }

          // Parse message and verify it contains required data
          const messageData = JSON.parse(message);
          if (messageData.session_id !== session_id ||
               messageData.challenge_nonce !== challenge.challenge_nonce) {
               return res.status(400).json({ error: 'Message data mismatch' });
          }

          // Mark challenge as used
          await db.markChallengeUsed(challenge.challenge_id);

          // Create delivery event
          const event_id = generateId('evt');
          const timestamp = new Date().toISOString();
          const backend_received_at = new Date().toISOString();
          const ephemeral_token_hash = 'sha256:' + hashString(session.ephemeral_token);

          const eventData = {
               event_id,
               session_id,
               order_id: session.order_id,
               customer_id: session.customer_id,
               dp_id,
               ephemeral_token_hash,
               challenge_nonce: challenge.challenge_nonce,
               dp_signature: signature,
               evidence_hashes: JSON.stringify(evidence_hashes),
               timestamp,
               backend_received_at
          };

          await db.createDeliveryEvent(eventData);

          // Update session status
          await db.updateSessionStatus(session_id, 'completed');

          console.log(`✅ Delivery event recorded: ${event_id}`);

          // Anchor to blockchain
          let txHash = null;
          if (contract) {
               try {
                    const canonicalJson = canonicalizeEvent(eventData);
                    const anchor_hash = '0x' + hashString(canonicalJson);

                    console.log(`📦 Anchoring event ${event_id} to blockchain...`);
                    const tx = await contract.storeAnchor(anchor_hash, event_id);
                    const receipt = await tx.wait();
                    txHash = receipt.hash;

                    const anchored_at = new Date().toISOString();
                    await db.updateEventAnchor(event_id, anchor_hash, txHash, anchored_at);

                    console.log(`⛓️  Event anchored! TX: ${txHash}`);
               } catch (blockchainError) {
                    console.error('Blockchain anchoring failed:', blockchainError.message);
                    // Continue without blockchain anchor
               }
          }

          res.json({
               status: 'verified',
               event_id,
               txHash,
               message: 'Delivery proof verified and recorded'
          });
     } catch (error) {
          console.error('Delivery submission error:', error);
          res.status(500).json({ error: 'Internal server error' });
     }
});

/**
 * GET /api/v1/deliveries/:event_id/verify
 * Verify a delivery event
 */
app.get('/api/v1/deliveries/:event_id/verify', async (req, res) => {
     try {
          const { event_id } = req.params;

          const event = await db.getDeliveryEvent(event_id);
          if (!event) {
               return res.status(404).json({ error: 'Event not found' });
          }

          // Check blockchain anchor if available
          let blockchainVerified = false;
          if (contract && event.anchor_hash) {
               try {
                    const isAnchored = await contract.isAnchored(event.anchor_hash);
                    blockchainVerified = isAnchored;
               } catch (error) {
                    console.error('Blockchain verification error:', error);
               }
          }

          res.json({
               event_id: event.event_id,
               session_id: event.session_id,
               order_id: event.order_id,
               dp_id: event.dp_id,
               timestamp: event.timestamp,
               status: event.status,
               tx_hash: event.tx_hash,
               anchor_hash: event.anchor_hash,
               anchored_at: event.anchored_at,
               blockchain_verified: blockchainVerified
          });
     } catch (error) {
          console.error('Verification error:', error);
          res.status(500).json({ error: 'Internal server error' });
     }
});

/**
 * POST /api/v1/dp/register
 * Register a delivery partner public key
 */
app.post('/api/v1/dp/register', async (req, res) => {
     try {
          const { dp_id, public_key } = req.body;

          if (!dp_id || typeof dp_id !== 'string' || dp_id.trim().length === 0) {
               return res.status(400).json({ error: 'dp_id must be a non-empty string' });
          }

          if (!public_key || typeof public_key !== 'string' || public_key.trim().length === 0) {
               return res.status(400).json({ error: 'public_key must be a non-empty string' });
          }

          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(dp_id)) {
               return res.status(400).json({ error: 'dp_id must be alphanumeric (1-128 chars)' });
          }

          const trimmedKey = public_key.trim();
          if (!/^[0-9a-fA-F]{130}$/.test(trimmedKey)) {
               return res.status(400).json({ error: 'public_key must be 130 hex chars (secp256k1 uncompressed)' });
          }

          try {
               ec.keyFromPublic(trimmedKey, 'hex');
          } catch (error) {
               return res.status(400).json({ error: 'Invalid public key format' });
          }

          const existingKey = await db.getDPKey(dp_id);
          if (existingKey) {
               return res.status(409).json({ error: 'DP already registered' });
          }

          await db.registerDPKey(dp_id, trimmedKey);

          console.log(`✅ DP registered: ${dp_id} with key ${trimmedKey.slice(0, 20)}...`);

          res.json({
               status: 'registered',
               dp_id,
               message: 'Delivery partner registered successfully'
          });
     } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT') {
               return res.status(409).json({ error: 'DP already registered' });
          }
          console.error('DP registration error:', error.message);
          res.status(500).json({ error: 'Internal server error' });
     }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
     res.json({
          status: 'ok',
          blockchain: contract ? 'connected' : 'disconnected',
          timestamp: new Date().toISOString()
     });
});

// Initialize and start server
async function start() {
     try {
          await db.initialize();
          await initBlockchain();

          app.listen(PORT, () => {
               console.log('');
               console.log('🚀 Proximity-Verified Delivery Backend');
               console.log(`📡 Server running on http://localhost:${PORT}`);
               console.log('');
               console.log('Endpoints:');
               console.log('  POST   /api/v1/sessions');
               console.log('  POST   /api/v1/sessions/:session_id/challenge');
               console.log('  POST   /api/v1/deliveries');
               console.log('  GET    /api/v1/deliveries/:event_id/verify');
               console.log('  POST   /api/v1/dp/register');
               console.log('  GET    /health');
               console.log('');
          });
     } catch (error) {
          console.error('Failed to start server:', error);
          process.exit(1);
     }
}

// Graceful shutdown
process.on('SIGINT', async () => {
     console.log('\nShutting down...');
     await db.close();
     process.exit(0);
});

start();
