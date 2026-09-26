// Rules for the custody service. Operators don't need a copy: with receipts
// on, the custody account publishes its verdict on every deposit, and
// operators mint only deposits it accepted.
import type { BridgeContractOptions } from 'hive-stream';

export const CUSTODY = 'mybridge';

// The custom_json id the custody account publishes deposit receipts under.
export const RECEIPTS_ID = 'mybridge-receipts';

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
    dailyLimit: '50000.000',
    receipts: { id: RECEIPTS_ID }
} satisfies BridgeContractOptions;
