import seedrandom from 'seedrandom';

const CONTRACT_NAME = 'hivedice';

const ACCOUNT = 'hivedice';

const HOUSE_EDGE = 0.05;
const MIN_BET = 1;
const MAX_BET = 10;

const rng = (previousBlockId, blockId, transactionId) => {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * 100) + 1;

    return randomRoll;
};

const VALID_CURRENCIES = ['HIVE', 'HBD'];

class DiceContract {
    private blockNumber: number;
    private blockId;
    private previousBlockId;
    private transactionId;

    create() {
        // Runs every time register is called on this contract
    }

    destroy() {
        // Runs every time unregister is run for this contract
    }

    updateBlockInfo(blockNumber, blockId, previousBlockId, transactionId) {
        // Lifecycle method which sets block info 
        this.blockNumber = blockNumber;
        this.blockId = blockId;
        this.previousBlockId = previousBlockId;
        this.transactionId = transactionId;
    }

    async roll(payload: { roll: number, direction: string }, { sender, amount }) {
        const { roll, direction } = payload;

        const amountTrim = amount.split(' ');

        const amountParsed = parseInt(amountTrim[0]);
        const amountFormatted = parseInt(amountTrim[0]).toFixed(3);
        const amountCurrency = amountTrim[1].trim();

        console.log(`Roll: ${roll} 
                     Direction: ${direction} 
                     Amount parsed: ${amountParsed} 
                     Amount formatted: ${amountFormatted} 
                     Currency: ${amountCurrency}`);

        const transaction = await Utils.getTransaction(this._client, this.blockNumber, this.transactionId);
        const verify = await Utils.verifyTransfer(transaction, sender, 'beggars', amount);

        // Transfer is valid
        if (verify) {
            // Bet amount is valid
            if (amountParsed >= MIN_BET && amountParsed <= MAX_BET) {
                // Validate roll is valid
            if ((roll >= 2 && roll <= 96) && (direction === 'lesserThan' || direction === 'greaterThan') && VALID_CURRENCIES.includes(amountCurrency)) {
                const rolledValue = rng(this.previousBlockId, this.blockId, this.transactionId);

                console.log(rolledValue);   
            }
            }
        }
    }
}

export default new DiceContract();