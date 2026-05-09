pragma circom 2.1.6;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// NOTE: `template` is a reserved keyword in circom (used to declare circuits),
// so we use `tpl` for biometric template signals throughout this file.

/// Registration: proves H(tpl || salt) == commitment
template BiometricCommitment() {
    signal input tpl[8];        // 8 x 32-bit chunks = 256-bit biometric template
    signal input salt;
    signal input commitment;    // public

    component hasher = Poseidon(9);
    for (var i = 0; i < 8; i++) {
        hasher.inputs[i] <== tpl[i];
    }
    hasher.inputs[8] <== salt;
    commitment === hasher.out;
}

/// Verification: proves Hamming(registered, new) < threshold
template BiometricVerification() {
    signal input registered_tpl[8];
    signal input new_tpl[8];
    signal input salt;
    signal input commitment;    // public
    signal input threshold;     // public

    // Re-prove H(registered_tpl || salt) == commitment
    component hasher = Poseidon(9);
    for (var i = 0; i < 8; i++) {
        hasher.inputs[i] <== registered_tpl[i];
    }
    hasher.inputs[8] <== salt;
    commitment === hasher.out;

    // Bit-decompose both templates and accumulate Hamming distance
    component reg_bits[8];
    component new_bits[8];
    signal xor_bits[256];
    signal hamming_sum[257];
    hamming_sum[0] <== 0;

    for (var i = 0; i < 8; i++) {
        reg_bits[i] = Num2Bits(32);
        new_bits[i] = Num2Bits(32);
        reg_bits[i].in <== registered_tpl[i];
        new_bits[i].in <== new_tpl[i];
        for (var j = 0; j < 32; j++) {
            var idx = i * 32 + j;
            xor_bits[idx] <== reg_bits[i].out[j] + new_bits[i].out[j] - 2 * reg_bits[i].out[j] * new_bits[i].out[j];
            hamming_sum[idx + 1] <== hamming_sum[idx] + xor_bits[idx];
        }
    }

    component lt = LessThan(9);
    lt.in[0] <== hamming_sum[256];
    lt.in[1] <== threshold;
    lt.out === 1;
}

// Toggle: Registration or Verification
component main {public [commitment]} = BiometricCommitment();
// component main {public [commitment, threshold]} = BiometricVerification();
