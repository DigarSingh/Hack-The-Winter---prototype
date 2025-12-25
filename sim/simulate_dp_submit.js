#!/usr/bin/env node

const http = require('http');
const crypto = require('crypto');
const elliptic = require('elliptic');
const fs = require('fs');
const path = require('path');

const ec = new elliptic.ec('secp256k1');
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

function makeRequest(method, urlPath, data = null) {
     return new Promise((resolve, reject) => {
          const url = new URL(urlPath, API_BASE);
          const options = {
               hostname: url.hostname,
               port: url.port,
               path: url.pathname + url.search,
               method: method,
               headers: {
                    'Content-Type': 'application/json'
               }
          };

          const req = http.request(options, (res) => {
               let body = '';
               res.on('data', chunk => body += chunk);
               res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                         resolve(JSON.parse(body));
                    } else {
                         reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                    }
               });
          });

          req.on('error', reject);

          if (data) {
               req.write(JSON.stringify(data));
          }

          req.end();
     });
}

function hashString(data) {
     return crypto.createHash('sha256').update(data).digest('hex');
}

function loadOrCreateDPKey(dp_id) {
     const keyPath = path.join(__dirname, `${dp_id}_key.json`);

     if (fs.existsSync(keyPath)) {
          console.log(`📂 Loading existing key for ${dp_id}...`);
          const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          return {
               keyPair: ec.keyFromPrivate(keyData.private_key, 'hex'),
               public_key: keyData.public_key,
               isNew: false
          };
     } else {
          console.log(`🔑 Generating new key pair for ${dp_id}...`);
          const keyPair = ec.genKeyPair();
          const private_key = keyPair.getPrivate('hex');
          const public_key = keyPair.getPublic('hex');

          const keyData = {
               dp_id,
               private_key,
               public_key,
               created_at: new Date().toISOString()
          };

          fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2));
          console.log(`💾 Key saved to ${keyPath}`);

          return { keyPair, public_key, isNew: true };
     }
}

async function main() {
     const args = process.argv.slice(2);

     // Parse arguments
     const session_id = args.find(arg => arg.startsWith('--session='))?.split('=')[1];
     const token = args.find(arg => arg.startsWith('--token='))?.split('=')[1];
     const dp_id = args.find(arg => arg.startsWith('--dp='))?.split('=')[1] || 'dp_' + Math.floor(Math.random() * 1000);

     if (!session_id || !token) {
          console.error('❌ Usage: node simulate_dp_submit.js --session=<SESSION_ID> --token=<TOKEN> [--dp=<DP_ID>]');
          console.error('');
          console.error('Run simulate_customer_activate.js first to get SESSION_ID and TOKEN');
          process.exit(1);
     }

     console.log('');
     console.log('📦 Delivery Partner Submitting Proof');
     console.log('=====================================');
     console.log(`DP ID:        ${dp_id}`);
     console.log(`Session ID:   ${session_id}`);
     console.log(`Token:        ${token.substring(0, 16)}...`);
     console.log('');

     try {
          // Load or create DP key pair
          const { keyPair, public_key, isNew } = loadOrCreateDPKey(dp_id);

          // Register DP if new key
          if (isNew) {
               console.log('📝 Registering delivery partner...');
               await makeRequest('POST', '/api/v1/dp/register', {
                    dp_id,
                    public_key
               });
               console.log('✅ DP registered');
               console.log('');
          }

          // Step 1: Request challenge
          console.log('🔐 Requesting challenge from backend...');
          const challengeResponse = await makeRequest('POST', `/api/v1/sessions/${session_id}/challenge`, {
               dp_id
          });
          console.log(`✅ Challenge received: ${challengeResponse.challenge_nonce.substring(0, 16)}...`);
          console.log(`   Expires: ${challengeResponse.expires_at}`);
          console.log('');

          // Step 2: Simulate BLE detection (in real app, this would be from BLE scan)
          console.log('📡 Simulating BLE proximity detection...');
          console.log(`   Found ephemeral token: ${token.substring(0, 16)}...`);
          console.log('   ✅ Device is within proximity range');
          console.log('');

          // Step 3: Create signed message
          console.log('✍️  Creating cryptographic proof...');
          const timestamp = new Date().toISOString();
          const token_hash = 'sha256:' + hashString(token);

          const messageData = {
               session_id,
               ephemeral_token_hash: token_hash,
               challenge_nonce: challengeResponse.challenge_nonce,
               timestamp,
               dp_id
          };

          const message = JSON.stringify(messageData);
          const msgHash = hashString(message);
          const signature = keyPair.sign(msgHash);
          const signatureHex = signature.r.toString('hex', 64) + signature.s.toString('hex', 64);

          console.log('   Message hash:', msgHash.substring(0, 32) + '...');
          console.log('   Signature:   ', signatureHex.substring(0, 32) + '...');
          console.log('');

          // Step 4: Submit delivery proof
          console.log('📤 Submitting delivery proof to backend...');

          const signedBlob = Buffer.from(JSON.stringify({
               message,
               signature: signatureHex
          })).toString('base64');

          const evidence_hashes = [
               'sha256:' + crypto.randomBytes(32).toString('hex') // Simulated photo hash
          ];

          const deliveryResponse = await makeRequest('POST', '/api/v1/deliveries', {
               session_id,
               dp_id,
               signed_blob: signedBlob,
               evidence_hashes
          });

          console.log('');
          console.log('🎉 SUCCESS! Delivery Verified');
          console.log('═════════════════════════════════════');
          console.log(`Status:    ${deliveryResponse.status}`);
          console.log(`Event ID:  ${deliveryResponse.event_id}`);
          if (deliveryResponse.txHash) {
               console.log(`TX Hash:   ${deliveryResponse.txHash}`);
               console.log('⛓️  Proof anchored to blockchain!');
          } else {
               console.log('⚠️  Blockchain anchoring not available');
          }
          console.log('');
          console.log('✅ Delivery proof recorded and verified');
          console.log('');
          console.log(`Verify at: ${API_BASE}/api/v1/deliveries/${deliveryResponse.event_id}/verify`);
          console.log('');

     } catch (error) {
          console.error('❌ Error:', error.message);
          process.exit(1);
     }
}

main();
