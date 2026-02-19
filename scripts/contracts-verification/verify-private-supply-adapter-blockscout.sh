#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

load_dotenv "${ENV_FILE}"

if ! command -v forge >/dev/null 2>&1; then
  echo "Error: forge is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "Error: cast is not installed or not in PATH." >&2
  exit 1
fi

for key in RPC_URL PRIVATE_SUPPLY_ADAPTER PRIVATE_EMPORIUM AAVE_POOL SUPPLY_TOKEN VAULT_FACTORY; do
  require_env "${key}"
done

for key in PRIVATE_SUPPLY_ADAPTER PRIVATE_EMPORIUM AAVE_POOL SUPPLY_TOKEN VAULT_FACTORY; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done

BLOCKSCOUT_VERIFIER_URL="${BLOCKSCOUT_VERIFIER_URL:-https://arbitrum.blockscout.com/api/}"
CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
CONSTRUCTOR_ARGS="$(cast abi-encode "constructor(address,address,address,address)" \
  "${PRIVATE_EMPORIUM}" \
  "${AAVE_POOL}" \
  "${SUPPLY_TOKEN}" \
  "${VAULT_FACTORY}")"

echo "Verifying PrivateSupplyAdapter on Blockscout..."
echo "RPC:                    ${RPC_URL}"
echo "Chain ID:               ${CHAIN_ID}"
echo "Contract:               ${PRIVATE_SUPPLY_ADAPTER}"
echo "Verifier URL:           ${BLOCKSCOUT_VERIFIER_URL}"
echo "Constructor args source: PRIVATE_EMPORIUM, AAVE_POOL, SUPPLY_TOKEN, VAULT_FACTORY"

forge verify-contract \
  --rpc-url "${RPC_URL}" \
  "${PRIVATE_SUPPLY_ADAPTER}" \
  contracts/PrivateSupplyAdapter.sol:PrivateSupplyAdapter \
  --constructor-args "${CONSTRUCTOR_ARGS}" \
  --verifier blockscout \
  --verifier-url "${BLOCKSCOUT_VERIFIER_URL}" \
  --watch

echo "PrivateSupplyAdapter verification command completed."
