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

require_env RPC_URL
require_env VAULT_FACTORY

if ! is_address "${VAULT_FACTORY}"; then
  echo "Error: VAULT_FACTORY must be a valid 0x address." >&2
  exit 1
fi

BLOCKSCOUT_VERIFIER_URL="${BLOCKSCOUT_VERIFIER_URL:-https://arbitrum.blockscout.com/api/}"
CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"

echo "Verifying VaultFactory on Blockscout..."
echo "RPC:                    ${RPC_URL}"
echo "Chain ID:               ${CHAIN_ID}"
echo "Contract:               ${VAULT_FACTORY}"
echo "Verifier URL:           ${BLOCKSCOUT_VERIFIER_URL}"

forge verify-contract \
  --rpc-url "${RPC_URL}" \
  "${VAULT_FACTORY}" \
  contracts/VaultFactory.sol:VaultFactory \
  --verifier blockscout \
  --verifier-url "${BLOCKSCOUT_VERIFIER_URL}" \
  --watch

echo "VaultFactory verification command completed."
