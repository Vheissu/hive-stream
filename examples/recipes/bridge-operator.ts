// One bridge operator. Each operator runs this with its own Hive account and
// active key, watches the custody account's deposit receipts, mints accepted
// deposits on the other chain, and attests. The custody service acts once
// two operators agree.
import { Streamer, createContractCustomJsonOperation, type BridgeDepositReceipt } from 'hive-stream';
import { CUSTODY, RECEIPTS_ID } from './bridge-config';

const OPERATOR = 'bridge-op1';

// Your code: mint on the destination chain and return its transaction id.
declare function mintOnEthereum(address: string, amount: string, asset: string): Promise<string>;

const operator = new Streamer({ env: true, username: OPERATOR });

async function attest(depositId: string, externalTxId: string) {
    const operation = createContractCustomJsonOperation({
        contract: 'bridge',
        action: 'attestDeposit',
        payload: { depositId, decision: 'minted', externalTxId }
    }, { sender: OPERATOR, authority: 'active' });

    await operator.broadcastOperations([operation]);
}

async function main() {
    operator.onCustomJsonId(RECEIPTS_ID, async (data, { sender }) => {
        // Anyone can broadcast under this id; only the custody account's
        // receipts count.
        if (sender !== CUSTODY) {
            return;
        }

        const receipt = JSON.parse(data.json) as BridgeDepositReceipt;

        // Refunded deposits are already back with the user. Never mint them.
        if (receipt.type !== 'deposit' || receipt.status !== 'accepted') {
            return;
        }

        // The receipt carries the amount after the bridge fee, rounded the
        // same way the contract rounds it.
        const externalTxId = await mintOnEthereum(receipt.address, receipt.netAmount, receipt.asset);
        await attest(receipt.depositId, externalTxId);
    });

    operator.enableGracefulShutdown();
    await operator.start();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
