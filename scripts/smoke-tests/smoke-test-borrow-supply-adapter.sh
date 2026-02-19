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

for key in RPC_URL DEPLOYER_PRIVATE_KEY PRIVATE_SUPPLY_ADAPTER SUPPLY_TOKEN BORROW_TOKEN AAVE_POOL VAULT_FACTORY; do
  require_env "${key}"
done

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

SMOKE_STAKE_AMOUNT="${SMOKE_STAKE_AMOUNT:-20000000}" # 20 USDC (6 decimals)
SMOKE_BORROW_AMOUNT="${SMOKE_BORROW_AMOUNT:-100000000000000}" # 0.0001 WETH (18 decimals)
SMOKE_SET_EXECUTOR_TO_DEPLOYER="${SMOKE_SET_EXECUTOR_TO_DEPLOYER:-true}"
SMOKE_RESTORE_EXECUTOR="${SMOKE_RESTORE_EXECUTOR:-true}"
SMOKE_CLEANUP="${SMOKE_CLEANUP:-true}"
SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL:-zk-owner-borrow-smoke-$(date +%s)}"
SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL:-smoke-$(date +%Y%m%d-%H%M%S)-borrow}"
RECIPIENT="${SMOKE_BORROW_RECIPIENT:-$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")}"
MAX_UINT="115792089237316195423570985008687907853269984665640564039457584007913129639935"
ZERO_HASH="0x0000000000000000000000000000000000000000000000000000000000000000"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")"
ORIGINAL_EXECUTOR="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "privacyExecutor()(address)" --rpc-url "${RPC_URL}")"
START_USDC_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
START_USDC_BALANCE="$(normalize_uint_output "${START_USDC_BALANCE_RAW}")"
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
    cast send "${PRIVATE_SUPPLY_ADAPTER}" \
      "setPrivacyExecutor(address)" "${ORIGINAL_EXECUTOR}" \
      --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
    EXECUTOR_CHANGED=false
  fi
}

cleanup_withdraw_position() {
  local position_id="$1"
  local current_secret="$2"
  local next_secret="$3"

  local tuple amount_raw amount amount_minus_one next_hash output=""
  tuple="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
    "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${position_id}" \
    --rpc-url "${RPC_URL}")"
  amount_raw="$(echo "${tuple}" | awk 'NR==4{print $1}')"
  amount="$(normalize_uint_output "${amount_raw}")"
  if ! [[ "${amount}" =~ ^[0-9]+$ ]] || (( amount == 0 )); then
    return 0
  fi

  if output="$(cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "${MAX_UINT}" "${current_secret}" "${ZERO_HASH}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" 2>&1)"; then
    return 0
  fi
  if [[ "${output}" != *"47bc4b2c"* && "${output}" != *"NotEnoughAvailableUserBalance"* ]]; then
    echo "${output}" >&2
    return 1
  fi

  if (( amount <= 1 )); then
    echo "Cleanup warning: residual collateral dust remains on position ${position_id}." >&2
    return 0
  fi

  amount_minus_one=$((amount - 1))
  next_hash="$(cast keccak "${next_secret}")"
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "${amount_minus_one}" "${current_secret}" "${next_hash}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

  if ! cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "withdrawToRecipient(uint256,uint256,bytes32,bytes32,address)" \
    "${position_id}" "1" "${next_secret}" "${ZERO_HASH}" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1; then
    echo "Cleanup warning: 1 raw collateral dust remains on position ${position_id}." >&2
  fi
}

