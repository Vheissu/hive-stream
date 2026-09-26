// Rules shared by the custody service and every operator. Operators must
// apply the same checks before minting: a deposit the custody refunds must
// never be minted on the other chain.
import type { BridgeContractOptions } from 'hive-stream';

export const CUSTODY = 'mybridge';

export const bridgeRules = {
    custodyAccount: CUSTODY,
    operators: ['bridge-op1', 'bridge-op2', 'bridge-op3'],
    threshold: 2,
    assets: ['HIVE', 'HBD'],
    chains: ['eth'],
    addressPattern: { eth: /^0x[0-9a-fA-F]{40}$/ },
    feeBps: 25,
    minAmount: '1.000',
    maxPerTx: '5000.000',
    dailyLimit: '50000.000'
} satisfies BridgeContractOptions;

export function passesStaticRules(chain: string | undefined, address: string | undefined, amount: string, asset: string): boolean {
    if (!chain || !address || !bridgeRules.chains.includes(chain) || !bridgeRules.assets.includes(asset)) {
        return false;
    }

    if (!bridgeRules.addressPattern.eth.test(address)) {
        return false;
    }

    const value = Number(amount);

    return value >= Number(bridgeRules.minAmount) && value <= Number(bridgeRules.maxPerTx);
}

// What to mint: the deposit minus the fee, rounded the same way the contract
// rounds it (fee down to 0.001). Integer milli-units avoid float drift.
export function netAmount(amount: string): string {
    const [whole, fraction = ''] = amount.split('.');
    const milli = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
    const fee = (milli * BigInt(bridgeRules.feeBps)) / 10000n;
    const net = milli - fee;

    return `${net / 1000n}.${(net % 1000n).toString().padStart(3, '0')}`;
}
