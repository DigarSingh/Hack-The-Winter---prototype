# Proximity-Verified Delivery Prototype - Setup & Testing Guide

## Current Status

The prototype is **fully implemented and tested**. All components are working:
- ✓ Smart contract deployed on local blockchain
- ✓ Backend API with session management, challenge-response, and signature verification
- ✓ Blockchain anchoring of delivery events
- ✓ End-to-end cryptographic proof-of-delivery flow
- ✓ CLI simulation tools

## Project Structure

```
proximity_verified_delivery_prototype/
├── contracts/                    # Smart contract & blockchain
│   ├── contracts/
│   │   └── AnchorRegistry.sol   # Solidity contract for anchoring
│   ├── scripts/
│   │   └── deploy.js            # Deployment script
│   ├── hardhat.config.js        # Hardhat configuration
│   ├── deployment.json          # Contract address (after deployment)
│   └── package.json
│
├── backend/                      # REST API server
│   ├── server.js                # Express API server
│   ├── db.js                    # SQLite database layer
│   ├── delivery.db              # SQLite database (created on first run)
│   └── package.json
│
├── sim/                          # CLI simulation tools
│   ├── simulate_customer_activate.js
│   ├── simulate_dp_submit.js
│   └── package.json
│
└── scripts/                      # Testing & demo scripts
    ├── test_e2e.js              # End-to-end test (recommended)
    ├── run_demo.js              # Full automated demo
    └── start_all.bat/sh         # Convenience startup scripts

```

## Quick Start (3 Terminals Required)

### Terminal 1: Start Blockchain Node

```powershell
cd contracts
npx hardhat node
```

Keep this running. You'll see 20 test accounts with 10000 ETH each.

### Terminal 2: Deploy Contract & Start Backend

```powershell
# Deploy contract (one-time, or when you restart Hardhat node)
cd contracts
npm run deploy

# Start backend server
cd ../backend
node server.js
```

You should see:
```
 Blockchain initialized. Contract at: 0x5FbDB...
 Proximity-Verified Delivery Backend
 Server running on http://localhost:3000
```

### Terminal 3: Run End-to-End Test

```powershell
cd proximity_verified_delivery_prototype
node scripts/test_e2e.js
```

Expected output:
```
 Proximity-Verified Delivery - End-to-End Test
======================================================================

 Step 1: Register Delivery Partner
 DP Registered

 Step 2: Customer Activates Delivery Session
 Session Created

 Step 3: Delivery Partner Scans BLE (Simulated)
 Scanned ephemeral token

 Step 4: Delivery Partner Requests Challenge
 Challenge Received

 Step 5: Delivery Partner Creates Signed Proof
 Signed Event Created

 Step 6: Submit Delivery with Proof
 Delivery Submitted
   Event ID: evt_...
   Status: verified
   Blockchain TxHash: 0x...

 Step 7: Verify Delivery Event
 Verification Result

 END-TO-END TEST COMPLETED SUCCESSFULLY!
```

## Alternative: One-Command Test (PowerShell)

If you want to run everything in one command (starts server, runs test, stops server):

```powershell
$job = Start-Job -ScriptBlock { Set-Location 'd:\proximity_verified_delivery_prototype\backend'; node server.js }
Start-Sleep -Seconds 3
cd d:\proximity_verified_delivery_prototype
node scripts/test_e2e.js
Stop-Job $job
```

**Note:** Hardhat node must still be running in a separate terminal.

## API Endpoints

The backend exposes the following REST API:

### 1. Register Delivery Partner
```http
POST /api/v1/dp/register
Content-Type: application/json

{
  "dp_id": "dp_001",
  "public_key": "04abc123...",
  "name": "Delivery Partner Name"
}
```

### 2. Activate Session (Customer)
```http
POST /api/v1/sessions
Content-Type: application/json

{
  "customer_id": "cust_123",
  "order_id": "order_789",
  "ttl_seconds": 300
}
```

Response:
```json
{
  "session_id": "s_...",
  "ephemeral_token": "abc123...",
  "token_type": "BLE",
  "expires_at": "2025-12-25T..."
}
```

### 3. Request Challenge (Delivery Partner)
```http
POST /api/v1/sessions/:session_id/challenge
Content-Type: application/json

{
  "dp_id": "dp_001"
}
```

### 4. Submit Delivery Proof
```http
POST /api/v1/deliveries
Content-Type: application/json

{
  "session_id": "s_...",
  "dp_id": "dp_001",
  "signed_blob": "base64(...)",
  "evidence_hashes": []
}
```

### 5. Verify Delivery
```http
GET /api/v1/deliveries/:event_id/verify
```

### 6. Health Check
```http
GET /health
```

## How It Works

### 1. **Session Activation**
Customer activates a time-limited delivery session via mobile app. Backend generates an ephemeral token that would be broadcast via BLE.

### 2. **Proximity Detection (Simulated)**
In production: DP app scans for BLE peripheral and discovers ephemeral token only when physically close.  
In prototype: CLI simulation passes the token directly.

### 3. **Challenge-Response**
- DP requests a challenge nonce from backend
- DP creates a canonical event JSON including:
  - Session ID
  - Order ID
  - Customer ID
  - DP ID
  - Hash of ephemeral token
  - Challenge nonce
  - Timestamp

