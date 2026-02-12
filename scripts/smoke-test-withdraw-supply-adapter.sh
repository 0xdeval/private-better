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

resolve_env() {
  local target="$1"
  shift
  for key in "$@"; do
    if [[ -n "${!key:-}" ]]; then
      export "${target}=${!key}"
      return 0
    fi
  done
  return 1
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

to_lower() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

normalize_uint_output() {
  local value="$1"
  value="$(echo "${value}" | tr -d '[:space:]')"
  value="${value%%\[*}"
  printf '%s' "${value}"
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

resolve_env RPC_URL RPC_URL AMOY_RPC_URL || true
resolve_env PRIVATE_SUPPLY_ADAPTER PRIVATE_SUPPLY_ADAPTER AMOY_PRIVATE_SUPPLY_ADAPTER || true
resolve_env SUPPLY_TOKEN SUPPLY_TOKEN USDC AMOY_USDC || true
resolve_env AAVE_POOL AAVE_POOL AMOY_AAVE_POOL || true
resolve_env VAULT_FACTORY VAULT_FACTORY AMOY_VAULT_FACTORY || true
resolve_env MOCK_RAILGUN MOCK_RAILGUN AMOY_MOCK_RAILGUN || true

require_env RPC_URL
require_env DEPLOYER_PRIVATE_KEY
require_env PRIVATE_SUPPLY_ADAPTER
require_env SUPPLY_TOKEN
require_env AAVE_POOL
require_env VAULT_FACTORY

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

for key in PRIVATE_SUPPLY_ADAPTER SUPPLY_TOKEN AAVE_POOL VAULT_FACTORY; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-1000000}" # 1 token if decimals=6
SMOKE_WITHDRAW_AMOUNT="${SMOKE_WITHDRAW_AMOUNT:-${SMOKE_STAKE_AMOUNT}}"
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-withdraw-smoke-$(date +%s)}"
SMOKE_SHIELD_LABEL="${SMOKE_SHIELD_LABEL:-zk-shield-withdraw-smoke-$(date +%s)}"
SMOKE_SET_CALLBACK_TO_DEPLOYER="${SMOKE_SET_CALLBACK_TO_DEPLOYER:-true}"
SMOKE_SET_SHIELD_TO_MOCK="${SMOKE_SET_SHIELD_TO_MOCK:-false}"
SMOKE_RESTORE_CALLBACK="${SMOKE_RESTORE_CALLBACK:-true}"
SMOKE_RESTORE_SHIELD="${SMOKE_RESTORE_SHIELD:-true}"

if [[ "$(echo "${SMOKE_WITHDRAW_AMOUNT}" | tr '[:upper:]' '[:lower:]')" == "max" ]]; then
  SMOKE_WITHDRAW_AMOUNT="115792089237316195423570985008687907853269984665640564039457584007913129639935"
fi

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_CALLBACK="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "railgunCallbackSender()(address)" --rpc-url "${RPC_URL}")"
ORIGINAL_SHIELD="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "railgunShield()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
AAVE_RESERVE_ATOKEN=""
if RESERVE_DATA="$(
  cast call "${AAVE_POOL}" \
    "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
    "${SUPPLY_TOKEN}" --rpc-url "${RPC_URL}" 2>/dev/null
)"; then
  AAVE_RESERVE_ATOKEN="$(echo "${RESERVE_DATA}" | grep -Eo '0x[0-9a-fA-F]{40}' | sed -n '1p')"
fi

echo "Starting PrivateSupplyAdapter withdraw smoke test"
echo "RPC:               ${RPC_URL}"
echo "Deployer:          ${DEPLOYER_ADDRESS}"
echo "Adapter:           ${PRIVATE_SUPPLY_ADAPTER}"
echo "Aave pool (env):   ${AAVE_POOL}"
echo "Aave pool (adp):   ${ADAPTER_POOL}"
echo "Token (env):       ${SUPPLY_TOKEN}"
echo "Token (adp):       ${ADAPTER_TOKEN}"
echo "Factory (env):     ${VAULT_FACTORY}"
echo "Factory (adp):     ${ADAPTER_FACTORY}"
echo "Original callback: ${ORIGINAL_CALLBACK}"
echo "Original shield:   ${ORIGINAL_SHIELD}"
if [[ -n "${AAVE_RESERVE_ATOKEN}" ]]; then
  echo "Aave reserve aToken: ${AAVE_RESERVE_ATOKEN}"
fi
echo "Withdraw amount (raw): ${SMOKE_WITHDRAW_AMOUNT}"

if [[ "$(to_lower "${ADAPTER_TOKEN}")" != "$(to_lower "${SUPPLY_TOKEN}")" ]]; then
  echo "Error: adapter supplyToken() does not match SUPPLY_TOKEN." >&2
  exit 1
fi
if [[ "$(to_lower "${ADAPTER_POOL}")" != "$(to_lower "${AAVE_POOL}")" ]]; then
  echo "Error: adapter aavePool() does not match AAVE_POOL." >&2
  exit 1
