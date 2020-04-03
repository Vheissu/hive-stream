import DiceContract from '../../src/contracts/dice.contract';

describe('Dice Contract', () => {
    let sut;

    beforeEach(() => {
        sut = { ...DiceContract };

        sut['_client'] = {
            database: {
                getAccounts: jest.fn()
            }
        };
    });

    test('Gets balance', async () => {
        sut['_client'].database.getAccounts = jest.fn(() => Promise.resolve([
            {
                balance: '2000.234 HIVE'
            }
        ]));

        expect(sut.getBalance).resolves.toBe(2000.23);
    });
});