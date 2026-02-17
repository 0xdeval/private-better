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

normalize_uint_output() {
  local value="$1"
  value="$(echo "${value}" | tr -d '[:space:]')"
  value="${value%%\[*}"
  if [[ "${value}" == 0x* || "${value}" == 0X* ]]; then
    value="$(cast to-dec "${value}")"
  fi
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

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-1000000}" # 1 token with 6 decimals
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-supply-smoke}"
SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL:-withdraw-secret-supply-smoke}"
SMOKE_SET_EXECUTOR_TO_DEPLOYER="${SMOKE_SET_EXECUTOR_TO_DEPLOYER:-true}"
SMOKE_RESTORE_EXECUTOR="${SMOKE_RESTORE_EXECUTOR:-true}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_EXECUTOR="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "privacyExecutor()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE="$(normalize_uint_output "${DEPLOYER_TOKEN_BALANCE_RAW}")"


echo "Starting PrivateSupplyAdapter smoke test"
echo "RPC:                ${RPC_URL}"
echo "Deployer:           ${DEPLOYER_ADDRESS}"
echo "Adapter:            ${PRIVATE_SUPPLY_ADAPTER}"
echo "Aave pool (env/adp):${AAVE_POOL} / ${ADAPTER_POOL}"
echo "Token (env/adp):    ${SUPPLY_TOKEN} / ${ADAPTER_TOKEN}"
echo "Factory (env/adp):  ${VAULT_FACTORY} / ${ADAPTER_FACTORY}"
echo "Executor (orig):    ${ORIGINAL_EXECUTOR}"
echo "Deployer token bal: ${DEPLOYER_TOKEN_BALANCE}"

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
if ! [[ "${DEPLOYER_TOKEN_BALANCE}" =~ ^[0-9]+$ ]]; then
  echo "Error: could not parse deployer token balance: ${DEPLOYER_TOKEN_BALANCE_RAW}" >&2
  exit 1
fi
if (( DEPLOYER_TOKEN_BALANCE < SMOKE_STAKE_AMOUNT )); then
  echo "Error: deployer token balance is lower than SMOKE_STAKE_AMOUNT." >&2
  echo "Required (raw): ${SMOKE_STAKE_AMOUNT}" >&2
  echo "Current  (raw): ${DEPLOYER_TOKEN_BALANCE}" >&2
  echo "Top up SUPPLY_TOKEN for ${DEPLOYER_ADDRESS} or run with a lower amount." >&2
  echo "Example: SMOKE_STAKE_AMOUNT=1000 bash scripts/smoke-test-supply-adapter.sh" >&2
  exit 1
fi

if is_true "${SMOKE_SET_EXECUTOR_TO_DEPLOYER}"; then
  echo "Step 1/6: Setting privacy executor to deployer..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setPrivacyExecutor(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo "Step 2/6: Funding adapter with stake token..."
cast send "${SUPPLY_TOKEN}" \
  "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 3/6: Building supply request..."
REQUEST_DATA="$(
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const { keccak256, toUtf8Bytes, defaultAbiCoder } = ethers.utils;
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-supply-smoke"));
    const withdrawSecret = keccak256(toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-supply-smoke"));
    const withdrawAuthHash = keccak256(withdrawSecret);
    const coder = defaultAbiCoder;
    console.log(coder.encode(["tuple(bytes32,bytes32)"], [[zkOwnerHash, withdrawAuthHash]]));
  '
)"

NEXT_POSITION_ID="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "nextPositionId()(uint256)" --rpc-url "${RPC_URL}")"
EXPECTED_POSITION_ID=$((NEXT_POSITION_ID + 1))

echo "Step 4/6: Calling onPrivateDeposit..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "onPrivateDeposit(address,uint256,bytes)" "${SUPPLY_TOKEN}" "${SMOKE_STAKE_AMOUNT}" "${REQUEST_DATA}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 5/6: Reading position and vault..."
POSITION="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${EXPECTED_POSITION_ID}" \
  --rpc-url "${RPC_URL}")"

VAULT_ADDRESS="$(cast call "${VAULT_FACTORY}" \
  "vaultOfZkOwner(bytes32)(address)" \
  "$(SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-supply-smoke")));')" \
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

if is_true "${SMOKE_RESTORE_EXECUTOR}"; then
  echo "Restoring privacy executor..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setPrivacyExecutor(address)" "${ORIGINAL_EXECUTOR}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo
echo "Supply smoke test completed."
