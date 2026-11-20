// Browser wallet connection only. No private keys or seed phrases are handled by this app.
const ethersModuleUrl = 'https://cdn.jsdelivr.net/npm/ethers@6.17.0/+esm';
const NETWORKS = {
  avalancheFuji: {
    key: 'avalancheFuji', name: 'Avalanche Fuji C-Chain', label: 'AVALANCHE C-CHAIN · FUJI TESTNET',
    chainId: '0xa869', chainIdNumber: 43113, rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, explorer: 'https://explorer-test.avax.network/c-chain',
  },
  bnbTestnet: {
    key: 'bnbTestnet', name: 'BNB Smart Chain Testnet', label: 'BNB SMART CHAIN · TESTNET',
    chainId: '0x61', chainIdNumber: 97, rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    nativeCurrency: { name: 'Test BNB', symbol: 'tBNB', decimals: 18 }, explorer: 'https://testnet.bscscan.com',
  },
};
const ABI = [
  'function isAnchored(bytes32 commitment) view returns (bool)',
  'function getAnchorCount() view returns (uint256)',
  'function getAnchor(uint256 sequence) view returns ((bytes32 commitment,uint8 recordKind,uint64 anchoredAt,address submittedBy))',
  'function anchorBatch(bytes32[] commitments,uint8[] recordKinds)',
];
const $ = (selector) => document.querySelector(selector);
const status = $('#avalancheStatus');
const badge = $('#avalancheBadge');
const walletLabel = $('#walletAddress');
const anchorButton = $('#anchorRecordsBtn');
const contractInput = $('#contractAddressInput');
let ethersLib, readProvider, walletProvider, signer, account, readContract, writeContract;
let localRecords = [];
let refreshing = false;
let activeNetwork = NETWORKS.avalancheFuji;
const networkSelect = $('#blockchainNetwork');

function message(text) {
  status.textContent = text;
}
function shorten(value) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
function loadProofs() {
  try { return JSON.parse(localStorage.getItem(`pathlight.${activeNetwork.key}.proofs.v1`) || '{}'); }
  catch { return {}; }
}
function saveProofs(proofs) {
  localStorage.setItem(`pathlight.${activeNetwork.key}.proofs.v1`, JSON.stringify(proofs));
}
function addressStorageKey() {
  return `pathlight.${activeNetwork.key}.contract.v1`;
}
function recordKind(type) {
  if (type === 'route_generated') return 1;
  if (type === 'obstacle_detected') return 2;
  if (type === 'therapist_review') return 3;
  return 4;
}
function kindLabel(kind) {
  return ({ 1: 'Route event', 2: 'Obstacle event', 3: 'Therapist review', 4: 'Other event' })[Number(kind)] || 'Record';
}
function addEmpty(text) {
  const node = document.createElement('div');
  node.className = 'empty-ledger';
  node.textContent = text;
  return node;
}
function renderAnchors(anchors) {
  const list = $('#avalancheLedgerList');
  list.replaceChildren();
  if (!anchors.length) {
    list.append(addEmpty(`No records have been anchored to this ${activeNetwork.name} contract yet.`));
    return;
  }
  const proofs = loadProofs();
  const localCommitments = new Set(Object.values(proofs).map(proof => proof.commitment?.toLowerCase()).filter(Boolean));
  for (const anchor of anchors.reverse()) {
    const entry = document.createElement('div');
    entry.className = 'ledger-entry';
    const num = document.createElement('span');
    num.className = 'ledger-num';
    num.textContent = String(anchor.sequence + 1).padStart(2, '0');
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = kindLabel(anchor.recordKind);
    const detail = document.createElement('small');
    const verified = localCommitments.has(anchor.commitment.toLowerCase());
    detail.textContent = `${new Date(Number(anchor.anchoredAt) * 1000).toLocaleString()} · ${verified ? 'matches a local record' : 'commitment only'} · ${shorten(anchor.submittedBy)}`;
    const commitment = document.createElement('span');
    commitment.className = 'ledger-hash';
    commitment.textContent = `${anchor.commitment.slice(0, 14)}…`;
    content.append(title, detail);
    entry.append(num, content, commitment);
    list.append(entry);
  }
}

function updateWriteState() {
  const ready = Boolean(signer && writeContract);
  anchorButton.disabled = !ready || !localRecords.length;
}

