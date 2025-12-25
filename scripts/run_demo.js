#!/usr/bin/env node

/**
 * Automated demo script for proximity-verified delivery prototype
 * Runs the complete flow: blockchain start, contract deployment, backend start, and test deliveries
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function runCommand(command, args, cwd, label) {
     return new Promise((resolve, reject) => {
          console.log(`\n${'='.repeat(60)}`);
          console.log(`🔧 ${label}`);
          console.log(`${'='.repeat(60)}`);
          console.log(`Command: ${command} ${args.join(' ')}`);
          console.log(`Directory: ${cwd}`);
          console.log('');

          const proc = spawn(command, args, {
               cwd,
               stdio: 'inherit',
               shell: true
          });

          proc.on('close', (code) => {
               if (code === 0) {
                    resolve();
               } else {
                    reject(new Error(`${label} failed with code ${code}`));
               }
          });

          proc.on('error', reject);
     });
}

function runBackground(command, args, cwd, label) {
     console.log(`\n${'='.repeat(60)}`);
     console.log(`🚀 ${label} (background)`);
     console.log(`${'='.repeat(60)}`);
     console.log(`Command: ${command} ${args.join(' ')}`);
     console.log(`Directory: ${cwd}`);
     console.log('');

     const proc = spawn(command, args, {
          cwd,
          stdio: 'pipe',
          shell: true
     });

     proc.stdout.on('data', (data) => {
          const output = data.toString();
          if (output.trim()) {
               console.log(`[${label}] ${output.trim()}`);
          }
     });

     proc.stderr.on('data', (data) => {
          const output = data.toString();
          if (output.trim()) {
               console.error(`[${label} ERROR] ${output.trim()}`);
          }
     });

     return proc;
}

async function checkHealth(maxAttempts = 30) {
     for (let i = 0; i < maxAttempts; i++) {
          try {
               await new Promise((resolve, reject) => {
                    const req = http.get('http://localhost:3000/health', (res) => {
                         if (res.statusCode === 200) {
                              resolve();
                         } else {
                              reject(new Error(`Health check returned ${res.statusCode}`));
                         }
                    });
                    req.on('error', reject);
                    req.setTimeout(2000);
               });
               console.log('✅ Backend is healthy and ready!');
               return true;
          } catch (error) {
               if (i < maxAttempts - 1) {
                    process.stdout.write('.');
                    await sleep(1000);
               }
          }
     }
     throw new Error('Backend health check failed');
}

async function main() {
     const projectRoot = path.join(__dirname, '..');

     console.log('');
     console.log('╔════════════════════════════════════════════════════════════╗');
     console.log('║   Proximity-Verified Delivery Prototype - Demo Runner     ║');
     console.log('╚════════════════════════════════════════════════════════════╝');
     console.log('');

     let blockchainProc = null;
     let backendProc = null;

     try {
          // Step 1: Install dependencies
          console.log('\n📦 Step 1: Installing dependencies...\n');
          await runCommand('npm', ['run', 'install-all'], projectRoot, 'Install All Dependencies');

          // Step 2: Start blockchain
          console.log('\n⛓️  Step 2: Starting local blockchain...\n');
          blockchainProc = runBackground('npx', ['hardhat', 'node'], path.join(projectRoot, 'contracts'), 'Blockchain');
          console.log('⏳ Waiting for blockchain to start...');
          await sleep(5000);

          // Step 3: Deploy contract
          console.log('\n📜 Step 3: Deploying smart contract...\n');
          await runCommand('npm', ['run', 'deploy'], path.join(projectRoot, 'contracts'), 'Deploy Contract');

          // Step 4: Start backend
          console.log('\n🖥️  Step 4: Starting backend server...\n');
          backendProc = runBackground('npm', ['start'], path.join(projectRoot, 'backend'), 'Backend');
          console.log('⏳ Waiting for backend to start');
          await checkHealth();

          // Step 5: Run test scenarios
          console.log('\n');
          console.log('╔════════════════════════════════════════════════════════════╗');
          console.log('║             Running Test Delivery Scenarios                ║');
          console.log('╚════════════════════════════════════════════════════════════╝');
          console.log('');

          // Scenario 1: Successful delivery
          console.log('\n📋 Scenario 1: Successful Delivery\n');
          const customerResult = await new Promise((resolve, reject) => {
               const proc = spawn('node', ['simulate_customer_activate.js', '--customer=cus_alice', '--order=ord_12345'], {
                    cwd: path.join(projectRoot, 'sim'),
                    shell: true
               });

               let output = '';
               proc.stdout.on('data', (data) => {
                    const text = data.toString();
                    output += text;
                    console.log(text.trimEnd());
               });

               proc.on('close', (code) => {
                    if (code === 0) {
                         // Extract session_id and token from output
                         const sessionMatch = output.match(/SESSION_ID="([^"]+)"/);
                         const tokenMatch = output.match(/TOKEN="([^"]+)"/);
                         if (sessionMatch && tokenMatch) {
                              resolve({ session_id: sessionMatch[1], token: tokenMatch[1] });
                         } else {
                              reject(new Error('Could not parse session details'));
                         }
                    } else {
                         reject(new Error('Customer activation failed'));
                    }
               });
          });

          await sleep(2000);

          await runCommand(
               'node',
               ['simulate_dp_submit.js', `--session=${customerResult.session_id}`, `--token=${customerResult.token}`, '--dp=dp_bob'],
               path.join(projectRoot, 'sim'),
               'DP Submit Delivery Proof'
          );

          console.log('\n');
          console.log('╔════════════════════════════════════════════════════════════╗');
          console.log('║                    🎉 DEMO COMPLETE! 🎉                    ║');
          console.log('╚════════════════════════════════════════════════════════════╝');
          console.log('');
          console.log('✅ Successfully demonstrated:');
          console.log('   • Customer session activation');
          console.log('   • Ephemeral token generation');
          console.log('   • Challenge-response authentication');
          console.log('   • Cryptographic signature verification');
          console.log('   • Blockchain anchoring of delivery proof');
          console.log('');
          console.log('📝 Components still running:');
          console.log('   • Blockchain:  http://127.0.0.1:8545');
          console.log('   • Backend API: http://localhost:3000');
          console.log('');
          console.log('🔍 Try these manual tests:');
          console.log('   • Create another session: cd sim && node simulate_customer_activate.js');
          console.log('   • Check health: curl http://localhost:3000/health');
          console.log('   • View database: sqlite3 backend/proximity_pod.db "SELECT * FROM delivery_events;"');
          console.log('');
          console.log('Press Ctrl+C to stop all services');
          console.log('');

          // Keep processes running
          await new Promise(() => { }); // Wait forever until Ctrl+C

     } catch (error) {
          console.error('\n❌ Demo failed:', error.message);
          console.error(error.stack);
          process.exit(1);
     } finally {
          // Cleanup happens in process.on('SIGINT') below
     }

     // Cleanup function
     function cleanup() {
          console.log('\n\n🛑 Shutting down services...');
          if (backendProc) {
               console.log('   Stopping backend...');
               backendProc.kill('SIGTERM');
          }
          if (blockchainProc) {
               console.log('   Stopping blockchain...');
               blockchainProc.kill('SIGTERM');
          }
          console.log('✅ Cleanup complete');
          process.exit(0);
     }

     process.on('SIGINT', cleanup);
     process.on('SIGTERM', cleanup);
}

main().catch((error) => {
     console.error('Fatal error:', error);
     process.exit(1);
});
