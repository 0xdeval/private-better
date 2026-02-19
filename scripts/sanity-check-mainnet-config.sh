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

to_lower() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

load_dotenv "${ENV_FILE}"

if ! command -v cast >/dev/null 2>&1; then
  echo "Error: cast is not installed or not in PATH." >&2
  exit 1
fi

for key in RPC_URL PRIVATE_SUPPLY_ADAPTER SUPPLY_TOKEN BORROW_TOKEN AAVE_POOL VAULT_FACTORY PRIVATE_EMPORIUM; do
  require_env "${key}"
done

EXPECTED_EXECUTOR="${PRIVATE_EMPORIUM}"

for key in PRIVATE_SUPPLY_ADAPTER SUPPLY_TOKEN BORROW_TOKEN AAVE_POOL VAULT_FACTORY; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} is not a valid 0x address." >&2
    exit 1
  fi
done
if ! is_address "${EXPECTED_EXECUTOR}"; then
  echo "Error: PRIVATE_EMPORIUM is not a valid 0x address." >&2
  exit 1
fi

CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
ADAPTER_TOKEN="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "supplyToken()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_POOL="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "aavePool()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_FACTORY="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "vaultFactory()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_EXECUTOR="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "privacyExecutor()(address)" --rpc-url "${RPC_URL}")"
ADAPTER_BORROW_ALLOWED="$(cast call "${PRIVATE_SUPPLY_ADAPTER}" "isBorrowTokenAllowed(address)(bool)" "${BORROW_TOKEN}" --rpc-url "${RPC_URL}")"

echo "Private Better Mainnet Sanity Check"
echo "RPC:                 ${RPC_URL}"
echo "Chain ID:            ${CHAIN_ID}"
echo "Adapter:             ${PRIVATE_SUPPLY_ADAPTER}"
echo "Aave pool (env/adp): ${AAVE_POOL} / ${ADAPTER_POOL}"
echo "Token (env/adp):     ${SUPPLY_TOKEN} / ${ADAPTER_TOKEN}"
echo "Borrow token (env):  ${BORROW_TOKEN}"
echo "Factory (env/adp):   ${VAULT_FACTORY} / ${ADAPTER_FACTORY}"
echo "Executor (env/adp):  ${EXPECTED_EXECUTOR} / ${ADAPTER_EXECUTOR}"
echo "Borrow allowed:      ${ADAPTER_BORROW_ALLOWED}"

if [[ "$(to_lower "${SUPPLY_TOKEN}")" != "$(to_lower "${ADAPTER_TOKEN}")" ]]; then
  echo "Error: adapter supplyToken() mismatch." >&2
  exit 1
fi
if [[ "$(to_lower "${AAVE_POOL}")" != "$(to_lower "${ADAPTER_POOL}")" ]]; then
  echo "Error: adapter aavePool() mismatch." >&2
  exit 1
fi
if [[ "$(to_lower "${VAULT_FACTORY}")" != "$(to_lower "${ADAPTER_FACTORY}")" ]]; then
  echo "Error: adapter vaultFactory() mismatch." >&2
  exit 1
fi
if [[ "$(to_lower "${EXPECTED_EXECUTOR}")" != "$(to_lower "${ADAPTER_EXECUTOR}")" ]]; then
  echo "Error: adapter privacyExecutor() mismatch." >&2
  exit 1
fi
if [[ "$(to_lower "${ADAPTER_BORROW_ALLOWED}")" != "true" ]]; then
  echo "Error: adapter borrow token is not allowlisted." >&2
  exit 1
fi

RESERVE_DATA="$({
  cast call "${AAVE_POOL}" \
    "getReserveData(address)((uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))" \
    "${SUPPLY_TOKEN}" --rpc-url "${RPC_URL}"
} 2>/dev/null || true)"
ATOKEN="$(echo "${RESERVE_DATA}" | grep -Eo '0x[0-9a-fA-F]{40}' | sed -n '1p')"

if [[ -z "${ATOKEN}" || "${ATOKEN}" == "0x0000000000000000000000000000000000000000" ]]; then
  echo "Error: SUPPLY_TOKEN is not an active reserve on AAVE_POOL." >&2
  exit 1
fi

ARB_POOL="0x794a61358D6845594F94dc1DB02A252b5b4814aD"
ARB_USDC_NATIVE="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"

if [[ "${CHAIN_ID}" == "42161" ]]; then
  if [[ "$(to_lower "${AAVE_POOL}")" != "$(to_lower "${ARB_POOL}")" ]]; then
    echo "Warning: AAVE_POOL does not match Arbitrum One canonical V3 pool." >&2
  fi
  if [[ "$(to_lower "${SUPPLY_TOKEN}")" != "$(to_lower "${ARB_USDC_NATIVE}")" ]]; then
    echo "Warning: SUPPLY_TOKEN is not native USDC on Arbitrum One (0xaf88...)." >&2
  fi
fi

echo "Reserve aToken:      ${ATOKEN}"
echo "Sanity check passed."
