const CONTRACT_NAME = 'hivedice';

const ACCOUNT = 'hivedice';

const HOUSE_EDGE = 0.05;
const MIN_BET = 1;
const MAX_BET = 10;

export default {
    create: () => {
        // Runs every time register is called on this contract
    },

    destroy: () => {
        // Runs every time unregister is run for this contract
    },

    roll: (payload: { roll: number, amount: string, direction: string }, { sender, isSignedWithActiveKey }) => {
        const { roll, amount, direction } = payload;

        console.log(sender, isSignedWithActiveKey);

        console.log(roll, amount, direction);
        
        if (roll >= 2 && roll <= 96) {

        }
    }
};