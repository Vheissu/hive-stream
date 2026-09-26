// A paid tournament for a game. Players enter by transfer, the game server
// (the oracle) posts scores, and prizes pay out automatically.
import {
    Streamer,
    TimeAction,
    createContractCustomJsonOperation,
    createTournamentContract
} from 'hive-stream';

const APP = 'mygame';

const streamer = new Streamer({ env: true, username: APP });

async function main() {
    await streamer.registerContract(createTournamentContract({
        account: APP,
        feeBps: 500,            // 5% house fee from the prize pool
        organizers: [APP],      // only the app can create tournaments
        oracles: [APP]          // and only the app can submit scores
    }));

    // Finalises tournaments whose end time has passed.
    await streamer.registerAction(new TimeAction('1m', 'tournament-finalize', 'tournaments', 'finalizeDue'));

    streamer.enableGracefulShutdown();
    await streamer.start();
}

// Called from your game backend. Both actions need active authority.
export async function createWeeklyCup(closesAt: Date, endsAt: Date) {
    const operation = createContractCustomJsonOperation({
        contract: 'tournaments',
        action: 'createTournament',
        payload: {
            tournamentId: `weekly-${closesAt.toISOString().slice(0, 10)}`,
            title: 'Weekly Cup',
            asset: 'HIVE',
            entryFee: '5.000',
            registrationClosesAt: closesAt.toISOString(),
            endsAt: endsAt.toISOString(),
            minPlayers: 4,
            prizeSplitBps: [6000, 3000, 1000]
        }
    }, { sender: APP, authority: 'active' });

    await streamer.broadcastOperations([operation]);
}

export async function reportScores(tournamentId: string, scores: Array<{ player: string; score: number }>) {
    const operation = createContractCustomJsonOperation({
        contract: 'tournaments',
        action: 'submitScores',
        payload: { tournamentId, scores }
    }, { sender: APP, authority: 'active' });

    await streamer.broadcastOperations([operation]);
}

// Players enter with a transfer of exactly the entry fee to @mygame and this memo:
// {"hive_stream":{"contract":"tournaments","action":"enter","payload":{"tournamentId":"weekly-2026-10-02"}}}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
