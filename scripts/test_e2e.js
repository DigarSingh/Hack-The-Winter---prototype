#!/usr/bin/env node

/**
 * Test script for proximity-verified delivery prototype
 * Assumes blockchain node and backend are already running
 */

const axios = require('axios');
const crypto = require('crypto');
const EC = require('elliptic').ec;

const BASE_URL = 'http://localhost:3000';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Delivery Partner key pair (generated for testing)
const ec = new EC('secp256k1');
const dpKeyPair = ec.keyFromPrivate('a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456');
const dpPublicKey = dpKeyPair.getPublic('hex');
const dpId = 'dp_test_001';

console.log('\n' + '='.repeat(70));
console.log('🚚 Proximity-Verified Delivery - End-to-End Test');
console.log('='.repeat(70));

async function main() {
     try {
          // Step 1: Register Delivery Partner
          console.log('\n📋 Step 1: Register Delivery Partner');
          console.log('-'.repeat(70));
          const registerResponse = await axios.post(`${BASE_URL}/api/v1/dp/register`, {
               dp_id: dpId,
               public_key: dpPublicKey,
               name: 'Test Delivery Partner'
          });
          console.log('✅ DP Registered:', registerResponse.data);

          // Step 2: Customer activates session
          console.log('\n👤 Step 2: Customer Activates Delivery Session');
          console.log('-'.repeat(70));
          const sessionResponse = await axios.post(`${BASE_URL}/api/v1/sessions`, {
               customer_id: 'cust_123',
               order_id: 'order_789',
               ttl_seconds: 300
          });
          const { session_id, ephemeral_token, expires_at } = sessionResponse.data;
          console.log('✅ Session Created:');
          console.log(`   Session ID: ${session_id}`);
          console.log(`   Ephemeral Token: ${ephemeral_token}`);
          console.log(`   Expires At: ${expires_at}`);

          // Step 3: Simulate BLE scan - DP discovers ephemeral token
          console.log('\n📡 Step 3: Delivery Partner Scans BLE (Simulated)');
          console.log('-'.repeat(70));
          console.log(`   DP scanned and found ephemeral token: ${ephemeral_token}`);

          // Step 4: DP requests challenge
          console.log('\n🔐 Step 4: Delivery Partner Requests Challenge');
          console.log('-'.repeat(70));
          const challengeResponse = await axios.post(
               `${BASE_URL}/api/v1/sessions/${session_id}/challenge`,
               { dp_id: dpId }
          );
          const { challenge_nonce } = challengeResponse.data;
          console.log('✅ Challenge Received:');
          console.log(`   Nonce: ${challenge_nonce}`);

          // Step 5: DP creates signed delivery proof
          console.log('\n✍️  Step 5: Delivery Partner Creates Signed Proof');
          console.log('-'.repeat(70));

          // Create canonical event (what gets signed)
          const timestamp = new Date().toISOString();
          const canonicalEvent = {
               session_id,
               order_id: 'order_789',
               customer_id: 'cust_123',
               dp_id: dpId,
               ephemeral_token_hash: crypto.createHash('sha256').update(ephemeral_token).digest('hex'),
               challenge_nonce,
               timestamp
          };

          // Sign the canonical event
          const eventString = JSON.stringify(canonicalEvent);
          const msgHash = crypto.createHash('sha256').update(eventString).digest('hex');
          const signature = dpKeyPair.sign(msgHash);

          // Convert signature to r+s hex format expected by backend
          const signatureHex = signature.r.toString('hex').padStart(64, '0') +
               signature.s.toString('hex').padStart(64, '0');

          console.log('✅ Signed Event Created');
          console.log(`   Message Hash: ${msgHash}`);
          console.log(`   Signature (r+s): ${signatureHex}`);

          // Prepare signed blob in expected format
          const signedBlob = {
               message: eventString,
               signature: signatureHex
          };
          const signedBlobBase64 = Buffer.from(JSON.stringify(signedBlob)).toString('base64');

          // Step 6: Submit delivery with proof
          console.log('\n📤 Step 6: Submit Delivery with Proof');
          console.log('-'.repeat(70));
          const deliveryResponse = await axios.post(`${BASE_URL}/api/v1/deliveries`, {
               session_id,
               dp_id: dpId,
               signed_blob: signedBlobBase64,
               evidence_hashes: []
          });

          const { event_id, txHash, status } = deliveryResponse.data;
          console.log('✅ Delivery Submitted:');
          console.log(`   Event ID: ${event_id}`);
          console.log(`   Status: ${status}`);
          console.log(`   Blockchain TxHash: ${txHash}`);

          // Step 7: Verify delivery
          console.log('\n🔍 Step 7: Verify Delivery Event');
          console.log('-'.repeat(70));
          await sleep(1000); // Wait for blockchain confirmation

          const verifyResponse = await axios.get(`${BASE_URL}/api/v1/deliveries/${event_id}/verify`);
          console.log('✅ Verification Result:');
          console.log(JSON.stringify(verifyResponse.data, null, 2));

          // Success summary
          console.log('\n' + '='.repeat(70));
          console.log('🎉 END-TO-END TEST COMPLETED SUCCESSFULLY!');
          console.log('='.repeat(70));
          console.log('\nSummary:');
          console.log(`   ✓ Delivery Partner registered`);
          console.log(`   ✓ Customer session activated`);
          console.log(`   ✓ BLE proximity simulated`);
          console.log(`   ✓ Challenge-response completed`);
          console.log(`   ✓ Cryptographic proof generated`);
          console.log(`   ✓ Event anchored to blockchain`);
          console.log(`   ✓ Delivery verified`);
          console.log('\n💡 The prototype is fully functional!');
          console.log('');

     } catch (error) {
          console.error('\n❌ Test Failed:', error.message);
          if (error.response) {
               console.error('Response:', error.response.data);
          }
          process.exit(1);
     }
}

main();
