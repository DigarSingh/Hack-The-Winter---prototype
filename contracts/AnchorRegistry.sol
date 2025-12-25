// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AnchorRegistry
 * @notice Stores tamper-proof hashes of delivery events on-chain for audit and verification
 * @dev Only emits events to minimize gas costs; actual event data stored off-chain
 */
contract AnchorRegistry {
    
    // Event emitted when a delivery event hash is anchored
    event AnchorStored(
        bytes32 indexed anchorHash,
        address indexed actor,
        uint256 timestamp,
        string eventId
    );

    // Mapping to prevent duplicate anchors (optional protection)
    mapping(bytes32 => bool) public anchored;

    /**
     * @notice Store a hash of a delivery event on-chain
     * @param anchorHash SHA256 hash of the canonical event JSON
     * @param eventId Backend event identifier for cross-reference
     */
    function storeAnchor(bytes32 anchorHash, string memory eventId) external {
        require(!anchored[anchorHash], "Anchor already exists");
        
        anchored[anchorHash] = true;
        
        emit AnchorStored(
            anchorHash,
            msg.sender,
            block.timestamp,
            eventId
        );
    }

    /**
     * @notice Batch store multiple anchors in a single transaction (gas optimization)
     * @param anchorHashes Array of SHA256 hashes
     * @param eventIds Array of event identifiers
     */
    function storeAnchorBatch(
        bytes32[] memory anchorHashes,
        string[] memory eventIds
    ) external {
        require(
            anchorHashes.length == eventIds.length,
            "Array length mismatch"
        );
        
        for (uint256 i = 0; i < anchorHashes.length; i++) {
            if (!anchored[anchorHashes[i]]) {
                anchored[anchorHashes[i]] = true;
                emit AnchorStored(
                    anchorHashes[i],
                    msg.sender,
                    block.timestamp,
                    eventIds[i]
                );
            }
        }
    }

    /**
     * @notice Check if an anchor has been stored
     * @param anchorHash The hash to check
     * @return bool True if anchor exists
     */
    function isAnchored(bytes32 anchorHash) external view returns (bool) {
        return anchored[anchorHash];
    }
}