### 4. **Cryptographic Signing**
- DP signs the canonical event with their ECDSA private key (secp256k1)
- Signature proves:
  - DP possessed the ephemeral token (proximity)
  - DP has the registered private key (identity)
  - Challenge nonce prevents replay attacks

### 5. **Backend Verification**
- Verifies DP signature using registered public key
- Validates session is active and challenge is fresh
- Stores event in database

### 6. **Blockchain Anchoring**
- Backend computes SHA256 hash of entire event
- Calls `storeAnchor()` on smart contract
- Anchor hash is permanently recorded on-chain with timestamp
- Transaction hash returned to DP as proof

### 7. **Verification**
Anyone can verify a delivery by:
- Retrieving event data from backend
- Recomputing the anchor hash
- Checking blockchain for matching anchor event
- Verifying DP signature

## Database Schema

The backend uses SQLite with the following tables:

### `delivery_partners`
Stores registered DP public keys for signature verification.

### `sessions`
Tracks active delivery sessions with ephemeral tokens and expiry.

### `challenges`
Stores challenge nonces with session association and usage tracking.

### `delivery_events`
Complete delivery records with signatures, timestamps, and blockchain anchors.

## Smart Contract

[contracts/contracts/AnchorRegistry.sol](contracts/contracts/AnchorRegistry.sol)

Simple, gas-efficient contract that emits events containing:
- `bytes32 anchorHash` - SHA256 hash of delivery event
- `address actor` - Address that submitted the anchor
- `uint256 timestamp` - Block timestamp
- `string eventId` - Backend event identifier for cross-reference

The contract also maintains a mapping to prevent duplicate anchors.

## Manual Testing with CLI Simulators

### Activate a Session
```powershell
cd sim
node simulate_customer_activate.js --customer cust_456 --order order_999
```

### Submit a Delivery
```powershell
cd sim
node simulate_dp_submit.js --session <session_id> --token <ephemeral_token>
```

## Viewing Blockchain Transactions

While Hardhat node is running, you'll see transaction logs in Terminal 1:

```
eth_sendTransaction
Contract call:       AnchorRegistry#storeAnchor
Transaction:         0x...
From:                0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
To:                  0x5fbdb2315678afecb367f032d93f642f64180aa3
Gas used:            49000
```

## Troubleshooting

### Contract deployment fails
- Ensure Hardhat node is running on port 8545
- Restart Hardhat node if needed: `Ctrl+C` then `npx hardhat node`

### Backend can't connect to blockchain
- Check `contracts/deployment.json` exists with contract address
- Verify Hardhat node is running
- Restart backend: `node server.js`

### Signature verification fails
- Ensure DP is registered first
- Check that signature format is correct (r+s hex concatenation)
- Verify canonical event structure matches backend expectations

### Session expired
- Sessions have 5-minute TTL by default
- Create a new session if expired

## What's Implemented

**Core Functionality**
- Session activation with ephemeral tokens
- Challenge-response authentication
- ECDSA signature generation and verification (secp256k1)
- SQLite database for session/event storage
- Blockchain anchoring via smart contract
- Event hash verification
- Complete REST API

**Security Features**
- Ephemeral tokens with TTL
- Challenge nonces to prevent replay
- Cryptographic signatures for non-repudiation
- Tamper-evident blockchain anchoring
- Duplicate anchor prevention

**Developer Experience**
- CLI simulation tools (no BLE hardware required)
- Automated end-to-end testing
- Clear API documentation
- Comprehensive error handling

## Not Implemented (Future Enhancements)

See [Section 12](proximity_verified_delivery_prototype_readme.md#12-what-well-add--improve-in-round-2) of the main README for Round 2 improvements:
- Real BLE peripheral/scanner (React Native apps)
- UWB support for centimeter accuracy
- Merkle tree batching for gas optimization
- Zero-knowledge proofs for privacy
- Hardware-backed key storage
- IPFS for evidence storage
- LLM-assisted anomaly detection
- Production-grade database (PostgreSQL)
- Deployment to testnet/mainnet

## Additional Resources

- Main design document: [proximity_verified_delivery_prototype_readme.md](proximity_verified_delivery_prototype_readme.md)
- Smart contract: [contracts/contracts/AnchorRegistry.sol](contracts/contracts/AnchorRegistry.sol)
- Backend API: [backend/server.js](backend/server.js)
- Database layer: [backend/db.js](backend/db.js)

## Success Criteria

The prototype demonstrates:

1. **Doorstep-level assurance**: Ephemeral tokens simulate BLE proximity
2. **Customer participation**: Explicit session activation
3. **Cryptographic proof**: ECDSA signatures verify DP identity and proximity
4. **Tamper resistance**: Blockchain anchoring prevents log manipulation
5. **Privacy**: Only hashes stored on-chain
6. **Auditability**: Complete verification flow from event to blockchain

## Conclusion

This prototype successfully demonstrates a privacy-first, blockchain-anchored proof-of-delivery system with proximity verification. All core components are functional and tested. The system is ready for:

- Demo presentations
- Security audits
- Round 2 enhancements
- Integration with mobile apps
- Deployment to testnets

**The proximity-verified delivery prototype is complete and working!** 