REQUEST_DATA="$(
  SMOKE_ZK_OWNER_LABEL="${SMOKE_ZK_OWNER_LABEL}" SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const { keccak256, toUtf8Bytes, defaultAbiCoder } = ethers.utils;
    const zkOwnerHash = keccak256(toUtf8Bytes(process.env.SMOKE_ZK_OWNER_LABEL ?? "zk-owner-borrow-smoke"));
    const withdrawSecret = keccak256(toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-borrow-smoke"));
    const withdrawAuthHash = keccak256(withdrawSecret);
    console.log(defaultAbiCoder.encode(["tuple(bytes32,bytes32)"], [[zkOwnerHash, withdrawAuthHash]]));
  '
)"
AUTH_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-borrow-smoke")));'
)"
NEXT_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const nextSecret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes((process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-borrow-smoke") + "-next"));
    console.log(nextSecret);
  '
)"
NEXT_AUTH_HASH="$(
  NEXT_SECRET="${NEXT_SECRET}" \
  bun -e 'import { ethers } from "ethers"; console.log(ethers.utils.keccak256(process.env.NEXT_SECRET ?? ""));'
)"
REPAY_CLEANUP_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes((process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-borrow-smoke") + "-repay-cleanup"));
    console.log(secret);
  '
)"
WITHDRAW_CLEANUP_SECRET="$(
  SMOKE_WITHDRAW_SECRET_LABEL="${SMOKE_WITHDRAW_SECRET_LABEL}" \
  bun -e '
    import { ethers } from "ethers";
    const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes((process.env.SMOKE_WITHDRAW_SECRET_LABEL ?? "withdraw-secret-borrow-smoke") + "-withdraw-cleanup"));
    console.log(secret);
  '
)"

echo "Starting PrivateSupplyAdapter borrow smoke test"
echo "Adapter: ${PRIVATE_SUPPLY_ADAPTER}"
echo "Supply token: ${SUPPLY_TOKEN}"
echo "Borrow token: ${BORROW_TOKEN}"
echo "Deployer: ${DEPLOYER_ADDRESS}"
echo "Recipient: ${RECIPIENT}"
echo "Stake amount (raw): ${SMOKE_STAKE_AMOUNT}"
echo "Borrow amount (raw): ${SMOKE_BORROW_AMOUNT}"
echo "Cleanup mode: ${SMOKE_CLEANUP}"

if is_true "${SMOKE_CLEANUP}" && [[ "$(echo "${RECIPIENT}" | tr '[:upper:]' '[:lower:]')" != "$(echo "${DEPLOYER_ADDRESS}" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "Error: cleanup requires borrowed token recipient to be deployer. Unset SMOKE_BORROW_RECIPIENT or set SMOKE_CLEANUP=false." >&2
  exit 1
fi

if is_true "${SMOKE_SET_EXECUTOR_TO_DEPLOYER}"; then
  echo "Step 1/6: Setting executor to deployer..."
  cast send "${PRIVATE_SUPPLY_ADAPTER}" \
    "setPrivacyExecutor(address)" "${DEPLOYER_ADDRESS}" \
    --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
  EXECUTOR_CHANGED=true
fi

echo "Step 2/6: Funding adapter with collateral token..."
cast send "${SUPPLY_TOKEN}" \
  "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${SMOKE_STAKE_AMOUNT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

NEXT_POSITION_ID="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "nextPositionId()(uint256)" --rpc-url "${RPC_URL}")"
POSITION_ID=$((NEXT_POSITION_ID + 1))

echo "Step 3/6: Opening collateral position..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "onPrivateDeposit(address,uint256,bytes)" "${SUPPLY_TOKEN}" "${SMOKE_STAKE_AMOUNT}" "${REQUEST_DATA}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 4/6: Borrowing to recipient..."
cast send "${PRIVATE_SUPPLY_ADAPTER}" \
  "borrowToRecipient(uint256,address,uint256,bytes32,bytes32,address)" "${POSITION_ID}" "${BORROW_TOKEN}" "${SMOKE_BORROW_AMOUNT}" "${AUTH_SECRET}" "${NEXT_AUTH_HASH}" "${RECIPIENT}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null

echo "Step 5/6: Reading results..."
POSITION="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${POSITION_ID}" --rpc-url "${RPC_URL}")"
ACCOUNT_DATA="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
  "getPositionAccountData(uint256)(uint256,uint256,uint256,uint256,uint256,uint256)" "${POSITION_ID}" --rpc-url "${RPC_URL}")"
RECIPIENT_BORROW_BALANCE="$(cast call "${BORROW_TOKEN}" "balanceOf(address)(uint256)" "${RECIPIENT}" --rpc-url "${RPC_URL}")"
VAULT_ADDRESS="$(echo "${POSITION}" | awk 'NR==2{print $1}')"

echo "Position: ${POSITION}"
echo "Account data: ${ACCOUNT_DATA}"
echo "Recipient borrow token balance: ${RECIPIENT_BORROW_BALANCE}"
echo "Vault: ${VAULT_ADDRESS}"