async function init() {
  try {
    const imported = await import(ethersModuleUrl);
    ethersLib = imported.ethers || imported;
    await selectNetwork(networkSelect.value || 'avalancheFuji');
    if (!window.ethereum) {
      message('Read-only chain access is available. Connect a compatible browser wallet to submit anchors.');
    }
  } catch (error) {
    badge.textContent = 'LIBRARY UNAVAILABLE';
    message(`Could not load the blockchain client library: ${error.message || 'check your internet connection.'}`);
  }
  updateWriteState();
}

async function selectNetwork(networkKey) {
  activeNetwork = NETWORKS[networkKey] || NETWORKS.avalancheFuji;
  networkSelect.value = activeNetwork.key;
  $('#blockchainNetworkLabel').textContent = activeNetwork.label;
  $('#contractAddressLabel').textContent = `Pathlight ledger contract address on ${activeNetwork.name}`;
  contractInput.value = localStorage.getItem(addressStorageKey()) || '';
  readProvider = new ethersLib.JsonRpcProvider(activeNetwork.rpcUrl, activeNetwork.chainIdNumber, { staticNetwork: true });
  readContract = null;
  writeContract = null;
  signer = null;
  account = null;
  walletLabel.textContent = 'Wallet not connected';
  badge.textContent = activeNetwork.name.toUpperCase();
  $('#avalancheLedgerList').replaceChildren(addEmpty(`Connect a deployed ${activeNetwork.name} contract to view its anchors.`));
  $('#avalancheRecordCount').textContent = '0 ANCHORED';
  message(`Selected ${activeNetwork.name}.`);
  const savedAddress = contractInput.value.trim();
  if (savedAddress && ethersLib.isAddress(savedAddress)) await connectContract(savedAddress, false);
  updateWriteState();
}

async function connectWallet() {
  if (!ethersLib) throw new Error('Blockchain client library is not ready. Refresh while connected to the internet.');
  if (!window.ethereum) throw new Error('No browser wallet was detected. Open Pathlight in a Core, MetaMask or Trust Wallet browser, or use a desktop browser with a compatible wallet extension enabled.');
  message('Requesting wallet connection… approve the connection in your wallet.');
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
  if (currentChain.toLowerCase() !== activeNetwork.chainId) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: activeNetwork.chainId }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: activeNetwork.chainId, chainName: activeNetwork.name, rpcUrls: [activeNetwork.rpcUrl], nativeCurrency: activeNetwork.nativeCurrency, blockExplorerUrls: [activeNetwork.explorer] }] });
    }
  }
  walletProvider = new ethersLib.BrowserProvider(window.ethereum);
  signer = await walletProvider.getSigner();
  account = await signer.getAddress();
  walletLabel.textContent = `Connected: ${shorten(account)} · ${activeNetwork.name}`;
  message(`Wallet connected to ${activeNetwork.name}.`);
  if (readContract) writeContract = readContract.connect(signer);
  updateWriteState();
  if (readContract) await refreshAnchors();
}

async function connectContract(address, persist = true) {
  if (!ethersLib) throw new Error('Blockchain client library is not ready.');
  if (!ethersLib.isAddress(address)) throw new Error('Enter a valid deployed contract address.');
  const candidate = new ethersLib.Contract(address, ABI, readProvider);
  await candidate.getAnchorCount();
  readContract = candidate;
  writeContract = signer ? candidate.connect(signer) : null;
  if (persist) localStorage.setItem(addressStorageKey(), address);
  message(signer ? 'Contract connected. Ready to anchor records.' : 'Contract connected for read-only viewing. Connect a wallet to anchor records.');
  await refreshAnchors();
  updateWriteState();
}

async function proofFor(record, proofs) {
  if (!/^([a-f0-9]{64})$/i.test(record.hash || '')) throw new Error(`Local record ${record.index + 1} has an invalid SHA-256 hash.`);
  const recordHash = `0x${record.hash}`;
  let proof = proofs[record.hash];
  if (!proof) {
    const salt = ethersLib.hexlify(ethersLib.randomBytes(32));
    const commitment = ethersLib.solidityPackedKeccak256(['bytes32', 'bytes32'], [recordHash, salt]);
    proof = { salt, commitment };
    proofs[record.hash] = proof;
  }
  const expected = ethersLib.solidityPackedKeccak256(['bytes32', 'bytes32'], [recordHash, proof.salt]);
  if (expected.toLowerCase() !== proof.commitment.toLowerCase()) throw new Error(`Privacy proof for local record ${record.index + 1} does not match.`);
  return proof;
}

