#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: .env not found at ${ENV_FILE}" >&2
  exit 1
fi

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

load_dotenv() {
  local file="$1"
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line="${raw_line%$'\r'}"
    [[ -z "$(trim "${line}")" ]] && continue
    [[ "$(trim "${line}")" == \#* ]] && continue
    [[ "${line}" != *"="* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"

    key="$(trim "${key}")"
    value="$(trim "${value}")"

    if [[ "${value}" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "${value}" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    if [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "${key}=${value}"
    fi
  done < "${file}"
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Error: ${key} is missing in .env" >&2
    exit 1
  fi
}

is_address() {
  [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]
}

is_true() {
  local value
  value="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "${value}" == "1" || "${value}" == "true" || "${value}" == "yes" || "${value}" == "y" ]]
}

load_dotenv "${ENV_FILE}"

if ! command -v cast >/dev/null 2>&1; then
  echo "Error: cast is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is not installed or not in PATH." >&2
  exit 1
fi

require_env AMOY_RPC_URL
require_env DEPLOYER_PRIVATE_KEY
require_env AMOY_PRIVATE_BET_ADAPTER
require_env AMOY_AZURO_ADAPTER
require_env AMOY_USDC

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

for key in AMOY_PRIVATE_BET_ADAPTER AMOY_AZURO_ADAPTER AMOY_USDC; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done

# Configurable smoke-test parameters (raw token amounts, USDC has 6 decimals).
SMOKE_MARKET_ID="${SMOKE_MARKET_ID:-101}"
SMOKE_OUTCOME="${SMOKE_OUTCOME:-1}"
SMOKE_MIN_ODDS="${SMOKE_MIN_ODDS:-100}"
SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-100000000}"    # 100 USDC
SMOKE_PAYOUT_AMOUNT="${SMOKE_PAYOUT_AMOUNT:-170000000}"  # 170 USDC
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-smoke}"
SMOKE_SET_CALLBACK_TO_DEPLOYER="${SMOKE_SET_CALLBACK_TO_DEPLOYER:-true}"
SMOKE_SET_SHIELD_TO_DEPLOYER="${SMOKE_SET_SHIELD_TO_DEPLOYER:-false}"
SMOKE_RESTORE_CONFIG="${SMOKE_RESTORE_CONFIG:-true}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"

echo "Starting PrivateBetAdapter smoke test on Amoy"
echo "RPC:       ${AMOY_RPC_URL}"
echo "Deployer:  ${DEPLOYER_ADDRESS}"
echo "Adapter:   ${AMOY_PRIVATE_BET_ADAPTER}"
echo "MockAzuro: ${AMOY_AZURO_ADAPTER}"
echo "USDC:      ${AMOY_USDC}"

POL_BALANCE="$(cast balance "${DEPLOYER_ADDRESS}" --rpc-url "${AMOY_RPC_URL}")"
USDC_BALANCE="$(cast call "${AMOY_USDC}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${AMOY_RPC_URL}")"
echo "Balances -> POL: ${POL_BALANCE}, USDC(raw): ${USDC_BALANCE}"

ORIGINAL_CALLBACK="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "railgunCallbackSender()(address)" --rpc-url "${AMOY_RPC_URL}")"
ORIGINAL_SHIELD="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "railgunShield()(address)" --rpc-url "${AMOY_RPC_URL}")"
ADAPTER_AZURO="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "azuro()(address)" --rpc-url "${AMOY_RPC_URL}")"
ADAPTER_USDC="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "usdc()(address)" --rpc-url "${AMOY_RPC_URL}")"

echo "Adapter wiring -> azuro: ${ADAPTER_AZURO}, usdc: ${ADAPTER_USDC}"
echo "Original config -> callback: ${ORIGINAL_CALLBACK}, shield: ${ORIGINAL_SHIELD}"
if [[ "$(echo "${ADAPTER_AZURO}" | tr '[:upper:]' '[:lower:]')" != "$(echo "${AMOY_AZURO_ADAPTER}" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Warning: adapter.azuro() differs from AMOY_AZURO_ADAPTER in .env"
fi
if [[ "$(echo "${ADAPTER_USDC}" | tr '[:upper:]' '[:lower:]')" != "$(echo "${AMOY_USDC}" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Warning: adapter.usdc() differs from AMOY_USDC in .env"
fi

if is_true "${SMOKE_SET_CALLBACK_TO_DEPLOYER}"; then
  echo "Step 1/8: Setting callback sender to deployer for manual test calls..."
  cast send "${AMOY_PRIVATE_BET_ADAPTER}" "setRailgunCallbackSender(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

if is_true "${SMOKE_SET_SHIELD_TO_DEPLOYER}"; then
  echo "Step 2/8: Setting shield target to deployer for smoke test..."
  cast send "${AMOY_PRIVATE_BET_ADAPTER}" "setRailgunShield(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo "Step 3/8: Funding adapter with stake USDC..."
cast send "${AMOY_USDC}" "transfer(address,uint256)" "${AMOY_PRIVATE_BET_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 4/8: Building bet request data..."
BET_DATA="$(
  SMOKE_MARKET_ID="${SMOKE_MARKET_ID}" \
  SMOKE_OUTCOME="${SMOKE_OUTCOME}" \
  SMOKE_MIN_ODDS="${SMOKE_MIN_ODDS}" \
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" \
  bun -e '
    import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
    const marketId = BigInt(process.env.SMOKE_MARKET_ID);
    const outcome = Number(process.env.SMOKE_OUTCOME);
    const minOdds = BigInt(process.env.SMOKE_MIN_ODDS);
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-smoke"));
    const coder = AbiCoder.defaultAbiCoder();
    console.log(
      coder.encode(
        ["tuple(uint256,uint8,uint256,bytes32)"],
        [[marketId, outcome, minOdds, zkOwnerHash]]
      )
    );
  '
)"

CURRENT_TOKEN_ID="$(cast call "${AMOY_AZURO_ADAPTER}" "nextTokenId()(uint256)" --rpc-url "${AMOY_RPC_URL}")"
EXPECTED_TOKEN_ID=$((CURRENT_TOKEN_ID + 1))
echo "Expected bet token id: ${EXPECTED_TOKEN_ID} (current nextTokenId was ${CURRENT_TOKEN_ID})"

echo "Step 5/8: Calling onRailgunUnshield() to place bet..."
cast send "${AMOY_PRIVATE_BET_ADAPTER}" "onRailgunUnshield(address,uint256,bytes)" "${AMOY_USDC}" "${SMOKE_STAKE_AMOUNT}" "${BET_DATA}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 6/8: Seeding MockAzuro liquidity and settling bet..."
cast send "${AMOY_USDC}" "approve(address,uint256)" "${AMOY_AZURO_ADAPTER}" "${SMOKE_PAYOUT_AMOUNT}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
cast send "${AMOY_AZURO_ADAPTER}" "seedLiquidity(address,uint256)" "${AMOY_USDC}" "${SMOKE_PAYOUT_AMOUNT}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
cast send "${AMOY_AZURO_ADAPTER}" "settleBet(uint256,uint256)" "${EXPECTED_TOKEN_ID}" "${SMOKE_PAYOUT_AMOUNT}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

CLAIMABLE="$(cast call "${AMOY_AZURO_ADAPTER}" "isClaimable(uint256)(bool)" "${EXPECTED_TOKEN_ID}" --rpc-url "${AMOY_RPC_URL}")"
POSITION_BEFORE="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "positions(uint256)(bytes32,address,uint256,bool)" "${EXPECTED_TOKEN_ID}" --rpc-url "${AMOY_RPC_URL}")"
CURRENT_SHIELD_TARGET="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "railgunShield()(address)" --rpc-url "${AMOY_RPC_URL}")"
SHIELD_CODE="$(cast code "${CURRENT_SHIELD_TARGET}" --rpc-url "${AMOY_RPC_URL}")"
echo "Pre-redeem checks -> claimable: ${CLAIMABLE}, shieldTarget: ${CURRENT_SHIELD_TARGET}, position: ${POSITION_BEFORE}"

if [[ "${SHIELD_CODE}" == "0x" ]]; then
  echo "Error: railgunShield target has no contract bytecode. redeemWin will revert." >&2
  echo "Set railgunShield to a contract implementing shield(address,uint256,bytes32), e.g. deployed MockRailgun." >&2
  exit 1
fi

echo "Step 7/8: Redeeming win from adapter..."
cast send "${AMOY_PRIVATE_BET_ADAPTER}" "redeemWin(uint256)" "${EXPECTED_TOKEN_ID}" \
  --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

POSITION_AFTER="$(cast call "${AMOY_PRIVATE_BET_ADAPTER}" "positions(uint256)(bytes32,address,uint256,bool)" "${EXPECTED_TOKEN_ID}" --rpc-url "${AMOY_RPC_URL}")"
echo "Step 8/8: Position after redeem -> ${POSITION_AFTER}"

if is_true "${SMOKE_RESTORE_CONFIG}"; then
  echo "Restoring adapter config to original callback/shield..."
  cast send "${AMOY_PRIVATE_BET_ADAPTER}" "setRailgunCallbackSender(address)" "${ORIGINAL_CALLBACK}" \
    --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
  cast send "${AMOY_PRIVATE_BET_ADAPTER}" "setRailgunShield(address)" "${ORIGINAL_SHIELD}" \
    --rpc-url "${AMOY_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo
echo "Smoke test completed."
echo "- Bet token id: ${EXPECTED_TOKEN_ID}"
echo "- Position claimed should be true (4th tuple value in output above)."
echo "- If shield target was set to deployer for smoke test, payout shielding was simulated only."