fi
if [[ "$(to_lower "${ADAPTER_FACTORY}")" != "$(to_lower "${VAULT_FACTORY}")" ]]; then
  echo "Error: adapter vaultFactory() does not match VAULT_FACTORY." >&2
  exit 1
fi

if is_true "${SMOKE_SET_CALLBACK_TO_DEPLOYER}"; then
  echo "Step 1/8: Setting callback sender to deployer..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunCallbackSender(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

if is_true "${SMOKE_SET_SHIELD_TO_MOCK}"; then
  require_env MOCK_RAILGUN
  if ! is_address "${MOCK_RAILGUN}"; then
    echo "Error: MOCK_RAILGUN must be a valid 0x address." >&2
    exit 1
  fi
  echo "Step 2/8: Setting railgunShield to MOCK_RAILGUN..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunShield(address)" "${MOCK_RAILGUN}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
else
  echo "Step 2/8: Keeping existing railgunShield address."
fi

echo "Step 3/8: Funding adapter with stake token..."
cast send "${SUPPLY_TOKEN}" \
  "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 4/8: Building supply request..."
REQUEST_DATA="$(
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" \
  bun -e '
    import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-withdraw-smoke"));
    const coder = AbiCoder.defaultAbiCoder();
    console.log(coder.encode(["tuple(bytes32)"], [[zkOwnerHash]]));
  '
)"

NEXT_POSITION_ID_RAW="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "nextPositionId()(uint256)" --rpc-url "${RPC_URL}")"
NEXT_POSITION_ID="$(normalize_uint_output "${NEXT_POSITION_ID_RAW}")"
EXPECTED_POSITION_ID=$((NEXT_POSITION_ID + 1))

echo "Step 5/8: Calling onRailgunUnshield..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "onRailgunUnshield(address,uint256,bytes)" "${SUPPLY_TOKEN}" "${SMOKE_STAKE_AMOUNT}" "${REQUEST_DATA}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

SHIELD_HASH="$(
  SMOKE_SHIELD_LABEL="${SMOKE_SHIELD_LABEL}" \
  bun -e 'import { keccak256, toUtf8Bytes } from "ethers"; console.log(keccak256(toUtf8Bytes(process.env.SMOKE_SHIELD_LABEL ?? "zk-shield-withdraw-smoke")));'
)"

VAULT_ADDRESS="$(cast call "${VAULT_FACTORY}" \
  "vaultOfZkOwner(bytes32)(address)" \
  "$(SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" bun -e 'import { keccak256, toUtf8Bytes } from "ethers"; console.log(keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-withdraw-smoke")));')" \
  --rpc-url "${RPC_URL}")"

ADAPTER_BALANCE_BEFORE="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${PRIVATE_SUPPLY_ADAPTER}" --rpc-url "${RPC_URL}")"
echo "Pre-withdraw adapter token balance: ${ADAPTER_BALANCE_BEFORE}"
if [[ -n "${AAVE_RESERVE_ATOKEN}" && "${AAVE_RESERVE_ATOKEN}" != "0x0000000000000000000000000000000000000000" ]]; then
  VAULT_ATOKEN_BALANCE="$(cast call "${AAVE_RESERVE_ATOKEN}" "balanceOf(address)(uint256)" "${VAULT_ADDRESS}" --rpc-url "${RPC_URL}")"
  echo "Pre-withdraw vault aToken balance: ${VAULT_ATOKEN_BALANCE}"
fi

echo "Step 6/8: Calling withdrawAndShield..."
WITHDRAW_OUTPUT="$(cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "withdrawAndShield(uint256,uint256,bytes32)" "${EXPECTED_POSITION_ID}" "${SMOKE_WITHDRAW_AMOUNT}" "${SHIELD_HASH}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" 2>&1)" || {
  echo "${WITHDRAW_OUTPUT}" >&2
  echo "Hint: on real Aave, use SMOKE_WITHDRAW_AMOUNT=max to avoid exact-amount rounding issues." >&2
  exit 1
}

echo "Step 7/8: Reading updated position..."
POSITION="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "positions(uint256)(bytes32,address,address,uint256)" "${EXPECTED_POSITION_ID}" \
  --rpc-url "${RPC_URL}")"
echo "Position: ${POSITION}"

if is_true "${SMOKE_SET_SHIELD_TO_MOCK}"; then
  MOCK_RAILGUN_BALANCE="$(cast call "${SUPPLY_TOKEN}" \
    "balanceOf(address)(uint256)" "${MOCK_RAILGUN}" --rpc-url "${RPC_URL}")"
  echo "Mock railgun token balance: ${MOCK_RAILGUN_BALANCE}"
fi

echo "Step 8/8: Restoring adapter config..."
if is_true "${SMOKE_RESTORE_CALLBACK}"; then
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunCallbackSender(address)" "${ORIGINAL_CALLBACK}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi
if is_true "${SMOKE_RESTORE_SHIELD}"; then
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunShield(address)" "${ORIGINAL_SHIELD}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo
echo "Withdraw smoke test completed."
echo "- position id: ${EXPECTED_POSITION_ID}"
echo "- if using MOCK_RAILGUN, token balance should increase by withdrawn amount."
