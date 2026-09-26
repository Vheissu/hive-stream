// One bridge operator. Each operator runs this with its own Hive account and
// active key, watches deposits to the custody account, mints on the other
// chain, and attests. The custody service acts once two operators agree.
import { Streamer, createContractCustomJsonOperation, operationRecordId } from 'hive-stream';
import { CUSTODY, netAmount, passesStaticRules } from './bridge-config';

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
    // beforeOperation sees the transaction id and operation index, which
    // together form the bridge's deposit id.
    operator.hook('beforeOperation', async ({ type, data, transactionId, operationIndex }) => {
        if (type !== 'transfer' || data.to !== CUSTODY) {
            return;
        }

        let deposit: { chain?: string; address?: string } | undefined;

        try {
            deposit = JSON.parse(data.memo)?.hive_stream?.payload;
        } catch {
            return;
        }

        const [amount, asset] = String(data.amount).split(' ');

        // The custody refunds deposits that break its rules; never mint those.
        // Rolling daily limits aren't checked here, so keep them generous or
        // confirm the deposit is pending with the custody service first.
        if (!passesStaticRules(deposit?.chain, deposit?.address, amount, asset)) {
            return;
        }

        const externalTxId = await mintOnEthereum(deposit!.address!, netAmount(amount), asset);
        await attest(operationRecordId(transactionId, operationIndex), externalTxId);
    });

    operator.enableGracefulShutdown();
    await operator.start();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
