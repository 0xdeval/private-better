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

require_env AMOY_RPC_URL
require_env DEPLOYER_PRIVATE_KEY
require_env AMOY_RAILGUN_CALLBACK_SENDER
require_env AMOY_RAILGUN_SHIELD
require_env AMOY_AZURO_ADAPTER
require_env AMOY_USDC

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

for key in AMOY_RAILGUN_CALLBACK_SENDER AMOY_RAILGUN_SHIELD AMOY_AZURO_ADAPTER AMOY_USDC; do
  if ! is_address "${!key}"; then
    echo "Error: ${key} must be a valid 0x address." >&2
    exit 1
  fi
done

echo "Deploying PrivateBetAdapter to Amoy..."
echo "RPC: ${AMOY_RPC_URL}"
echo "Callback sender: ${AMOY_RAILGUN_CALLBACK_SENDER}"
echo "Railgun shield:  ${AMOY_RAILGUN_SHIELD}"
echo "Azuro adapter:   ${AMOY_AZURO_ADAPTER}"
echo "USDC:            ${AMOY_USDC}"

DEPLOY_OUTPUT="$(forge create contracts/PrivateBetAdapter.sol:PrivateBetAdapter \
  --rpc-url "${AMOY_RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}" \
  --broadcast \
  --constructor-args \
  "${AMOY_RAILGUN_CALLBACK_SENDER}" \
  "${AMOY_RAILGUN_SHIELD}" \
  "${AMOY_AZURO_ADAPTER}" \
  "${AMOY_USDC}" 2>&1)"

echo "${DEPLOY_OUTPUT}"

ADAPTER_ADDRESS="$(echo "${DEPLOY_OUTPUT}" | sed -n 's/.*Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p' | tail -n1)"

if [[ -z "${ADAPTER_ADDRESS}" ]]; then
  if echo "${DEPLOY_OUTPUT}" | grep -qi "insufficient funds"; then
    echo "Error: deployment failed due to insufficient gas funds in deployer wallet." >&2
    echo "Top up POL on Amoy and run the script again." >&2
  else
    echo "Error: could not parse deployed address from forge output." >&2
    echo "If needed, run manually:" >&2
    echo "forge create contracts/PrivateBetAdapter.sol:PrivateBetAdapter --rpc-url \"\$AMOY_RPC_URL\" --private-key \"\$DEPLOYER_PRIVATE_KEY\" --broadcast --constructor-args \"\$AMOY_RAILGUN_CALLBACK_SENDER\" \"\$AMOY_RAILGUN_SHIELD\" \"\$AMOY_AZURO_ADAPTER\" \"\$AMOY_USDC\"" >&2
  fi
  exit 1
fi

echo
echo "PrivateBetAdapter deployed at: ${ADAPTER_ADDRESS}"
echo "Add/update this in .env:"
echo "AMOY_PRIVATE_BET_ADAPTER=${ADAPTER_ADDRESS}"

