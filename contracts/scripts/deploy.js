const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
     console.log("Deploying AnchorRegistry contract...");

     const AnchorRegistry = await hre.ethers.getContractFactory("AnchorRegistry");
     const anchorRegistry = await AnchorRegistry.deploy();

     await anchorRegistry.waitForDeployment();

     const address = await anchorRegistry.getAddress();
     console.log(`AnchorRegistry deployed to: ${address}`);

     // Save deployment info for backend to use
     const deploymentInfo = {
          contractAddress: address,
          chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
          deployedAt: new Date().toISOString()
     };

     const deploymentPath = path.join(__dirname, "../deployment.json");
     fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
     console.log(`Deployment info saved to: ${deploymentPath}`);

     // Verify contract is working
     console.log("\nTesting contract...");
     const testHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("test"));
     const tx = await anchorRegistry.storeAnchor(testHash, "test_event_001");
     await tx.wait();
     console.log("Test anchor stored successfully!");

     const isAnchored = await anchorRegistry.isAnchored(testHash);
     console.log(`Test anchor verification: ${isAnchored}`);
}

main()
     .then(() => process.exit(0))
     .catch((error) => {
          console.error(error);
          process.exit(1);
     });
