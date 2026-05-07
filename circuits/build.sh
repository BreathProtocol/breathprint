#!/usr/bin/env bash
# BreathPrint circuit build pipeline
#
# Output: build/breath_identity.r1cs, build/breath_identity_js/, build/breath_identity_final.zkey,
#         build/verification_key.json
#
# Requirements: circom (https://docs.circom.io/getting-started/installation/),
#               snarkjs (installed via this package), node >= 18.

set -euo pipefail

CIRCUIT_NAME="breath_identity"
BUILD_DIR="build"
PTAU_POWER=16  # 2^16 constraints — sufficient for both templates
PTAU_FILE="${BUILD_DIR}/pot${PTAU_POWER}_final.ptau"

mkdir -p "${BUILD_DIR}"

echo "▸ [1/5] Compiling ${CIRCUIT_NAME}.circom"
circom "${CIRCUIT_NAME}.circom" \
  --r1cs --wasm --sym \
  -o "${BUILD_DIR}" \
  -l node_modules

echo "▸ [2/5] Powers of Tau ceremony (bn128, 2^${PTAU_POWER})"
if [ ! -f "${PTAU_FILE}" ]; then
  npx snarkjs powersoftau new bn128 ${PTAU_POWER} "${BUILD_DIR}/pot${PTAU_POWER}_0000.ptau" -v
  npx snarkjs powersoftau contribute "${BUILD_DIR}/pot${PTAU_POWER}_0000.ptau" \
    "${BUILD_DIR}/pot${PTAU_POWER}_0001.ptau" \
    --name="BreathPrint contribution" -v -e="$(openssl rand -hex 32)"
  npx snarkjs powersoftau prepare phase2 \
    "${BUILD_DIR}/pot${PTAU_POWER}_0001.ptau" \
    "${PTAU_FILE}" -v
else
  echo "  ✓ ptau exists, skipping"
fi

echo "▸ [3/5] Groth16 setup"
npx snarkjs groth16 setup \
  "${BUILD_DIR}/${CIRCUIT_NAME}.r1cs" \
  "${PTAU_FILE}" \
  "${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey"

echo "▸ [4/5] Phase 2 contribution"
npx snarkjs zkey contribute \
  "${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey" \
  "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
  --name="BreathPrint phase 2" -v -e="$(openssl rand -hex 32)"

echo "▸ [5/5] Export verification key"
npx snarkjs zkey export verificationkey \
  "${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey" \
  "${BUILD_DIR}/verification_key.json"

echo ""
echo "✓ Build complete. Artifacts in ${BUILD_DIR}/"
echo "  - ${CIRCUIT_NAME}.wasm   (proving witness)"
echo "  - ${CIRCUIT_NAME}_final.zkey (proving key)"
echo "  - verification_key.json     (on-chain / verifier key)"
