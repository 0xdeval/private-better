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

load_dotenv "${ENV_FILE}"

if ! command -v forge >/dev/null 2>&1; then
  echo "Error: forge is not installed or not in PATH." >&2
  exit 1
fi

if [[ -z "${AMOY_RPC_URL:-}" ]]; then
  echo "Error: AMOY_RPC_URL is missing in .env" >&2
  exit 1
fi

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY is missing in .env" >&2
  exit 1
fi

if ! [[ "${DEPLOYER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "Error: DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars." >&2
  exit 1
fi

echo "Deploying MockRailgun to Amoy..."
echo "RPC: ${AMOY_RPC_URL}"

DEPLOY_OUTPUT="$(forge create contracts/mocks/MockRailgun.sol:MockRailgun \
  --rpc-url "${AMOY_RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}" \
  --broadcast 2>&1)"

echo "${DEPLOY_OUTPUT}"

MOCK_RAILGUN_ADDRESS="$(echo "${DEPLOY_OUTPUT}" | sed -n 's/.*Deployed to: \(0x[0-9a-fA-F]\{40\}\).*/\1/p' | tail -n1)"

if [[ -z "${MOCK_RAILGUN_ADDRESS}" ]]; then
  if echo "${DEPLOY_OUTPUT}" | grep -qi "insufficient funds"; then
    echo "Error: deployment failed due to insufficient gas funds in deployer wallet." >&2
    echo "Top up POL on Amoy and run the script again." >&2
  else
    echo "Error: could not parse deployed address from forge output." >&2
    echo "If needed, run manually:" >&2
    echo "forge create contracts/mocks/MockRailgun.sol:MockRailgun --rpc-url \"\$AMOY_RPC_URL\" --private-key \"\$DEPLOYER_PRIVATE_KEY\" --broadcast" >&2
  fi
  exit 1
fi

echo
echo "MockRailgun deployed at: ${MOCK_RAILGUN_ADDRESS}"
echo "Add/update this in .env:"
echo "AMOY_MOCK_RAILGUN=${MOCK_RAILGUN_ADDRESS}"

