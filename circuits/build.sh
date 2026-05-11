#!/usr/bin/env bash
# BreathPrint circuit build pipeline
#
# Tries multiple Powers of Tau mirrors; falls back to a small local
# ceremony (2^12) if every download fails.

set -euo pipefail

CIRCUIT_NAME="breath_identity"
BUILD_DIR="build"
PTAU_POWER=14
PTAU_FILE="${BUILD_DIR}/powersOfTau28_hez_final_${PTAU_POWER}.ptau"

# Mirrors to try in order. First non-403/200 wins.
PTAU_MIRRORS=(
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
  "https://www.dropbox.com/s/d3iknvkwf16ozm6/powersOfTau28_hez_final_14.ptau?dl=1"
)

mkdir -p "${BUILD_DIR}"

echo "▸ [1/4] Compiling ${CIRCUIT_NAME}.circom"
circom "${CIRCUIT_NAME}.circom" \
  --r1cs --wasm --sym \
  -o "${BUILD_DIR}" \
  -l node_modules

echo "▸ [2/4] Acquiring Powers of Tau (2^${PTAU_POWER})"

acquired=0
if [ -f "${PTAU_FILE}" ] && [ "$(stat -c %s "${PTAU_FILE}" 2>/dev/null || stat -f %z "${PTAU_FILE}")" -gt 1000000 ]; then
  echo "  ✓ ptau already present, skipping download"
  acquired=1
fi

if [ $acquired -eq 0 ]; then
  for url in "${PTAU_MIRRORS[@]}"; do
    echo "  trying $url"
    if curl -L --fail --max-time 120 --retry 2 -o "${PTAU_FILE}" "$url" 2>&1; then
      size=$(stat -c %s "${PTAU_FILE}" 2>/dev/null || stat -f %z "${PTAU_FILE}")
      if [ "$size" -gt 1000000 ]; then
        echo "  ✓ downloaded ($(( size / 1024 / 1024 )) MB)"
        acquired=1
        break
      fi
    fi
    rm -f "${PTAU_FILE}"
  done
fi

if [ $acquired -eq 0 ]; then
  echo "  ⚠ All ptau mirrors failed. Running tiny local ceremony (2^12 = 4096) instead."
  PTAU_POWER=12
  PTAU_FILE="${BUILD_DIR}/pot12_final.ptau"
  if [ ! -f "${PTAU_FILE}" ]; then
    npx snarkjs powersoftau new bn128 12 "${BUILD_DIR}/pot12_0000.ptau"
    echo "BreathPrint" | npx snarkjs powersoftau contribute \
      "${BUILD_DIR}/pot12_0000.ptau" "${BUILD_DIR}/pot12_0001.ptau" \
      --name="local" -e="$(openssl rand -hex 32)"
    npx snarkjs powersoftau prepare phase2 \
      "${BUILD_DIR}/pot12_0001.ptau" "${PTAU_FILE}"
  fi
fi

echo "▸ [3/4] Groth16 setup"
npx snarkjs groth16 setup \
  "${BUILD_DIR}/${CIRCUIT_NAME}.r1cs" \
  "${PTAU_FILE}" \
  "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey"

echo "▸ [4/4] Export verification key"
npx snarkjs zkey export verificationkey \
  "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
  "${BUILD_DIR}/verification_key.json"

echo ""
echo "✓ Build complete. Artifacts in ${BUILD_DIR}/"
echo "  - ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
echo "  - ${CIRCUIT_NAME}_final.zkey"
echo "  - verification_key.json"
