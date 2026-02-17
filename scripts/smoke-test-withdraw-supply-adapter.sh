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

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-1000000}"
SMOKE_WITHDRAW_AMOUNT="${SMOKE_WITHDRAW_AMOUNT:-${SMOKE_STAKE_AMOUNT}}"
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-withdraw-smoke-$(date +%s)}"
SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL:-withdraw-secret-withdraw-smoke-$(date +%s)}"
SMOKE_SET_EXECUTOR_TO_DEPLOYER="${SMOKE_SET_EXECUTOR_TO_DEPLOYER:-true}"
SMOKE_RESTORE_EXECUTOR="${SMOKE_RESTORE_EXECUTOR:-true}"

if [[ "$(echo "${SMOKE_WITHDRAW_AMOUNT}" | tr '[:upper:]' '[:lower:]')" == "max" ]]; then
  SMOKE_WITHDRAW_AMOUNT="115792089237316195423570985008687907853269984665640564039457584007913129639935"
fi

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_EXECUTOR="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "privacyExecutor()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE="$(normalize_uint_output "${DEPLOYER_TOKEN_BALANCE_RAW}")"

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
echo "Original executor: ${ORIGINAL_EXECUTOR}"
echo "Withdraw amount (raw): ${SMOKE_WITHDRAW_AMOUNT}"
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
  echo "Example: SMOKE_STAKE_AMOUNT=1000 bash scripts/smoke-test-withdraw-supply-adapter.sh" >&2
  exit 1
fi

if is_true "${SMOKE_SET_EXECUTOR_TO_DEPLOYER}"; then
  echo "Step 1/7: Setting executor to deployer..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setPrivacyExecutor(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo "Step 2/7: Funding adapter with stake token..."
cast send "${SUPPLY_TOKEN}" \
  "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 3/7: Building supply request..."
REQUEST_DATA="$(
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const { keccak256, toUtf8Bytes, defaultAbiCoder } = ethers.utils;
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-withdraw-smoke"));
    const withdrawSecret = keccak256(toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-withdraw-smoke"));
    const withdrawAuthHash = keccak256(withdrawSecret);
    const coder = defaultAbiCoder;
    console.log(coder.encode(["tuple(bytes32,bytes32)"], [[zkOwnerHash, withdrawAuthHash]]));
  '
)"

NEXT_POSITION_ID_RAW="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "nextPositionId()(uint256)" --rpc-url "${RPC_URL}")"
NEXT_POSITION_ID="$(normalize_uint_output "${NEXT_POSITION_ID_RAW}")"
EXPECTED_POSITION_ID=$((NEXT_POSITION_ID + 1))

echo "Step 4/7: Calling onPrivateDeposit..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "onPrivateDeposit(address,uint256,bytes)" "${SUPPLY_TOKEN}" "${SMOKE_STAKE_AMOUNT}" "${REQUEST_DATA}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

WITHDRAW_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-withdraw-smoke")));'
)"

NEXT_WITHDRAW_AUTH_HASH="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" SMOKE_WITHDRAW_AMOUNT="${SMOKE_WITHDRAW_AMOUNT}" \
  bun -e '
    import { ethers } from "ethers";
    const { keccak256, toUtf8Bytes } = ethers.utils;
    const amount = (process.env.SMOKE_WITHDRAW_AMOUNT ?? "").toLowerCase();
    if (amount === "115792089237316195423570985008687907853269984665640564039457584007913129639935") {
      console.log("0x0000000000000000000000000000000000000000000000000000000000000000");
      process.exit(0);
    }
    const nextSecret = keccak256(toUtf8Bytes((process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-withdraw-smoke") + "-next"));
    console.log(keccak256(nextSecret));
  '
)"

RECIPIENT="${SMOKE_WITHDRAW_RECIPIENT:-${DEPLOYER_ADDRESS}}"
BEFORE_RECIPIENT_BALANCE="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${RECIPIENT}" --rpc-url "${RPC_URL}")"

echo "Step 5/7: Calling withdrawToRecipient..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" "${EXPECTED_POSITION_ID}" "${SMOKE_WITHDRAW_AMOUNT}" "${WITHDRAW_SECRET}" "${NEXT_WITHDRAW_AUTH_HASH}" "${RECIPIENT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 6/7: Reading updated position..."
POSITION="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${EXPECTED_POSITION_ID}" \
  --rpc-url "${RPC_URL}")"
AFTER_RECIPIENT_BALANCE="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${RECIPIENT}" --rpc-url "${RPC_URL}")"

echo "Position: ${POSITION}"
echo "Recipient balance before: ${BEFORE_RECIPIENT_BALANCE}"
echo "Recipient balance after:  ${AFTER_RECIPIENT_BALANCE}"

echo "Step 7/7: Restoring executor..."
if is_true "${SMOKE_RESTORE_EXECUTOR}"; then
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setPrivacyExecutor(address)" "${ORIGINAL_EXECUTOR}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
fi

echo
echo "Withdraw smoke test completed."
echo "- position id: ${EXPECTED_POSITION_ID}"
echo "- recipient: ${RECIPIENT}"