async function refreshAnchors() {
  if (!readContract || refreshing) return;
  refreshing = true;
  try {
    const count = Number(await readContract.getAnchorCount());
    $('#avalancheRecordCount').textContent = `${count} ANCHORED`;
    const start = Math.max(0, count - 8);
    const anchors = await Promise.all(Array.from({ length: count - start }, async (_, offset) => {
      const sequence = start + offset;
      const item = await readContract.getAnchor(sequence);
      return { sequence, commitment: item.commitment, recordKind: item.recordKind, anchoredAt: item.anchoredAt, submittedBy: item.submittedBy };
    }));
    renderAnchors(anchors);
    updateWriteState();
  } catch (error) {
    message(`Could not read the selected chain contract: ${error.shortMessage || error.message}`);
  } finally {
    refreshing = false;
  }
}

async function anchorUnanchoredRecords() {
  if (!writeContract || !signer) throw new Error('Connect a wallet and the ledger contract first.');
  if (!localRecords.length) throw new Error('There are no local ledger records to anchor yet.');
  const proofs = loadProofs();
  const pending = [];
  for (const record of localRecords) {
    const proof = await proofFor(record, proofs);
    const alreadyAnchored = await readContract.isAnchored(proof.commitment);
    if (!alreadyAnchored) pending.push({ commitment: proof.commitment, kind: recordKind(record.type) });
  }
  if (!pending.length) {
    saveProofs(proofs);
    message('All current local records already have anchors on the selected test network.');
    return;
  }
  saveProofs(proofs);
  const groups = [];
  for (let i = 0; i < pending.length; i += 40) groups.push(pending.slice(i, i + 40));
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    message(`Review transaction ${i + 1} of ${groups.length} in your wallet (${group.length} commitments).`);
    const transaction = await writeContract.anchorBatch(group.map(item => item.commitment), group.map(item => item.kind));
    message(`Transaction sent: ${shorten(transaction.hash)}. Waiting for network confirmation…`);
    await transaction.wait();
  }
  message(`Anchored ${pending.length} salted record commitments on ${activeNetwork.name}.`);
  await refreshAnchors();
}

$('#connectAvalancheBtn').addEventListener('click', async () => {
  try { await connectWallet(); }
  catch (error) { message(error.shortMessage || error.message || 'Wallet connection failed.'); }
});
networkSelect.addEventListener('change', async () => {
  try { await selectNetwork(networkSelect.value); }
  catch (error) { message(error.shortMessage || error.message || 'Could not connect to that test network.'); }
});
$('#saveContractBtn').addEventListener('click', async () => {
  try { await connectContract(contractInput.value.trim()); }
  catch (error) { message(error.shortMessage || error.message || 'Could not connect that contract.'); }
});
$('#exportProofBtn').addEventListener('click', () => {
  const proofs = loadProofs();
  if (!Object.keys(proofs).length) { message('No privacy proofs exist yet. Anchor a local record first.'); return; }
  const backup = { network: activeNetwork.name, chainId: activeNetwork.chainIdNumber, contractAddress: contractInput.value.trim() || null, format: 'Pathlight salted commitment proofs v1', proofs };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `pathlight-${activeNetwork.key}-proof-backup.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('Privacy-proof backup downloaded. Store it safely with your local ledger backup.');
});
anchorButton.addEventListener('click', async () => {
  anchorButton.disabled = true;
  try { await anchorUnanchoredRecords(); }
  catch (error) { message(error.shortMessage || error.message || 'Anchoring was cancelled or failed.'); }
  finally { updateWriteState(); }
});
window.refreshAvalancheLedger = (records) => {
  localRecords = Array.isArray(records) ? records : [];
  updateWriteState();
};

if (window.ethereum?.on) {
  window.ethereum.on('chainChanged', () => {
    signer = null; writeContract = null; account = null;
    walletLabel.textContent = `Wallet network changed · reconnect to ${activeNetwork.name}`;
    updateWriteState();
  });
  window.ethereum.on('accountsChanged', (accounts) => {
    signer = null; writeContract = null; account = accounts?.[0] || null;
    walletLabel.textContent = account ? 'Wallet account changed · reconnect' : 'Wallet disconnected';
    updateWriteState();
  });
}
init();
