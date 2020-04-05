import DiceContract from '../../src/contracts/dice.contract';

describe('Dice Contract', () => {
    const sut: any = DiceContract;

    beforeEach(() => {
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

        expect(sut.getBalance()).resolves.toBe(2000.234);
    });

    test('Balance call does not have an account', async () => {
        sut['_client'].database.getAccounts = jest.fn(() => Promise.resolve(null));

        expect(sut.getBalance()).resolves.toBeNull();
    });

    test('winning roll and transfers winnings', async () => {
        const payload = {
            roll: '90'
        };

        const args = {
            sender: 'beggars',
            amount: '9.234 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '250.123'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '9.747', 'HIVE', 'You won 9.747 HIVE. Roll: 51, Your guess: 90');
    });

    test('losing roll and does not transfer anything', async () => {
        const payload = {
            roll: '22'
        };

        const args = {
            sender: 'beggars',
            amount: '9.234 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '250.123'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '0.001', 'HIVE', 'You lost 9.234 HIVE. Roll: 51, Your guess: 22');
    });

    test('winning roll, but account has insufficient balance and refunds the bet', async () => {
        const payload = {
            roll: '78'
        };

        const args = {
            sender: 'beggars',
            amount: '9.234 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '10.000'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '9.234', 'HIVE', '[Refund] The server could not fufill your bet.');
    });

    test('balance remaining is less than the maximum bet amount', async () => {
        const payload = {
            roll: '78'
        };

        const args = {
            sender: 'beggars',
            amount: '9.234 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '8.000'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '9.234', 'HIVE', '[Refund] The server could not fufill your bet.');
    });

    test('bet amount was higher than the maximum', async () => {
        const payload = {
            roll: '43'
        };

        const args = {
            sender: 'beggars',
            amount: '52.023 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '10.000'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '52.023', 'HIVE', '[Refund] You sent an invalid bet amount.');
    });

    test('roll amount was higher than the maximum, refund the user', async () => {
        const payload = {
            roll: '99'
        };

        const args = {
            sender: 'beggars',
            amount: '9.023 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '100.000'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '9.023', 'HIVE', '[Refund] Invalid bet params.');
    });

    test('winning roll, but account has insufficient balance and refunds the bet', async () => {
        const payload = {
            roll: '78'
        };

        const args = {
            sender: 'beggars',
            amount: '9.234 HIVE'
        };

        sut['_instance'] = {
            client: {
                database: {
                    getAccounts: jest.fn().mockResolvedValue([{
                        balance: '10.000'
                    }])
                }
            },
            getTransaction: jest.fn(),
            transferHiveTokens: jest.fn(),
            verifyTransfer: jest.fn().mockResolvedValue(true)
        };

        sut['blockId'] = '473847834';
        sut['previousBlockId'] = 'fdf34342342342342sdfgsdgsdg';
        sut['transactionId'] = 'jfkdjfkdf777jhfjshdf';

        await sut['roll'](payload, args);

        expect(sut['_instance']['transferHiveTokens']).toBeCalledWith('beggars', 'beggars', '9.234', 'HIVE', '[Refund] The server could not fufill your bet.');
    });
});