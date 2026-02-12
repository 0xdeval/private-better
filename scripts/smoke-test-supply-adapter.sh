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

to_lower() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

load_dotenv "${ENV_FILE}"

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

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-1000000}" # 1 USDC
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-supply-smoke}"
SMOKE_SET_CALLBACK_TO_DEPLOYER="${SMOKE_SET_CALLBACK_TO_DEPLOYER:-true}"
SMOKE_RESTORE_CALLBACK="${SMOKE_RESTORE_CALLBACK:-true}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_CALLBACK="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "railgunCallbackSender()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE_HEX="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE_HEX="$(echo "${DEPLOYER_TOKEN_BALANCE_HEX}" | tr -d '[:space:]')"
if [[ -z "${DEPLOYER_TOKEN_BALANCE_HEX}" ]]; then
  echo "Error: empty balance response from token contract." >&2
  exit 1
fi
if [[ "${DEPLOYER_TOKEN_BALANCE_HEX}" == 0x* || "${DEPLOYER_TOKEN_BALANCE_HEX}" == 0X* ]]; then
  DEPLOYER_TOKEN_BALANCE="$(cast to-dec "${DEPLOYER_TOKEN_BALANCE_HEX}")"
else
  DEPLOYER_TOKEN_BALANCE="${DEPLOYER_TOKEN_BALANCE_HEX}"
fi
DEPLOYER_TOKEN_BALANCE="${DEPLOYER_TOKEN_BALANCE%%\[*}"
DEPLOYER_TOKEN_BALANCE="$(echo "${DEPLOYER_TOKEN_BALANCE}" | tr -d '[:space:]')"
if ! [[ "${DEPLOYER_TOKEN_BALANCE}" =~ ^[0-9]+$ ]]; then
  echo "Error: unexpected deployer balance format: ${DEPLOYER_TOKEN_BALANCE}" >&2
  exit 1
fi
AAVE_RESERVE_ATOKEN=""
if RESERVE_DATA="$(
  cast call "${AAVE_POOL}" \
    "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
    "${SUPPLY_TOKEN}" --rpc-url "${RPC_URL}" 2>/dev/null
)"; then
  AAVE_RESERVE_ATOKEN="$(echo "${RESERVE_DATA}" | grep -Eo '0x[0-9a-fA-F]{40}' | sed -n '1p')"
fi

echo "Starting PrivateSupplyAdapter smoke test"
echo "RPC:            ${RPC_URL}"
echo "Deployer:       ${DEPLOYER_ADDRESS}"
echo "Adapter:        ${PRIVATE_SUPPLY_ADAPTER}"
echo "Aave pool (env):${AAVE_POOL}"
echo "Aave pool (adp):${ADAPTER_POOL}"
echo "Token (env):    ${SUPPLY_TOKEN}"
echo "Token (adp):    ${ADAPTER_TOKEN}"
echo "Factory (env):  ${VAULT_FACTORY}"
echo "Factory (adp):  ${ADAPTER_FACTORY}"
echo "Token balance (deployer, raw): ${DEPLOYER_TOKEN_BALANCE}"
if [[ -n "${AAVE_RESERVE_ATOKEN}" ]]; then
  echo "Aave reserve aToken: ${AAVE_RESERVE_ATOKEN}"
fi

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
if [[ -n "${AAVE_RESERVE_ATOKEN}" && "${AAVE_RESERVE_ATOKEN}" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "Error: SUPPLY_TOKEN is not listed as an active reserve in this Aave pool." >&2
  echo "Use the exact reserve token address from Aave Sepolia addresses." >&2
  exit 1
fi
if (( DEPLOYER_TOKEN_BALANCE < SMOKE_STAKE_AMOUNT )); then
  echo "Error: deployer token balance is lower than SMOKE_STAKE_AMOUNT." >&2
  echo "Required (raw): ${SMOKE_STAKE_AMOUNT}" >&2
  echo "Current  (raw): ${DEPLOYER_TOKEN_BALANCE}" >&2
  echo "Top up SUPPLY_TOKEN for ${DEPLOYER_ADDRESS} or lower SMOKE_STAKE_AMOUNT." >&2
  exit 1
fi

if is_true "${SMOKE_SET_CALLBACK_TO_DEPLOYER}"; then
  echo "Step 1/6: Setting callback sender to deployer..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunCallbackSender(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo "Step 2/6: Funding adapter with stake token..."
cast send "${SUPPLY_TOKEN}" \
  "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 3/6: Building supply request..."
REQUEST_DATA="$(
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" \
  bun -e '
    import { AbiCoder, keccak256, toUtf8Bytes } from "ethers";
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-supply-smoke"));
    const coder = AbiCoder.defaultAbiCoder();
    console.log(coder.encode(["tuple(bytes32)"], [[zkOwnerHash]]));
  '
)"

NEXT_POSITION_ID="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "nextPositionId()(uint256)" --rpc-url "${RPC_URL}")"
EXPECTED_POSITION_ID=$((NEXT_POSITION_ID + 1))

echo "Step 4/6: Calling onRailgunUnshield..."
STEP4_OUTPUT="$(cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "onRailgunUnshield(address,uint256,bytes)" "${SUPPLY_TOKEN}" "${SMOKE_STAKE_AMOUNT}" "${REQUEST_DATA}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" 2>&1)" || {
  echo "${STEP4_OUTPUT}" >&2
  if echo "${STEP4_OUTPUT}" | grep -qE 'execution reverted: 51|Error\("51"\)'; then
    echo "Hint: Aave error 51 = SUPPLY_CAP_EXCEEDED for this reserve on the selected pool." >&2
    echo "Try a different reserve asset with headroom, lower utilization chain, or switch back to mock pool for smoke tests." >&2
  fi
  exit 1
}

echo "Step 5/6: Reading position and vault..."
POSITION="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "positions(uint256)(bytes32,address,address,uint256)" "${EXPECTED_POSITION_ID}" \
  --rpc-url "${RPC_URL}")"

VAULT_ADDRESS="$(cast call "${VAULT_FACTORY}" \
  "vaultOfZkOwner(bytes32)(address)" \
  "$(SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" bun -e 'import { keccak256, toUtf8Bytes } from "ethers"; console.log(keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-supply-smoke")));')" \
  --rpc-url "${RPC_URL}")"

AAVE_SUPPLIED=""
if AAVE_SUPPLIED_OUTPUT="$(cast call "${AAVE_POOL}" \
  "suppliedBalance(address,address)(uint256)" "${VAULT_ADDRESS}" "${SUPPLY_TOKEN}" \
  --rpc-url "${RPC_URL}" 2>/dev/null)"; then
  AAVE_SUPPLIED="${AAVE_SUPPLIED_OUTPUT}"
else
  AAVE_SUPPLIED="n/a (real Aave pool mode: mock-only suppliedBalance() is unavailable)"
fi

echo "Step 6/6: Results"
echo "- expected position id: ${EXPECTED_POSITION_ID}"
echo "- position tuple: ${POSITION}"
echo "- vault: ${VAULT_ADDRESS}"
echo "- suppliedBalance(vault, token): ${AAVE_SUPPLIED}"

if is_true "${SMOKE_RESTORE_CALLBACK}"; then
  echo "Restoring callback sender..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setRailgunCallbackSender(address)" "${ORIGINAL_CALLBACK}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo
echo "Supply smoke test completed."
