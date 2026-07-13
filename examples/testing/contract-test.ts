/**
 * Testing a contract with the hive-stream testing kit.
 *
 * Everything runs offline: blocks are simulated, broadcasts are captured,
 * and state lives in an in-memory SQLite database. In a real project you
 * would import from 'hive-stream' and 'hive-stream/testing'.
 */
import { action, defineContract, TimeAction } from '../../src';
import { createTestStreamer, hive } from '../../src/testing';

const doubleOrNothing = defineContract({
    name: 'doubleornothing',
    actions: {
        play: action(async (payload: { guess: 'heads' | 'tails' }, ctx) => {
            const result = ctx.block.number % 2 === 0 ? 'heads' : 'tails';

            if (payload.guess === result && ctx.transfer) {
                const doubled = (Number(ctx.transfer.amount) * 2).toFixed(3);
                await ctx.streamer.transferHiveTokens(
                    'myapp',
                    ctx.sender as string,
                    doubled,
                    ctx.transfer.asset,
                    `You won ${doubled} ${ctx.transfer.asset}!`
                );
            }
        }, { trigger: 'transfer' })
    }
});

async function main() {
    const ts = await createTestStreamer({
        username: 'myapp',
        // Any valid-format key works: broadcasts are captured, never sent
        activeKey: '5JdeC9P7Pbd1uGdFVEsJ41EkEnADbbHGq6p1BwFxm6txNBsQnsw'
    });

    await ts.streamer.registerContract(doubleOrNothing);

    // Simulate a player betting 1 HIVE
    await ts.contractTransfer({
        from: 'alice',
        contract: 'doubleornothing',
        action: 'play',
        payload: { guess: 'heads' },
        amount: hive(1)
    });

    console.log('Broadcasts captured:', ts.outgoingTransfers);

    // Time-based actions fire against simulated time
    await ts.streamer.registerAction(new TimeAction('1h', 'hourly-report', 'doubleornothing', 'play', {}, ts.currentTime));
    await ts.advanceTime('1h');

    await ts.stop();
}

main().catch(console.error);
