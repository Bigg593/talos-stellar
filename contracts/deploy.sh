#!/usr/bin/env bash
# ─── Talos Protocol — Soroban Contract Deploy ─────────────────────────────────
# Usage: ./deploy.sh [testnet|mainnet] [--source <key-name>] [--yes]
#
# Prerequisites:
#   1. Rust + wasm32 target: rustup target add wasm32-unknown-unknown
#   2. Stellar CLI: cargo install --locked stellar-cli --features opt
#   3. A funded Stellar keypair configured: stellar keys generate deployer --network testnet
#
# The script prints the four contract IDs you must add to .env.local:
#   NEXT_PUBLIC_TALOS_REGISTRY_CONTRACT=C...
#   NEXT_PUBLIC_TALOS_NAME_SERVICE_CONTRACT=C...
#   NEXT_PUBLIC_TALOS_GOVERNANCE_CONTRACT=C...
#   NEXT_PUBLIC_TALOS_DIVIDENDS_CONTRACT=C...
#
# Idempotency: contract IDs are cached under .deploy-ids/<network>/.
# Re-running skips already-deployed contracts and already-initialized
# contracts. Delete a file to force re-deployment:
#   rm .deploy-ids/testnet/registry_id

set -euo pipefail

NETWORK="${1:-testnet}"
SOURCE="deployer"      # default key name in stellar keys store
SKIP_CONFIRM=false

# ── Parse flags ───────────────────────────────────────────────────────────────
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE="$2"
      shift 2
      ;;
    --yes|-y)
      SKIP_CONFIRM=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./deploy.sh [testnet|mainnet] [--source <key-name>] [--yes]"
      exit 1
      ;;
  esac
done

# ── Mainnet guard ─────────────────────────────────────────────────────────────
if [[ "$NETWORK" == "mainnet" ]] && [[ "$SKIP_CONFIRM" == "false" ]]; then
  echo ""
  echo "⚠️  You are about to deploy to MAINNET."
  echo "   This will consume real XLM and cannot be undone."
  echo ""
  read -r -p "Type 'yes' to confirm mainnet deployment: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── Idempotency helpers ───────────────────────────────────────────────────────
ID_DIR=".deploy-ids/${NETWORK}"
mkdir -p "$ID_DIR"

load_or_deploy() {
  local name="$1"
  local wasm="$2"
  local id_file="${ID_DIR}/${name}_id"

  if [[ -f "$id_file" ]]; then
    local existing_id
    existing_id=$(cat "$id_file")
    echo "   ↩  ${name} already deployed: ${existing_id} (skipping re-deploy)" >&2
    echo "$existing_id"
    return
  fi

  local contract_id
  contract_id=$(stellar contract deploy \
    --wasm "$wasm" \
    --network "$NETWORK" \
    --source "$SOURCE")

  echo "$contract_id" > "$id_file"
  echo "$contract_id"
}

is_initialized() {
  local id_file="${ID_DIR}/${1}_initialized"
  [[ -f "$id_file" ]]
}

mark_initialized() {
  touch "${ID_DIR}/${1}_initialized"
}

# ── Build ─────────────────────────────────────────────────────────────────────
echo "▶  Building Soroban contracts (release)..."
cargo build --target wasm32-unknown-unknown --release 2>&1 | tail -5

REGISTRY_WASM="target/wasm32-unknown-unknown/release/talos_registry.wasm"
NAME_SERVICE_WASM="target/wasm32-unknown-unknown/release/talos_name_service.wasm"
GOVERNANCE_WASM="target/wasm32-unknown-unknown/release/talos_governance.wasm"
DIVIDENDS_WASM="target/wasm32-unknown-unknown/release/talos_dividends.wasm"

for wasm in "$REGISTRY_WASM" "$NAME_SERVICE_WASM" "$GOVERNANCE_WASM" "$DIVIDENDS_WASM"; do
  if [[ ! -f "$wasm" ]]; then
    echo "✗  Build failed — $wasm not found"
    exit 1
  fi
done

# ── Deploy TalosRegistry ──────────────────────────────────────────────────────
echo ""
echo "▶  Deploying TalosRegistry to $NETWORK..."
REGISTRY_ID=$(load_or_deploy "registry" "$REGISTRY_WASM")
echo "   TalosRegistry:    $REGISTRY_ID"

# ── Deploy TalosNameService ───────────────────────────────────────────────────
echo ""
echo "▶  Deploying TalosNameService to $NETWORK..."
NAME_SERVICE_ID=$(load_or_deploy "name_service" "$NAME_SERVICE_WASM")
echo "   TalosNameService: $NAME_SERVICE_ID"

