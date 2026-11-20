// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Pathlight privacy-preserving record anchor ledger
/// @notice Stores salted commitments only. Never publish route, location, or clinical text here.
contract PathlightLedger {
    struct Anchor {
        bytes32 commitment;
        uint8 recordKind;
        uint64 anchoredAt;
        address submittedBy;
    }

    uint256 public constant MAX_BATCH = 40;
    Anchor[] private anchors;
    mapping(bytes32 => bool) public isAnchored;

    event RecordAnchored(
        bytes32 indexed commitment,
        uint8 indexed recordKind,
        uint256 indexed sequence,
        uint64 anchoredAt,
        address submittedBy
    );

    error InvalidBatch();
    error EmptyCommitment();
    error DuplicateCommitment(bytes32 commitment);

    function anchorBatch(bytes32[] calldata commitments, uint8[] calldata recordKinds) external {
        uint256 length = commitments.length;
        if (length == 0 || length > MAX_BATCH || length != recordKinds.length) revert InvalidBatch();

        uint64 anchoredAt = uint64(block.timestamp);
        for (uint256 i; i < length; ++i) {
            bytes32 commitment = commitments[i];
            if (commitment == bytes32(0)) revert EmptyCommitment();
            if (isAnchored[commitment]) revert DuplicateCommitment(commitment);

            isAnchored[commitment] = true;
            uint256 sequence = anchors.length;
            anchors.push(Anchor(commitment, recordKinds[i], anchoredAt, msg.sender));
            emit RecordAnchored(commitment, recordKinds[i], sequence, anchoredAt, msg.sender);
        }
    }

    function getAnchorCount() external view returns (uint256) {
        return anchors.length;
    }

    function getAnchor(uint256 sequence) external view returns (Anchor memory) {
        return anchors[sequence];
    }
}