if is_true "${SMOKE_CLEANUP}"; then
  echo "Cleanup: repaying debt and withdrawing collateral..."
  RESERVE_DATA="$({
    cast call "${AAVE_POOL}" \
      "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
      "${BORROW_TOKEN}" --rpc-url "${RPC_URL}"
  } 2>/dev/null || true)"
  VARIABLE_DEBT_TOKEN="$(echo "${RESERVE_DATA}" | grep -Eo '0x[0-9a-fA-F]{40}' | sed -n '3p')"
  if [[ -z "${VARIABLE_DEBT_TOKEN}" || "${VARIABLE_DEBT_TOKEN}" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "Error: could not resolve variable debt token for BORROW_TOKEN." >&2
    restore_executor
    exit 1
  fi

  DEBT_RAW="$(cast call "${VARIABLE_DEBT_TOKEN}" "balanceOf(address)(uint256)" "${VAULT_ADDRESS}" --rpc-url "${RPC_URL}")"
  DEBT="$(normalize_uint_output "${DEBT_RAW}")"
  CURRENT_SECRET="${NEXT_SECRET}"
  if [[ "${DEBT}" =~ ^[0-9]+$ ]] && (( DEBT > 0 )); then
    REPAY_CLEANUP_HASH="$(cast keccak "${REPAY_CLEANUP_SECRET}")"
    cast send "${BORROW_TOKEN}" \
      "transfer(address,uint256)" "${PRIVATE_SUPPLY_ADAPTER}" "${DEBT}" \
      --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
    cast send "${PRIVATE_SUPPLY_ADAPTER}" \
      "repayFromPrivate(uint256,address,uint256,bytes32,bytes32)" \
      "${POSITION_ID}" "${BORROW_TOKEN}" "${DEBT}" "${CURRENT_SECRET}" "${REPAY_CLEANUP_HASH}" \
      --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
    CURRENT_SECRET="${REPAY_CLEANUP_SECRET}"
  fi
  cleanup_withdraw_position "${POSITION_ID}" "${CURRENT_SECRET}" "${WITHDRAW_CLEANUP_SECRET}"

  POST_TUPLE="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" \
    "positions(uint256)(bytes32,address,address,uint256,bytes32)" "${POSITION_ID}" \
    --rpc-url "${RPC_URL}")"
  POST_AMOUNT_RAW="$(echo "${POST_TUPLE}" | awk 'NR==4{print $1}')"
  POST_AMOUNT="$(normalize_uint_output "${POST_AMOUNT_RAW}")"
  POST_DEBT_RAW="$(cast call "${VARIABLE_DEBT_TOKEN}" "balanceOf(address)(uint256)" "${VAULT_ADDRESS}" --rpc-url "${RPC_URL}")"
  POST_DEBT="$(normalize_uint_output "${POST_DEBT_RAW}")"
  if [[ "${POST_DEBT}" =~ ^[0-9]+$ ]] && (( POST_DEBT > 0 )); then
    echo "Error: cleanup failed, residual debt=${POST_DEBT} on vault ${VAULT_ADDRESS}." >&2
    restore_executor
    exit 1
  fi
  if [[ "${POST_AMOUNT}" =~ ^[0-9]+$ ]] && (( POST_AMOUNT > 1 )); then
    echo "Error: cleanup failed, residual collateral amount=${POST_AMOUNT} on position ${POSITION_ID}." >&2
    restore_executor
    exit 1
  fi
fi

echo "Step 6/6: Restoring executor..."
restore_executor

FINAL_USDC_BALANCE_RAW="$(cast call "${SUPPLY_TOKEN}" "balanceOf(address)(uint256)" "${DEPLOYER_ADDRESS}" --rpc-url "${RPC_URL}")"
FINAL_USDC_BALANCE="$(normalize_uint_output "${FINAL_USDC_BALANCE_RAW}")"
echo "Final deployer USDC balance (raw): ${FINAL_USDC_BALANCE}"
if is_true "${SMOKE_CLEANUP}" && (( FINAL_USDC_BALANCE + 2 < START_USDC_BALANCE )); then
  echo "Warning: final USDC balance is materially lower than start. Check residual open positions/debt." >&2
fi

echo
echo "Borrow smoke test completed."
