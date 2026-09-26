// Browser code for a dice frontend: build the bet memo for Hive Keychain and
// verify a settled bet once the server seed is revealed. hive-stream/client
// has no Node dependencies, so this runs in any bundler.
import { createContractMemo, verifyOutcome } from 'hive-stream/client';

const HOUSE = 'myhouse';

declare const hive_keychain: {
    requestTransfer(
        account: string,
        to: string,
        amount: string,
        memo: string,
        currency: string,
        callback: (response: { success: boolean; message?: string }) => void
    ): void;
};

export function placeBet(player: string, amount: string, rollUnder: number, clientSeed?: string) {
    const memo = createContractMemo({
        contract: 'hivedice',
        action: 'roll',
        payload: { roll: rollUnder, ...(clientSeed ? { seed: clientSeed } : {}) }
    });

    return new Promise<void>((resolve, reject) => {
        hive_keychain.requestTransfer(player, HOUSE, amount, memo, 'HIVE', (response) => {
            if (response.success) {
                resolve();
            } else {
                reject(new Error(response.message ?? 'Transfer was not signed'));
            }
        });
    });
}

// `proof` comes from the bet's contract event, `serverSeed` from the
// rotation that revealed it.
export function checkBet(
    proof: { serverSeedHash: string; clientSeed: string; nonce: number; entropy?: string },
    serverSeed: string,
    settledRoll: number
) {
    const result = verifyOutcome(
        { serverSeed, ...proof },
        { type: 'dice', sides: 100 },
        settledRoll
    );

    return {
        fair: result.valid,
        commitmentMatches: result.commitmentValid,
        expectedRoll: result.outcome
    };
}
