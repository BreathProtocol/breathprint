#!/usr/bin/env bash
# BreathPrint circuit build pipeline
#
# Uses Hermez's pre-computed Powers of Tau (canonical, used by the wider
# circom/snarkjs community) instead of running the ceremony from scratch.
# This skips ~5 min of single-threaded compute on slow Codespaces.
#
# Output: build/breath_identity.r1cs, build/breath_identity_js/,
#         build/breath_identity_final.zkey, build/verification_key.json
#
# Requirements: circom, snarkjs (via npm), node >= 18, curl.

set -euo pipefail

CIRCUIT_NAME="breath_identity"
BUILD_DIR="build"

# 2^14 = 16384 constraints. Our BiometricCommitment circuit is ~3k constraints,
# so this is more than enough. Smaller ptau → faster groth16 setup.
PTAU_POWER=14
PTAU_FILE="${BUILD_DIR}/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${PTAU_POWER}.ptau"

mkdir -p "${BUILD_DIR}"

echo "▸ [1/4] Compiling ${CIRCUIT_NAME}.circom"
circom "${CIRCUIT_NAME}.circom" \
  --r1cs --wasm --sym \
  -o "${BUILD_DIR}" \
  -l node_modules

echo "▸ [2/4] Fetching Hermez Powers of Tau (2^${PTAU_POWER}, ~9 MB)"
if [ ! -f "${PTAU_FILE}" ]; then
  curl -L --fail --retry 3 -o "${PTAU_FILE}" "${PTAU_URL}"
else
  echo "  ✓ ptau exists, skipping download"
fi

echo "▸ [3/4] Groth16 setup (using Hermez phase 2 ptau)"
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
echo "  - ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm   (prover witness)"
echo "  - ${CIRCUIT_NAME}_final.zkey                (proving key)"
echo "  - verification_key.json                       (verifier key)"