if ! is_initialized "name_service"; then
  echo ""
  echo "▶  Initializing TalosNameService with TalosRegistry address..."
  stellar contract invoke \
    --id "$NAME_SERVICE_ID" \
    --network "$NETWORK" \
    --source "$SOURCE" \
    -- \
    initialize \
    --registry_id "$REGISTRY_ID"
  mark_initialized "name_service"
else
  echo "   ↩  TalosNameService already initialized (skipping)"
fi

# ── Deploy TalosGovernance ────────────────────────────────────────────────────
echo ""
echo "▶  Deploying TalosGovernance to $NETWORK..."
GOVERNANCE_ID=$(load_or_deploy "governance" "$GOVERNANCE_WASM")
echo "   TalosGovernance:  $GOVERNANCE_ID"

# TalosGovernance.initialize requires: admin, pulse_token_address,
# quorum_threshold, consensus_threshold, voting_period_ledgers.
# Set GOVERNANCE_ADMIN and GOVERNANCE_PULSE_TOKEN env vars to auto-initialize.
if ! is_initialized "governance"; then
  if [[ -n "${GOVERNANCE_ADMIN:-}" && -n "${GOVERNANCE_PULSE_TOKEN:-}" ]]; then
    echo ""
    echo "▶  Initializing TalosGovernance..."
    stellar contract invoke \
      --id "$GOVERNANCE_ID" \
      --network "$NETWORK" \
      --source "$SOURCE" \
      -- \
      initialize \
      --admin "${GOVERNANCE_ADMIN}" \
      --pulse_token_address "${GOVERNANCE_PULSE_TOKEN}" \
      --quorum_threshold "${GOVERNANCE_QUORUM_THRESHOLD:-100}" \
      --consensus_threshold "${GOVERNANCE_CONSENSUS_THRESHOLD:-5100}" \
      --voting_period_ledgers "${GOVERNANCE_VOTING_PERIOD_LEDGERS:-17280}"
    mark_initialized "governance"
  else
    echo "   ⚠  GOVERNANCE_ADMIN and GOVERNANCE_PULSE_TOKEN not set — skipping auto-init."
    echo "      Run manually: stellar contract invoke --id $GOVERNANCE_ID -- initialize \\"
    echo "        --admin <ADDR> --pulse_token_address <PULSE_TOKEN_ADDR> \\"
    echo "        --quorum_threshold 100 --consensus_threshold 5100 --voting_period_ledgers 17280"
  fi
else
  echo "   ↩  TalosGovernance already initialized (skipping)"
fi

# ── Deploy TalosDividends ─────────────────────────────────────────────────────
echo ""
echo "▶  Deploying TalosDividends to $NETWORK..."
DIVIDENDS_ID=$(load_or_deploy "dividends" "$DIVIDENDS_WASM")
echo "   TalosDividends:   $DIVIDENDS_ID"

# TalosDividends.initialize requires: admin, registry_contract.
# Set DIVIDENDS_ADMIN to auto-initialize (registry address is wired automatically).
if ! is_initialized "dividends"; then
  if [[ -n "${DIVIDENDS_ADMIN:-}" ]]; then
    echo ""
    echo "▶  Initializing TalosDividends with TalosRegistry address..."
    stellar contract invoke \
      --id "$DIVIDENDS_ID" \
      --network "$NETWORK" \
      --source "$SOURCE" \
      -- \
      initialize \
      --admin "${DIVIDENDS_ADMIN}" \
      --registry_contract "$REGISTRY_ID"
    mark_initialized "dividends"
  else
    echo "   ⚠  DIVIDENDS_ADMIN not set — skipping auto-init."
    echo "      Run manually: stellar contract invoke --id $DIVIDENDS_ID -- initialize \\"
    echo "        --admin <ADDR> --registry_contract $REGISTRY_ID"
  fi
else
  echo "   ↩  TalosDividends already initialized (skipping)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Add these to web/.env.local:"
echo ""
echo "  NEXT_PUBLIC_TALOS_REGISTRY_CONTRACT=$REGISTRY_ID"
echo "  NEXT_PUBLIC_TALOS_NAME_SERVICE_CONTRACT=$NAME_SERVICE_ID"
echo "  NEXT_PUBLIC_TALOS_GOVERNANCE_CONTRACT=$GOVERNANCE_ID"
echo "  NEXT_PUBLIC_TALOS_DIVIDENDS_CONTRACT=$DIVIDENDS_ID"
echo "═══════════════════════════════════════════════════════"
