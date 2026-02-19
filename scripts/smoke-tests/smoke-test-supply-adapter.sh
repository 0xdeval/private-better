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
require_env BORROW_TOKEN
require_env AAVE_POOL
require_env VAULT_FACTORY

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

for key in PRIVATE_SUPPLY_ADAPTER SUPPLY_TOKEN BORROW_TOKEN AAVE_POOL VAULT_FACTORY; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-1000000}" # 1 token with 6 decimals
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-supply-smoke}"
SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL:-smoke-$(date +%Y%m%d-%H%M%S)-supply}"
SMOKE_SET_EXECUTOR_TO_DEPLOYER="${SMOKE_SET_EXECUTOR_TO_DEPLOYER:-true}"
SMOKE_RESTORE_EXECUTOR="${SMOKE_RESTORE_EXECUTOR:-true}"
SMOKE_CLEANUP="${SMOKE_CLEANUP:-true}"
MAX_UINT="115792089237316195423570985008687907853269984665640564039457584007913129639935"
ZERO_HASH="0x0000000000000000000000000000000000000000000000000000000000000000"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_EXECUTOR="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "privacyExecutor()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_BORROW_ALLOWED="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "isBorrowTokenAllowed(address)(bool)" "${BORROW_TOKEN}" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
DEPLOYER_TOKEN_BALANCE="$(normalize_uint_output "${DEPLOYER_TOKEN_BALANCE_RAW}")"
EXECUTOR_CHANGED=false

cleanup_on_exit() {
  if [[ "${EXECUTOR_CHANGED}" == "true" ]] && is_true "${SMOKE_RESTORE_EXECUTOR}"; then
    cast send "${PRIVATE_SUPPLY_ADAPTER}" \
      "setPrivacyExecutor(address)" "${ORIGINAL_EXECUTOR}" \
      --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1 || true
  fi
}
trap cleanup_on_exit EXIT

restore_executor() {
  if is_true "${SMOKE_RESTORE_EXECUTOR}"; then
    echo "Restoring privacy executor..."
    cast send "${PRIVATE_SUPPLY_ADAPTER}" \
      "setPrivacyExecutor(address)" "${ORIGINAL_EXECUTOR}" \
      --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
    EXECUTOR_CHANGED=false
  fi
}

cleanup_position() {
  local position_id="$1"
  local current_secret="$2"
  local next_secret="$3"

  local tuple amount_raw amount amount_minus_one next_hash
  tuple="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
    "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${position_id}" \
    --rpc-url "${RPC_URL}")"
  amount_raw="$(echo "${tuple}" | awk 'NR==4{print $1}')"
  amount="$(normalize_uint_output "${amount_raw}")"
  if ! [[ "${amount}" =~ ^[0-9]+$ ]] || (( amount == 0 )); then
    echo "Cleanup: position ${position_id} already closed."
    return 0
  fi

  echo "Cleanup: trying max-withdraw for position ${position_id}..."
  local output=""
  if output="$(cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "${MAX_UINT}" "${current_secret}" "${ZERO_HASH}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" 2>&1)"; then
    echo "Cleanup: position ${position_id} closed with max-withdraw."
    return 0
  fi

  if [[ "${output}" != *"47bc4b2c"* && "${output}" != *"NotEnoughAvailableUserBalance"* ]]; then
    echo "${output}" >&2
    return 1
  fi

  if (( amount <= 1 )); then
    echo "Cleanup warning: position ${position_id} has tiny residual amount=${amount}; skipping." >&2
    return 0
  fi

  amount_minus_one=$((amount - 1))
  next_hash="$(cast keccak "${next_secret}")"
  echo "Cleanup: fallback withdraw ${amount_minus_one}, then try final 1..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "${amount_minus_one}" "${current_secret}" "${next_hash}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

  if ! cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "1" "${next_secret}" "${ZERO_HASH}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1; then
    echo "Cleanup warning: position ${position_id} left with 1 raw unit dust due Aave rounding." >&2
  fi
}


echo "Starting PrivateSupplyAdapter smoke test"
echo "RPC:                ${RPC_URL}"
echo "Deployer:           ${DEPLOYER_ADDRESS}"
echo "Adapter:            ${PRIVATE_SUPPLY_ADAPTER}"
echo "Aave pool (env/adp):${AAVE_POOL} / ${ADAPTER_POOL}"
echo "Token (env/adp):    ${SUPPLY_TOKEN} / ${ADAPTER_TOKEN}"
echo "Borrow token (env): ${BORROW_TOKEN}"
echo "Factory (env/adp):  ${VAULT_FACTORY} / ${ADAPTER_FACTORY}"
echo "Executor (orig):    ${ORIGINAL_EXECUTOR}"
echo "Borrow allowed:     ${ADAPTER_BORROW_ALLOWED}"
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
if [[ "$(to_lower "${ADAPTER_BORROW_ALLOWED}")" != "true" ]]; then
  echo "Error: adapter borrow token is not allowlisted." >&2
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
  EXECUTOR_CHANGED=true
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
WITHDRAW_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-supply-smoke")));'
)"
CLEANUP_NEXT_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(ethers.utils.toUtf8Bytes((process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-supply-smoke") + "-cleanup")));'
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

if is_true "${SMOKE_CLEANUP}"; then
  echo "Cleanup: withdrawing supplied collateral back to deployer..."
  cleanup_position "${EXPECTED_POSITION_ID}" "${WITHDRAW_SECRET}" "${CLEANUP_NEXT_SECRET}"
  POST_TUPLE="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
    "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${EXPECTED_POSITION_ID}" \
    --rpc-url "${RPC_URL}")"
  POST_AMOUNT_RAW="$(echo "${POST_TUPLE}" | awk 'NR==4{print $1}')"
  POST_AMOUNT="$(normalize_uint_output "${POST_AMOUNT_RAW}")"
  if [[ "${POST_AMOUNT}" =~ ^[0-9]+$ ]] && (( POST_AMOUNT > 1 )); then
    echo "Error: cleanup failed, residual collateral amount=${POST_AMOUNT} on position ${EXPECTED_POSITION_ID}." >&2
    restore_executor
    exit 1
  fi
fi

restore_executor

FINAL_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
FINAL_BALANCE="$(normalize_uint_output "${FINAL_BALANCE_RAW}")"
echo "- deployer final token balance (raw): ${FINAL_BALANCE}"
if is_true "${SMOKE_CLEANUP}"; then
  if (( FINAL_BALANCE + 2 < DEPLOYER_TOKEN_BALANCE )); then
    echo "Warning: final balance is materially lower than start. Check open positions/debt." >&2
  fi
fi

echo
echo "Supply smoke test completed."
