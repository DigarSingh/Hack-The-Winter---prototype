#!/usr/bin/env node

const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

function makeRequest(method, path, data = null) {
     return new Promise((resolve, reject) => {
          const url = new URL(path, API_BASE);
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

async function main() {
     const args = process.argv.slice(2);

     // Parse arguments
     const customer_id = args.find(arg => arg.startsWith('--customer='))?.split('=')[1] || 'cus_' + Date.now();
     const order_id = args.find(arg => arg.startsWith('--order='))?.split('=')[1] || 'ord_' + Date.now();
     const ttl = parseInt(args.find(arg => arg.startsWith('--ttl='))?.split('=')[1] || '300');

     console.log('');
     console.log('🛒 Customer Activating Delivery Session');
     console.log('=====================================');
     console.log(`Customer ID: ${customer_id}`);
     console.log(`Order ID:    ${order_id}`);
     console.log(`TTL:         ${ttl} seconds`);
     console.log('');

     try {
          const response = await makeRequest('POST', '/api/v1/sessions', {
               customer_id,
               order_id,
               ttl_seconds: ttl
          });

          console.log('✅ Session created successfully!');
          console.log('');
          console.log('Session Details:');
          console.log('─────────────────────────────────────');
          console.log(`Session ID:       ${response.session_id}`);
          console.log(`Ephemeral Token:  ${response.ephemeral_token}`);
          console.log(`Token Type:       ${response.token_type}`);
          console.log(`Expires At:       ${response.expires_at}`);
          console.log('');
          console.log('📱 Customer app would now:');
          console.log('   1. Display this token via BLE peripheral mode');
          console.log('   2. Or show as QR code for delivery partner to scan');
          console.log('');
          console.log('💾 Save these values for DP simulation:');
          console.log('─────────────────────────────────────');
          console.log(`SESSION_ID="${response.session_id}"`);
          console.log(`TOKEN="${response.ephemeral_token}"`);
          console.log('');
          console.log('Next step: Run simulate_dp_submit.js with these values');
          console.log('');

     } catch (error) {
          console.error('❌ Error:', error.message);
          process.exit(1);
     }
}

main();
