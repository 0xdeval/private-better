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
require_env DEPLOYER_PRIVATE_KEY
require_env AAVE_POOL
require_env SUPPLY_TOKEN
require_env VAULT_FACTORY
require_env PRIVATE_EMPORIUM

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

for key in AAVE_POOL SUPPLY_TOKEN VAULT_FACTORY; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done
if ! is_address "${PRIVATE_EMPORIUM}"; then
  echo "Error: PRIVATE_EMPORIUM must be a valid 0x address." >&2
  exit 1
fi

echo "Deploying PrivateSupplyAdapter..."
echo "RPC:              ${RPC_URL}"
echo "Emporium caller:  ${PRIVATE_EMPORIUM}"
echo "Aave pool:        ${AAVE_POOL}"
echo "Supply token:     ${SUPPLY_TOKEN}"
echo "Vault factory:    ${VAULT_FACTORY}"

DEPLOY_OUTPUT="$(forge create contracts/PrivateSupplyAdapter.sol:PrivateSupplyAdapter \
  --rpc-url "${RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}" \
  --broadcast \
  --constructor-args \
  "${PRIVATE_EMPORIUM}" \
  "${AAVE_POOL}" \
  "${SUPPLY_TOKEN}" \
  "${VAULT_FACTORY}" 2>&1)"

echo "${DEPLOY_OUTPUT}"

ADAPTER_ADDRESS="$(echo "${DEPLOY_OUTPUT}" | sed -n 's/.*Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p' | tail -n1)"

if [[ -z "${ADAPTER_ADDRESS}" ]]; then
  if echo "${DEPLOY_OUTPUT}" | grep -qi "insufficient funds"; then
    echo "Error: deployment failed due to insufficient gas funds in deployer wallet." >&2
    echo "Top up native gas token on the target chain and run the script again." >&2
  else
    echo "Error: could not parse deployed address from forge output." >&2
    echo "If needed, run manually:" >&2
    echo "forge create contracts/PrivateSupplyAdapter.sol:PrivateSupplyAdapter --rpc-url \"\$RPC_URL\" --private-key \"\$DEPLOYER_PRIVATE_KEY\" --broadcast --constructor-args \"\$PRIVATE_EMPORIUM\" \"\$AAVE_POOL\" \"\$SUPPLY_TOKEN\" \"\$VAULT_FACTORY\"" >&2
  fi
  exit 1
fi

echo
echo "PrivateSupplyAdapter deployed at: ${ADAPTER_ADDRESS}"
echo "Add/update these in .env:"
echo "PRIVATE_SUPPLY_ADAPTER=${ADAPTER_ADDRESS}"
echo "VITE_PRIVATE_SUPPLY_ADAPTER=${ADAPTER_ADDRESS}"
echo
echo "Setting factory adapter..."
cast send "${VAULT_FACTORY}" \
  "setAdapter(address)" "${ADAPTER_ADDRESS}" \
  --rpc-url "${RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
echo "Factory adapter set successfully."
