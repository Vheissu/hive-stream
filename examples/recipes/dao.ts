// A community DAO: members fund a treasury, open proposals with a small
// deposit, vote with their Hive Power, and passed proposals pay out after a
// timelock during which the council can veto them.
import {
    Streamer,
    TimeAction,
    createContractCustomJsonOperation,
    createContractTransferOperation,
    createDaoContract
} from 'hive-stream';

const TREASURY = 'mydao';

const streamer = new Streamer({ env: true, username: TREASURY });

async function main() {
    await streamer.registerContract(createDaoContract({
        account: TREASURY,
        votingPower: 'hive-power',      // or 'engine-token' with tokenSymbol, or 'equal'
        quorum: '5000',                 // at least 5,000 HP must vote
        passThresholdBps: 6000,         // more than 60% of the votes cast must be in favour
        votingPeriodHours: 72,
        timelockHours: 24,
        proposalDeposit: '10.000',      // refunded once a proposal reaches quorum
        depositAsset: 'HIVE',
        admins: ['council-a', 'council-b']
    }));

    // Close finished votes and pay out proposals whose timelock has elapsed.
    await streamer.registerAction(new TimeAction('5m', 'dao-tally', 'dao', 'tally'));
    await streamer.registerAction(new TimeAction('5m', 'dao-execute', 'dao', 'execute'));

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// What a member's wallet broadcasts to open a proposal: the deposit, with the
// proposal in the memo.
export function proposalOperation(proposer: string) {
    return createContractTransferOperation({
        contract: 'dao',
        action: 'createProposal',
        payload: {
            proposalId: 'meetup-2026-11',
            title: 'Fund the November meetup',
            description: 'Venue hire and catering for 40 people.',
            payouts: [{ to: 'meetup-host', amount: '250.000', asset: 'HIVE' }]
        }
    }, { from: proposer, to: TREASURY, amount: '10.000 HIVE' });
}

// What a member's wallet broadcasts to vote. Posting authority is enough;
// the vote is weighted by the member's own Hive Power at the time it is cast.
export function voteOperation(member: string, proposalId: string, support: boolean) {
    return createContractCustomJsonOperation({
        contract: 'dao',
        action: 'vote',
        payload: { proposalId, support }
    }, { sender: member });
}

// A council member vetoing during the timelock needs active authority.
export function vetoOperation(admin: string, proposalId: string, reason: string) {
    return createContractCustomJsonOperation({
        contract: 'dao',
        action: 'vetoProposal',
        payload: { proposalId, reason }
    }, { sender: admin, authority: 'active' });
}

// Anyone can fund the treasury with a transfer to @mydao and this memo:
// {"hive_stream":{"contract":"dao","action":"deposit","payload":{}}}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
